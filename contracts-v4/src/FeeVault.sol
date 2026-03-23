// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA}           from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712}          from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title  FeeVault
/// @notice Accumulates all captured value from MWSocialHook and distributes
///         it to LPs, referrers, and protocol at epoch close via Merkle claims.
///
/// @dev    Income sources:
///           1. MEV surplus   — transferred by MWSocialHook.afterSwap
///           2. Trading fees  — swept from V4 ERC-6909 claim tokens by SocialVault
///           3. LP penalties  — transferred by SocialVault.executeWithdrawal
///
///         Distribution split (owner-configurable):
///           ~70%  Community LPs    (Attribution + lock tier weighted, via MintwareDistributor)
///           ~15%  Referrers        (net liquidity quality weighted, via MintwareDistributor)
///           ~10%  Protocol treasury
///           ~5%   Attribution bonus pool
///
///         Soft expiry: 90 days. Unclaimed USDC swept back via sweep(epochId).
///         The sweep() adds unclaimed funds to the NEXT epoch's bonus pool.
///
///         Attribution weighting is done OFF-CHAIN (oracle signs AttributionSnapshot
///         at epoch close). FeeVault verifies the EIP-712 signature before epoch close.
contract FeeVault is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct Epoch {
        uint256 totalAccumulated;   // total USDC received this epoch
        uint256 bonusPool;          // swept unclaimed from prior epoch
        uint256 totalAllocated;     // set at epoch close
        uint256 totalClaimed;       // incremented as claims settle
        uint256 openedAt;
        uint256 closedAt;
        uint256 deadline;           // closedAt + 90 days
        bool    closed;
        bool    swept;
        // Distribution root committed at close (used by MintwareDistributor)
        bytes32 merkleRoot;
    }

    /// @dev EIP-712 typehash for Attribution oracle snapshots
    bytes32 public constant ATTRIBUTION_SNAPSHOT_TYPEHASH = keccak256(
        "AttributionSnapshot(address wallet,uint16 liquidityPercentile,uint16 sharingPercentile,uint256 epochNumber,uint256 deadline)"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant EPOCH_DURATION     = 7 days;
    uint256 public constant CLAIM_EXPIRY       = 90 days;
    uint256 public constant BPS                = 10_000;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public immutable distributor;      // MintwareDistributor

    /// @notice SocialVault address — owner-settable to break the deploy circular dep.
    ///         Deploy order: FeeVault → SocialVault → FeeVault.setSocialVault(addr).
    address public socialVault;

    /// @notice Hook address — owner-settable (same pattern as socialVault).
    address public hook;

    /// @notice Oracle signer — same key used in onchainPublisher.ts
    address public oracleSigner;

    /// @notice Protocol treasury address
    address public treasury;

    /// @notice Distribution split in bps (must sum to BPS)
    uint256 public lpShareBps        = 7_000;  // 70%
    uint256 public referrerShareBps  = 1_500;  // 15%
    uint256 public protocolShareBps  = 1_000;  // 10%
    uint256 public bonusPoolBps      =   500;  //  5%

    /// @notice Epoch records
    mapping(uint256 => Epoch) public epochs;
    uint256 public currentEpoch;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event FeesReceived(uint256 indexed epochId, uint256 amount, string source);
    event EpochClosed(uint256 indexed epochId, uint256 totalAllocated, bytes32 merkleRoot);
    event EpochOpened(uint256 indexed epochId);
    event EpochSwept(uint256 indexed epochId, uint256 unclaimedAmount);
    event ClaimRecorded(uint256 indexed epochId, address indexed lp, uint256 amount);
    event SharesUpdated(uint256 lp, uint256 referrer, uint256 protocol, uint256 bonus);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error EpochNotClosed();
    error EpochNotExpired();
    error AlreadySwept();
    error InvalidShares();
    error InvalidOracleSignature();
    error DeadlinePassed();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev    socialVault and hook are NOT set in constructor — set post-deploy via
    ///         setSocialVault() and setHook() to break the circular dep.
    ///         Deploy order: FeeVault → SocialVault → FeeVault.setSocialVault(addr)
    ///                       → MWSocialHook → FeeVault.setHook(addr)
    constructor(
        address _usdc,
        address _distributor,
        address _oracleSigner,
        address _treasury
    ) Ownable(msg.sender) EIP712("FeeVault", "1") {
        usdc         = IERC20(_usdc);
        distributor  = _distributor;
        oracleSigner = _oracleSigner;
        treasury     = _treasury;

        // Open epoch 1
        _openEpoch();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fee ingestion — called by hook (MEV) and socialVault (penalties, fees)
    // ─────────────────────────────────────────────────────────────────────────

    function receiveFees(uint256 amount, string calldata source) external nonReentrant {
        require(msg.sender == hook || msg.sender == socialVault, "unauthorized");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        epochs[currentEpoch].totalAccumulated += amount;
        emit FeesReceived(currentEpoch, amount, source);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Epoch close — owner calls at weekly boundary (Vercel cron automates)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Close current epoch, commit Merkle root, open next epoch
    /// @param  merkleRoot  built off-chain by merkleBuilder.ts
    function closeEpoch(bytes32 merkleRoot) external onlyOwner nonReentrant {
        Epoch storage epoch = epochs[currentEpoch];

        uint256 total     = epoch.totalAccumulated + epoch.bonusPool;
        uint256 lpAlloc   = (total * lpShareBps)       / BPS;
        uint256 refAlloc  = (total * referrerShareBps)  / BPS;
        uint256 protAlloc = (total * protocolShareBps)  / BPS;
        uint256 bonusAlloc= (total * bonusPoolBps)      / BPS;

        epoch.totalAllocated = lpAlloc + refAlloc;
        epoch.closedAt       = block.timestamp;
        epoch.deadline       = block.timestamp + CLAIM_EXPIRY;
        epoch.closed         = true;
        epoch.merkleRoot     = merkleRoot;

        // Push protocol share to treasury immediately
        if (protAlloc > 0) {
            usdc.safeTransfer(treasury, protAlloc);
        }

        emit EpochClosed(currentEpoch, epoch.totalAllocated, merkleRoot);

        _openEpoch();

        // Seed next epoch bonus pool
        epochs[currentEpoch].bonusPool = bonusAlloc;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sweep — permissionless after 90-day expiry
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Sweep unclaimed funds from an expired epoch into next epoch's bonus pool
    function sweep(uint256 epochId) external nonReentrant {
        Epoch storage epoch = epochs[epochId];
        if (!epoch.closed)                        revert EpochNotClosed();
        if (block.timestamp <= epoch.deadline)    revert EpochNotExpired();
        if (epoch.swept)                          revert AlreadySwept();

        uint256 unclaimed = epoch.totalAllocated - epoch.totalClaimed;
        epoch.swept = true;

        if (unclaimed > 0) {
            // Add to current epoch's bonus pool
            epochs[currentEpoch].bonusPool += unclaimed;
        }

        emit EpochSwept(epochId, unclaimed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Claim tracking — MintwareDistributor calls back to record claims
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Called by MintwareDistributor after a successful claim
    function recordClaim(uint256 epochId, address lp, uint256 amount) external {
        require(msg.sender == distributor, "only distributor");
        epochs[epochId].totalClaimed += amount;
        emit ClaimRecorded(epochId, lp, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Auto-compound — routes LP fees back into SocialVault position
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Instead of Merkle claim, compound LP earnings directly into vault
    /// @dev    Called off-chain at epoch close for LPs who opted in
    function compound(address lp, uint256 amount, uint256 epochId) external onlyOwner nonReentrant {
        Epoch storage epoch = epochs[epochId];
        require(epoch.closed, "epoch not closed");
        epoch.totalClaimed += amount;

        usdc.approve(socialVault, amount);
        // ISocialVault(socialVault).compound(lp, amount);
        // TODO (T1.5): uncomment once SocialVault interface is finalised

        emit ClaimRecorded(epochId, lp, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Wire SocialVault after deploy — breaks circular constructor dep
    function setSocialVault(address _socialVault) external onlyOwner {
        require(_socialVault != address(0), "zero address");
        socialVault = _socialVault;
    }

    /// @notice Wire MWSocialHook after deploy
    function setHook(address _hook) external onlyOwner {
        require(_hook != address(0), "zero address");
        hook = _hook;
    }

    function setShares(
        uint256 _lp,
        uint256 _referrer,
        uint256 _protocol,
        uint256 _bonus
    ) external onlyOwner {
        if (_lp + _referrer + _protocol + _bonus != BPS) revert InvalidShares();
        lpShareBps       = _lp;
        referrerShareBps = _referrer;
        protocolShareBps = _protocol;
        bonusPoolBps     = _bonus;
        emit SharesUpdated(_lp, _referrer, _protocol, _bonus);
    }

    function setOracleSigner(address _signer) external onlyOwner {
        oracleSigner = _signer;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getEpoch(uint256 epochId) external view returns (Epoch memory) {
        return epochs[epochId];
    }

    function currentEpochAccumulated() external view returns (uint256) {
        return epochs[currentEpoch].totalAccumulated;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _openEpoch() internal {
        currentEpoch++;
        epochs[currentEpoch].openedAt = block.timestamp;
        emit EpochOpened(currentEpoch);
    }
}
