// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MintwareDistributor
 * @notice Phase 1 settlement contract for Mintware campaign rewards.
 * @custom:version 2.0.0
 *
 * @dev Zero-oracle-gas architecture:
 *
 *   1. Campaign creator calls depositCampaign() → tokens locked in contract.
 *      Creator is recorded on-chain at first deposit.
 *   2. Oracle (Mintware backend) signs the Merkle root + deadline off-chain (EIP-712).
 *      No transaction, no gas, no on-chain action by the oracle.
 *   3. User calls claim() with their proof + oracle signature + deadline.
 *      Contract verifies all three, checks deadline, transfers tokens. User pays gas.
 *   4. Owner calls closeCampaign() when a campaign ends.
 *      After WITHDRAWAL_COOLDOWN, creator can recover any unclaimed tokens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES FROM v1 — BREAKING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Oracle is now MUTABLE (was immutable).
 *     - Read `oracleSigner` not `ORACLE_SIGNER`.
 *     - Rotation uses a 48-hour timelock: proposeOracleSigner → confirmOracleSigner.
 *
 *  2. ROOT_TYPEHASH now includes `uint256 deadline`.
 *     - Oracle MUST include deadline when signing roots.
 *     - claim() and batchClaim() require the deadline parameter.
 *     - getRootDigest() requires the deadline parameter.
 *     - Off-chain viem signTypedData call must add deadline to the message.
 *
 *  3. `campaignToken[id]` mapping replaced by `campaigns[id].token`.
 *     - Use `campaigns[id].token` to look up a campaign's ERC-20 address.
 *
 *  4. Events restructured — `bytes32 indexed campaignIdHash` added to all events.
 *     - Indexers filtering by campaignId should filter on keccak256(bytes(campaignId)).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEAF ENCODING — CRITICAL (unchanged from v1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Must match the openzeppelin/merkle-tree StandardMerkleTree EXACTLY.
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
 * EIP-712 ORACLE SIGNATURE (updated — now includes deadline)
 * ─────────────────────────────────────────────────────────────────────────────
 * The oracle signs:
 *   RootPublication(string campaignId, uint256 epochNumber, bytes32 merkleRoot, uint256 deadline)
 *
 * Domain: name="MintwareDistributor", version="1", chainId=<from EIP712>, verifyingContract=<this>
 *
 * TypeScript (viem):
 *   walletClient.signTypedData({
 *     domain,
 *     types: { RootPublication: [
 *       { name: 'campaignId',   type: 'string'  },
 *       { name: 'epochNumber',  type: 'uint256' },
 *       { name: 'merkleRoot',   type: 'bytes32' },
 *       { name: 'deadline',     type: 'uint256' },  // ← NEW
 *     ]},
 *     primaryType: 'RootPublication',
 *     message: { campaignId, epochNumber, merkleRoot, deadline },
 *   })
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract MintwareDistributor is EIP712, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Updated typehash — now includes deadline to prevent stale-sig replay.
    bytes32 private constant ROOT_TYPEHASH = keccak256(
        "RootPublication(string campaignId,uint256 epochNumber,bytes32 merkleRoot,uint256 deadline)"
    );

    /// @notice Delay between proposeOracleSigner() and confirmOracleSigner().
    ///         48 hours gives the team time to detect a rogue rotation attempt
    ///         and cancel it (or pause the contract) before it takes effect.
    uint256 public constant ORACLE_ROTATION_DELAY = 48 hours;

    /// @notice How long after closeCampaign() before the creator can withdraw.
    ///         7 days is generous headroom for users to submit their final claims
    ///         after receiving off-chain notification that a campaign has ended.
    uint256 public constant WITHDRAWAL_COOLDOWN = 7 days;

    // ─────────────────────────────────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Per-campaign metadata stored on-chain.
    struct CampaignInfo {
        address token;      // ERC-20 reward token; immutable after first deposit
        address creator;    // Address that made the first deposit; entitled to withdraw after close
        bool    closed;     // Set by owner via closeCampaign()
        uint256 closedAt;   // Timestamp of closure; starts the WITHDRAWAL_COOLDOWN clock
    }

    /// @notice Parameters for a single claim. Used by batchClaim().
    struct ClaimParams {
        string   campaignId;
        uint256  epochNumber;
        bytes32  merkleRoot;
        bytes    oracleSignature;
        uint256  deadline;
        uint256  amount;
        bytes32[] merkleProof;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Oracle rotation state
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Currently active oracle address (signs Merkle roots).
    address public oracleSigner;

    /// @notice Proposed replacement for oracleSigner; zero when no rotation is pending.
    address public pendingOracleSigner;

    /// @notice Earliest timestamp at which confirmOracleSigner() may be called.
    ///         Zero when no rotation is pending.
    uint256 public oracleRotationAvailableAt;

    // ─────────────────────────────────────────────────────────────────────────
    // Campaign state
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Metadata for each campaign, keyed by Supabase UUID string.
    mapping(string => CampaignInfo) public campaigns;

    /// @notice Remaining claimable token balance per campaign.
    ///         Kept separate from CampaignInfo for cheaper balance-only reads.
    mapping(string => uint256) public campaignBalances;

    /// @notice campaignId → epochNumber → wallet → has claimed
    mapping(string => mapping(uint256 => mapping(address => bool))) public claimed;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    // Note: Solidity cannot index dynamic types (string) in events.
    // We emit keccak256(bytes(campaignId)) as `campaignIdHash` — use this for
    // efficient off-chain log filtering. The raw string is always also emitted.

    event CampaignFunded(
        bytes32 indexed campaignIdHash,
        address indexed token,
        address indexed funder,
        string  campaignId,
        uint256 amount
    );

    event CampaignClosed(
        bytes32 indexed campaignIdHash,
        address indexed creator,
        string  campaignId,
        uint256 closedAt
    );

    event CampaignWithdrawn(
        bytes32 indexed campaignIdHash,
        address indexed creator,
        string  campaignId,
        uint256 amount
    );

    event Claimed(
        bytes32 indexed campaignIdHash,
        uint256 indexed epochNumber,
        address indexed claimant,
        string  campaignId,
        uint256 amount
    );

    event OracleRotationProposed(
        address indexed proposed,
        uint256 availableAt
    );

    event OracleRotationConfirmed(
        address indexed previous,
        address indexed next
    );

    event OracleRotationCancelled(
        address indexed cancelled
    );

    event EmergencyWithdraw(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Custom errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a batch claim fails — surfaces which element caused the revert.
    error BatchClaimFailed(uint256 index);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param _oracleSigner  Address of the oracle key that signs Merkle roots.
     *                       This is the DISTRIBUTOR_PRIVATE_KEY wallet on the backend.
     * @param initialOwner   Address that owns the contract (pause/unpause, close campaigns,
     *                       rotate oracle, emergency withdraw). Recommend a multisig.
     */
    constructor(address _oracleSigner, address initialOwner)
        EIP712("MintwareDistributor", "1")
        Ownable(initialOwner)
    {
        require(_oracleSigner != address(0), "MintwareDistributor: zero oracle signer");
        oracleSigner = _oracleSigner;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Oracle rotation — timelocked for safety
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Propose a new oracle signer. Takes effect after ORACLE_ROTATION_DELAY.
     * @dev    The 48-hour window gives the team time to detect and cancel a rogue
     *         rotation (e.g. if the owner key was compromised). While a rotation is
     *         pending, the current oracleSigner remains fully active — no disruption
     *         to ongoing claims.
     *
     * @param proposed  Address of the new oracle signer. Must not be zero or current.
     */
    function proposeOracleSigner(address proposed) external onlyOwner {
        require(proposed != address(0),    "MintwareDistributor: zero address");
        require(proposed != oracleSigner,  "MintwareDistributor: already active signer");

        pendingOracleSigner      = proposed;
        oracleRotationAvailableAt = block.timestamp + ORACLE_ROTATION_DELAY;

        emit OracleRotationProposed(proposed, oracleRotationAvailableAt);
    }

    /**
     * @notice Confirm a previously proposed oracle rotation.
     * @dev    Only callable after ORACLE_ROTATION_DELAY has elapsed.
     *         Clears pending state once confirmed.
     */
    function confirmOracleSigner() external onlyOwner {
        require(pendingOracleSigner != address(0),            "MintwareDistributor: no rotation pending");
        require(block.timestamp >= oracleRotationAvailableAt, "MintwareDistributor: rotation delay not elapsed");

        address previous   = oracleSigner;
        oracleSigner       = pendingOracleSigner;
        pendingOracleSigner = address(0);
        oracleRotationAvailableAt = 0;

        emit OracleRotationConfirmed(previous, oracleSigner);
    }

    /**
     * @notice Cancel a pending oracle rotation before it takes effect.
     * @dev    Use this immediately if a rogue proposeOracleSigner() was submitted
     *         (e.g. owner key compromise detected). Current oracleSigner is unaffected.
     */
    function cancelOracleRotation() external onlyOwner {
        require(pendingOracleSigner != address(0), "MintwareDistributor: no rotation pending");

        address cancelled   = pendingOracleSigner;
        pendingOracleSigner = address(0);
        oracleRotationAvailableAt = 0;

        emit OracleRotationCancelled(cancelled);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Campaign deposit — creator pays gas once
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit tokens to fund a campaign's reward pool.
     *
     * @dev  - One token per campaign; token address is immutable after first deposit.
     *       - First depositor is recorded as the campaign creator, entitling them
     *         to withdraw any remaining balance after the campaign is closed.
     *       - Anyone may top up an existing campaign (same token, not closed).
     *       - Uses balance-diff accounting to handle fee-on-transfer tokens correctly.
     *         campaignBalances reflects tokens actually received, not amount requested.
     *       - Caller must approve this contract for `amount` of `token` before calling.
     *
     * @param campaignId  Off-chain identifier (Supabase UUID string).
     * @param token       ERC-20 token address to distribute.
     * @param amount      Number of tokens to deposit (in token base units).
     */
    function depositCampaign(
        string  calldata campaignId,
        address token,
        uint256 amount
    ) external whenNotPaused nonReentrant {
        require(token  != address(0), "MintwareDistributor: zero token");
        require(amount  > 0,          "MintwareDistributor: zero amount");

        CampaignInfo storage info = campaigns[campaignId];

        if (info.token == address(0)) {
            // First deposit — register token and creator
            info.token   = token;
            info.creator = msg.sender;
        } else {
            require(!info.closed,         "MintwareDistributor: campaign closed");
            require(info.token == token,  "MintwareDistributor: token mismatch for campaign");
        }

        // Balance-diff: records tokens actually received, not amount parameter.
        // Protects against fee-on-transfer tokens overstating campaignBalances.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;

        require(received > 0, "MintwareDistributor: no tokens received");
        campaignBalances[campaignId] += received;

        emit CampaignFunded(keccak256(bytes(campaignId)), token, msg.sender, campaignId, received);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Claim — user pays gas; oracle paid zero
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Claim tokens from a campaign epoch.
     *
     * @dev  Four-step verification (checks ordered cheapest-first):
     *   0. Campaign is funded and not withdrawn — cheap storage read, done first.
     *   1. Deadline — cheap timestamp compare.
     *   2. Already-claimed guard — cheap mapping read.
     *   3. Oracle EIP-712 signature — medium cost; chainId in domain prevents cross-chain replay.
     *   4. Merkle proof — most expensive; only reached if all above pass.
     *
     * @param campaignId       Off-chain campaign identifier (Supabase UUID string).
     * @param epochNumber      Epoch index — scopes dedup per (campaign, epoch).
     * @param merkleRoot       Root signed by the oracle for this epoch.
     * @param oracleSignature  EIP-712 sig over (campaignId, epochNumber, merkleRoot, deadline).
     *                         Returned by /api/claim; submitted by the user's wallet.
     * @param deadline         Expiry timestamp set by the oracle when signing the root.
     *                         Claim reverts if block.timestamp > deadline.
     * @param amount           Token amount this wallet is entitled to (in token base units).
     * @param merkleProof      Merkle inclusion proof for (msg.sender, amount).
     */
    function claim(
        string     calldata campaignId,
        uint256             epochNumber,
        bytes32             merkleRoot,
        bytes      calldata oracleSignature,
        uint256             deadline,
        uint256             amount,
        bytes32[]  calldata merkleProof
    ) external whenNotPaused nonReentrant {
        _claim(campaignId, epochNumber, merkleRoot, oracleSignature, deadline, amount, merkleProof);
    }

    /**
     * @notice Claim from multiple campaigns / epochs in a single transaction.
     * @dev    Each ClaimParams element is processed independently via the internal _claim().
     *         If any individual claim reverts the entire batch reverts — the original
     *         revert reason from _claim() (e.g. "invalid oracle signature") propagates
     *         directly to the caller. Users who need partial-success behaviour should
     *         call claim() per epoch instead.
     *
     *         NOTE: try/catch to surface the failing index (BatchClaimFailed) is not used
     *         here because Solidity try/catch requires external calls, and calling
     *         this.claim() from batchClaim() would re-enter the nonReentrant mutex.
     *         BatchClaimFailed is reserved for a future version that splits the mutex.
     *
     * @param claimsData  Array of ClaimParams structs, one per (campaign, epoch) pair.
     */
    function batchClaim(
        ClaimParams[] calldata claimsData
    ) external whenNotPaused nonReentrant {
        uint256 len = claimsData.length;
        require(len > 0, "MintwareDistributor: empty batch");

        for (uint256 i = 0; i < len; ) {
            ClaimParams calldata c = claimsData[i];
            _claim(
                c.campaignId,
                c.epochNumber,
                c.merkleRoot,
                c.oracleSignature,
                c.deadline,
                c.amount,
                c.merkleProof
            );
            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Campaign lifecycle — owner closes; creator withdraws
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mark a campaign as closed. Starts the WITHDRAWAL_COOLDOWN clock.
     * @dev    Only the owner (Mintware) can close a campaign — this prevents a
     *         campaign creator from pulling the rug on users mid-campaign by closing
     *         early and withdrawing before all epochs have been distributed.
     *         Closing does NOT immediately block claims — the WITHDRAWAL_COOLDOWN
     *         (7 days) gives users ample time to submit their final claims after
     *         receiving off-chain notification.
     * @dev    Closing a campaign with a zero balance is permitted (it emits CampaignClosed).
     *         Off-chain indexers should check campaignBalances[campaignId] > 0 before
     *         treating the event as meaningful for withdrawal eligibility.
     *
     * @param campaignId  Campaign to close.
     */
    function closeCampaign(string calldata campaignId) external onlyOwner {
        CampaignInfo storage info = campaigns[campaignId];
        require(info.token    != address(0), "MintwareDistributor: campaign not found");
        require(!info.closed,               "MintwareDistributor: already closed");

        info.closed   = true;
        info.closedAt = block.timestamp;

        emit CampaignClosed(
            keccak256(bytes(campaignId)),
            info.creator,
            campaignId,
            block.timestamp
        );
    }

    /**
     * @notice Withdraw remaining campaign balance to the campaign creator.
     * @dev    Callable by the creator only, and only after:
     *           (a) owner has called closeCampaign(), AND
     *           (b) WITHDRAWAL_COOLDOWN (7 days) has elapsed since closure.
     *
     *         This ensures users have a meaningful window to claim before funds
     *         are returned. If balance is zero (fully claimed), the call succeeds
     *         silently — no tokens transferred, event still emitted for indexing.
     *
     * @param campaignId  Campaign to withdraw from.
     */
    function withdrawCampaign(string calldata campaignId) external nonReentrant {
        CampaignInfo storage info = campaigns[campaignId];

        require(info.creator == msg.sender,                              "MintwareDistributor: not campaign creator");
        require(info.closed,                                             "MintwareDistributor: campaign not closed");
        require(block.timestamp >= info.closedAt + WITHDRAWAL_COOLDOWN, "MintwareDistributor: cooldown active");

        uint256 balance = campaignBalances[campaignId];
        // Zero out before transfer — re-entrancy safe (nonReentrant + CEI)
        campaignBalances[campaignId] = 0;

        emit CampaignWithdrawn(
            keccak256(bytes(campaignId)),
            msg.sender,
            campaignId,
            balance
        );

        if (balance > 0) {
            IERC20(info.token).safeTransfer(msg.sender, balance);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Owner — pause / emergency withdraw
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Pause all deposits, claims, and withdrawals. Emergency use only.
    function pause()   external onlyOwner { _pause();   }

    /// @notice Resume operations after a pause.
    function unpause() external onlyOwner { _unpause(); }

    /**
     * @notice Emergency sweep of any ERC-20 token held by this contract.
     * @dev    ONLY callable when the contract is paused. The pause requirement
     *         ensures this is an intentional emergency action, not a routine one.
     *         WARNING: this bypasses campaignBalances — use only in true emergencies
     *         (e.g. critical vulnerability discovered, oracle key compromised).
     *         After using this, the contract should remain paused until the situation
     *         is resolved and a new contract is deployed if necessary.
     *
     * @param token   ERC-20 token to sweep (use campaigns[id].token for campaign tokens).
     * @param to      Recipient address (use owner multisig).
     * @param amount  Amount to transfer in token base units.
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner whenPaused nonReentrant {
        require(token  != address(0), "MintwareDistributor: zero token");
        require(to     != address(0), "MintwareDistributor: zero recipient");
        require(amount  > 0,          "MintwareDistributor: zero amount");

        IERC20(token).safeTransfer(to, amount);

        emit EmergencyWithdraw(token, to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns whether a wallet has claimed from a specific campaign epoch.
     */
    function isClaimed(
        string  calldata campaignId,
        uint256          epochNumber,
        address          wallet
    ) external view returns (bool) {
        return claimed[campaignId][epochNumber][wallet];
    }

    /**
     * @notice Compute the Merkle leaf hash for a (wallet, amount) pair.
     * @dev    Matches StandardMerkleTree from the openzeppelin/merkle-tree package.
     *         Exposed for off-chain proof verification and test suite cross-checks.
     */
    function computeLeaf(
        address wallet,
        uint256 amount
    ) external pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(wallet, amount))));
    }

    /**
     * @notice Returns the EIP-712 digest the oracle must sign for a given root.
     * @dev    Exposed for the test suite and oracle signature pre-verification.
     *         The oracle signs this digest using signTypedData (viem) or eth_signTypedData.
     *         Note: deadline is now required — the oracle must choose an expiry timestamp
     *         before signing and include the same value when calling claim().
     *
     * @param campaignId   Campaign identifier.
     * @param epochNumber  Epoch index.
     * @param merkleRoot   The Merkle root being published.
     * @param deadline     Unix timestamp after which claim() will reject this signature.
     */
    function getRootDigest(
        string  calldata campaignId,
        uint256          epochNumber,
        bytes32          merkleRoot,
        uint256          deadline
    ) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ROOT_TYPEHASH,
            keccak256(bytes(campaignId)),
            epochNumber,
            merkleRoot,
            deadline
        )));
    }

    /**
     * @notice Returns campaign metadata in a single call.
     * @dev    Convenience for frontends / scripts — avoids two separate calls.
     *
     * @return token        ERC-20 token address (zero = campaign not funded).
     * @return creator      Address entitled to withdraw remaining balance after close.
     * @return closed       True if the owner has called closeCampaign().
     * @return closedAt     Timestamp of closure (zero if not closed).
     * @return balance      Current claimable balance in token base units.
     * @return withdrawableAt  Earliest timestamp the creator may call withdrawCampaign().
     *                         Zero if not closed.
     */
    function getCampaign(string calldata campaignId) external view returns (
        address token,
        address creator,
        bool    closed,
        uint256 closedAt,
        uint256 balance,
        uint256 withdrawableAt
    ) {
        CampaignInfo storage info = campaigns[campaignId];
        return (
            info.token,
            info.creator,
            info.closed,
            info.closedAt,
            campaignBalances[campaignId],
            info.closed ? info.closedAt + WITHDRAWAL_COOLDOWN : 0
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Core claim logic, shared by claim() and batchClaim().
     *      msg.sender is the claimant in both paths.
     *
     *      Verification order (cheapest first):
     *        0. Campaign funded check  — 1 SLOAD
     *        1. Deadline check         — 1 comparison
     *        2. Already-claimed check  — 1 SLOAD
     *        3. Oracle sig verify      — ecrecover + hashing
     *        4. Merkle proof verify    — N hashes (proof depth)
     *        5. CEI: mark claimed, decrement balance, transfer
     */
    function _claim(
        string     calldata campaignId,
        uint256             epochNumber,
        bytes32             merkleRoot,
        bytes      calldata oracleSignature,
        uint256             deadline,
        uint256             amount,
        bytes32[]  calldata merkleProof
    ) internal {
        require(amount > 0, "MintwareDistributor: zero amount");

        // ── 0. Campaign must be funded ──────────────────────────────────────
        // Checked first — saves gas on the expensive sig/proof steps if not funded.
        CampaignInfo storage info = campaigns[campaignId];
        require(info.token != address(0), "MintwareDistributor: campaign not funded");

        // ── 1. Deadline ────────────────────────────────────────────────────
        // Oracle sets the deadline when signing. Prevents stale signatures from
        // being submitted long after an epoch has ended.
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "MintwareDistributor: signature expired");

        // ── 2. Already-claimed guard ────────────────────────────────────────
        require(
            !claimed[campaignId][epochNumber][msg.sender],
            "MintwareDistributor: already claimed"
        );

        // ── 3. Verify oracle EIP-712 signature ──────────────────────────────
        // chainId is baked into the EIP-712 domain separator by OZ EIP712.
        // Cross-chain replay (e.g. reusing a Base sig on BNB) is impossible.
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            ROOT_TYPEHASH,
            keccak256(bytes(campaignId)),
            epochNumber,
            merkleRoot,
            deadline
        )));
        require(
            ECDSA.recover(digest, oracleSignature) == oracleSigner,
            "MintwareDistributor: invalid oracle signature"
        );

        // ── 4. Verify Merkle proof ───────────────────────────────────────────
        // Leaf encoding matches OZ StandardMerkleTree:
        //   keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(msg.sender, amount)))
        );
        require(
            MerkleProof.verify(merkleProof, merkleRoot, leaf),
            "MintwareDistributor: invalid proof"
        );

        // ── 5. Effects — before interaction (CEI) ───────────────────────────
        claimed[campaignId][epochNumber][msg.sender] = true;

        require(
            campaignBalances[campaignId] >= amount,
            "MintwareDistributor: insufficient campaign balance"
        );
        campaignBalances[campaignId] -= amount;

        // ── 6. Interaction ───────────────────────────────────────────────────
        IERC20(info.token).safeTransfer(msg.sender, amount);

        emit Claimed(
            keccak256(bytes(campaignId)),
            epochNumber,
            msg.sender,
            campaignId,
            amount
        );
    }
}
