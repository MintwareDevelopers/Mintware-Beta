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
import {SqrtPriceMath}         from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MintwarePairVault} from "./MintwarePairVault.sol";
import {PoolProfile, LockTier} from "./VaultTypes.sol";
import {IYieldAdapter} from "./IYieldAdapter.sol";

/// @dev Minimal view of MintwareWeightedDistributor used for oracle-weighted fee routing.
interface IMWWeightedDistributor {
    function registerVault(bytes32 vaultId, address token0, address token1) external;
    function fundFees(bytes32 vaultId, uint256 amount0, uint256 amount1) external;
}

/// @dev Optional adapter self-description used to hard-verify a wired adapter really idles the
///      matching pool token (a Bunni-class mis-wiring guard). Not part of IYieldAdapter, so the
///      check is best-effort (skipped if the adapter doesn't expose it).
interface IAdapterAsset {
    function asset() external view returns (address);
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

    /// @notice Virtual-liquidity offset applied to the deposit mint formula (inflation defense,
    ///         defense-in-depth). Floors the share/position denominator so a griefer can't drive a
    ///         later depositor's minted shares to zero via a tiny first deposit. Symmetrically small
    ///         (1e3 liquidity units) versus real deposits (~1e18+), so dilution is negligible.
    ///         NB: the primary defense is that shares are minted against on-chain V4 `positionLiquidity`
    ///         (which a raw token donation to the vault balance cannot inflate), NOT against the vault's
    ///         token balance — the classic ERC-4626 donation vector does not apply. This offset closes
    ///         the residual tiny-supply rounding grief.
    uint256 public constant VIRTUAL_LIQUIDITY = 1e3;

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

    uint128 public totalLiquidity; // == total shares outstanding (ownership units)
    /// @notice The ACTUAL V4 liquidity currently deployed in the active range. Diverges from
    ///         `totalLiquidity` (shares) after a `_rebalance`, which re-derives the raw V4 number
    ///         for the same tokens at a new range. Redeem removes `positionLiquidity * s / shares`
    ///         so shares always track a pro-rata claim on the live position — never a raw 1:1 unit
    ///         (audit HIGH: 1:1 removal after a rebalance locked out late redeemers).
    uint128 public positionLiquidity;
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

    /// @notice The am-AMM auction — the ONLY address allowed to push rent via fundRent().
    address public rentFunder;
    /// @dev Sub-threshold rent remainder carried between fundRent calls so tiny rent is
    ///      never stranded when (amount * ACC_PRECISION) < totalLiquidity truncates to 0.
    uint256 public rentDust0;
    uint256 public rentDust1;

    /// @notice Vault-held tokens that back UNCLAIMED accumulator fees + rent (the accumulator
    ///         liability). Segregated so `_rebalance` never sweeps LPs' owed fees into the pool
    ///         position — a share of the raw balance would otherwise silently reassign them.
    uint256 public feeReserve0;
    uint256 public feeReserve1;

    // ── Buffered rehypothecation (ULV Phase 1a increment 2) ──────────────────
    // Idle capital: pool principal that is currently supplied to a yield source (Aave v3) via
    // one adapter per token, tracked as PRICE-FREE SETTLED COUNTERS. `idleN` is the vault's own
    // record of principal it has supplied — it is NEVER derived from `adapter.totalAssets()`
    // (that live aToken read is donation-inflatable; using it in share/redeem math is the Bunni bug
    // shape). A share is a pro-rata claim on BOTH locations per token: pooled tokens + idle tokens.
    IYieldAdapter public adapter0;
    IYieldAdapter public adapter1;
    uint256 public idle0; // settled token0 principal supplied to adapter0 (Aave)
    uint256 public idle1; // settled token1 principal supplied to adapter1 (Aave)

    /// @notice Liquidity-unit equivalent of the currently-idled capital, i.e. the sum of V4
    ///         liquidity units removed from the pool to fund `idle0/idle1` (decremented pro-rata on
    ///         redeem, and by the redeployed amount on refill). Used ONLY to target `bufferRatioBps`
    ///         in `rebalanceBuffer` — never in the share/redeem payout math. `managedLiquidity` =
    ///         `positionLiquidity + idleLiquidity` is the price-free total the buffer ratio splits.
    uint128 public idleLiquidity;

