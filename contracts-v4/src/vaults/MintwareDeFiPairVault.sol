// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}       from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MintwarePairVault} from "./MintwarePairVault.sol";
import {PoolProfile, LockTier} from "./VaultTypes.sol";

/// @dev Minimal view of MintwareWeightedDistributor used for oracle-weighted fee routing.
interface IMWWeightedDistributor {
    function registerVault(bytes32 vaultId, address token0, address token1) external;
    function fundFees(bytes32 vaultId, uint256 amount0, uint256 amount1) external;
}

/// @title  MintwareDeFiPairVault
/// @notice A true dual-sided pair liquidity vault (generic token0/token1). Depositors provide
///         BOTH tokens in the current pool ratio and receive shares == V4 liquidity units — a
///         claim on both sides of the position. This is the pair-native evolution of the
///         single-sided MintwareDeFiVault4626 (which held only USDC and relied on a team-seeded
///         counter-asset); here neither side is privileged and neither must be USDC.
///
/// @dev    Deliberately NOT ERC-4626: a 4626 share is a claim on ONE underlying asset, which
///         cannot represent a two-token LP position. Shares are liquidity units instead.
///
///         Platform-standard machinery is preserved: pool profiles (tick half-width), lock
///         tiers with early-exit penalties, async (notice-period) redemption, the Stage-1.4
///         guardian kill-switch, and a Mintware protocol fee cut. Swap fees accrue ON-CHAIN
///         per share in BOTH tokens (a MasterChef-style accumulator) because the USDC-only
///         FeeVault cannot serve an arbitrary token pair.
///
///         Follow-on: a shared MintwarePairVault base to be extracted from this + the
///         MatchedLiquidityVault once both are proven; attribution/lock-weighted reward
///         layering on top of the raw per-share accrual.
contract MintwareDeFiPairVault is MintwarePairVault, IUnlockCallback {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    enum Action { Deploy, Remove, Rebalance, Collect }

    struct LockInfo {
        uint256  depositedAt;
        uint256  lockedUntil;
        LockTier tier;
        bool     initialized;
    }

    struct WithdrawalRequest {
        uint256 shares;
        uint256 noticeExpiry;
        bool    executed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant BPS             = 10_000;
    uint256 public constant NOTICE_PERIOD   = 7 days;
    uint256 public constant MIN_HOLD_PERIOD = 24 hours;
    uint256 public constant ACC_PRECISION   = 1e18;
    uint256 public constant MINTWARE_FEE_BPS = 2_500; // protocol cut of swap fees

    uint256 public constant LOCK_COMMITTED = 30 days;
    uint256 public constant LOCK_ALIGNED   = 90 days;
    uint256 public constant LOCK_CORE      = 180 days;

    uint256 public constant PENALTY_TIER_1_BPS = 200; // <20% elapsed → 2.0%
    uint256 public constant PENALTY_TIER_2_BPS = 100; // 20–50%      → 1.0%
    uint256 public constant PENALTY_TIER_3_BPS = 50;  // 50–80%      → 0.5%

    // ─────────────────────────────────────────────────────────────────────────
    // Immutables
    // ─────────────────────────────────────────────────────────────────────────

    IERC20       public immutable token0;
    IERC20       public immutable token1;
    address      public immutable provider;   // strategy manager

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    PoolProfile public profile;

    uint128 public totalLiquidity; // == total shares outstanding
    mapping(address => uint256) public shares;
    mapping(address => LockInfo) public locks;
    mapping(address => WithdrawalRequest) public withdrawals;

    // Fee accumulators (per share, ACC_PRECISION-scaled), one per token.
    uint256 public accFee0PerShare;
    uint256 public accFee1PerShare;
    mapping(address => uint256) public fee0Debt;
    mapping(address => uint256) public fee1Debt;

    // Oracle-weighted reward routing (audit migration slice 4). When set, the realized
    // LP fee portion is forwarded to MintwareWeightedDistributor for reputation + referral
    // weighting off-chain, instead of the pro-rata per-share accumulator above. This is the
    // "attribution/lock-weighted reward layering" the header anticipates.
    address public weightedDistributor;
    bytes32 public distributorVaultId;

    LockTier private _pendingTier; // consumed within a deposit

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event Deposited(address indexed lp, uint256 amount0, uint256 amount1, uint256 sharesMinted, LockTier tier);
    event RedeemRequested(address indexed lp, uint256 shares, uint256 noticeExpiry);
    event Redeemed(address indexed lp, uint256 shares, uint256 amount0, uint256 amount1, uint256 penalty0, uint256 penalty1);
    event FeesCollected(uint256 fee0, uint256 fee1, uint256 mintware0, uint256 mintware1);
    event FeesClaimed(address indexed lp, uint256 amount0, uint256 amount1);
    event WeightedDistributorSet(address indexed distributor, bytes32 indexed vaultId);
    event FeesRoutedToDistributor(bytes32 indexed vaultId, uint256 lp0, uint256 lp1);
    event Rebalanced(int24 tickLower, int24 tickUpper, uint128 liquidity);
    event ProfileSet(PoolProfile profile);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error BadConfig();
    error PoolNotInitialized();
    error ZeroLiquidity();
    error MinHoldNotMet();
    error InsufficientShares();
    error LockTierChangeNotAllowed();
    error NoRequest();
    error NoticeNotExpired();
    error AlreadyExecuted();
    error EmptyRange();
    error OnlyProvider();
    error ZeroDistributor();
    error WeightedDistributorAlreadySet();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        address _poolManager,
        PoolKey memory _poolKey,
        PoolProfile _profile,
        address _treasury,
        address _provider,
        address _initialOwner
    ) MintwarePairVault(_poolManager, _treasury, _initialOwner) {
        if (_treasury == address(0) || _provider == address(0)) revert BadConfig();
        address c0 = Currency.unwrap(_poolKey.currency0);
        address c1 = Currency.unwrap(_poolKey.currency1);
        if (c0 == address(0) || c1 == address(0) || c0 == c1) revert BadConfig();

        poolKey     = _poolKey;
        token0      = IERC20(c0);
        token1      = IERC20(c1);
        profile     = _profile;
        provider    = _provider;
    }

    modifier onlyProvider() {
        if (msg.sender != provider && msg.sender != owner()) revert OnlyProvider();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pool init + profile range
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Initialize the V4 pool at a launch price and set the initial profile range.
    function initializePool(uint160 sqrtPriceX96) external onlyProvider {
        _initializePool(sqrtPriceX96);
        int24 launchTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        (tickLower, tickUpper) = _profileRange(launchTick);
    }

    function profileHalfWidth(PoolProfile p) public pure returns (int24) {
        if (p == PoolProfile.BLUE_CHIP) return 600;
        if (p == PoolProfile.EMERGING)  return 1200;
        return 2400; // MEME
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deposit — balanced dual-sided
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Provide BOTH tokens; the vault adds the maximal balanced liquidity at the current
    ///         profile range and mints shares == liquidity added. Unused dust is returned.
    /// @param  amount0Desired / amount1Desired  amounts the caller makes available.
    /// @param  minShares  slippage floor on liquidity minted.
    /// @param  tier       lock tier (fee-multiplier / penalty semantics; Flex = no lock).
    function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 minShares, LockTier tier)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesMinted)
    {
        if (!poolInitialized) revert PoolNotInitialized();

        // Settle any accrued fees for the caller on their existing balance BEFORE their share
        // count changes (so the accumulator stays correct).
        _claimFees(msg.sender);

        token0.safeTransferFrom(msg.sender, address(this), amount0Desired);
        token1.safeTransferFrom(msg.sender, address(this), amount1Desired);

        _pendingTier = tier;
        bytes memory res = poolManager.unlock(abi.encode(Action.Deploy, abi.encode(amount0Desired, amount1Desired)));
        (uint128 liquidity, uint256 used0, uint256 used1) = abi.decode(res, (uint128, uint256, uint256));
        _pendingTier = LockTier.Flex;

        if (liquidity == 0) revert ZeroLiquidity();
        if (liquidity < minShares) revert InsufficientShares();

        // Return unused dust.
        if (amount0Desired > used0) token0.safeTransfer(msg.sender, amount0Desired - used0);
        if (amount1Desired > used1) token1.safeTransfer(msg.sender, amount1Desired - used1);

        shares[msg.sender] += liquidity;
        totalLiquidity     += liquidity;
        _recordLock(msg.sender, tier);

        // Reset fee debt to current accumulator for the new (larger) balance.
        fee0Debt[msg.sender] = (shares[msg.sender] * accFee0PerShare) / ACC_PRECISION;
        fee1Debt[msg.sender] = (shares[msg.sender] * accFee1PerShare) / ACC_PRECISION;

        sharesMinted = liquidity;
        emit Deposited(msg.sender, used0, used1, liquidity, tier);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Redemption — async (notice period) + lock penalty
    // ─────────────────────────────────────────────────────────────────────────

    function requestRedeem(uint256 shares_) external nonReentrant {
        if (block.timestamp < locks[msg.sender].depositedAt + MIN_HOLD_PERIOD) revert MinHoldNotMet();
        if (shares_ == 0 || shares_ > shares[msg.sender]) revert InsufficientShares();
        uint256 expiry = block.timestamp + NOTICE_PERIOD;
        withdrawals[msg.sender] = WithdrawalRequest({shares: shares_, noticeExpiry: expiry, executed: false});
        emit RedeemRequested(msg.sender, shares_, expiry);
    }

    function executeRedeem()
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amount0, uint256 amount1)
    {
        WithdrawalRequest storage req = withdrawals[msg.sender];
        if (req.shares == 0) revert NoRequest();
        if (req.executed) revert AlreadyExecuted();
        if (block.timestamp < req.noticeExpiry) revert NoticeNotExpired();

        uint256 s = req.shares;
        if (s > shares[msg.sender]) s = shares[msg.sender];
        req.executed = true;

        // Realize + distribute pending fees first (fee-free position → clean principal removal),
        // then settle this LP's fee share on their pre-burn balance.
        _realizeFees();
        _claimFees(msg.sender);

        // Effects
        shares[msg.sender] -= s;
        totalLiquidity     -= uint128(s);

        // Remove `s` liquidity units; proceeds come back to the vault so we can net penalties.
        bytes memory res = poolManager.unlock(abi.encode(Action.Remove, abi.encode(uint128(s))));
        (uint256 out0, uint256 out1) = abi.decode(res, (uint256, uint256));

        // Early-exit penalty (both tokens), routed to the provider as retained liquidity value.
        uint256 penaltyBps = _penaltyBps(msg.sender);
        uint256 pen0 = (out0 * penaltyBps) / BPS;
        uint256 pen1 = (out1 * penaltyBps) / BPS;
        if (pen0 > 0) token0.safeTransfer(treasury, pen0);
        if (pen1 > 0) token1.safeTransfer(treasury, pen1);

        amount0 = out0 - pen0;
        amount1 = out1 - pen1;

        // Reset fee debt for the remaining balance.
        fee0Debt[msg.sender] = (shares[msg.sender] * accFee0PerShare) / ACC_PRECISION;
        fee1Debt[msg.sender] = (shares[msg.sender] * accFee1PerShare) / ACC_PRECISION;

        if (amount0 > 0) token0.safeTransfer(msg.sender, amount0);
        if (amount1 > 0) token1.safeTransfer(msg.sender, amount1);
        emit Redeemed(msg.sender, s, amount0, amount1, pen0, pen1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fees — realize on-chain + per-share accrual in both tokens
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Realize accrued swap fees on the position and distribute (permissionless keeper).
    function collectFees() external nonReentrant whenNotPaused returns (uint256 fee0, uint256 fee1) {
        return _realizeFees();
    }

    function _realizeFees() internal returns (uint256 fee0, uint256 fee1) {
        if (!poolInitialized || totalLiquidity == 0) return (0, 0);
        bytes memory res = poolManager.unlock(abi.encode(Action.Collect, bytes("")));
        (fee0, fee1) = abi.decode(res, (uint256, uint256));
        if (fee0 == 0 && fee1 == 0) return (0, 0);

        uint256 mint0 = (fee0 * MINTWARE_FEE_BPS) / BPS;
        uint256 mint1 = (fee1 * MINTWARE_FEE_BPS) / BPS;
        if (mint0 > 0) token0.safeTransfer(treasury, mint0);
        if (mint1 > 0) token1.safeTransfer(treasury, mint1);

        uint256 lp0 = fee0 - mint0;
        uint256 lp1 = fee1 - mint1;
        if (weightedDistributor != address(0)) {
            // Canonical path: route LP fees to the oracle-weighted distributor. LPs claim
            // their reputation + referral weighted share there, not from the accumulator.
            if (lp0 > 0 || lp1 > 0) {
                IMWWeightedDistributor(weightedDistributor).fundFees(distributorVaultId, lp0, lp1);
                emit FeesRoutedToDistributor(distributorVaultId, lp0, lp1);
            }
        } else {
            // Legacy path: pro-rata per-share accrual (pre-wiring / un-migrated vaults).
            accFee0PerShare += (lp0 * ACC_PRECISION) / totalLiquidity;
            accFee1PerShare += (lp1 * ACC_PRECISION) / totalLiquidity;
        }
        emit FeesCollected(fee0, fee1, mint0, mint1);
    }

    /// @notice One-time wiring of the reputation + referral weighted distributor. Once set,
    ///         realized LP fees route there (oracle-weighted) instead of the pro-rata
    ///         accumulator. Registers this vault's token pair with the distributor and
    ///         grants it the pull allowance it needs for fundFees().
    function setWeightedDistributor(address dist, bytes32 vaultId) external onlyOwner {
        if (dist == address(0))                revert ZeroDistributor();
        if (weightedDistributor != address(0)) revert WeightedDistributorAlreadySet();
        weightedDistributor = dist;
        distributorVaultId  = vaultId;
        IMWWeightedDistributor(dist).registerVault(vaultId, address(token0), address(token1));
        token0.forceApprove(dist, type(uint256).max);
        token1.forceApprove(dist, type(uint256).max);
        emit WeightedDistributorSet(dist, vaultId);
    }

    function claimFees() external nonReentrant {
        _claimFees(msg.sender);
    }

    function _claimFees(address lp) internal {
        uint256 s = shares[lp];
        if (s == 0) return;
        uint256 a0 = (s * accFee0PerShare) / ACC_PRECISION - fee0Debt[lp];
        uint256 a1 = (s * accFee1PerShare) / ACC_PRECISION - fee1Debt[lp];
        fee0Debt[lp] = (s * accFee0PerShare) / ACC_PRECISION;
        fee1Debt[lp] = (s * accFee1PerShare) / ACC_PRECISION;
        if (a0 > 0) token0.safeTransfer(lp, a0);
        if (a1 > 0) token1.safeTransfer(lp, a1);
        if (a0 > 0 || a1 > 0) emit FeesClaimed(lp, a0, a1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rebalance
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Move the whole position to the range implied by `p` around the current tick.
    function rebalanceToProfile(PoolProfile p) external onlyProvider nonReentrant whenNotPaused {
        if (!poolInitialized) revert PoolNotInitialized();
        (, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());
        (int24 lower, int24 upper) = _profileRangeFor(p, currentTick);
        if (upper <= lower) revert EmptyRange();

        _realizeFees(); // realize fees before moving the position
        profile = p;
        poolManager.unlock(abi.encode(Action.Rebalance, abi.encode(lower, upper)));
        emit ProfileSet(p);
        emit Rebalanced(lower, upper, totalLiquidity);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IUnlockCallback
    // ─────────────────────────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        _onlyPoolManager();
        (Action action, bytes memory params) = abi.decode(data, (Action, bytes));

        if (action == Action.Deploy) {
            (uint256 a0, uint256 a1) = abi.decode(params, (uint256, uint256));
            return _deploy(a0, a1);
        }
        if (action == Action.Remove) {
            uint128 liq = abi.decode(params, (uint128));
            return _remove(liq);
        }
        if (action == Action.Collect) {
            return _collect();
        }
        (int24 lo, int24 hi) = abi.decode(params, (int24, int24));
        return _rebalance(lo, hi);
    }

    function _deploy(uint256 a0, uint256 a1) internal returns (bytes memory) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolKey.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtP, sqrtLower, sqrtUpper, a0, a1);
        if (liquidity == 0) return abi.encode(uint128(0), uint256(0), uint256(0));

        uint256 bal0Before = token0.balanceOf(address(this));
        uint256 bal1Before = token1.balanceOf(address(this));

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(delta);

        uint256 used0 = bal0Before - token0.balanceOf(address(this));
        uint256 used1 = bal1Before - token1.balanceOf(address(this));
        return abi.encode(liquidity, used0, used1);
    }

    function _remove(uint128 liquidity) internal returns (bytes memory) {
        uint256 bal0Before = token0.balanceOf(address(this));
        uint256 bal1Before = token1.balanceOf(address(this));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(delta);
        uint256 out0 = token0.balanceOf(address(this)) - bal0Before;
        uint256 out1 = token1.balanceOf(address(this)) - bal1Before;
        return abi.encode(out0, out1);
    }

    function _collect() internal returns (bytes memory) {
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: bytes32(0)}),
            ""
        );
        _settleDelta(delta);
        uint256 fee0 = delta.amount0() > 0 ? uint256(uint128(delta.amount0())) : 0;
        uint256 fee1 = delta.amount1() > 0 ? uint256(uint128(delta.amount1())) : 0;
        return abi.encode(fee0, fee1);
    }

    function _rebalance(int24 newLower, int24 newUpper) internal returns (bytes memory) {
        if (totalLiquidity > 0) {
            (BalanceDelta removeDelta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(totalLiquidity)), salt: bytes32(0)}),
                ""
            );
            _settleDelta(removeDelta);
        }

        tickLower = newLower;
        tickUpper = newUpper;

        // Re-add the maximal balanced liquidity from the tokens now held by the vault.
        uint256 a0 = token0.balanceOf(address(this));
        uint256 a1 = token1.balanceOf(address(this));
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolKey.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(newLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(newUpper);
        uint128 newLiquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtP, sqrtLower, sqrtUpper, a0, a1);
        if (newLiquidity > 0) {
            (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({tickLower: newLower, tickUpper: newUpper, liquidityDelta: int256(uint256(newLiquidity)), salt: bytes32(0)}),
                ""
            );
            _settleDelta(addDelta);
        }
        // totalLiquidity (share supply) is unchanged by a rebalance — shares track ownership, not
        // the raw V4 liquidity number, which may shift slightly at a new range.
        return "";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lock / penalty
    // ─────────────────────────────────────────────────────────────────────────

    function _recordLock(address owner_, LockTier tier) internal {
        LockInfo storage info = locks[owner_];
        uint256 lockedUntil = block.timestamp + _lockDuration(tier);
        if (info.initialized && shares[owner_] > 0) {
            // Same-tier top-ups allowed; tier changes blocked while a balance exists.
            if (info.tier != tier) revert LockTierChangeNotAllowed();
            if (info.lockedUntil > lockedUntil) lockedUntil = info.lockedUntil;
            info.lockedUntil = lockedUntil;
            info.depositedAt = block.timestamp;
        } else {
            info.tier        = tier;
            info.depositedAt = block.timestamp;
            info.lockedUntil = lockedUntil;
            info.initialized = true;
        }
    }

    function _penaltyBps(address lp) internal view returns (uint256) {
        LockInfo storage info = locks[lp];
        if (info.tier == LockTier.Flex)          return 0;
        if (block.timestamp >= info.lockedUntil) return 0;
        uint256 dur     = _lockDuration(info.tier);
        uint256 elapsed = block.timestamp - info.depositedAt;
        uint256 pct     = dur == 0 ? 100 : (elapsed * 100) / dur;
        if (pct < 20) return PENALTY_TIER_1_BPS;
        if (pct < 50) return PENALTY_TIER_2_BPS;
        if (pct < 80) return PENALTY_TIER_3_BPS;
        return 0;
    }

    function _lockDuration(LockTier tier) internal pure returns (uint256) {
        if (tier == LockTier.Committed) return LOCK_COMMITTED;
        if (tier == LockTier.Aligned)   return LOCK_ALIGNED;
        if (tier == LockTier.Core)      return LOCK_CORE;
        return 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Range helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _profileRange(int24 currentTick) internal view returns (int24 lower, int24 upper) {
        return _profileRangeFor(profile, currentTick);
    }

    function _profileRangeFor(PoolProfile p, int24 currentTick) internal view returns (int24 lower, int24 upper) {
        int24 spacing = poolKey.tickSpacing;
        int24 hw = profileHalfWidth(p);
        lower = _alignTick(currentTick - hw, spacing);
        upper = _alignTick(currentTick + hw, spacing);
    }

    function _alignTick(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function pendingFees(address lp) external view returns (uint256 fee0, uint256 fee1) {
        uint256 s = shares[lp];
        fee0 = (s * accFee0PerShare) / ACC_PRECISION - fee0Debt[lp];
        fee1 = (s * accFee1PerShare) / ACC_PRECISION - fee1Debt[lp];
    }
}
