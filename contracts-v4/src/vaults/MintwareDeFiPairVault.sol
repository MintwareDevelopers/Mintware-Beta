// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}       from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
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
    using SafeERC20      for IERC20;
    using PoolIdLibrary  for PoolKey;
    using StateLibrary   for IPoolManager;
    using CurrencyLibrary for Currency;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    enum Action { Deploy, Remove, Rebalance, Collect, SweepClaims }

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
    /// @notice Flat protocol cut (bps) of the Aave yield-harvest surplus ONLY. The realized swap-fee
    ///         cut is NO LONGER governed by this constant — `_realizeFees` uses the configurable
    ///         three-way value-capture split (`treasuryFeeBps` / `buybackFeeBps`; ULV increment 3).
    ///         Left unchanged for `harvestYield`/`_harvestOne` (the idle-leg proceeds path), which is
    ///         deliberately out of scope for the splitter.
    uint256 public constant MINTWARE_FEE_BPS = 2_500;

    /// @notice Upper bound (bps) on the COMBINED non-LP cut (treasury + buyback) of realized position
    ///         fees. `setFeeSplit` reverts above this, so LPs ALWAYS keep at least `BPS - 4000` = 60%.
    uint256 public constant MAX_NON_LP_FEE_BPS = 4_000;

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

    /// @notice Dedicated pool-position salt for JIT liquidity. NEVER the main position's `salt = 0`,
    ///         so mid-swap JIT liquidity is a physically separate V4 position that can never be
    ///         co-mingled with (or double-counted against) `positionLiquidity`.
    bytes32 public constant JIT_SALT = keccak256("MW_JIT");

    /// @notice Width of the tight single-sided JIT band, in units of `tickSpacing`. The band sits
    ///         strictly to ONE side of the live tick so the add is genuinely single-asset (no
    ///         counter-token required). A tuning knob for fill depth, not a correctness parameter.
    int24 public constant JIT_WIDTH_SPACINGS = 5;

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

    // ── Configurable value-capture split (ULV increment 3) ───────────────────
    // The single treasury cut of realized swap fees is generalized into a three-way template:
    // LP / treasury / buyback+burn. Only the two NON-LP legs are stored; the LP share is always the
    // implied remainder (`BPS - treasuryFeeBps - buybackFeeBps`) so no wei is stranded. Defaults set
    // in the constructor to the canonical 60% LP / 30% treasury / 10% buyback.
    /// @notice Treasury cut of realized position (swap) fees, in bps. Default 3000 (30%).
    uint16 public treasuryFeeBps;
    /// @notice Buyback+burn cut of realized position (swap) fees, in bps. Default 1000 (10%). Routed
    ///         to `buybackSink`; if that is unset (address(0)) the buyback cut FOLDS into the treasury
    ///         transfer (never stranded, never sent to address(0)).
    uint16 public buybackFeeBps;
    /// @notice Sink for the buyback+burn cut (e.g. a buyback/burner). Owner-settable; when unset the
    ///         buyback cut folds into the treasury transfer.
    address public buybackSink;

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

    // ── Size-gated true JIT (ULV Phase 1a increment 1b, Lever B) ─────────────
    // The hook coordinator is the ONLY caller allowed to open/close JIT liquidity. It is hard-wired
    // once (never caller-supplied at swap time — a Bunni-class vector). During a size-gated swap the
    // hook calls `jitOpen` in beforeSwap and `jitClose` in afterSwap; both run INSIDE the swapper's
    // existing PoolManager unlock, so they call `modifyLiquidity`/`_settleDelta`/the adapter DIRECTLY
    // (never `poolManager.unlock`, which would be a nested-unlock revert).
    address public hook; // set-once; the MWHookCoordinator

    /// @notice Open JIT liquidity units currently in the pool at [jitTickLower, jitTickUpper] under
    ///         JIT_SALT. MUST be zero at rest (between txs). NEVER part of share/redeem/deposit math.
    uint128 public jitLiquidity;
    int24   public jitTickLower;
    int24   public jitTickUpper;
    /// @notice True only WITHIN a size-gated swap tx (between jitOpen and jitClose). The single guard
    ///         spanning hook↔vault↔JIT: while true every unlock-based vault entrypoint reverts.
    bool    public jitActive;

    /// @notice Per-swap ceiling on the output-token principal a single jitOpen may pull from Aave
    ///         (0 = unbounded — the adapter headroom + idle basis still clamp). Capital cap #1.
    uint256 public jitMaxPerSwap;
    /// @notice Per-BLOCK cumulative ceiling on JIT principal pulled from Aave across all swaps in the
    ///         block (0 = unbounded). Capital cap #2 — bounds toxic one-sided drain within a block.
    uint256 public jitMaxPerBlock;
    uint256 private _jitBlock;               // block of the last JIT withdraw
    uint256 private _jitWithdrawnThisBlock;  // running per-block JIT principal pulled

    /// @notice ERC-6909 claim balances the vault holds against the PoolManager for JIT proceeds that
    ///         could NOT be physically taken at close time. During `afterSwap` the swapper has not yet
    ///         settled its input token, so the manager may lack the physical reserves to pay the JIT
    ///         removal's INPUT-side delta. Rather than revert (which would brick the swap), `jitClose`
    ///         mints ERC-6909 claims for the shortfall (a pure-accounting credit needing no reserves).
    ///         A claim is 1:1 redeemable for the underlying once the manager holds it (always true at
    ///         rest, after the swapper settles). `sweepJitClaims()` redeems them → Aave. These claims
    ///         are real backing (counted in solvency) but are NOT `idleN` until redeemed+re-supplied.
    uint256 public jitClaim0;
    uint256 public jitClaim1;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event Deposited(address indexed lp, uint256 amount0, uint256 amount1, uint256 sharesMinted, LockTier tier);
    event RedeemRequested(address indexed lp, uint256 shares, uint256 noticeExpiry);
    event Redeemed(address indexed lp, uint256 shares, uint256 amount0, uint256 amount1, uint256 penalty0, uint256 penalty1);
    /// @notice Emitted on every realize. `treasuryN`/`buybackN` are the SPLIT-MATH entitlements
    ///         (treasuryN + buybackN + lpN == feeN). When `buybackSink == address(0)` the buyback
    ///         entitlement is physically folded into the treasury transfer, but is still reported
    ///         separately here so the conservation invariant reads off the event directly.
    event FeesCollected(
        uint256 fee0, uint256 fee1,
        uint256 treasury0, uint256 treasury1,
        uint256 buyback0, uint256 buyback1
    );
    event FeeSplitSet(uint16 treasuryBps, uint16 buybackBps, uint16 lpBps);
    event BuybackSinkSet(address indexed sink);
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
    event HookSet(address indexed hook);
    event JitCapsSet(uint256 perSwap, uint256 perBlock);
    event JitOpened(bool zeroForOne, uint256 principal, uint128 liquidity, int24 tickLower, int24 tickUpper);
    event JitClosed(uint256 taken0, uint256 taken1, uint256 claimed0, uint256 claimed1);
    event JitClaimsSwept(uint256 redeemed0, uint256 redeemed1);

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
    error BadFeeSplit();
    error OnlyRentFunder();
    error ZeroAddress();
    error AdaptersAlreadySet();
    error AdapterAssetMismatch();
    error AdaptersNotSet();
    error BadBufferRatio();
    error AaveTemporarilyIlliquid();
    error OnlyHook();
    error HookAlreadySet();
    error JitInProgress();

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

        // Canonical value-capture template: 60% LP / 30% treasury / 10% buyback+burn.
        // (Behavior change vs the retired flat MINTWARE_FEE_BPS=2500 swap-fee cut: treasury 25%→30%,
        //  LP 75%→60%, plus a new 10% buyback leg.) `buybackSink` starts unset, so until it is wired
        // the buyback cut folds into the treasury transfer.
        treasuryFeeBps = 3_000;
        buybackFeeBps  = 1_000;
    }

    modifier onlyProvider() {
        if (msg.sender != provider && msg.sender != owner()) revert OnlyProvider();
        _;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    /// @dev The single guard spanning hook↔vault↔JIT. Every unlock-based / balance-moving vault
    ///      entrypoint carries it, so nothing can interleave while a JIT position is open mid-swap
    ///      (defends the hostile-token / hostile-adapter callback path). Between txs `jitActive` is
    ///      always false, so this is a no-op for ordinary calls.
    modifier notDuringJit() {
        if (jitActive) revert JitInProgress();
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
        notDuringJit
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

    function requestRedeem(uint256 shares_) external nonReentrant notDuringJit {
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
        notDuringJit
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
    function collectFees() external nonReentrant whenNotPaused notDuringJit returns (uint256 fee0, uint256 fee1) {
        return _realizeFees();
    }

    /// @dev Split a realized fee into (treasuryCut, buybackCut, lpAmt) under the configurable
    ///      three-way template. BOTH protocol cuts round DOWN; the LP takes the EXACT remainder, so
    ///      (treasuryCut + buybackCut + lpAmt == fee) always holds (zero dust stranded) and any
    ///      rounding loss accrues to the LPs, never the protocol.
    function _splitFee(uint256 fee)
        internal
        view
        returns (uint256 treasuryCut, uint256 buybackCut, uint256 lpAmt)
    {
        treasuryCut = (fee * treasuryFeeBps) / BPS;
        buybackCut  = (fee * buybackFeeBps) / BPS;
        lpAmt       = fee - treasuryCut - buybackCut; // remainder → LP (favors LPs)
    }

    /// @dev Realize accrued swap fees on the live V4 position and split them via the configurable
    ///      three-way value-capture template (LP / treasury / buyback+burn; ULV increment 3). SCOPE:
    ///      this covers ONLY realized position fees — regular trading fees plus the increment-1c
    ///      unmanaged surge/LVR, both of which land as position fees here. It deliberately does NOT
    ///      touch the JIT idle-leg proceeds (no price-free way to separate JIT principal from fee →
    ///      LP-only by prior design), the am-AMM manager skim (the manager's, by design), am-AMM rent
    ///      (`fundRent`, routed 100% to LPs), or the Aave yield harvest (`harvestYield`, still the flat
    ///      MINTWARE_FEE_BPS cut). The LP leg's downstream routing (weighted distributor vs pro-rata
    ///      accumulator) is UNCHANGED.
    function _realizeFees() internal returns (uint256 fee0, uint256 fee1) {
        // `positionLiquidity == 0` (all capital idled in Aave) means there is no live V4 position to
        // collect from — a `modifyLiquidity(0)` on an empty position reverts `CannotUpdateEmptyPosition`.
        if (!poolInitialized || totalLiquidity == 0 || positionLiquidity == 0) return (0, 0);
        bytes memory res = poolManager.unlock(abi.encode(Action.Collect, bytes("")));
        (fee0, fee1) = abi.decode(res, (uint256, uint256));
        if (fee0 == 0 && fee1 == 0) return (0, 0);

        (uint256 treasury0, uint256 buyback0, uint256 lp0) = _splitFee(fee0);
        (uint256 treasury1, uint256 buyback1, uint256 lp1) = _splitFee(fee1);

        // Route the two NON-LP legs. If no buyback sink is wired, fold the buyback cut into the
        // treasury transfer — never strand it, never transfer to address(0).
        address sink = buybackSink;
        if (sink == address(0)) {
            uint256 t0 = treasury0 + buyback0;
            uint256 t1 = treasury1 + buyback1;
            if (t0 > 0) token0.safeTransfer(treasury, t0);
            if (t1 > 0) token1.safeTransfer(treasury, t1);
        } else {
            if (treasury0 > 0) token0.safeTransfer(treasury, treasury0);
            if (treasury1 > 0) token1.safeTransfer(treasury, treasury1);
            if (buyback0 > 0)  token0.safeTransfer(sink, buyback0);
            if (buyback1 > 0)  token1.safeTransfer(sink, buyback1);
        }

        // LP leg → the EXISTING routing, unchanged.
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
        emit FeesCollected(fee0, fee1, treasury0, treasury1, buyback0, buyback1);
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

    /// @notice Reconfigure the three-way value-capture split of realized swap fees. `treasuryBps`
    ///         and `buybackBps` are the two NON-LP legs; the LP share is the implied remainder
    ///         (`BPS - treasuryBps - buybackBps`). Reverts if the combined non-LP cut exceeds
    ///         `MAX_NON_LP_FEE_BPS` (4000) — LPs always keep at least 60%.
    function setFeeSplit(uint16 treasuryBps, uint16 buybackBps) external onlyOwner {
        if (uint256(treasuryBps) + uint256(buybackBps) > MAX_NON_LP_FEE_BPS) revert BadFeeSplit();
        treasuryFeeBps = treasuryBps;
        buybackFeeBps  = buybackBps;
        emit FeeSplitSet(treasuryBps, buybackBps, uint16(BPS) - treasuryBps - buybackBps);
    }

    /// @notice Set (or clear) the buyback+burn sink. When unset (address(0)), the buyback leg folds
    ///         into the treasury transfer in `_realizeFees`.
    function setBuybackSink(address sink) external onlyOwner {
        buybackSink = sink;
        emit BuybackSinkSet(sink);
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
    function fundRent(address token, uint256 amount) external nonReentrant whenNotPaused notDuringJit {
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

    function claimFees() external nonReentrant notDuringJit {
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
    function rebalanceToProfile(PoolProfile p) external onlyProvider nonReentrant whenNotPaused notDuringJit {
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

    /// @notice Hard-wire the hook coordinator allowed to open/close JIT liquidity, ONCE. Owner-only;
    ///         never caller-supplied at swap time. The hook is the sole `onlyHook` caller.
    function setHook(address h) external onlyOwner {
        if (hook != address(0)) revert HookAlreadySet();
        if (h == address(0)) revert ZeroAddress();
        hook = h;
        emit HookSet(h);
    }

    /// @notice Set the per-swap and per-block JIT capital ceilings (output-token units; 0 = unbounded).
    ///         Belt-and-suspenders over the adapter's own per-block withdraw cap.
    function setJitCaps(uint256 perSwap, uint256 perBlock) external onlyOwner {
        jitMaxPerSwap  = perSwap;
        jitMaxPerBlock = perBlock;
        emit JitCapsSet(perSwap, perBlock);
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
    function rebalanceBuffer() external onlyProvider nonReentrant whenNotPaused notDuringJit {
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
    function supplyIdle(uint128 deltaL) external onlyProvider nonReentrant whenNotPaused notDuringJit {
        if (address(adapter0) == address(0)) revert AdaptersNotSet();
        _realizeFees();
        _supplyIdleCore(deltaL);
    }

    /// @notice Explicitly refill `deltaL` V4 liquidity units from Aave back into the position.
    function recallIdle(uint128 deltaL) external onlyProvider nonReentrant whenNotPaused notDuringJit {
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

        // CEI hardening: apply the data-INDEPENDENT position effects (deltaL is fixed) BEFORE the
        // pool interaction; record the pool-DERIVED idle counters (out0/out1) immediately after, and
        // all effects land BEFORE the adapter supply below. Entrypoints (supplyIdle/rebalanceBuffer)
        // are nonReentrant, so no external interleaving is possible regardless.
        positionLiquidity -= deltaL;
        idleLiquidity += deltaL;

        bytes memory res = poolManager.unlock(abi.encode(Action.Remove, abi.encode(deltaL)));
        (uint256 out0, uint256 out1) = abi.decode(res, (uint256, uint256));
        idle0 += out0;
        idle1 += out1;

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
        // CEI note: `addedL`/`used*` are POOL-DERIVED (known only after the unlock), so these effects
        // cannot precede the pool interaction; they land BEFORE the leftover adapter supply, and the
        // nonReentrant entrypoints are the reentrancy mitigation (as in _supplyIdleCore).
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
    function harvestYield() external onlyProvider nonReentrant whenNotPaused notDuringJit
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

    // ─────────────────────────────────────────────────────────────────────────
    // Size-gated true JIT bridge (Lever B) — hook-only, runs INSIDE the swap unlock
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Open a tight SINGLE-SIDED JIT position funded from the OUTPUT-side Aave adapter.
    ///         Called by the hook in `beforeSwap`, INSIDE the swapper's PoolManager unlock — so it
    ///         calls `modifyLiquidity`/`_settleDelta`/the adapter DIRECTLY (never `poolManager.unlock`).
    ///         Every early `return 0` is a clean no-op fallback: no JIT liquidity, `jitActive` stays
    ///         false, and the swap fills against the resting `positionLiquidity` buffer. NO price or
    ///         oracle is read — sizing is purely `outputBudget` ∩ adapter headroom ∩ idle basis ∩ caps.
    /// @param  zeroForOne   swap direction (trader sells token0 ⇒ pool pays token1 ⇒ add token1 side).
    /// @param  outputBudget hook-derived output-token budget (from `amountSpecified`, never a price).
    /// @return L            JIT liquidity actually opened (0 ⇒ hook falls back to resting liquidity).
    function jitOpen(bool zeroForOne, uint256 outputBudget)
        external
        onlyHook
        nonReentrant
        returns (uint128 L)
    {
        if (jitActive) return 0;             // already open (defensive; hook opens once per swap)
        if (!poolInitialized) return 0;

        // (1) Output-side adapter only — never touch the input adapter in jitOpen.
        IYieldAdapter adapter = zeroForOne ? adapter1 : adapter0;
        if (address(adapter) == address(0)) return 0;

        // (2) Size the pull: budget ∩ adapter live headroom ∩ settled idle basis ∩ per-swap/-block caps.
        //     Clamping to the idle counter guarantees we only ever deploy SETTLED principal (never
        //     accrued Aave yield), so the counter decrement below is exact and can't underflow.
        uint256 basis = zeroForOne ? idle1 : idle0;
        uint256 want = outputBudget;
        uint256 maxW = adapter.maxWithdrawable();
        if (maxW  < want) want = maxW;
        if (basis < want) want = basis;
        want = _jitCap(want);
        if (want == 0) return 0;

        // (3) Best-effort withdraw (got <= want). Settle the idle counter IMMEDIATELY: the money has
        //     left Aave. adapterN.totalAssets() and idleN both drop by `got`, so `aave_backs_idle`
        //     (totalAssets >= idleN) is preserved at every step, including the undo path below.
        uint256 got = adapter.withdraw(want);
        if (got == 0) return 0;
        _recordJitWithdraw(got);
        if (zeroForOne) idle1 -= got; else idle0 -= got;

        // (4) Tight single-sided range aligned to tickSpacing, strictly to one side of the live tick.
        (, int24 tick,,) = poolManager.getSlot0(poolKey.toId());
        int24 spacing = poolKey.tickSpacing;
        int24 width   = spacing * JIT_WIDTH_SPACINGS;
        int24 lo;
        int24 hi;
        if (zeroForOne) {
            // token1 side: range at/below the current tick ⇒ pure token1 (price >= sqrtUpper).
            hi = _alignTick(tick, spacing);
            lo = hi - width;
        } else {
            // token0 side: range strictly ABOVE the current tick ⇒ pure token0 (price <= sqrtLower).
            lo = _alignTick(tick, spacing) + spacing;
            hi = lo + width;
        }
        uint160 sLo = TickMath.getSqrtPriceAtTick(lo);
        uint160 sHi = TickMath.getSqrtPriceAtTick(hi);

        // (5) Liquidity from the single-sided principal. If it rounds to zero, undo the withdraw
        //     (re-idle `got`, restoring the counter) and fall back.
        L = zeroForOne
            ? LiquidityAmounts.getLiquidityForAmount1(sLo, sHi, got)
            : LiquidityAmounts.getLiquidityForAmount0(sLo, sHi, got);
        if (L == 0) {
            _reIdle(zeroForOne, got);
            return 0;
        }

        // (6) Add JIT liquidity at the DEDICATED salt (a separate pool position from `salt = 0`).
        //     `_settleDelta` pays the single-sided principal into the pool. Any sub-wei rounding dust
        //     (got minus the exact amount the mint consumed) stays in the vault balance as extra,
        //     unattributed backing — vault-favoring, never distributed to redeemers.
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(L)), salt: JIT_SALT}),
            ""
        );
        _settleDelta(delta);

        jitTickLower = lo;
        jitTickUpper = hi;
        jitLiquidity = L;
        jitActive    = true;
        emit JitOpened(zeroForOne, got, L, lo, hi);
    }

    /// @notice Close the JIT position: remove it, take both sides back, re-idle EVERYTHING returned to
    ///         the adapters as settled principal, and clear JIT state. Called by the hook in
    ///         `afterSwap`, INSIDE the swap unlock. Best-effort re-supply — a capped/frozen reserve
    ///         leaves the tokens as vault balance rather than reverting (a revert here would unwind the
    ///         entire swap, which is safe but undesirable).
    ///
    /// @dev    SETTLEMENT (the one hard V4 fact). During `afterSwap` the swapper has NOT yet settled its
    ///         input token, so the PoolManager can be SHORT the JIT removal's input-side delta. Physical
    ///         `take` of an amount the manager lacks would revert → the swap would brick. So we take
    ///         PHYSICAL up to the manager's current reserves and mint ERC-6909 CLAIMS for any shortfall
    ///         (`mint` needs no reserves — it just books the offsetting delta). The swap therefore always
    ///         settles. Claims are redeemed to Aave later by `sweepJitClaims()`.
    ///
    /// @dev    FEE ATTRIBUTION (documented rule). The JIT opens single-sided with `got` of ONE token and,
    ///         after the swap, returns a MIX whose value equals the principal plus the LP fee it earned.
    ///         With NO price/oracle there is no price-free way to split that mix into "principal" vs
    ///         "fee". We therefore book EVERYTHING returned back as principal: the physically-taken part
    ///         is re-idled (`idleN += taken`) and the claimed part is tracked in `jitClaimN` until swept
    ///         (then `idleN += redeemed`). This is exactly-conserving per token, never credits a counter
    ///         beyond real backing (idle rises only by adapter-accepted physical; claims are 1:1 manager-
    ///         backed), and rounds toward the vault. The captured fee/LVR reaches LPs via the pro-rata
    ///         idle leg, not the per-share accumulator. Trade-off (honest): (a) value present during the
    ///         swap accrues to whoever holds shares at redeem time — a late depositor can dilute it; and
    ///         (b) proceeds parked as claims reach the idle leg only after a `sweepJitClaims()` keeper
    ///         call, so a redeem before a sweep forfeits the tiny unswept share to remaining LPs. Both
    ///         are fairness nuances, NOT solvency ones; no counter is ever over-credited.
    function jitClose() external onlyHook nonReentrant {
        if (!jitActive) return; // idempotent — hook always calls; JIT may not have opened.

        uint128 L  = jitLiquidity;
        int24   lo = jitTickLower;
        int24   hi = jitTickUpper;

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: -int256(uint256(L)), salt: JIT_SALT}),
            ""
        );

        // Removal yields a non-negative delta per side (principal converted by the swap + JIT LP fees).
        // Defensively pay any negative side (should not occur on a pure removal).
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) _pay(poolKey.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _pay(poolKey.currency1, uint256(uint128(-d1)));

        (uint256 taken0, uint256 claimed0) = d0 > 0 ? _takeOrClaim(false, uint256(uint128(d0))) : (0, 0);
        (uint256 taken1, uint256 claimed1) = d1 > 0 ? _takeOrClaim(true,  uint256(uint128(d1))) : (0, 0);

        // Re-idle only the PHYSICALLY-taken proceeds. Counters clear LAST so a mid-close reentrancy
        // still observes `jitActive` and is blocked by `notDuringJit`.
        _reIdle(false, taken0);
        _reIdle(true,  taken1);

        // NB: leave jitTickLower/jitTickUpper at the last-used range (not zeroed) so
        //     `jitPositionLiquidity()` reads the REAL position and can prove it holds 0 units at rest.
        jitLiquidity = 0;
        jitActive    = false;
        emit JitClosed(taken0, taken1, claimed0, claimed1);
    }

    /// @dev Settle one side of the JIT removal's positive delta: `take` physical up to the manager's
    ///      current reserves, `mint` an ERC-6909 claim for the remainder (needs no reserves). Returns
    ///      (physicalTaken, claimMinted). Never reverts for an availability reason ⇒ jitClose can't brick.
    function _takeOrClaim(bool side1, uint256 owed) internal returns (uint256 taken, uint256 claimed) {
        Currency cur = side1 ? poolKey.currency1 : poolKey.currency0;
        IERC20  token = side1 ? token1 : token0;
        uint256 avail = token.balanceOf(address(poolManager));
        taken = owed < avail ? owed : avail;
        if (taken > 0) poolManager.take(cur, address(this), taken);
        claimed = owed - taken;
        if (claimed > 0) {
            poolManager.mint(address(this), cur.toId(), claimed);
            if (side1) jitClaim1 += claimed; else jitClaim0 += claimed;
        }
    }

    /// @notice Redeem outstanding JIT ERC-6909 claims to physical tokens and re-supply them to Aave
    ///         (`idleN += redeemed`). Permissionless keeper — claims accrue only when a JIT closed while
    ///         the manager was short the input token (a thin-buffer swap); at rest the manager holds the
    ///         underlying, so the burn+take always succeeds up to the claim amount. Best-effort: if Aave
    ///         cannot accept the supply, the redeemed physical stays in the vault balance (extra backing).
    function sweepJitClaims() external nonReentrant whenNotPaused notDuringJit returns (uint256 r0, uint256 r1) {
        if (jitClaim0 == 0 && jitClaim1 == 0) return (0, 0);
        bytes memory res = poolManager.unlock(abi.encode(Action.SweepClaims, bytes("")));
        (r0, r1) = abi.decode(res, (uint256, uint256));
        emit JitClaimsSwept(r0, r1);
    }

    function _sweepClaims() internal returns (bytes memory) {
        uint256 r0 = _redeemClaim(false);
        uint256 r1 = _redeemClaim(true);
        return abi.encode(r0, r1);
    }

    /// @dev Burn up to `jitClaimN` ERC-6909 claims (capped at the manager's reserves), take the physical
    ///      underlying, and supply it to Aave (idle += supplied). Best-effort on the Aave leg.
    function _redeemClaim(bool side1) internal returns (uint256 redeemed) {
        uint256 claim = side1 ? jitClaim1 : jitClaim0;
        if (claim == 0) return 0;
        Currency cur = side1 ? poolKey.currency1 : poolKey.currency0;
        IERC20  token = side1 ? token1 : token0;
        IYieldAdapter adapter = side1 ? adapter1 : adapter0;

        uint256 avail = token.balanceOf(address(poolManager));
        redeemed = claim < avail ? claim : avail;
        if (redeemed == 0) return 0;

        poolManager.burn(address(this), cur.toId(), redeemed); // +redeemed delta to the vault
        poolManager.take(cur, address(this), redeemed);        // physical to the vault; delta → 0
        if (side1) jitClaim1 -= redeemed; else jitClaim0 -= redeemed;

        if (address(adapter) != address(0) && adapter.maxSuppliable() > 0) {
            token.forceApprove(address(adapter), redeemed);
            try adapter.deposit(redeemed) {
                if (side1) idle1 += redeemed; else idle0 += redeemed;
            } catch {
                token.forceApprove(address(adapter), 0); // leave physical in the vault (extra backing)
            }
        }
        // else: reserve unavailable — physical stays in the vault balance (still full backing).
    }

    /// @dev Re-supply `amt` of the given side back to its adapter as settled principal, incrementing
    ///      the idle counter by EXACTLY what the adapter accepts. If the adapter is unset, its reserve
    ///      cannot accept supply (`maxSuppliable()==0`), or the supply reverts, the tokens are left in
    ///      the vault balance (unattributed extra backing) and the counter is NOT bumped — so idleN can
    ///      never exceed adapter principal. `side1 == true` ⇒ token1/adapter1.
    function _reIdle(bool side1, uint256 amt) internal {
        if (amt == 0) return;
        IYieldAdapter adapter = side1 ? adapter1 : adapter0;
        IERC20 token = side1 ? token1 : token0;
        if (address(adapter) == address(0)) return;   // leave in vault balance
        if (adapter.maxSuppliable() == 0) return;      // reserve full/paused/frozen — leave in vault
        token.forceApprove(address(adapter), amt);
        try adapter.deposit(amt) {
            if (side1) idle1 += amt; else idle0 += amt;
        } catch {
            token.forceApprove(address(adapter), 0);   // reset dangling approval; leave in vault
        }
    }

    /// @dev Clamp a JIT pull to the per-swap ceiling and the remaining per-block budget (0 = unbounded).
    function _jitCap(uint256 want) internal view returns (uint256) {
        uint256 perSwap = jitMaxPerSwap;
        if (perSwap != 0 && want > perSwap) want = perSwap;
        uint256 rem = _jitBlockRemaining();
        return want < rem ? want : rem;
    }

    function _jitBlockRemaining() internal view returns (uint256) {
        if (jitMaxPerBlock == 0) return type(uint256).max;
        if (block.number != _jitBlock) return jitMaxPerBlock;
        return jitMaxPerBlock > _jitWithdrawnThisBlock ? jitMaxPerBlock - _jitWithdrawnThisBlock : 0;
    }

    function _recordJitWithdraw(uint256 got) internal {
        if (block.number != _jitBlock) {
            _jitBlock = block.number;
            _jitWithdrawnThisBlock = 0;
        }
        _jitWithdrawnThisBlock += got;
    }

    /// @notice Live on-chain liquidity of the JIT position (JIT_SALT). Zero at rest — used by the
    ///         invariant suite to prove no orphaned JIT liquidity ever persists between txs.
    function jitPositionLiquidity() external view returns (uint128 liq) {
        if (!poolInitialized) return 0;
        (liq,,) = poolManager.getPositionInfo(poolKey.toId(), address(this), jitTickLower, jitTickUpper, JIT_SALT);
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
        if (action == Action.SweepClaims) {
            return _sweepClaims();
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