    /// @notice Target fraction (bps) of managed liquidity to keep HOT in the active V4 position;
    ///         the remainder is idled in Aave. 0 = keep everything pooled (no idling).
    uint256 public bufferRatioBps;

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
    event RentFunded(address indexed token, uint256 amount);
    event RentFunderSet(address indexed funder);
    event Rebalanced(int24 tickLower, int24 tickUpper, uint128 liquidity);
    event ProfileSet(PoolProfile profile);
    event AdaptersSet(address indexed adapter0, address indexed adapter1);
    event BufferRatioSet(uint256 bufferRatioBps);
    event Idled(uint128 liquidity, uint256 amount0, uint256 amount1);
    event Refilled(uint128 liquidity, uint256 amount0, uint256 amount1);
    event YieldHarvested(uint256 lp0, uint256 lp1, uint256 mintware0, uint256 mintware1);

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
    error OnlyRentFunder();
    error ZeroAddress();
    error AdaptersAlreadySet();
    error AdapterAssetMismatch();
    error AdaptersNotSet();
    error BadBufferRatio();
    error AaveTemporarilyIlliquid();

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

        // Mint shares as a pro-rata claim on TOTAL MANAGED liquidity — pooled + idle-equivalent —
        // because an existing share claims both legs (position tokens AND idled principal). Pricing a
        // new deposit against `positionLiquidity` alone would explode `minted` when capital is idled
        // (position → 0 while shares persist), so the denominator MUST include `idleLiquidity`. Still
        // price-free: both numerator and denominator are liquidity units, no token price appears.
        // `sharesMinted = (totalShares + V) * liq / (managed + V)`; the VIRTUAL_LIQUIDITY offset (V)
        // floors the denominator against tiny-supply rounding grief (inflation defense). At bootstrap
        // (totalLiquidity == managed == 0) this reduces to `minted = liq` (1:1), unchanged.
        uint256 managed = uint256(positionLiquidity) + uint256(idleLiquidity);
        uint256 minted = ((uint256(totalLiquidity) + VIRTUAL_LIQUIDITY) * liquidity)
            / (managed + VIRTUAL_LIQUIDITY);
        if (minted == 0 || minted < minShares) revert InsufficientShares();
        // Shares are tracked in uint128 (totalLiquidity); refuse a mint that would truncate.
        if (minted > type(uint128).max) revert InsufficientShares();

        // Return unused dust.
        if (amount0Desired > used0) token0.safeTransfer(msg.sender, amount0Desired - used0);
        if (amount1Desired > used1) token1.safeTransfer(msg.sender, amount1Desired - used1);

        shares[msg.sender] += minted;
        totalLiquidity     += uint128(minted);
        positionLiquidity  += liquidity;
        _recordLock(msg.sender, tier);

        // Reset fee debt to current accumulator for the new (larger) balance.
        fee0Debt[msg.sender] = (shares[msg.sender] * accFee0PerShare) / ACC_PRECISION;
        fee1Debt[msg.sender] = (shares[msg.sender] * accFee1PerShare) / ACC_PRECISION;

        sharesMinted = minted;
        emit Deposited(msg.sender, used0, used1, minted, tier);
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

        // Everything below is priced against the PRE-burn share supply (`TL`), so the pool leg and
        // the idle leg use the same price-free denominator — a share is a pro-rata claim on BOTH.
        uint128 TL = totalLiquidity;

        // Pro-rata claim on the live position: `s` shares map to `positionLiquidity * s / TL`
        // V4 units. Rounds DOWN, so the vault never over-removes — the last redeemer can always
        // exit and any rounding dust accrues to remaining holders (solvency-preserving).
        uint128 liqToRemove = TL == 0 ? 0 : uint128((uint256(positionLiquidity) * s) / TL);

        // Pro-rata claim on the IDLE (Aave) leg — per token, round DOWN, on the same pre-burn TL.
        // No price is used: idle is a settled token counter, redeemed as a fraction of itself.
        uint256 idleOut0  = TL == 0 ? 0 : (idle0 * s) / TL;
        uint256 idleOut1  = TL == 0 ? 0 : (idle1 * s) / TL;
        uint128 idleLiqOut = TL == 0 ? 0 : uint128((uint256(idleLiquidity) * s) / TL);

