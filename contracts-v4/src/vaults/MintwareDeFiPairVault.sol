// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}       from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary}         from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MintwarePairVault} from "./MintwarePairVault.sol";
import {PoolProfile, LockTier} from "./VaultTypes.sol";
import {IYieldAdapter} from "./IYieldAdapter.sol";
import {MWJitLib} from "./lib/MWJitLib.sol";
import {MWIdleLib} from "./lib/MWIdleLib.sol";
import {MWPositionLib} from "./lib/MWPositionLib.sol";
import {MWFeeLib} from "./lib/MWFeeLib.sol"; // SIZE: realized-fee + rent routing extracted here

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
        // Self-deposit: the caller both pays the tokens AND receives the shares/dust (unchanged behavior).
        return _deposit(msg.sender, msg.sender, amount0Desired, amount1Desired, minShares, tier);
    }

    /// @notice Deposit on behalf of `recipient`: `msg.sender` PAYS both tokens, `recipient` receives the
    ///         minted shares + lock + any returned dust. This is what lets a migration router
    ///         (`Mintwarev3ToV4Migrator`) redeploy a user's unwound v3 liquidity and mint the ULV shares
    ///         straight to the user — shares are an internal mapping (not transferable), so crediting the
    ///         recipient at mint time is the ONLY way to hand them over. Purely additive: `deposit` is the
    ///         `recipient == msg.sender` special case, so existing behavior is unchanged.
    /// @param  recipient  who receives the shares, lock, and dust (must be non-zero).
    function depositFor(
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares,
        LockTier tier
    ) external nonReentrant whenNotPaused notDuringJit returns (uint256 sharesMinted) {
        if (recipient == address(0)) revert ZeroAddress();
        return _deposit(msg.sender, recipient, amount0Desired, amount1Desired, minShares, tier);
    }

    /// @dev Shared deposit core. `payer` transfers the tokens in; `recipient` is credited the shares, lock,
    ///      fee-debt reset, and dust. `deposit`/`depositFor` are the two external entrypoints; every guard
    ///      (nonReentrant/whenNotPaused/notDuringJit) lives on them.
    function _deposit(
        address payer,
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares,
        LockTier tier
    ) internal returns (uint256 sharesMinted) {
        if (!poolInitialized) revert PoolNotInitialized();

        // AUDIT M12 (DEFERRED): a new depositor can capture a slice of pending, uncollected swap fees
        // (redeem realizes fees first; deposit does not). A naive `_realizeFees()` here corrupts the
        // single-sided migrator's balance-diff dust refund, so the correct fix needs the deposit intake
        // reworked to balance-diff and exclude realized fees — tracked as follow-up, not a fund-loss risk.

        // Settle any accrued fees for the RECIPIENT on their existing balance BEFORE their share
        // count changes (so the accumulator stays correct).
        _claimFees(recipient);

        token0.safeTransferFrom(payer, address(this), amount0Desired);
        token1.safeTransferFrom(payer, address(this), amount1Desired);

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

        // Return unused dust to the RECIPIENT (they own the migrated/deposited capital).
        if (amount0Desired > used0) token0.safeTransfer(recipient, amount0Desired - used0);
        if (amount1Desired > used1) token1.safeTransfer(recipient, amount1Desired - used1);

        shares[recipient] += minted;
        totalLiquidity    += uint128(minted);
        positionLiquidity += liquidity;
        _recordLock(recipient, tier, payer == recipient);

        // Reset fee debt to current accumulator for the new (larger) balance.
        fee0Debt[recipient] = (shares[recipient] * accFee0PerShare) / ACC_PRECISION;
        fee1Debt[recipient] = (shares[recipient] * accFee1PerShare) / ACC_PRECISION;

        sharesMinted = minted;
        emit Deposited(recipient, used0, used1, minted, tier);
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

    /// @dev Realize accrued swap fees on the live V4 position and split them via the configurable
    ///      three-way value-capture template (LP / treasury / buyback+burn; ULV increment 3). SCOPE:
    ///      this covers ONLY realized position fees — regular trading fees plus the increment-1c
    ///      unmanaged surge/LVR, both of which land as position fees here. It deliberately does NOT
    ///      touch the JIT idle-leg proceeds (no price-free way to separate JIT principal from fee →
    ///      LP-only by prior design), the am-AMM manager skim (the manager's, by design), am-AMM rent
    ///      (`fundRent`, routed 100% to LPs), or the Aave yield harvest (`harvestYield`, still the flat
    ///      MINTWARE_FEE_BPS cut). The LP leg's downstream routing (weighted distributor vs pro-rata
    ///      accumulator) is UNCHANGED.
    ///
    ///      SIZE: the split + routing body lives in `MWFeeLib.realizeFees` (extracted for EIP-170 size,
    ///      same stateless-library pattern as MWJitLib/MWIdleLib). The short-circuit guard below stays
    ///      here (it reads `positionLiquidity`, whose `== 0` case — all capital idled in Aave — means
    ///      there is no live V4 position to collect from; a `modifyLiquidity(0)` on an empty position
    ///      reverts `CannotUpdateEmptyPosition`). This wrapper loads the six fee-routing counters,
    ///      delegates, and writes every one back — completeness is load-bearing.
    function _realizeFees() internal returns (uint256 fee0, uint256 fee1) {
        if (!poolInitialized || totalLiquidity == 0 || positionLiquidity == 0) return (0, 0);
        MWFeeLib.FeeState memory s = _loadFee();
        (s, fee0, fee1) = MWFeeLib.realizeFees(_feeCtx(), s);
        _storeFee(s);
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
        // AUDIT H3: NO standing unbounded approval. `_realizeFees` approves exactly the fee legs per pull
        // and resets to 0, so a compromised/misconfigured distributor can never drain vault principal.
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

        // SIZE: routing body (weighted-distributor R2-H3/M6 path + pro-rata carried-dust fallback +
        // RentFunded event) lives in MWFeeLib.fundRent. Guards + balance-diff intake stay here; the
        // wrapper loads the six fee-routing counters, delegates, and writes every one back.
        MWFeeLib.FeeState memory s = _loadFee();
        s = MWFeeLib.fundRent(_feeCtx(), s, isToken0, received);
        _storeFee(s);
    }

    // ── Fee library plumbing (Ctx build + full-field load/store) ─────────────
    // Same stateless pattern as the JIT/idle plumbing. MWFeeLib cannot read the vault's immutables or
    // storage under delegatecall, so `_feeCtx` hands it the immutables + routing config and
    // `_loadFee`/`_storeFee` mirror the COMPLETE set of fee-routing-mutable storage in and back out.
    // Load/store completeness is load-bearing — the six fields are the exact set the library touches.

    function _feeCtx() internal view returns (MWFeeLib.Ctx memory) {
        return MWFeeLib.Ctx({
            pm:                  poolManager,
            t0:                  token0,
            t1:                  token1,
            treasury:            treasury,
            weightedDistributor: weightedDistributor,
            distributorVaultId:  distributorVaultId,
            buybackSink:         buybackSink,
            treasuryFeeBps:      treasuryFeeBps,
            buybackFeeBps:       buybackFeeBps,
            totalLiquidity:      totalLiquidity
        });
    }

    function _loadFee() internal view returns (MWFeeLib.FeeState memory s) {
        s.accFee0PerShare = accFee0PerShare;
        s.accFee1PerShare = accFee1PerShare;
        s.feeReserve0     = feeReserve0;
        s.feeReserve1     = feeReserve1;
        s.rentDust0       = rentDust0;
        s.rentDust1       = rentDust1;
    }

    function _storeFee(MWFeeLib.FeeState memory s) internal {
        accFee0PerShare = s.accFee0PerShare;
        accFee1PerShare = s.accFee1PerShare;
        feeReserve0     = s.feeReserve0;
        feeReserve1     = s.feeReserve1;
        rentDust0       = s.rentDust0;
        rentDust1       = s.rentDust1;
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
    ///      The move math lives in `MWIdleLib.supplyIdle` (extracted for EIP-170 size); this wrapper
    ///      loads the idle counters, delegates, and writes every field back. Adapters are guaranteed
    ///      non-zero by the callers' `AdaptersNotSet` guard.
    function _supplyIdleCore(uint128 deltaL) internal {
        MWIdleLib.IdleState memory s = _loadIdle();
        s = MWIdleLib.supplyIdle(_idleCtx(), s, deltaL);
        _storeIdle(s);
    }

    /// @dev Withdraw a pro-rata slice of idle principal from Aave and redeploy it into the active
    ///      range. Any ratio-mismatch leftover is re-idled so no tokens are stranded in the vault.
    ///      Math lives in `MWIdleLib.refillIdle`; this wrapper does the full-field load/store.
    function _refillIdleCore(uint128 deltaL) internal {
        MWIdleLib.IdleState memory s = _loadIdle();
        s = MWIdleLib.refillIdle(_idleCtx(), s, deltaL);
        _storeIdle(s);
    }

    // ── Idle library plumbing (Ctx build + full-field load/store) ────────────
    // Same stateless pattern as the JIT plumbing above. The library cannot read the vault's immutables
    // or storage under delegatecall, so `_idleCtx` hands it the immutables + live range and
    // `_loadIdle`/`_storeIdle` mirror the COMPLETE set of idle-core-mutable storage in and back out.
    // Load/store completeness is load-bearing — the four fields are the exact set the library touches.

    function _idleCtx() internal view returns (MWIdleLib.Ctx memory) {
        return MWIdleLib.Ctx({
            pm:        poolManager,
            key:       poolKey,
            t0:        token0,
            t1:        token1,
            a0:        adapter0,
            a1:        adapter1,
            tickLower: tickLower,
            tickUpper: tickUpper
        });
    }

    function _loadIdle() internal view returns (MWIdleLib.IdleState memory s) {
        s.positionLiquidity = positionLiquidity;
        s.idleLiquidity     = idleLiquidity;
        s.idle0             = idle0;
        s.idle1             = idle1;
    }

    function _storeIdle(MWIdleLib.IdleState memory s) internal {
        positionLiquidity = s.positionLiquidity;
        idleLiquidity     = s.idleLiquidity;
        idle0             = s.idle0;
        idle1             = s.idle1;
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
        // Body lives in MWIdleLib.harvest (extracted for EIP-170 size). It mutates ONLY the fee
        // accumulators + reserve (idleN is read-only — yield is not principal), so this wrapper loads
        // those four fields, delegates, and writes every one back.
        MWIdleLib.HarvestState memory s = _loadHarvest();
        (s, lp0, lp1) = MWIdleLib.harvest(_harvestCtx(), s);
        _storeHarvest(s);
    }

    // ── Harvest library plumbing (Ctx build + full-field load/store) ─────────
    function _harvestCtx() internal view returns (MWIdleLib.HarvestCtx memory) {
        return MWIdleLib.HarvestCtx({
            t0:                  token0,
            t1:                  token1,
            a0:                  adapter0,
            a1:                  adapter1,
            treasury:            treasury,
            weightedDistributor: weightedDistributor,
            distributorVaultId:  distributorVaultId,
            idle0:               idle0,
            idle1:               idle1,
            totalLiquidity:      totalLiquidity
        });
    }

    function _loadHarvest() internal view returns (MWIdleLib.HarvestState memory s) {
        s.accFee0PerShare = accFee0PerShare;
        s.accFee1PerShare = accFee1PerShare;
        s.feeReserve0     = feeReserve0;
        s.feeReserve1     = feeReserve1;
    }

    function _storeHarvest(MWIdleLib.HarvestState memory s) internal {
        accFee0PerShare = s.accFee0PerShare;
        accFee1PerShare = s.accFee1PerShare;
        feeReserve0     = s.feeReserve0;
        feeReserve1     = s.feeReserve1;
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

        // Per-block cap stays in the vault (it owns `_jitBlock`/`_jitWithdrawnThisBlock`). Passing
        // `cap = _jitCap(type(uint256).max)` = min(per-swap, remaining per-block) reproduces the exact
        // `_jitCap(want)` clamp inside the library (`min(want, cap)`). The library returns the amount
        // actually withdrawn (`got`) so we record it against the per-block counter — even on the L==0
        // undo path (the withdraw physically happened), matching the pre-extraction ordering.
        uint256 cap = _jitCap(type(uint256).max);
        MWJitLib.JitState memory s = _loadJit();
        uint256 got;
        (s, L, got) = MWJitLib.open(
            _jitCtx(), s, zeroForOne, outputBudget, poolKey.tickSpacing, JIT_WIDTH_SPACINGS, JIT_SALT, cap
        );
        if (got > 0) _recordJitWithdraw(got);
        _storeJit(s);
        if (L > 0) emit JitOpened(zeroForOne, got, L, s.jitTickLower, s.jitTickUpper);
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

        // NB: the library leaves jitTickLower/jitTickUpper at the last-used range (not zeroed) so
        //     `jitPositionLiquidity()` reads the REAL position and can prove it holds 0 units at rest.
        MWJitLib.JitState memory s = _loadJit();
        uint256 taken0;
        uint256 taken1;
        uint256 claimed0;
        uint256 claimed1;
        (s, taken0, taken1, claimed0, claimed1) = MWJitLib.close(_jitCtx(), s, JIT_SALT);
        _storeJit(s);
        emit JitClosed(taken0, taken1, claimed0, claimed1);
    }

    /// @notice Redeem outstanding JIT ERC-6909 claims to physical tokens and re-supply them to Aave
    ///         (`idleN += redeemed`). Permissionless keeper — claims accrue only when a JIT closed while
    ///         the manager was short the input token (a thin-buffer swap); at rest the manager holds the
    ///         underlying, so the burn+take always succeeds up to the claim amount. Best-effort: if Aave
    ///         cannot accept the supply, the redeemed physical stays in the vault balance (extra backing).
    ///         The redeem math itself lives in `MWJitLib.sweep` (extracted for EIP-170 size).
    function sweepJitClaims() external nonReentrant whenNotPaused notDuringJit returns (uint256 r0, uint256 r1) {
        if (jitClaim0 == 0 && jitClaim1 == 0) return (0, 0);
        bytes memory res = poolManager.unlock(abi.encode(Action.SweepClaims, bytes("")));
        (r0, r1) = abi.decode(res, (uint256, uint256));
        emit JitClaimsSwept(r0, r1);
    }

    /// @dev Unlock dispatch target for `sweepJitClaims`. Runs INSIDE the PoolManager unlock; loads JIT
    ///      state, delegates the burn/take/re-supply to the library, and writes every field back.
    function _sweepClaims() internal returns (bytes memory) {
        MWJitLib.JitState memory s = _loadJit();
        uint256 r0;
        uint256 r1;
        (s, r0, r1) = MWJitLib.sweep(_jitCtx(), s);
        _storeJit(s);
        return abi.encode(r0, r1);
    }

    // ── JIT library plumbing (Ctx build + full-field load/store) ─────────────
    // The library is STATELESS: it cannot read the vault's immutables or storage under delegatecall.
    // `_jitCtx` hands it the immutables; `_loadJit`/`_storeJit` mirror the COMPLETE set of JIT-mutable
    // storage in and back out. Load/store completeness is load-bearing — a missed field is silent
    // state corruption. The eight fields are the exact set the library reads or writes.

    function _jitCtx() internal view returns (MWJitLib.Ctx memory) {
        return MWJitLib.Ctx({
            pm:  poolManager,
            key: poolKey,
            t0:  token0,
            t1:  token1,
            a0:  adapter0,
            a1:  adapter1
        });
    }

    function _loadJit() internal view returns (MWJitLib.JitState memory s) {
        s.jitLiquidity = jitLiquidity;
        s.jitActive    = jitActive;
        s.jitTickLower = jitTickLower;
        s.jitTickUpper = jitTickUpper;
        s.jitClaim0    = jitClaim0;
        s.jitClaim1    = jitClaim1;
        s.idle0        = idle0;
        s.idle1        = idle1;
    }

    function _storeJit(MWJitLib.JitState memory s) internal {
        jitLiquidity = s.jitLiquidity;
        jitActive    = s.jitActive;
        jitTickLower = s.jitTickLower;
        jitTickUpper = s.jitTickUpper;
        jitClaim0    = s.jitClaim0;
        jitClaim1    = s.jitClaim1;
        idle0        = s.idle0;
        idle1        = s.idle1;
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

    // The four main-position V4 handlers below run inside this vault's PoolManager unlock; their bodies
    // live in `MWPositionLib` (extracted for EIP-170 size, carrying TickMath/LiquidityAmounts out of the
    // vault). `_deploy`/`_remove`/`_collect` are pure pool interactions returning ABI-encoded amounts;
    // the vault's callers still do every state write. `_rebalance` alone mutates state — the library
    // performs the remove(old)+add(new) and returns the new liquidity; this wrapper persists the three
    // fields AFTER (unobservable ordering: the pool hook never reads the vault's ticks, and
    // rebalanceToProfile is nonReentrant — see MWPositionLib).

    function _deploy(uint256 a0, uint256 a1) internal returns (bytes memory) {
        return MWPositionLib.deploy(_posCtx(), a0, a1);
    }

    function _remove(uint128 liquidity) internal returns (bytes memory) {
        return MWPositionLib.remove(_posCtx(), liquidity);
    }

    function _collect() internal returns (bytes memory) {
        return MWPositionLib.collect(_posCtx());
    }

    function _rebalance(int24 newLower, int24 newUpper) internal returns (bytes memory) {
        uint128 newLiquidity = MWPositionLib.rebalance(_posCtx(), positionLiquidity, feeReserve0, feeReserve1, newLower, newUpper);
        tickLower = newLower;
        tickUpper = newUpper;
        // Shares (totalLiquidity) are unchanged by a rebalance — they track ownership. The RAW V4
        // number does shift at a new range, so record it: redeem/deposit price against this.
        positionLiquidity = newLiquidity;
        return "";
    }

    function _posCtx() internal view returns (MWPositionLib.Ctx memory) {
        return MWPositionLib.Ctx({
            pm:        poolManager,
            key:       poolKey,
            t0:        token0,
            t1:        token1,
            tickLower: tickLower,
            tickUpper: tickUpper
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lock / penalty
    // ─────────────────────────────────────────────────────────────────────────

    /// @param selfDeposit true when the payer == recipient (`deposit`). When false (a third-party
    ///        `depositFor`), the recipient's lock must NOT be mutated adversely: an existing position's
    ///        lock is left untouched (no extend, no `depositedAt`/hold/penalty-clock reset), and a fresh
    ///        recipient can only ever be given an UNLOCKED (Flex) position — never locked capital on their
    ///        behalf. AUDIT (pre-audit review): closes a griefing vector where anyone could re-lock a
    ///        victim's position (extend to full tier duration) or reset their 24h hold + penalty clock by
    ///        depositing dust to them.
    function _recordLock(address owner_, LockTier tier, bool selfDeposit) internal {
        LockInfo storage info = locks[owner_];
        if (info.initialized && shares[owner_] > 0) {
            // Existing position — tier changes are always blocked while a balance exists.
            if (info.tier != tier) revert LockTierChangeNotAllowed();
            if (!selfDeposit) return; // third-party top-up: leave the lock exactly as-is (griefing guard)
            uint256 lockedUntil = block.timestamp + _lockDuration(tier);
            if (info.lockedUntil > lockedUntil) lockedUntil = info.lockedUntil; // never shorten
            info.lockedUntil = lockedUntil;
            info.depositedAt = block.timestamp;
        } else {
            // Fresh position — a third party can only create an UNLOCKED (Flex) position for someone else.
            LockTier eff = selfDeposit ? tier : LockTier.Flex;
            info.tier        = eff;
            info.depositedAt = block.timestamp;
            info.lockedUntil = block.timestamp + _lockDuration(eff);
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
