// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard}  from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA}            from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712}           from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MerkleProof}      from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {MWGuardianPausable}       from "./lib/MWGuardianPausable.sol";
import {MWTimelockedOracleSigner} from "./lib/MWTimelockedOracleSigner.sol";

/// @title  MintwareWeightedDistributor
/// @notice Canonical two-token, oracle-signed, per-epoch Merkle distributor for the
///         reputation-weighted pair vaults. This is the reward path FeeVault was
///         supposed to be but never verified (audit C1): here the oracle signature
///         is checked on-chain at epoch close, before any root can pay out.
///
/// @dev    DESIGN — separation of concerns (the trust model the audit calls for):
///           • OFF-CHAIN (the merkle builder) owns the WEIGHTING FORMULA — it turns
///             liquidity-time × attribution × lock × referral into a final per-wallet
///             (amount0, amount1) allocation and builds the tree. That is where the
///             Attribution percentile, the real referral signal, and the margin-funded
///             referrer rewards live.
///           • ON-CHAIN (this contract) enforces PROVENANCE + NO-OVER-ALLOCATION:
///               C1  the epoch root is only accepted with a valid oracle EIP-712 sig;
///               C5  the signed totals must be ≤ what was actually funded, so a root
///                   can never allocate more than the pot — a subtly-wrong or malicious
///                   root cannot mint value, only mis-split a bounded pot (and even that
///                   is bounded per-wallet by the claim-once + running-remaining guard);
///               C4  every value-moving path is behind the guardian kill-switch;
///               C7  the oracle signer rotates only through a 48h timelock.
///
///         Multi-tenant: one deployment serves every pair vault, keyed by `vaultId`
///         (bytes32 — the pool id / vault handle). Each vault registers its immutable
///         (token0, token1) pair on first funding.
///
///         WHY TWO TOKENS IN ONE LEAF: a pair vault earns fees in both pool tokens.
///         One tree with leaves (wallet, amount0, amount1) means one root, one oracle
///         signature, and one claim that pays both sides — no double bookkeeping.
///
///         NOT a replacement for MintwareDistributor's single-token campaign path; this
///         is the pair-vault fee path. It deliberately mirrors that contract's proven
///         rotation / verify / leaf-encoding so both sides stay auditable and identical.
contract MintwareWeightedDistributor is EIP712, MWGuardianPausable, MWTimelockedOracleSigner, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Minimum wall-clock an epoch stays open before it can be closed.
    uint256 public constant EPOCH_DURATION = 7 days;

    /// @notice Claim window after close; unclaimed funds are sweepable afterwards.
    uint256 public constant CLAIM_EXPIRY = 90 days;

    /// @notice EIP-712 typehash for a signed epoch commitment. The oracle signs the
    ///         Merkle root AND the declared totals — the totals are the on-chain
    ///         over-allocation guard (C5), so the oracle cannot sign a root whose
    ///         leaves sum to more than the funded pot without the totals giving it away.
    bytes32 public constant EPOCH_ROOT_TYPEHASH = keccak256(
        "EpochRoot(bytes32 vaultId,uint256 epochNumber,bytes32 merkleRoot,uint256 totalAmount0,uint256 totalAmount1,uint256 deadline)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct VaultInfo {
        address token0;      // immutable after registration
        address token1;      // immutable after registration; may equal address(0) for single-sided
        address funder;      // first funder — entitled to swept remainders
        bool    registered;
    }

    struct Epoch {
        uint256 pot0;         // token0 funded into this epoch
        uint256 pot1;         // token1 funded into this epoch
        uint256 total0;       // token0 allocated by the signed root (≤ pot0)
        uint256 total1;       // token1 allocated by the signed root (≤ pot1)
        uint256 claimed0;     // token0 claimed so far
        uint256 claimed1;     // token1 claimed so far
        uint256 openedAt;
        uint256 closedAt;
        uint256 expiry;       // closedAt + CLAIM_EXPIRY; sweepable afterwards
        bytes32 merkleRoot;   // committed at close, oracle-signed
        bool    closed;
        bool    swept;
    }

    // Oracle-signer state + 48h timelocked rotation live in MWTimelockedOracleSigner.

    // ─────────────────────────────────────────────────────────────────────────
    // Vault + epoch state
    // ─────────────────────────────────────────────────────────────────────────

    mapping(bytes32 => VaultInfo) public vaults;
    mapping(bytes32 => uint256)   public currentEpoch;                 // vaultId → open epoch number
    mapping(bytes32 => mapping(uint256 => Epoch)) public epochs;       // vaultId → epoch → data
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) public claimed; // vaultId → epoch → wallet

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event VaultRegistered(bytes32 indexed vaultId, address indexed token0, address indexed token1, address funder);
    event EpochOpened(bytes32 indexed vaultId, uint256 indexed epochNumber, uint256 openedAt);
    event FeesFunded(bytes32 indexed vaultId, uint256 indexed epochNumber, address indexed from, uint256 amount0, uint256 amount1);
    event EpochClosed(bytes32 indexed vaultId, uint256 indexed epochNumber, bytes32 merkleRoot, uint256 total0, uint256 total1);
    event Claimed(bytes32 indexed vaultId, uint256 indexed epochNumber, address indexed wallet, uint256 amount0, uint256 amount1);
    event EpochSwept(bytes32 indexed vaultId, uint256 indexed epochNumber, uint256 unclaimed0, uint256 unclaimed1);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error VaultNotRegistered();
    error VaultAlreadyRegistered();
    error ZeroToken0();
    error EpochStillActive();
    error EpochAlreadyClosed();
    error EpochNotClosed();
    error EpochNotExpired();
    error AlreadySwept();
    error AlreadyClaimed();
    error SignatureExpired();
    error InvalidOracleSignature();
    error OverAllocated();          // C5 — signed totals exceed the funded pot
    error InvalidProof();
    error ZeroAmount();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _oracleSigner, address initialOwner)
        EIP712("MintwareWeightedDistributor", "1")
        MWGuardianPausable(initialOwner)
    {
        _initOracleSigner(_oracleSigner);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vault registration + fee funding
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Register a vault's immutable token pair. First caller = funder-of-record.
    /// @dev    token1 may be address(0) for a single-sided vault (amount1 always 0).
    function registerVault(bytes32 vaultId, address token0, address token1) external {
        if (vaults[vaultId].registered) revert VaultAlreadyRegistered();
        if (token0 == address(0))       revert ZeroToken0();

        vaults[vaultId] = VaultInfo({ token0: token0, token1: token1, funder: msg.sender, registered: true });
        emit VaultRegistered(vaultId, token0, token1, msg.sender);

        _openEpoch(vaultId);
    }

    /// @notice Fund the vault's currently-open epoch with fees (and/or margin top-up
    ///         for referrer rewards). Permissionless — the caller donates their own
    ///         tokens; over-funding is safe (excess is swept back to the funder).
    /// @dev    Not gated by whenNotPaused: funding-in never moves value out, so it is
    ///         harmless while paused and keeps fee accrual from stalling on a pause.
    function fundFees(bytes32 vaultId, uint256 amount0, uint256 amount1) external nonReentrant {
        VaultInfo storage v = vaults[vaultId];
        if (!v.registered) revert VaultNotRegistered();

        uint256 epochNumber = currentEpoch[vaultId];
        Epoch storage e = epochs[vaultId][epochNumber];

        if (amount0 > 0) {
            IERC20(v.token0).safeTransferFrom(msg.sender, address(this), amount0);
            e.pot0 += amount0;
        }
        if (amount1 > 0) {
            // token1 == address(0) means single-sided; reject stray token1 funding.
            if (v.token1 == address(0)) revert ZeroToken0();
            IERC20(v.token1).safeTransferFrom(msg.sender, address(this), amount1);
            e.pot1 += amount1;
        }

        emit FeesFunded(vaultId, epochNumber, msg.sender, amount0, amount1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Epoch close — the trust-bearing step. Oracle sig is VERIFIED here (C1).
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Close the vault's current epoch by committing an oracle-signed root.
    /// @param  merkleRoot   root of leaves keccak256(bytes.concat(keccak256(
    ///                      abi.encode(wallet, amount0, amount1)))) — OZ StandardMerkleTree.
    /// @param  total0       sum of all leaves' amount0 — MUST be ≤ pot0 (C5).
    /// @param  total1       sum of all leaves' amount1 — MUST be ≤ pot1 (C5).
    /// @param  oracleSig    EIP-712 signature over EpochRoot by `oracleSigner`.
    /// @param  deadline     signature-freshness bound; close must land at/before it.
    function closeEpoch(
        bytes32 vaultId,
        bytes32 merkleRoot,
        uint256 total0,
        uint256 total1,
        bytes calldata oracleSig,
        uint256 deadline
    ) external whenNotPaused nonReentrant {
        VaultInfo storage v = vaults[vaultId];
        if (!v.registered) revert VaultNotRegistered();

        uint256 epochNumber = currentEpoch[vaultId];
        Epoch storage e = epochs[vaultId][epochNumber];

        if (e.closed)                                        revert EpochAlreadyClosed();
        if (block.timestamp < e.openedAt + EPOCH_DURATION)   revert EpochStillActive();
        // solhint-disable-next-line not-rely-on-time
        if (block.timestamp > deadline)                      revert SignatureExpired();

        // ── C1: verify the oracle actually signed THIS (vault, epoch, root, totals) ──
        // vaultId + epochNumber are in the digest, so an old signed root cannot be
        // replayed onto a later epoch, and a root for vault A cannot close vault B.
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            EPOCH_ROOT_TYPEHASH,
            vaultId,
            epochNumber,
            merkleRoot,
            total0,
            total1,
            deadline
        )));
        if (ECDSA.recover(digest, oracleSig) != oracleSigner) revert InvalidOracleSignature();

        // ── C5: the signed allocation can never exceed what was actually funded ──
        if (total0 > e.pot0 || total1 > e.pot1) revert OverAllocated();

        e.total0     = total0;
        e.total1     = total1;
        e.merkleRoot = merkleRoot;
        e.closedAt   = block.timestamp;
        e.expiry     = block.timestamp + CLAIM_EXPIRY;
        e.closed     = true;

        emit EpochClosed(vaultId, epochNumber, merkleRoot, total0, total1);

        _openEpoch(vaultId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Claim — pays both tokens for one leaf. Guarded (C4), CEI, claim-once.
    // ─────────────────────────────────────────────────────────────────────────

    function claim(
        bytes32 vaultId,
        uint256 epochNumber,
        uint256 amount0,
        uint256 amount1,
        bytes32[] calldata merkleProof
    ) external whenNotPaused nonReentrant {
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();

        Epoch storage e = epochs[vaultId][epochNumber];
        if (!e.closed) revert EpochNotClosed();
        if (claimed[vaultId][epochNumber][msg.sender]) revert AlreadyClaimed();

        // Leaf encoding matches OZ StandardMerkleTree (two-token generalization):
        //   keccak256(bytes.concat(keccak256(abi.encode(wallet, amount0, amount1))))
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount0, amount1))));
        if (!MerkleProof.verify(merkleProof, e.merkleRoot, leaf)) revert InvalidProof();

        // ── Effects (CEI) ──
        claimed[vaultId][epochNumber][msg.sender] = true;

        // Defense-in-depth: even with a valid proof, cumulative claims can never
        // exceed the signed totals (which are themselves ≤ the funded pot, C5).
        uint256 newClaimed0 = e.claimed0 + amount0;
        uint256 newClaimed1 = e.claimed1 + amount1;
        if (newClaimed0 > e.total0 || newClaimed1 > e.total1) revert OverAllocated();
        e.claimed0 = newClaimed0;
        e.claimed1 = newClaimed1;

        VaultInfo storage v = vaults[vaultId];

        // ── Interactions ──
        if (amount0 > 0) IERC20(v.token0).safeTransfer(msg.sender, amount0);
        if (amount1 > 0) IERC20(v.token1).safeTransfer(msg.sender, amount1);

        emit Claimed(vaultId, epochNumber, msg.sender, amount0, amount1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sweep — permissionless after expiry; returns unclaimed to the funder.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice After the 90-day claim window, return the epoch's unclaimed remainder
    ///         (both the un-allocated surplus pot−total and any unclaimed allocation)
    ///         to the funder-of-record. Permissionless.
    function sweep(bytes32 vaultId, uint256 epochNumber) external nonReentrant {
        Epoch storage e = epochs[vaultId][epochNumber];
        if (!e.closed)                     revert EpochNotClosed();
        if (block.timestamp <= e.expiry)   revert EpochNotExpired();
        if (e.swept)                       revert AlreadySwept();

        e.swept = true;

        // Everything funded minus everything claimed is returnable.
        uint256 unclaimed0 = e.pot0 - e.claimed0;
        uint256 unclaimed1 = e.pot1 - e.claimed1;

        VaultInfo storage v = vaults[vaultId];
        if (unclaimed0 > 0) IERC20(v.token0).safeTransfer(v.funder, unclaimed0);
        if (unclaimed1 > 0 && v.token1 != address(0)) IERC20(v.token1).safeTransfer(v.funder, unclaimed1);

        emit EpochSwept(vaultId, epochNumber, unclaimed0, unclaimed1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Oracle rotation — 48h timelock (C7), mirrors MintwareDistributor
    // ─────────────────────────────────────────────────────────────────────────

    function proposeOracleSigner(address proposed) external onlyOwner { _proposeOracleSigner(proposed); }
    function confirmOracleSigner() external onlyOwner { _confirmOracleSigner(); }
    function cancelOracleRotation() external onlyOwner { _cancelOracleRotation(); }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The EIP-712 digest the oracle must sign for an epoch close.
    ///         Exposed for the off-chain signer and the test suite.
    function getEpochRootDigest(
        bytes32 vaultId,
        uint256 epochNumber,
        bytes32 merkleRoot,
        uint256 total0,
        uint256 total1,
        uint256 deadline
    ) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            EPOCH_ROOT_TYPEHASH, vaultId, epochNumber, merkleRoot, total0, total1, deadline
        )));
    }

    function getEpoch(bytes32 vaultId, uint256 epochNumber) external view returns (Epoch memory) {
        return epochs[vaultId][epochNumber];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _openEpoch(bytes32 vaultId) internal {
        uint256 next = ++currentEpoch[vaultId];   // first epoch is 1
        epochs[vaultId][next].openedAt = block.timestamp;
        emit EpochOpened(vaultId, next, block.timestamp);
    }
}
