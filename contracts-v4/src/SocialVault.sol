// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}       from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}            from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath}           from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}             from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}          from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}            from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard}    from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  SocialVault
/// @notice Manages community USDC deposits + team PROJECT token seeds.
///         Pairs them in a Uniswap V4 pool via MWSocialHook.
///
/// @dev    Three-role model:
///           - Teams    → seed PROJECT tokens, gain pool health score (no fee share)
///           - Community → deposit USDC, earn fees weighted by Attribution + lock tier
///           - Referrers → tracked off-chain, earn via FeeVault epoch distribution
///
///         Lock tiers:
///           Flex     (0d)   1.0× fee multiplier
///           Committed (30d) 1.15×
///           Aligned  (90d)  1.30×
///           Core    (180d)  1.50×
///
///         Early exit penalties:
///           < 20% of lock elapsed → 2.0%
///           20–50%               → 1.0%
///           50–80%               → 0.5%
///           > 80%                → 0.0%
///         Penalties route to FeeVault (redistributed to remaining LPs).
///
///         Withdrawal flow:
///           1. requestWithdrawal() — 7-day notice period
///           2. executeWithdrawal() — callable after noticeExpiry
contract SocialVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    enum LockTier {
        Flex,       // 0 days
        Committed,  // 30 days
        Aligned,    // 90 days
        Core        // 180 days
    }

    struct LPPosition {
        uint256 usdcDeposited;   // USDC deposited (principal)
        uint256 depositedAt;     // block.timestamp at deposit
        uint256 lockedUntil;     // block.timestamp + lockDuration
        LockTier tier;
        bool    compoundEnabled; // auto-compound fee earnings
    }

    struct WithdrawalRequest {
        uint256 amount;         // USDC to withdraw
        uint256 requestedAt;
        uint256 noticeExpiry;   // requestedAt + NOTICE_PERIOD
        bool    executed;
    }

    struct TeamSeed {
        address projectToken;
        uint256 amount;
        uint256 seededAt;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant NOTICE_PERIOD         = 7 days;
    uint256 public constant MIN_HOLD_PERIOD       = 24 hours;
    uint256 public constant LOCK_COMMITTED        = 30 days;
    uint256 public constant LOCK_ALIGNED          = 90 days;
    uint256 public constant LOCK_CORE             = 180 days;

    /// @dev Early exit penalty in bps (10_000 = 100%)
    uint256 public constant PENALTY_TIER_1_BPS    = 200;  // 2.0%
    uint256 public constant PENALTY_TIER_2_BPS    = 100;  // 1.0%
    uint256 public constant PENALTY_TIER_3_BPS    = 50;   //  0.5%

    uint256 public constant BPS                   = 10_000;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    IPoolManager public immutable poolManager;
    address public immutable feeVault;
    address public immutable hook;

    /// @notice LP positions per wallet
    mapping(address => LPPosition) public positions;

    /// @notice Pending withdrawal requests per wallet
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    /// @notice Team seeds per vaultId (one seed per team)
    mapping(bytes32 => TeamSeed) public teamSeeds;

    /// @notice Total USDC currently deposited in vault
    uint256 public totalDeposits;

    /// @notice Pool key for this vault's V4 pool
    PoolKey public poolKey;

    /// @notice Whether the V4 pool has been initialized
    bool public poolInitialized;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event Deposited(address indexed lp, uint256 amount, LockTier tier);
    event WithdrawalRequested(address indexed lp, uint256 amount, uint256 noticeExpiry);
    event WithdrawalExecuted(address indexed lp, uint256 amount, uint256 penalty);
    event Compounded(address indexed lp, uint256 feeAmount);
    event TeamSeeded(bytes32 indexed vaultId, address token, uint256 amount);
    event PoolInitialized(bytes32 indexed poolId);
    event Rebalanced(int24 newTickLower, int24 newTickUpper);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error MinHoldNotMet();
    error LockNotExpired();
    error NoWithdrawalRequest();
    error NoticeNotExpired();
    error WithdrawalAlreadyExecuted();
    error PoolNotInitialized();
    error PoolAlreadyInitialized();
    error InsufficientDeposit();
    error OnlyFeeVault();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _poolManager,
        address _feeVault,
        address _hook
    ) Ownable(msg.sender) {
        usdc        = IERC20(_usdc);
        poolManager = IPoolManager(_poolManager);
        feeVault    = _feeVault;
        hook        = _hook;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Community LP — deposit
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deposit USDC into the vault with a chosen lock tier
    function deposit(uint256 amount, LockTier tier) external nonReentrant {
        if (amount == 0) revert InsufficientDeposit();

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 lockDuration = _lockDuration(tier);

        positions[msg.sender] = LPPosition({
            usdcDeposited:   positions[msg.sender].usdcDeposited + amount,
            depositedAt:     block.timestamp,
            lockedUntil:     block.timestamp + lockDuration,
            tier:            tier,
            compoundEnabled: false
        });

        totalDeposits += amount;

        // Add to V4 pool if initialized
        if (poolInitialized) {
            _addLiquidity(amount);
        }

        emit Deposited(msg.sender, amount, tier);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Community LP — withdrawal (2-step)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Step 1: request withdrawal — starts 7-day notice period
    function requestWithdrawal(uint256 amount) external {
        LPPosition storage pos = positions[msg.sender];
        if (block.timestamp < pos.depositedAt + MIN_HOLD_PERIOD) revert MinHoldNotMet();
        if (amount > pos.usdcDeposited) revert InsufficientDeposit();

        uint256 expiry = block.timestamp + NOTICE_PERIOD;
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            amount:       amount,
            requestedAt:  block.timestamp,
            noticeExpiry: expiry,
            executed:     false
        });

        emit WithdrawalRequested(msg.sender, amount, expiry);
    }

    /// @notice Step 2: execute withdrawal after notice period
    function executeWithdrawal() external nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender];
        if (req.amount == 0)       revert NoWithdrawalRequest();
        if (req.executed)          revert WithdrawalAlreadyExecuted();
        if (block.timestamp < req.noticeExpiry) revert NoticeNotExpired();

        LPPosition storage pos = positions[msg.sender];
        uint256 penalty = _calculatePenalty(pos, req.amount);
        uint256 payout  = req.amount - penalty;

        req.executed = true;
        pos.usdcDeposited -= req.amount;
        totalDeposits     -= req.amount;

        // Remove liquidity from V4 pool
        if (poolInitialized) {
            _removeLiquidity(req.amount);
        }

        // Route penalty to FeeVault
        if (penalty > 0) {
            usdc.safeTransfer(feeVault, penalty);
        }

        usdc.safeTransfer(msg.sender, payout);

        emit WithdrawalExecuted(msg.sender, payout, penalty);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Auto-compound — called by FeeVault at epoch close
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice FeeVault calls this to compound an LP's fee earnings back into position
    function compound(address lp, uint256 feeAmount) external nonReentrant {
        if (msg.sender != feeVault) revert OnlyFeeVault();

        usdc.safeTransferFrom(feeVault, address(this), feeAmount);

        LPPosition storage pos = positions[lp];
        pos.usdcDeposited += feeAmount;
        totalDeposits     += feeAmount;

        if (poolInitialized) {
            _addLiquidity(feeAmount);
        }

        emit Compounded(lp, feeAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Team seeding
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Team seeds PROJECT tokens — initializes the V4 pool on first seed
    function seedTeamTokens(
        bytes32 vaultId,
        address projectToken,
        uint256 amount,
        PoolKey calldata key
    ) external nonReentrant {
        IERC20(projectToken).safeTransferFrom(msg.sender, address(this), amount);

        teamSeeds[vaultId] = TeamSeed({
            projectToken: projectToken,
            amount:       amount,
            seededAt:     block.timestamp
        });

        // Initialize V4 pool on first team seed
        if (!poolInitialized) {
            _initializePool(key);
        }

        emit TeamSeeded(vaultId, projectToken, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rebalancing — called by oracle (AI optimizer) or at epoch boundary
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Rebalance liquidity to new tick range — atomic via flash accounting
    function rebalance(
        int24 newTickLower,
        int24 newTickUpper
    ) external onlyOwner nonReentrant {
        if (!poolInitialized) revert PoolNotInitialized();

        // TODO (T1.4):
        //   1. Remove all liquidity from current range (flash accounting)
        //   2. Add all liquidity to new range
        //   3. Settle via poolManager.unlock()
        //   4. Update stored tick range

        emit Rebalanced(newTickLower, newTickUpper);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — V4 interactions (stubs, implemented in T1.3)
    // ─────────────────────────────────────────────────────────────────────────

    function _initializePool(PoolKey calldata key) internal {
        if (poolInitialized) revert PoolAlreadyInitialized();
        poolKey         = key;
        poolInitialized = true;
        // TODO (T1.3): poolManager.initialize(key, sqrtPriceX96)
        emit PoolInitialized(keccak256(abi.encode(key)));
    }

    function _addLiquidity(uint256 usdcAmount) internal {
        // TODO (T1.3): poolManager.unlock() → modifyLiquidity callback
    }

    function _removeLiquidity(uint256 usdcAmount) internal {
        // TODO (T1.3): poolManager.unlock() → modifyLiquidity callback
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — penalty + lock math
    // ─────────────────────────────────────────────────────────────────────────

    function _calculatePenalty(
        LPPosition storage pos,
        uint256 amount
    ) internal view returns (uint256) {
        if (pos.tier == LockTier.Flex) return 0;
        if (block.timestamp >= pos.lockedUntil) return 0;

        uint256 lockDuration = _lockDuration(pos.tier);
        uint256 elapsed      = block.timestamp - pos.depositedAt;
        uint256 pct          = (elapsed * 100) / lockDuration; // 0–100

        uint256 penaltyBps;
        if      (pct < 20)  penaltyBps = PENALTY_TIER_1_BPS;
        else if (pct < 50)  penaltyBps = PENALTY_TIER_2_BPS;
        else if (pct < 80)  penaltyBps = PENALTY_TIER_3_BPS;
        else                penaltyBps = 0;

        return (amount * penaltyBps) / BPS;
    }

    function _lockDuration(LockTier tier) internal pure returns (uint256) {
        if (tier == LockTier.Committed) return LOCK_COMMITTED;
        if (tier == LockTier.Aligned)   return LOCK_ALIGNED;
        if (tier == LockTier.Core)      return LOCK_CORE;
        return 0; // Flex
    }
}
