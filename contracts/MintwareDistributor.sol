// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MintwareDistributor
 * @notice Phase 1 settlement contract for Mintware campaign rewards.
 *
 * @dev Implements the off-chain calculation → on-chain settlement pattern:
 *
 *   1. Mintware backend computes who earns what (epochProcessor.ts)
 *   2. Merkle tree is built off-chain (merkleBuilder.ts)
 *   3. Owner calls createDistribution() — funds locked in contract, root posted
 *   4. Wallets call claim() with their proof — trustless, non-custodial release
 *
 * Architecture:
 *   - Phase 1 (this contract): Merkle drop, Mintware trusted for calculation
 *   - Phase 2: EAS attestations — multipliers move on-chain
 *   - Phase 3: V4 hooks — fully on-chain, no cron or backend needed
 *
 * Multi-chain deployment: same ABI, same claim flow, different address per chain.
 * Campaigns route to the correct deployment via campaigns.contract_address.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEAF ENCODING — CRITICAL
 * ─────────────────────────────────────────────────────────────────────────────
 * Must match the openzeppelin/merkle-tree StandardMerkleTree EXACTLY.
 *
 * TypeScript (merkleBuilder.ts) via StandardMerkleTree.of():
 *   StandardMerkleTree.of([[wallet, amount]], ['address', 'uint256'])
 *   standardLeafHash = keccak256(keccak256(abi.encode(address, uint256)))
 *
 * Solidity (this contract):
 *   keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))))
 *
 * NOT abi.encodePacked — uses abi.encode (ABI-padded, 64 bytes per leaf).
 * Double-keccak256 prevents second-preimage attacks on tree nodes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract MintwareDistributor is Ownable, Pausable {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    struct Distribution {
        bytes32 merkleRoot;
        address token;
        uint256 totalAmount;
        uint256 claimedAmount;
        bool active;
    }

    /// @notice Auto-incrementing distribution ID counter. Starts at 0.
    uint256 public nextDistributionId;

    /// @notice distributionId → Distribution config
    mapping(uint256 => Distribution) public distributions;

    /// @notice distributionId → wallet → has claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event DistributionCreated(
        uint256 indexed distributionId,
        bytes32 indexed merkleRoot,
        address indexed token,
        uint256 totalAmount
    );

    event Claimed(
        uint256 indexed distributionId,
        address indexed wallet,
        uint256 amount
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address initialOwner) Ownable(initialOwner) {}

    // -------------------------------------------------------------------------
    // Owner functions
    // -------------------------------------------------------------------------

    /**
     * @notice Create a new token distribution backed by a Merkle root.
     * @dev Caller must approve this contract for `totalAmount` of `token` first.
     *      Tokens are pulled from caller into contract at time of creation.
     *      The root is immutable once posted — Mintware cannot alter allocations
     *      after this call.
     *
     * @param merkleRoot Root of the Merkle tree for this distribution.
     * @param token ERC-20 token address to distribute.
     * @param totalAmount Total tokens deposited for this distribution.
     * @return distributionId The auto-assigned ID of this distribution.
     */
    function createDistribution(
        bytes32 merkleRoot,
        address token,
        uint256 totalAmount
    ) external onlyOwner returns (uint256 distributionId) {
        require(merkleRoot != bytes32(0), "MintwareDistributor: invalid merkle root");
        require(token != address(0), "MintwareDistributor: invalid token");
        require(totalAmount > 0, "MintwareDistributor: zero amount");

        distributionId = nextDistributionId++;

        distributions[distributionId] = Distribution({
            merkleRoot: merkleRoot,
            token: token,
            totalAmount: totalAmount,
            claimedAmount: 0,
            active: true
        });

        // Pull tokens from owner → contract (requires prior ERC-20 approval)
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);

        emit DistributionCreated(distributionId, merkleRoot, token, totalAmount);
    }

    /**
     * @notice Pause all claim operations. Emergency use only.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume claim operations after a pause.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Claim
    // -------------------------------------------------------------------------

    /**
     * @notice Claim tokens from a distribution using a Merkle inclusion proof.
     * @dev Follows Checks-Effects-Interactions pattern:
     *      1. Verify proof (check)
     *      2. Mark claimed (effect)
     *      3. Transfer tokens (interaction)
     *
     *      Leaf encoding matches StandardMerkleTree (from the openzeppelin merkle-tree package):
     *        keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))))
     *
     * @param distributionId ID of the distribution to claim from.
     * @param amount Token amount this wallet is entitled to (must match tree leaf).
     * @param merkleProof Inclusion proof for the leaf (wallet, amount).
     */
    function claim(
        uint256 distributionId,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external whenNotPaused {
        Distribution storage dist = distributions[distributionId];

        require(dist.active, "MintwareDistributor: distribution not active");
        require(amount > 0, "MintwareDistributor: zero amount");
        require(
            !claimed[distributionId][msg.sender],
            "MintwareDistributor: already claimed"
        );

        // Leaf encoding: keccak256(keccak256(abi.encode(address, uint256)))
        // Matches StandardMerkleTree standardLeafHash() in @openzeppelin/merkle-tree.
        // abi.encode pads address to 32 bytes → 64 bytes total before first hash.
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(msg.sender, amount)))
        );

        require(
            MerkleProof.verify(merkleProof, dist.merkleRoot, leaf),
            "MintwareDistributor: invalid proof"
        );

        // Effects before interaction — prevents reentrancy
        claimed[distributionId][msg.sender] = true;
        dist.claimedAmount += amount;

        // Interaction — transfer tokens directly to claimant
        IERC20(dist.token).safeTransfer(msg.sender, amount);

        emit Claimed(distributionId, msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /**
     * @notice Returns whether a wallet has already claimed from a distribution.
     */
    function isClaimed(
        uint256 distributionId,
        address wallet
    ) external view returns (bool) {
        return claimed[distributionId][wallet];
    }

    /**
     * @notice Returns full distribution struct for a given ID.
     */
    function getDistribution(
        uint256 distributionId
    ) external view returns (Distribution memory) {
        return distributions[distributionId];
    }

    /**
     * @notice Compute the Merkle leaf hash for a (wallet, amount) pair.
     * @dev Exposed as a view function so the Ticket 6 claim API and test suite
     *      can verify off-chain encoding matches on-chain encoding exactly.
     *
     *      TypeScript equivalent (StandardMerkleTree from openzeppelin/merkle-tree):
     *        StandardMerkleTree.of([[wallet, amount]], ['address', 'uint256'])
     *        standardLeafHash(types, value)
     *        = keccak256(keccak256(abi.encode(address, uint256)))
     *
     * @param wallet The claimant address.
     * @param amount The token amount.
     * @return The leaf hash as it appears in the Merkle tree.
     */
    function computeLeaf(
        address wallet,
        uint256 amount
    ) external pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(wallet, amount))));
    }
}
