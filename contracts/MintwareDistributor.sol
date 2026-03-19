// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MintwareDistributor
 * @notice Phase 1 settlement contract for Mintware campaign rewards.
 *
 * @dev Gas model (zero operational gas for Mintware):
 *   - Teams     call depositCampaign() to fund a campaign      (they pay gas)
 *   - Mintware  signs cumulative Merkle roots off-chain EIP-712 (ZERO gas)
 *   - Users     call claim() with proof + oracle sig            (they pay gas)
 *
 * Fee model:
 *   The contract has NO fee logic.  Fees (Mintware cut, referrer rewards,
 *   buyer rebates) are calculated off-chain per swap event, tracked in
 *   Supabase, and included as normal Merkle leaves at epoch settlement.
 *   The Mintware treasury wallet claims its accumulated fees via claim()
 *   exactly like any other participant.
 *
 *   Points campaigns:  no fee logic runs, period.
 *   Reward pool campaigns: fees come out of the pool based on percentages
 *   set at campaign creation — never additive on top.
 *
 * Cumulative claims:
 *   Each Merkle leaf encodes the wallet's TOTAL earned to date across all
 *   epochs.  The contract tracks claimedCumulative[wallet] and pays the
 *   delta on each claim.  Users who skip epochs claim everything owed in
 *   one transaction.  Pattern used by Curve, Convex, and Aura.
 *
 * Sweep:
 *   After a campaign's end date, unclaimed tokens can be recovered by the
 *   owner — prevents permanent lockup from wallets that never return.
 *
 * Trust model:
 *   The oracle signer attests to each epoch's cumulative Merkle root via
 *   EIP-712.  It cannot move tokens directly — tokens only exit via
 *   valid claim() calls satisfying both the oracle signature and the
 *   Merkle proof.  The signer is rotatable by the owner.
 *
 * Multi-chain:
 *   Same bytecode on every EVM chain.  EIP-712 domain includes chainId +
 *   verifyingContract — signatures are chain-specific, cannot be replayed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEAF ENCODING (must match merkleBuilder.ts StandardMerkleTree exactly)
 * ─────────────────────────────────────────────────────────────────────────────
 *   keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))
 *   Uses abi.encode (ABI-padded, 64 bytes).  Double-hash prevents
 *   second-preimage attacks on interior tree nodes.
 *   The uint256 is the CUMULATIVE amount (total earned to date).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORACLE SIGNATURE (EIP-712)
 * ─────────────────────────────────────────────────────────────────────────────
 *   OracleRoot(bytes32 campaignId, uint256 epochNumber, bytes32 merkleRoot)
 *   campaignId = keccak256(bytes(campaignIdString))
 *
 *   Backend (onchainPublisher.ts) calls account.signTypedData():
 *     domain: { name: "MintwareDistributor", version: "1", chainId, verifyingContract }
 *
 *   Stored in Supabase distributions.oracle_signature.
 *   Users fetch it from GET /api/claim and pass it to claim().
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract MintwareDistributor is EIP712, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ─── EIP-712 ──────────────────────────────────────────────────────────────

    bytes32 public constant ROOT_TYPEHASH = keccak256(
        "OracleRoot(bytes32 campaignId,uint256 epochNumber,bytes32 merkleRoot)"
    );

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Oracle signer — rotatable by owner via setOracleSigner().
    address public oracleSigner;

    /// @notice campaignIdHash → ERC-20 reward token.
    ///         Set on first deposit; immutable thereafter.
    mapping(bytes32 => address) public campaignToken;

    /// @notice campaignIdHash → token balance available for claims.
    mapping(bytes32 => uint256) public campaignBalance;

    /// @notice campaignIdHash → campaign end timestamp (unix seconds).
    ///         0 = no end date set (sweep disabled).
    mapping(bytes32 => uint64) public campaignEndDate;

    /// @notice campaignIdHash → wallet → total tokens claimed to date (cumulative).
    mapping(bytes32 => mapping(address => uint256)) public claimedCumulative;

    // ─── Events ───────────────────────────────────────────────────────────────

    event CampaignFunded(
        bytes32 indexed campaignIdHash,
        string          campaignId,
        address indexed token,
        uint256         amount,
        address indexed funder
    );

    event Claimed(
        bytes32 indexed campaignIdHash,
        string          campaignId,
        uint256 indexed epochNumber,
        address indexed wallet,
        uint256         amount,
        uint256         newCumulativeTotal
    );

    event CampaignEndDateSet(
        bytes32 indexed campaignIdHash,
        string          campaignId,
        uint64          endDate
    );

    event Swept(
        bytes32 indexed campaignIdHash,
        string          campaignId,
        address indexed to,
        uint256         amount
    );

    event OracleSignerUpdated(address indexed oldSigner, address indexed newSigner);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param initialOwner        Contract owner (pause, rotate oracle, sweep).
     * @param initialOracleSigner Mintware oracle that signs Merkle roots off-chain.
     */
    constructor(address initialOwner, address initialOracleSigner)
        EIP712("MintwareDistributor", "1")
        Ownable(initialOwner)
    {
        require(initialOracleSigner != address(0), "MintwareDistributor: zero oracle");
        oracleSigner = initialOracleSigner;
    }

    // ─── Owner functions ──────────────────────────────────────────────────────

    /**
     * @notice Rotate the oracle signer key.
     * @dev Old signatures become invalid immediately — users must re-fetch
     *      from /api/claim before retrying their claim.
     */
    function setOracleSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "MintwareDistributor: zero address");
        emit OracleSignerUpdated(oracleSigner, newSigner);
        oracleSigner = newSigner;
    }

    /**
     * @notice Set or update a campaign's end date for sweep eligibility.
     * @param endDate Unix timestamp (seconds). Pass 0 to disable sweep.
     */
    function setCampaignEndDate(string calldata campaignId, uint64 endDate)
        external onlyOwner
    {
        bytes32 cIdHash = keccak256(bytes(campaignId));
        campaignEndDate[cIdHash] = endDate;
        emit CampaignEndDateSet(cIdHash, campaignId, endDate);
    }

    /// @notice Pause all deposits and claims. Emergency use only.
    function pause()   external onlyOwner { _pause(); }

    /// @notice Resume after a pause.
    function unpause() external onlyOwner { _unpause(); }

    // ─── Team deposit ─────────────────────────────────────────────────────────

    /**
     * @notice Fund a campaign with reward tokens.
     *
     * @dev Caller must ERC-20 approve this contract for `amount` first.
     *      Full amount enters the campaign balance — no fee deduction here.
     *      Fees (Mintware cut, referrer, buyer rebate) are calculated off-chain
     *      and distributed as Merkle leaves at epoch settlement.
     *
     *      The first deposit permanently locks in the token for this campaign.
     *      Multiple addresses may top up the same campaign.
     *
     * @param campaignId  Mintware campaign UUID (matches Supabase campaigns.id).
     * @param token       ERC-20 reward token address.
     * @param amount      Deposit amount in token base units.
     */
    function depositCampaign(
        string  calldata campaignId,
        address          token,
        uint256          amount
    ) external whenNotPaused {
        require(bytes(campaignId).length > 0, "MintwareDistributor: empty campaignId");
        require(token  != address(0),         "MintwareDistributor: invalid token");
        require(amount >  0,                  "MintwareDistributor: zero amount");

        bytes32 cIdHash = keccak256(bytes(campaignId));

        if (campaignToken[cIdHash] == address(0)) {
            campaignToken[cIdHash] = token;
        } else {
            require(
                campaignToken[cIdHash] == token,
                "MintwareDistributor: token mismatch for campaign"
            );
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        campaignBalance[cIdHash] += amount;

        emit CampaignFunded(cIdHash, campaignId, token, amount, msg.sender);
    }

    // ─── User claim ───────────────────────────────────────────────────────────

    /**
     * @notice Claim earned tokens using a cumulative Merkle proof and an
     *         oracle-signed EIP-712 root attestation.
     *
     * @dev CUMULATIVE MODEL:
     *      `cumulativeAmount` is the wallet's TOTAL earned across ALL epochs.
     *      The contract pays the delta: claimable = cumulativeAmount - claimedCumulative[wallet].
     *      A user who skips epochs claims everything owed in a single tx.
     *
     *      This function is called by:
     *        - Regular participants (LP points, referrers, referred buyers)
     *        - Mintware treasury wallet (auto-claimed by settlement server
     *          immediately after epoch signing, or manually at any time)
     *
     *      Verification order (cheapest first):
     *        1. Cumulative check         (arithmetic)
     *        2. Oracle EIP-712 signature (ecrecover)
     *        3. Merkle inclusion proof   (log2(n) hashes)
     *        4. Balance check            (SLOAD)
     *        5. Effects + transfer       (SSTORE + safeTransfer — CEI)
     *
     * @param campaignId       Campaign UUID string.
     * @param epochNumber      Epoch index (used in oracle sig domain separation).
     * @param merkleRoot       Root of the cumulative Merkle tree for this epoch.
     * @param oracleSignature  EIP-712 sig from oracleSigner over (campaignId, epochNumber, merkleRoot).
     * @param cumulativeAmount Wallet's TOTAL earned to date. Must exceed claimedCumulative.
     * @param merkleProof      Inclusion proof for (msg.sender, cumulativeAmount).
     */
    function claim(
        string    calldata campaignId,
        uint256            epochNumber,
        bytes32            merkleRoot,
        bytes     calldata oracleSignature,
        uint256            cumulativeAmount,
        bytes32[] calldata merkleProof
    ) external whenNotPaused {
        bytes32 cIdHash = keccak256(bytes(campaignId));

        // 1. Cumulative check
        uint256 alreadyClaimed = claimedCumulative[cIdHash][msg.sender];
        require(
            cumulativeAmount > alreadyClaimed,
            "MintwareDistributor: nothing new to claim"
        );
        uint256 claimable = cumulativeAmount - alreadyClaimed;

        // 2. Oracle EIP-712 signature
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            ROOT_TYPEHASH,
            cIdHash,
            epochNumber,
            merkleRoot
        )));
        require(
            ECDSA.recover(digest, oracleSignature) == oracleSigner,
            "MintwareDistributor: invalid oracle signature"
        );

        // 3. Merkle inclusion proof
        //    Leaf = keccak256(keccak256(abi.encode(address, uint256)))
        //    uint256 = cumulativeAmount (total earned, not per-epoch delta)
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(msg.sender, cumulativeAmount)))
        );
        require(
            MerkleProof.verify(merkleProof, merkleRoot, leaf),
            "MintwareDistributor: invalid proof"
        );

        // 4. Balance check
        require(
            campaignBalance[cIdHash] >= claimable,
            "MintwareDistributor: insufficient campaign balance"
        );

        // 5. Effects before interaction — CEI pattern
        claimedCumulative[cIdHash][msg.sender] = cumulativeAmount;
        campaignBalance[cIdHash] -= claimable;

        IERC20(campaignToken[cIdHash]).safeTransfer(msg.sender, claimable);

        emit Claimed(
            cIdHash, campaignId, epochNumber,
            msg.sender, claimable, cumulativeAmount
        );
    }

    // ─── Sweep ────────────────────────────────────────────────────────────────

    /**
     * @notice Recover unclaimed tokens after a campaign ends.
     * @dev Requires campaignEndDate to be set and passed.
     *      Prevents permanent token lockup from wallets that never claim.
     * @param campaignId Campaign UUID string.
     * @param to         Destination for the swept tokens (team or treasury).
     */
    function sweep(string calldata campaignId, address to) external onlyOwner {
        require(to != address(0), "MintwareDistributor: zero destination");

        bytes32 cIdHash = keccak256(bytes(campaignId));
        uint64 endDate  = campaignEndDate[cIdHash];

        require(endDate != 0,              "MintwareDistributor: no end date set");
        require(block.timestamp > endDate, "MintwareDistributor: campaign still active");

        uint256 remaining = campaignBalance[cIdHash];
        require(remaining > 0,             "MintwareDistributor: nothing to sweep");

        campaignBalance[cIdHash] = 0;
        IERC20(campaignToken[cIdHash]).safeTransfer(to, remaining);

        emit Swept(cIdHash, campaignId, to, remaining);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /// @notice Returns a wallet's lifetime claimed total for a campaign.
    function getClaimedCumulative(string calldata campaignId, address wallet)
        external view returns (uint256)
    {
        return claimedCumulative[keccak256(bytes(campaignId))][wallet];
    }

    /// @notice Returns the claimable delta for a wallet given a new cumulative amount.
    ///         Returns 0 if nothing new to claim.
    function getClaimable(
        string  calldata campaignId,
        address          wallet,
        uint256          cumulativeAmount
    ) external view returns (uint256) {
        uint256 already = claimedCumulative[keccak256(bytes(campaignId))][wallet];
        return cumulativeAmount > already ? cumulativeAmount - already : 0;
    }

    /// @notice Returns the token balance available for claims.
    function getCampaignBalance(string calldata campaignId)
        external view returns (uint256)
    {
        return campaignBalance[keccak256(bytes(campaignId))];
    }

    /// @notice Returns the reward token address (zero if not yet funded).
    function getCampaignToken(string calldata campaignId)
        external view returns (address)
    {
        return campaignToken[keccak256(bytes(campaignId))];
    }

    /// @notice Whether a campaign's end date has passed (sweep available).
    function isCampaignEnded(string calldata campaignId)
        external view returns (bool)
    {
        bytes32 cIdHash = keccak256(bytes(campaignId));
        uint64 endDate  = campaignEndDate[cIdHash];
        return endDate != 0 && block.timestamp > endDate;
    }

    /// @notice Compute the Merkle leaf hash for (wallet, cumulativeAmount).
    ///         Matches StandardMerkleTree from the openzeppelin merkle-tree package.
    function computeLeaf(address wallet, uint256 cumulativeAmount)
        external pure returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(wallet, cumulativeAmount))));
    }

    /**
     * @notice Returns the EIP-712 digest the oracle must sign for a given root.
     * @dev Use in tests and the signing backend to verify digest alignment.
     *
     *      TypeScript (viem signTypedData):
     *        domain: { name: "MintwareDistributor", version: "1",
     *                  chainId, verifyingContract: contractAddress }
     *        types:  { OracleRoot: [
     *                    { name: "campaignId",  type: "bytes32" },
     *                    { name: "epochNumber", type: "uint256" },
     *                    { name: "merkleRoot",  type: "bytes32" } ] }
     *        message: { campaignId: keccak256(toBytes(idString)),
     *                   epochNumber: BigInt(epoch), merkleRoot }
     */
    function getRootDigest(
        string  calldata campaignId,
        uint256          epochNumber,
        bytes32          merkleRoot
    ) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ROOT_TYPEHASH,
            keccak256(bytes(campaignId)),
            epochNumber,
            merkleRoot
        )));
    }
}
