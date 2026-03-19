// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MintwareDistributor
 * @notice Phase 1 settlement contract for Mintware campaign rewards.
 *
 * @dev Zero-oracle-gas architecture:
 *
 *   1. Team calls depositCampaign() → tokens locked in contract. They pay gas once.
 *   2. Oracle (Mintware backend) signs the Merkle root off-chain using EIP-712.
 *      No transaction, no gas, no on-chain action by Mintware.
 *   3. User calls claim() with their proof + the oracle's signature.
 *      Contract verifies signature + proof, transfers tokens. User pays their own gas.
 *
 * Gas summary:
 *   depositCampaign()  — team pays (once per campaign)
 *   Oracle signs root  — nobody pays (off-chain EIP-712)
 *   claim()            — user pays (their choice, their gas)
 *   Mintware forever:    zero ongoing gas cost
 *
 * Multi-chain: deploy identical bytecode on every EVM chain.
 * EIP-712 domain includes chainId — replay attacks across chains are impossible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEAF ENCODING — CRITICAL
 * ─────────────────────────────────────────────────────────────────────────────
 * Must match the openzeppelin/merkle-tree package StandardMerkleTree EXACTLY.
 *
 * TypeScript: StandardMerkleTree.of([[wallet, amount]], ['address', 'uint256'])
 *   standardLeafHash = keccak256(keccak256(abi.encode(address, uint256)))
 *
 * Solidity (this contract):
 *   keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))))
 *
 * Uses abi.encode (64-byte ABI-padded), NOT abi.encodePacked (52 bytes).
 * Double-keccak256 prevents second-preimage attacks on interior tree nodes.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EIP-712 ORACLE SIGNATURE
 * ─────────────────────────────────────────────────────────────────────────────
 * The oracle (DISTRIBUTOR_PRIVATE_KEY wallet) signs:
 *
 *   RootPublication(string campaignId, uint256 epochNumber, bytes32 merkleRoot)
 *
 * Domain: name="MintwareDistributor", version="1", chainId=<from EIP712>, verifyingContract=<this>
 *
 * TypeScript (viem):
 *   walletClient.signTypedData({ domain, types: { RootPublication: [...] }, primaryType, message })
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract MintwareDistributor is EIP712, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    bytes32 private constant ROOT_TYPEHASH = keccak256(
        "RootPublication(string campaignId,uint256 epochNumber,bytes32 merkleRoot)"
    );

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Oracle address authorised to sign Merkle roots. Immutable after deploy.
    address public immutable ORACLE_SIGNER;

    /// @notice ERC-20 token for each campaign. Set on first deposit; immutable after.
    mapping(string => address) public campaignToken;

    /// @notice Remaining claimable balance per campaign (decremented on each claim).
    mapping(string => uint256) public campaignBalances;

    /// @notice campaignId → epochNumber → wallet → has claimed
    mapping(string => mapping(uint256 => mapping(address => bool))) public claimed;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event CampaignFunded(
        string campaignId,
        address indexed token,
        uint256 amount,
        address indexed funder
    );

    event Claimed(
        string campaignId,
        uint256 indexed epochNumber,
        address indexed claimant,
        uint256 amount
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _oracleSigner Address of the oracle key that signs Merkle roots.
     *                      This is the DISTRIBUTOR_PRIVATE_KEY wallet on the backend.
     * @param initialOwner  Address that can pause/unpause. Can be a multisig.
     */
    constructor(address _oracleSigner, address initialOwner)
        EIP712("MintwareDistributor", "1")
        Ownable(initialOwner)
    {
        require(_oracleSigner != address(0), "MintwareDistributor: zero oracle signer");
        ORACLE_SIGNER = _oracleSigner;
    }

    // -------------------------------------------------------------------------
    // Team deposit — they pay gas, once per campaign
    // -------------------------------------------------------------------------

    /**
     * @notice Deposit tokens to fund a campaign's reward pool.
     * @dev One token per campaign. Token is immutable after first deposit.
     *      Caller must approve this contract for `amount` of `token` first.
     *      Anyone may top up an existing campaign (same token required).
     *
     * @param campaignId Off-chain identifier (Supabase UUID string).
     * @param token      ERC-20 token address to distribute.
     * @param amount     Number of tokens to deposit (in token base units).
     */
    function depositCampaign(
        string calldata campaignId,
        address token,
        uint256 amount
    ) external whenNotPaused {
        require(token != address(0), "MintwareDistributor: zero token");
        require(amount > 0, "MintwareDistributor: zero amount");

        // Enforce one token per campaign — immutable after first deposit
        if (campaignToken[campaignId] == address(0)) {
            campaignToken[campaignId] = token;
        } else {
            require(
                campaignToken[campaignId] == token,
                "MintwareDistributor: token mismatch for campaign"
            );
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        campaignBalances[campaignId] += amount;

        emit CampaignFunded(campaignId, token, amount, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Claim — user pays gas; oracle paid zero
    // -------------------------------------------------------------------------

    /**
     * @notice Claim tokens from a campaign epoch.
     *
     * @dev Three-step verification:
     *   1. Oracle EIP-712 signature — proves the root is legitimate.
     *      chainId is baked into the EIP-712 domain; cross-chain replay impossible.
     *   2. Merkle proof — proves this wallet's allocation in the root.
     *   3. Claimed mapping — prevents replay within the same (campaign, epoch).
     *
     * @param campaignId       Off-chain campaign identifier (Supabase UUID string).
     * @param epochNumber      Epoch index — scopes dedup per campaign epoch.
     * @param merkleRoot       Root signed by the oracle for this epoch.
     * @param oracleSignature  EIP-712 sig over (campaignId, epochNumber, merkleRoot).
     *                         Returned by /api/claim; submitted by the user's wallet.
     * @param amount           Token amount this wallet is entitled to.
     * @param merkleProof      Merkle inclusion proof for (msg.sender, amount).
     */
    function claim(
        string calldata campaignId,
        uint256 epochNumber,
        bytes32 merkleRoot,
        bytes calldata oracleSignature,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external whenNotPaused {
        require(amount > 0, "MintwareDistributor: zero amount");
        require(
            !claimed[campaignId][epochNumber][msg.sender],
            "MintwareDistributor: already claimed"
        );

        // ── 1. Verify oracle EIP-712 signature ─────────────────────────────
        // The oracle signed: keccak256(abi.encode(ROOT_TYPEHASH, keccak256(campaignId), epoch, root))
        // _hashTypedDataV4 wraps this with the domain separator automatically.
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            ROOT_TYPEHASH,
            keccak256(bytes(campaignId)),
            epochNumber,
            merkleRoot
        )));
        require(
            ECDSA.recover(digest, oracleSignature) == ORACLE_SIGNER,
            "MintwareDistributor: invalid oracle signature"
        );

        // ── 2. Verify Merkle proof ──────────────────────────────────────────
        // Leaf encoding matches the openzeppelin/merkle-tree StandardMerkleTree:
        //   keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(msg.sender, amount)))
        );
        require(
            MerkleProof.verify(merkleProof, merkleRoot, leaf),
            "MintwareDistributor: invalid proof"
        );

        // ── 3. Mark claimed (effect before interaction — prevents reentrancy)
        claimed[campaignId][epochNumber][msg.sender] = true;

        // ── 4. Transfer from campaign balance ──────────────────────────────
        address token = campaignToken[campaignId];
        require(token != address(0), "MintwareDistributor: campaign not funded");
        require(
            campaignBalances[campaignId] >= amount,
            "MintwareDistributor: insufficient campaign balance"
        );
        campaignBalances[campaignId] -= amount;

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Claimed(campaignId, epochNumber, msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Owner functions
    // -------------------------------------------------------------------------

    /// @notice Pause all deposits and claims. Emergency use only.
    function pause() external onlyOwner { _pause(); }

    /// @notice Resume operations after a pause.
    function unpause() external onlyOwner { _unpause(); }

    // -------------------------------------------------------------------------
    // View helpers
    // -------------------------------------------------------------------------

    /**
     * @notice Returns whether a wallet has claimed from a specific campaign epoch.
     */
    function isClaimed(
        string calldata campaignId,
        uint256 epochNumber,
        address wallet
    ) external view returns (bool) {
        return claimed[campaignId][epochNumber][wallet];
    }

    /**
     * @notice Compute the Merkle leaf hash for a (wallet, amount) pair.
     * @dev Matches StandardMerkleTree from the openzeppelin/merkle-tree package.
     *      Exposed for off-chain proof verification and test suite cross-checks.
     */
    function computeLeaf(
        address wallet,
        uint256 amount
    ) external pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(wallet, amount))));
    }

    /**
     * @notice Returns the EIP-712 digest the oracle must sign for a given root.
     * @dev Exposed for test suite and oracle signature pre-verification.
     *      The oracle signs this digest using signTypedData (viem) or eth_signTypedData.
     */
    function getRootDigest(
        string calldata campaignId,
        uint256 epochNumber,
        bytes32 merkleRoot
    ) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ROOT_TYPEHASH,
            keccak256(bytes(campaignId)),
            epochNumber,
            merkleRoot
        )));
    }
}