        // Effects — decrement ALL settled state BEFORE the external adapter withdraw (CEI). A
        // re-entrant adapter can therefore never see stale idle counters to double-claim against.
        shares[msg.sender] -= s;
        totalLiquidity     -= uint128(s);
        positionLiquidity  -= liqToRemove;
        idle0              -= idleOut0;
        idle1              -= idleOut1;
        idleLiquidity      -= idleLiqOut;

        // Pull this redeemer's idle slice back from Aave. Best-effort at the adapter, but a redeem is
        // NOT the swap hot path, so if Aave cannot return the full settled amount we revert and let
        // the LP retry (honest partial-fill avoidance) rather than short-changing them silently.
        uint256 gotIdle0;
        uint256 gotIdle1;
        if (idleOut0 > 0) { gotIdle0 = adapter0.withdraw(idleOut0); if (gotIdle0 < idleOut0) revert AaveTemporarilyIlliquid(); }
        if (idleOut1 > 0) { gotIdle1 = adapter1.withdraw(idleOut1); if (gotIdle1 < idleOut1) revert AaveTemporarilyIlliquid(); }

        // Remove the mapped pooled liquidity; proceeds come back to the vault so we can net penalties.
        // Skip the unlock entirely when the pooled slice rounds to 0 (e.g. this LP's capital is fully
        // idled) — a `modifyLiquidity(0)` on an empty position reverts `CannotUpdateEmptyPosition`.
        uint256 pool0;
        uint256 pool1;
        if (liqToRemove > 0) {
            bytes memory res = poolManager.unlock(abi.encode(Action.Remove, abi.encode(liqToRemove)));
            (pool0, pool1) = abi.decode(res, (uint256, uint256));
        }

        // Combine pool proceeds + idle proceeds, THEN apply the early-exit penalty on the total.
        uint256 out0 = pool0 + gotIdle0;
        uint256 out1 = pool1 + gotIdle1;

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
        // `positionLiquidity == 0` (all capital idled in Aave) means there is no live V4 position to
        // collect from — a `modifyLiquidity(0)` on an empty position reverts `CannotUpdateEmptyPosition`.
        if (!poolInitialized || totalLiquidity == 0 || positionLiquidity == 0) return (0, 0);
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
            feeReserve0 += lp0; // these tokens stay in the vault to back claims — segregate them
            feeReserve1 += lp1;
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

    /// @notice One-time-ish wiring of the am-AMM auction allowed to push rent. Owner-set.
    function setRentFunder(address _funder) external onlyOwner {
        rentFunder = _funder;
        emit RentFunderSet(_funder);
    }

    /// @notice Receive am-AMM rent for the LPs. Only the wired auction may call it. Rent
    ///         arrives in one of the two pool tokens and is routed to LPs exactly like
    ///         realized swap fees — via the weighted distributor if wired, else the
    ///         pro-rata per-share accumulator. Balance-diff intake makes it safe for
    ///         fee-on-transfer tokens; a carried remainder means sub-threshold rent is
    ///         never stranded. This is the IAmAmmRentSink entrypoint MWAmAuction calls.
    function fundRent(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (msg.sender != rentFunder) revert OnlyRentFunder();
        if (amount == 0) return;
        bool isToken0 = token == address(token0);
        if (!isToken0 && token != address(token1)) revert BadConfig();

        // Credit what ACTUALLY arrived (fee-on-transfer safe), mirroring _deploy/_remove.
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;
        if (received == 0) return;

        if (weightedDistributor != address(0)) {
            (uint256 r0, uint256 r1) = isToken0 ? (received, uint256(0)) : (uint256(0), received);
            IMWWeightedDistributor(weightedDistributor).fundFees(distributorVaultId, r0, r1);
        } else if (totalLiquidity == 0) {
            // No LPs to credit — forward to treasury rather than strand it or divide by zero.
            IERC20(token).safeTransfer(treasury, received);
        } else if (isToken0) {
            uint256 pool0 = rentDust0 + received;
            uint256 add0  = (pool0 * ACC_PRECISION) / totalLiquidity;
            accFee0PerShare += add0;
            rentDust0 = pool0 - (add0 * totalLiquidity) / ACC_PRECISION;
            feeReserve0 += received; // rent tokens stay in the vault to back claims — segregate
        } else {
            uint256 pool1 = rentDust1 + received;
            uint256 add1  = (pool1 * ACC_PRECISION) / totalLiquidity;
            accFee1PerShare += add1;
            rentDust1 = pool1 - (add1 * totalLiquidity) / ACC_PRECISION;
            feeReserve1 += received;
        }
        emit RentFunded(token, received);
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
        if (a0 > 0) feeReserve0 -= a0; // release from the reserve as it's paid out
        if (a1 > 0) feeReserve1 -= a1;
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
        emit Rebalanced(lower, upper, positionLiquidity);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Buffered rehypothecation — idle capital engine (Aave v3 via IYieldAdapter)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Hard-wire the two per-token yield adapters, ONCE. Owner-only; never caller-supplied
    ///         at deposit/swap time (a Bunni-class attack vector). Each adapter's `asset()` — if it
    ///         exposes one — must match its token, so a swapped adapter can't silently mis-account.
    function setAdapters(IYieldAdapter a0, IYieldAdapter a1) external onlyOwner {
        if (address(adapter0) != address(0) || address(adapter1) != address(0)) revert AdaptersAlreadySet();
        if (address(a0) == address(0) || address(a1) == address(0)) revert ZeroAddress();
        _verifyAdapterAsset(address(a0), address(token0));
        _verifyAdapterAsset(address(a1), address(token1));
        adapter0 = a0;
        adapter1 = a1;
        emit AdaptersSet(address(a0), address(a1));
    }

    /// @notice Set the target fraction (bps) of managed liquidity to keep hot in the V4 position.
    function setBufferRatio(uint256 bps) external onlyOwner {
        if (bps > BPS) revert BadBufferRatio();
        bufferRatioBps = bps;
        emit BufferRatioSet(bps);
    }

    function _verifyAdapterAsset(address adapter, address token) internal view {
        // Best-effort: only enforce if the adapter self-describes (IYieldAdapter itself doesn't).
        try IAdapterAsset(adapter).asset() returns (address a) {
            if (a != token) revert AdapterAssetMismatch();
        } catch {}
    }

    /// @notice Move managed capital pool→Aave and Aave→pool toward `bufferRatioBps`. Provider/keeper
    ///         only; safe to call whenever drift crosses the target. Reverts are acceptable here (this
    ///         is NOT the swap hot path); the underlying adapter is nonetheless best-effort so the
    ///         function degrades gracefully rather than bricking.
    function rebalanceBuffer() external onlyProvider nonReentrant whenNotPaused {
        if (address(adapter0) == address(0)) revert AdaptersNotSet();
        _realizeFees(); // clean principal before moving any liquidity
        uint256 managed = uint256(positionLiquidity) + uint256(idleLiquidity);
        if (managed == 0) return;
        uint256 targetPooled = (managed * bufferRatioBps) / BPS;
        if (uint256(positionLiquidity) > targetPooled) {
            // excess <= positionLiquidity (uint128) → cast is always safe.
            _supplyIdleCore(uint128(uint256(positionLiquidity) - targetPooled));
        } else if (uint256(positionLiquidity) < targetPooled) {
            // deficit is bounded by idleLiquidity (the only capital available to refill); clamp to it
            // BEFORE the uint128 cast so the cast can never truncate.
            uint256 deficit = targetPooled - uint256(positionLiquidity);
            if (deficit > idleLiquidity) deficit = idleLiquidity;
            _refillIdleCore(uint128(deficit));
        }
    }

    /// @notice Explicitly idle `deltaL` V4 liquidity units into Aave (provider/keeper). Exposed
    ///         alongside `rebalanceBuffer` for precise operator control + invariant coverage.
    function supplyIdle(uint128 deltaL) external onlyProvider nonReentrant whenNotPaused {
        if (address(adapter0) == address(0)) revert AdaptersNotSet();
        _realizeFees();
        _supplyIdleCore(deltaL);
    }

    /// @notice Explicitly refill `deltaL` V4 liquidity units from Aave back into the position.
    function recallIdle(uint128 deltaL) external onlyProvider nonReentrant whenNotPaused {
        if (address(adapter0) == address(0)) revert AdaptersNotSet();
        _realizeFees();
        _refillIdleCore(deltaL);
    }

    /// @dev Remove `deltaL` pooled liquidity and supply the resulting principal to Aave. Fees must
    ///      already be realized (caller does this) so `out0/out1` are clean principal, not owed fees.
    function _supplyIdleCore(uint128 deltaL) internal {
        if (deltaL == 0 || positionLiquidity == 0) return;
        if (deltaL > positionLiquidity) deltaL = positionLiquidity;
        // Graceful gate: only idle if BOTH reserves can currently accept supply (else no-op, no
        // stranded tokens — we never remove liquidity we can't fully re-home in Aave).
        if (adapter0.maxSuppliable() == 0 || adapter1.maxSuppliable() == 0) return;
        // Skip a dust removal that would free zero tokens on both sides: it would still burn pooled
        // liquidity (pool keeps the sub-wei dust) and could over time bleed the position into a
        // phantom `idleLiquidity` counter backed by no principal. Pricing the move first (a pure
        // view calc, no state) keeps the idle bookkeeping and the position honest.
        {
            (uint256 exp0, uint256 exp1) = _amountsForLiquidity(deltaL);
            if (exp0 == 0 && exp1 == 0) return;
        }

        bytes memory res = poolManager.unlock(abi.encode(Action.Remove, abi.encode(deltaL)));
        (uint256 out0, uint256 out1) = abi.decode(res, (uint256, uint256));

        // Effects: pooled → idle. Settled counters move by exactly the principal that left the pool.
        positionLiquidity -= deltaL;
        idle0 += out0;
        idle1 += out1;
        idleLiquidity += deltaL;

        // Supply to Aave. Exact-amount approvals; the adapter pulls from the vault.
        if (out0 > 0) { token0.forceApprove(address(adapter0), out0); adapter0.deposit(out0); }
        if (out1 > 0) { token1.forceApprove(address(adapter1), out1); adapter1.deposit(out1); }
        emit Idled(deltaL, out0, out1);
    }

    /// @dev Withdraw a pro-rata slice of idle principal from Aave and redeploy it into the active
    ///      range. Any ratio-mismatch leftover is re-idled so no tokens are stranded in the vault.
    function _refillIdleCore(uint128 deltaL) internal {
        if (deltaL == 0 || idleLiquidity == 0) return;
        if (deltaL > idleLiquidity) deltaL = idleLiquidity;

        // Token amounts backing this liquidity-equiv slice (round DOWN — vault-favoring).
        uint256 want0 = (idle0 * deltaL) / idleLiquidity;
        uint256 want1 = (idle1 * deltaL) / idleLiquidity;

        // Best-effort withdraw from Aave (tokens land in the vault).
        uint256 got0 = want0 > 0 ? adapter0.withdraw(want0) : 0;
        uint256 got1 = want1 > 0 ? adapter1.withdraw(want1) : 0;

        // Redeploy what we pulled into the active range.
        uint128 addedL;
        uint256 used0;
        uint256 used1;
        if (got0 > 0 || got1 > 0) {
            bytes memory res = poolManager.unlock(abi.encode(Action.Deploy, abi.encode(got0, got1)));
            (addedL, used0, used1) = abi.decode(res, (uint128, uint256, uint256));
        }

        // Net idle change = principal that actually left Aave for the pool (`used`). The
        // ratio-mismatch leftover (`got - used`) is re-supplied to Aave, so `idleN` only ever
        // moves by the deployed amount and no tokens strand in the vault.
        idle0 -= used0;
        idle1 -= used1;
        positionLiquidity += addedL;
        // managed-liquidity conserving: pool gained `addedL`, so idle-equiv drops by `addedL`.
        idleLiquidity -= addedL <= idleLiquidity ? addedL : idleLiquidity;

        uint256 left0 = got0 - used0;
        uint256 left1 = got1 - used1;
        if (left0 > 0) { token0.forceApprove(address(adapter0), left0); adapter0.deposit(left0); }
        if (left1 > 0) { token1.forceApprove(address(adapter1), left1); adapter1.deposit(left1); }
        emit Refilled(addedL, used0, used1);
    }

    /// @notice Harvest Aave supply yield (the surplus of `adapter.totalAssets()` over the settled
    ///         `idleN` principal) and distribute it to LPs EXACTLY like swap fees — via the weighted
    ///         distributor if wired, else the pro-rata per-share accumulator + segregated reserve.
    ///         `idleN` is untouched (yield is not principal), so the live aToken balance never enters
    ///         the share/redeem math (Bunni-safe). Provider/keeper only.
    function harvestYield() external onlyProvider nonReentrant whenNotPaused
        returns (uint256 lp0, uint256 lp1)
    {
        if (address(adapter0) == address(0)) revert AdaptersNotSet();
        (uint256 g0, uint256 mint0) = _harvestOne(adapter0, token0, idle0, true);
        (uint256 g1, uint256 mint1) = _harvestOne(adapter1, token1, idle1, false);
        lp0 = g0;
        lp1 = g1;
        if (g0 > 0 || g1 > 0) emit YieldHarvested(g0, g1, mint0, mint1);
    }

    /// @dev Realize one token's yield surplus into distributable fees. Returns (lpPortion, mintwareCut).
    function _harvestOne(IYieldAdapter adapter, IERC20 token, uint256 idleN, bool isToken0)
        internal
        returns (uint256 lpAmt, uint256 mintwareAmt)
    {
        uint256 assets = adapter.totalAssets();
        if (assets <= idleN) return (0, 0);
        uint256 surplus = assets - idleN;
        // Pull yield only — principal (`idleN`) stays supplied, so the settled counter is unchanged.
        uint256 got = adapter.withdraw(surplus);
        if (got == 0) return (0, 0);

        mintwareAmt = (got * MINTWARE_FEE_BPS) / BPS;
        if (mintwareAmt > 0) token.safeTransfer(treasury, mintwareAmt);
        lpAmt = got - mintwareAmt;
        if (lpAmt == 0) return (0, mintwareAmt);

        if (weightedDistributor != address(0)) {
            (uint256 r0, uint256 r1) = isToken0 ? (lpAmt, uint256(0)) : (uint256(0), lpAmt);
            IMWWeightedDistributor(weightedDistributor).fundFees(distributorVaultId, r0, r1);
            emit FeesRoutedToDistributor(distributorVaultId, r0, r1);
        } else if (totalLiquidity == 0) {
            // No LPs to credit — forward to treasury rather than strand it or divide by zero.
            token.safeTransfer(treasury, lpAmt);
            mintwareAmt += lpAmt;
            lpAmt = 0;
        } else if (isToken0) {
            accFee0PerShare += (lpAmt * ACC_PRECISION) / totalLiquidity;
            feeReserve0 += lpAmt;
        } else {
            accFee1PerShare += (lpAmt * ACC_PRECISION) / totalLiquidity;
            feeReserve1 += lpAmt;
        }
    }

    /// @notice Price-free total liquidity under management: pooled + idle-equivalent.
    function totalManagedLiquidity() external view returns (uint256) {
        return uint256(positionLiquidity) + uint256(idleLiquidity);
    }

    /// @dev Token amounts that removing `liquidity` from the active range would free at the current
    ///      price (round DOWN, matching V4's own removal rounding). Pure view — used to skip a
    ///      no-yield dust idle before mutating state.
    function _amountsForLiquidity(uint128 liquidity) internal view returns (uint256 amount0, uint256 amount1) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolKey.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        if (sqrtP <= sqrtLower) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, liquidity, false);
        } else if (sqrtP < sqrtUpper) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtUpper, liquidity, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtP, liquidity, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, liquidity, false);
        }
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
        if (positionLiquidity > 0) {
            (BalanceDelta removeDelta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(positionLiquidity)), salt: bytes32(0)}),
                ""
            );
            _settleDelta(removeDelta);
        }

        tickLower = newLower;
        tickUpper = newUpper;

        // Re-add the maximal balanced liquidity from the tokens now held by the vault, MINUS the
        // segregated fee/rent reserve — that balance backs LP claims and must never be deployed.
        uint256 a0 = token0.balanceOf(address(this)) - feeReserve0;
        uint256 a1 = token1.balanceOf(address(this)) - feeReserve1;
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
        // Shares (totalLiquidity) are unchanged by a rebalance — they track ownership. The RAW V4
        // number does shift at a new range, so record it: redeem/deposit price against this.
        positionLiquidity = newLiquidity;
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
