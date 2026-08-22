// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}       from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams}            from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath}             from "@uniswap/v4-core/src/libraries/FullMath.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IYieldAdapter}   from "../vaults/IYieldAdapter.sol";

/// @dev The truncated-oracle reference the settlement swap bounds against — the SAME surface the JIT hook
///      exposes (`MintwareTreasuryJitHook.oracleTick()`). In production the WETH/USDC pool's hook supplies
///      it; `ready == false` (or a zero source) makes the swap fall back to unbounded (pre-first-swap only).
interface IOracleTickSource {
    function oracleTick() external view returns (int24 tick, bool ready);
}

/// @title  MintwareEthSettlement
/// @notice The on-chain half of the YPN multi-collateral card system: converts an ETH-collateral vault's
///         WETH into USDC when a batch of card charges settles, so ETH-backed shares are actually
///         card-spendable. Mirrors the treasury JIT hook's ORACLE-BOUNDED sweep
///         (`_swapLimit`/`_sqrtAtClamped`/`_settleDelta`) — a WETH→USDC swap whose price can never be
///         forced past the truncated-oracle band, so a sandwich that moved spot cannot make settlement
///         realize at the manipulated price. If the bounded swap can't produce the owed USDC, the junior
///         first-loss buffer tops it up (up to a per-call cap); beyond that the tx reverts
///         (`SettlementSlippageExceeded`) and the relayer retries next window — the rail is NEVER underpaid.
///
/// @dev    COHERENCE WITH THE OFF-CHAIN EDGE (do NOT lose this): `edge-auth`'s VaR haircut
///         `γ = 1 − (z·σ·√T + slippage)` already reserved the buffer this swap consumes — the
///         `settlement_slippage_bps` term IS this conversion's slippage and `z·σ·√T` covers the drift
///         between auth and settlement. So the swap's realized shortfall is bounded by γ by construction:
///         if the buffer holds, the swap (± junior top-up) produces the owed USDC; a move beyond γ is the
///         junior first-loss event the tranche is designed to absorb — never a senior/rail loss. The
///         relayer passes `minUsdcOut` = the edge's conservative price × γ; a swap under that floor reverts
///         before any junior draw (catastrophic move → retry, don't spend first-loss on a bad print).
///
/// @dev    SENIOR STAYS PRICE-FREE. Settlement pays the rail a FIXED `totalUsdc` or reverts — the ETH-price
///         exposure lands entirely on how much WETH the swap consumes and whether the junior buffer is
///         tapped, never on the amount the rail receives. This is the on-chain ↔ off-chain contract.
///
/// @dev    The `jitSkipSender` exemption (JIT hook P3 fix) applies for free if the WETH/USDC pool is the
///         vault's OWN am-AMM pool: this contract swaps as itself, and if set as the hook's `jitSkipSender`
///         its settlement swaps are exempt from the JIT/am-AMM auction path — no self-skim, no reentrant
///         `fundRent` deadlock. Settlement and trading flow never collide.
contract MintwareEthSettlement is IUnlockCallback, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    IPoolManager public immutable poolManager;
    IERC20       public immutable usdc;             // settlement asset (paid to the rail)
    IERC20       public immutable weth;             // the ETH-collateral token the vault holds
    bool         public immutable wethIsCurrency0;  // token ordering in the canonical pool
    PoolId       public immutable canonicalPoolId;

    // Canonical pool key (the ONE WETH/USDC pool this contract settles through).
    Currency private immutable _c0;
    Currency private immutable _c1;
    uint24   private immutable _fee;
    int24    private immutable _tickSpacing;
    IHooks   private immutable _hooks;

    /// @notice Band (ticks) the settlement swap may move price past the oracle before stopping. Mirrors the
    ///         JIT hook's `SWEEP_BAND_TICKS` (~5% at spacing-60). Owner-tunable per pool depth.
    int24 public bandTicks = 500;

    /// @notice Supplies the truncated reference tick (a pool hook). Zero / not-ready ⇒ unbounded swap
    ///         (pre-first-swap fallback only; a live pool's hook is always ready).
    IOracleTickSource public oracleSource;

    /// @notice AUDIT (pre-audit review): when true (the default), a settlement REVERTS if the oracle isn't
    ///         ready, rather than falling through to an unbounded (sandwichable) swap that would lean
    ///         entirely on the relayer's `minUsdcOut`. Production settlement is therefore ALWAYS bounded to
    ///         the truncated-oracle band. Owner may disable only for a pre-oracle bootstrap/testnet.
    bool public requireReadyOracle = true;

    /// @notice The settlement role — the relayer that batches settling holds and triggers the swap.
    address public relayer;

    /// @notice Physical WETH held to back settlement (the ETH-collateral the vault deposited here). Decays
    ///         by exactly the WETH each swap consumes — conservation is asserted by checked arithmetic.
    uint256 public wethBacking;

    /// @notice First-loss USDC reserve. Tops up a bounded-swap shortfall so the rail is paid in full;
    ///         drawing it is the junior absorbing the ETH-price move the senior is insulated from.
    uint256 public juniorUsdcBuffer;

    /// @notice Max junior top-up per settlement (0 ⇒ up to the whole buffer). Caps first-loss bleed on a
    ///         bad day: a shortfall beyond the cap reverts (retry next window) instead of draining junior.
    uint256 public juniorTopUpCapPerCall;

    /// @notice AUDIT H4: the ONE pinned settlement destination. `batchSettleEth` may pay ONLY this address —
    ///         the relayer cannot redirect funds. Mirrors the Gateway's C1 fix (receiver pinned to the CPN
    ///         treasury). Owner-settable/re-settable (a settlement-address migration re-points it); until it
    ///         is set, settlement reverts (`RailNotSet`) so no value can flow to an unpinned address.
    address public settlementRail;

    /// @notice AUDIT H4: per-call ceiling on `totalUsdc` (0 ⇒ off). Bounds how much a single settlement — and
    ///         thus a runaway/compromised relayer — can move in one tx, even to the pinned rail. Defense in
    ///         depth on top of the pin; set per the expected batch size.
    uint256 public maxSettlePerCall;

    /// @notice AUDIT R2-M2: cumulative/windowed settlement ceiling (USDC) — 0 ⇒ off. The per-call cap alone
    ///         doesn't bound TOTAL extraction: a rogue/compromised relayer can call `batchSettleEth`
    ///         repeatedly (each ≤ `maxSettlePerCall`) and, with a loose `minUsdcOut`, convert all WETH backing
    ///         + drain the junior buffer to the pinned rail with no on-chain proof a real charge exists. This
    ///         caps aggregate `totalUsdc` settled within a rolling `settleWindow`, so the guardian has time to
    ///         pause. Owner-set alongside `settleWindow`.
    uint256 public maxSettlePerWindow;
    /// @notice AUDIT R2-M2: length (seconds) of the rolling settlement window `maxSettlePerWindow` applies to.
    ///         Ignored while `maxSettlePerWindow == 0`.
    uint256 public settleWindow;
    uint256 private _windowStart;      // start timestamp of the current window
    uint256 private _settledInWindow;  // Σ totalUsdc settled since `_windowStart`

    /// @notice AUDIT R2-M2: minimum acceptable swap output as a fraction (bps) of `totalUsdc` — 0 ⇒ off. When
    ///         set, `batchSettleEth` requires the relayer-supplied `minUsdcOut` to be AT LEAST this fraction of
    ///         `totalUsdc`, so a rogue relayer cannot pass `minUsdcOut = 0` and let the bounded swap execute at
    ///         a near-zero output (converting WETH backing cheaply + leaning on the junior top-up). The real
    ///         floor is still the tighter of this and the oracle band.
    uint16 public minSettleOutBps;
    uint16 internal constant SETTLE_BPS = 10_000;

    /// @dev Transient exact-output target read inside `unlockCallback` (set→unlock→clear in one call).
    uint256 private _pendingUsdcOut;

    // ── never-idle: WETH backing earns lending (Aave/Morpho) yield while staying settlement-liquid ──────
    //
    // The WETH the vault deposits here as settlement backing should not sit idle. This wires it — through
    // the SAME `IYieldAdapter` seam the treasury vault uses for USDC (`_supplyToAdapter`/`_pullUSDC`) — to
    // a WETH LENDING adapter (`AaveV3YieldAdapter(WETH, aWETH)` / MultiVenue on Aave+Morpho), NOT staking.
    // Only a liquid buffer stays on-hand; the rest lends; a pre-settlement `_ensureLiquidWeth` unwinds on
    // demand. Everything below is ADDITIVE and OFF by default: with `wethAdapter == address(0)` behaviour
    // is byte-for-byte today's (WETH fully liquid, no lending). See docs/developers/eth-backing-never-idle-design.md.

    /// @notice The WETH lending yield sink. **Defaults to `address(0)`; while unset the contract behaves
    ///         byte-for-byte as before (no lending, WETH fully liquid).** Set to an audited WETH lending
    ///         adapter (`AaveV3YieldAdapter(WETH, aWETH)` or `MintwareMultiVenueYieldAdapter`) to turn earning
    ///         on. First set takes effect immediately; thereafter it is LOCKED (mirrors the spirit of
    ///         `MWTimelockedOracleSigner` — one deliberate wiring, then immutable at this layer).
    /// @dev    RISK PARAM. This setter will adopt the shared 48h risk-param timelock the governance branch
    ///         adds; it does NOT hard-depend on it (that branch ships separately). The first-set-then-lock
    ///         rule is the conservative interim: the adapter can only ever be wired ONCE from here.
    IYieldAdapter public wethAdapter;

    /// @notice Fraction (bps) of total WETH backing to keep LIQUID on-hand; the remainder is lent. Default
    ///         `3000` = keep 30% liquid, lend 70% — conservative because settlement WETH turns over and an
    ///         on-demand unwind is the routine path only for unusually large batches. Bounded
    ///         [`MIN_WETH_BUFFER_BPS`, `MAX_WETH_BUFFER_BPS`].
    /// @dev    RISK PARAM (same timelock note as `wethAdapter`).
    uint16 public wethIdleBufferBps = 3_000;

    /// @notice Safety margin (bps) applied to the oracle-estimated WETH the next settlement swap will
    ///         consume, so the pre-settlement unwind pulls a cushion above the point estimate. Default
    ///         `12000` = 120%. Bounded [`SETTLE_BPS`, `MAX_SETTLE_MARGIN_BPS`] (never below 100%).
    /// @dev    RISK PARAM (same timelock note as `wethAdapter`).
    uint16 public settleMarginBps = 12_000;

    uint16 internal constant MIN_WETH_BUFFER_BPS   = 1_000;  // >=10% liquid, else routine settlements churn the adapter
    uint16 internal constant MAX_WETH_BUFFER_BPS   = 10_000; // <=100% (100% = fully liquid, i.e. lending effectively off)
    uint16 internal constant MAX_SETTLE_MARGIN_BPS = 30_000; // <=300% cushion on the unwind estimate
    uint256 internal constant Q96 = 1 << 96;                 // fixed-point unit for the oracle price

    event RelayerSet(address indexed relayer);
    event OracleSourceSet(address indexed source);
    event BandSet(int24 bandTicks);
    event RequireReadyOracleSet(bool required);
    event JuniorTopUpCapSet(uint256 cap);
    event SettlementRailSet(address indexed rail);
    event MaxSettlePerCallSet(uint256 cap);
    event SettlementWindowCapSet(uint256 cap, uint256 windowSecs);
    event MinSettleOutBpsSet(uint16 bps);
    event WethBackingFunded(address indexed from, uint256 amount, uint256 total);
    event WethBackingWithdrawn(address indexed to, uint256 amount, uint256 total);
    event JuniorBufferFunded(address indexed from, uint256 amount, uint256 total);
    event JuniorBufferWithdrawn(address indexed to, uint256 amount, uint256 total);
    event Settled(address indexed rail, uint256 totalUsdc, uint256 usdcFromSwap, uint256 wethSpent, uint256 juniorDrawn);
    event WethAdapterSet(address indexed adapter);
    event WethIdleBufferBpsSet(uint16 bps);
    event SettleMarginBpsSet(uint16 bps);
    event WethSuppliedToAdapter(uint256 amount);
    event WethUnwoundFromAdapter(uint256 requested, uint256 withdrawn);

    error ZeroAddress();
    error ZeroAmount();
    error NotWethUsdcPool();
    error OnlyRelayer();
    error OnlyPoolManager();
    error InsufficientWethBacking();
    error SettlementSlippageExceeded(uint256 produced, uint256 required);
    error OracleNotReady();
    error RailNotSet();
    error RailMismatch();
    error SettlementCapExceeded();
    error SettlementWindowCapExceeded();
    error MinUsdcOutTooLow(uint256 supplied, uint256 required);
    error BadParam();
    error AdapterAlreadySet();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert OnlyRelayer();
        _;
    }

    /// @param pm       The V4 PoolManager.
    /// @param key      The canonical WETH/USDC pool key (currencies must be exactly {weth_, usdc_}).
    /// @param usdc_    Settlement asset.
    /// @param weth_    ETH-collateral token.
    /// @param owner_   Admin (roles, band, buffers).
    /// @param relayer_ Initial settlement role.
    constructor(
        IPoolManager pm,
        PoolKey memory key,
        address usdc_,
        address weth_,
        address owner_,
        address relayer_
    ) Ownable(owner_) {
        if (usdc_ == address(0) || weth_ == address(0) || relayer_ == address(0)) revert ZeroAddress();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        // The pool must be exactly the {weth, usdc} pair — either ordering.
        bool ok = (c0 == weth_ && c1 == usdc_) || (c0 == usdc_ && c1 == weth_);
        if (!ok) revert NotWethUsdcPool();

        poolManager     = pm;
        usdc            = IERC20(usdc_);
        weth            = IERC20(weth_);
        wethIsCurrency0 = (c0 == weth_);
        canonicalPoolId = key.toId();

        _c0          = key.currency0;
        _c1          = key.currency1;
        _fee         = key.fee;
        _tickSpacing = key.tickSpacing;
        _hooks       = key.hooks;

        relayer = relayer_;
        emit RelayerSet(relayer_);
    }

    // ── admin ──────────────────────────────────────────────────────────────────────

    function setRelayer(address relayer_) external onlyOwner {
        if (relayer_ == address(0)) revert ZeroAddress();
        relayer = relayer_;
        emit RelayerSet(relayer_);
    }

    function setOracleSource(address source) external onlyOwner {
        oracleSource = IOracleTickSource(source);
        emit OracleSourceSet(source);
    }

    function setBandTicks(int24 band) external onlyOwner {
        if (band <= 0) revert ZeroAmount();
        bandTicks = band;
        emit BandSet(band);
    }

    /// @notice Toggle the fail-closed require-ready-oracle guard. Keep TRUE in production.
    function setRequireReadyOracle(bool required) external onlyOwner {
        requireReadyOracle = required;
        emit RequireReadyOracleSet(required);
    }

    function setJuniorTopUpCapPerCall(uint256 cap) external onlyOwner {
        juniorTopUpCapPerCall = cap;
        emit JuniorTopUpCapSet(cap);
    }

    /// @notice AUDIT H4: pin (or re-point) the sole settlement destination. Set to the Gateway / CPN
    ///         settlement address before enabling settlement; the relayer can never pay anywhere else.
    function setSettlementRail(address rail) external onlyOwner {
        if (rail == address(0)) revert ZeroAddress();
        settlementRail = rail;
        emit SettlementRailSet(rail);
    }

    /// @notice AUDIT H4: set the per-call `totalUsdc` ceiling (0 = off). Defense in depth over the pin.
    function setMaxSettlePerCall(uint256 cap) external onlyOwner {
        maxSettlePerCall = cap;
        emit MaxSettlePerCallSet(cap);
    }

    /// @notice AUDIT R2-M2: set the cumulative/windowed settlement ceiling (USDC) + rolling window length
    ///         (seconds). `cap == 0` disables it; when enabled `windowSecs` must be non-zero. Bounds TOTAL
    ///         extraction a runaway relayer can push through the pinned rail, giving the guardian time to pause.
    function setSettlementWindowCap(uint256 cap, uint256 windowSecs) external onlyOwner {
        if (cap != 0 && windowSecs == 0) revert BadParam();
        maxSettlePerWindow = cap;
        settleWindow       = windowSecs;
        _windowStart       = block.timestamp; // fresh window on (re)config
        _settledInWindow   = 0;
        emit SettlementWindowCapSet(cap, windowSecs);
    }

    /// @notice AUDIT R2-M2: require the relayer's `minUsdcOut` to be ≥ this fraction (bps) of `totalUsdc`
    ///         (0 = off). Stops a rogue relayer passing `minUsdcOut = 0` and settling the swap at a near-zero
    ///         output. Must be ≤ 100%.
    function setMinSettleOutBps(uint16 bps) external onlyOwner {
        if (bps > SETTLE_BPS) revert BadParam();
        minSettleOutBps = bps;
        emit MinSettleOutBpsSet(bps);
    }

    /// @notice Wire the WETH LENDING adapter (turns "never idle" on). First set takes effect immediately;
    ///         thereafter it is LOCKED — the adapter can only ever be set ONCE from here (first-set-then-lock,
    ///         mirroring `MWTimelockedOracleSigner`'s spirit). Pass an audited `AaveV3YieldAdapter(WETH,aWETH)`
    ///         / `MintwareMultiVenueYieldAdapter`. Until it is set, backing stays fully liquid (today's behaviour).
    /// @dev    RISK PARAM — will adopt the shared 48h risk-param timelock (separate governance branch); this
    ///         does not hard-depend on it. The lock is the conservative interim.
    function setWethAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (address(wethAdapter) != address(0)) revert AdapterAlreadySet();
        wethAdapter = IYieldAdapter(adapter);
        emit WethAdapterSet(adapter);
    }

    /// @notice Set the liquid-buffer fraction (bps) kept on-hand; the remainder lends. Bounded
    ///         [`MIN_WETH_BUFFER_BPS`, `MAX_WETH_BUFFER_BPS`].
    /// @dev    RISK PARAM (timelock note as `setWethAdapter`).
    function setWethIdleBufferBps(uint16 bps) external onlyOwner {
        if (bps < MIN_WETH_BUFFER_BPS || bps > MAX_WETH_BUFFER_BPS) revert BadParam();
        wethIdleBufferBps = bps;
        emit WethIdleBufferBpsSet(bps);
    }

    /// @notice Set the safety margin (bps) on the pre-settlement unwind estimate. Bounded
    ///         [`SETTLE_BPS` (100%), `MAX_SETTLE_MARGIN_BPS`].
    /// @dev    RISK PARAM (timelock note as `setWethAdapter`).
    function setSettleMarginBps(uint16 bps) external onlyOwner {
        if (bps < SETTLE_BPS || bps > MAX_SETTLE_MARGIN_BPS) revert BadParam();
        settleMarginBps = bps;
        emit SettleMarginBpsSet(bps);
    }

    /// @notice Owner/keeper: push any WETH backing held above the liquid buffer into the lending adapter.
    ///         Idempotent and best-effort — a no-op when no adapter is set or nothing is above the buffer.
    function sweepWethToAdapter() external onlyOwner {
        _supplyExcessWeth();
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── funding (models the vault depositing ETH backing + the team funding first-loss) ──────────────

    /// @notice Pull `amount` WETH in as settlement backing (the ETH-collateral vault funds this).
    /// @dev AUDIT (defense-in-depth, Info): credits the NOMINAL `amount`, not a balance-diff — this
    ///      assumes a standard (non-fee-on-transfer) `weth`, which canonical WETH is. A fee-on-transfer
    ///      collateral token would over-credit `wethBacking`; wire only standard tokens here. (Contrast
    ///      the pair vault's `fundRent`, which is balance-diff for hostile-token safety.)
    function fundWethBacking(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        weth.safeTransferFrom(msg.sender, address(this), amount);
        wethBacking += amount;
        emit WethBackingFunded(msg.sender, amount, wethBacking);
        // NEVER IDLE: auto-lend everything above the liquid buffer (no-op while `wethAdapter == 0`).
        _supplyExcessWeth();
    }

    /// @notice Owner reclaims unused WETH backing (e.g. wind-down). Cannot touch the junior USDC buffer.
    /// @dev `wethBacking` tracks TOTAL backing (on-hand + lent). If on-hand is short, unwind from the
    ///      adapter first (best-effort) before transferring out; a wind-down beyond what can be unwound
    ///      right now reverts `InsufficientWethBacking` rather than under-deliver.
    function withdrawWethBacking(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > wethBacking) revert InsufficientWethBacking();
        _ensureLiquidWeth(amount); // pull from the lending adapter if on-hand is short (no-op while unset)
        if (weth.balanceOf(address(this)) < amount) revert InsufficientWethBacking();
        wethBacking -= amount;
        weth.safeTransfer(to, amount);
        emit WethBackingWithdrawn(to, amount, wethBacking);
    }

    /// @notice Total WETH backing settlement — on-hand `+ wethAdapter.totalAssets()` (0 adapter ⇒ on-hand
    ///         only). aTokens rebase, so `totalAssets` already values accrued lending interest at its
    ///         redeemable amount — this view is never an overstatement of what can actually be realized.
    function totalWethBacking() public view returns (uint256) {
        uint256 onHand = weth.balanceOf(address(this));
        if (address(wethAdapter) == address(0)) return onHand;
        return onHand + wethAdapter.totalAssets();
    }

    /// @notice Fund the junior first-loss USDC buffer.
    /// @dev AUDIT (defense-in-depth, Info): nominal credit, not balance-diff — assumes standard USDC
    ///      (which it is). Do not wire a fee-on-transfer token here. See `fundWethBacking` note.
    function fundJuniorBuffer(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        juniorUsdcBuffer += amount;
        emit JuniorBufferFunded(msg.sender, amount, juniorUsdcBuffer);
    }

    /// @notice Owner reclaims unused junior USDC buffer.
    function withdrawJuniorBuffer(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > juniorUsdcBuffer) revert ZeroAmount();
        juniorUsdcBuffer -= amount;
        usdc.safeTransfer(to, amount);
        emit JuniorBufferWithdrawn(to, amount, juniorUsdcBuffer);
    }

    // ── the settlement swap ──────────────────────────────────────────────────────────

    /// @notice Convert WETH backing → USDC and pay `totalUsdc` to `rail` (the card-network settlement).
    ///         The swap is exact-output `totalUsdc`, price-bounded to the oracle band. If it comes up short
    ///         (band binds / thin liquidity) the junior buffer tops up to full, up to the per-call cap;
    ///         beyond that — or below the `minUsdcOut` catastrophe floor — it reverts and the relayer
    ///         retries next window. The rail is paid IN FULL or not at all.
    /// @param totalUsdc   USDC owed to the rail for this batch (Σ hold amounts).
    /// @param minUsdcOut  Catastrophe floor for the swap output (edge's conservative price × γ). A swap
    ///                    producing less reverts BEFORE any junior draw.
    /// @param rail        Recipient of the settled USDC (the Gateway / card-network settlement address).
    /// @return usdcFromSwap USDC the bounded swap produced.
    /// @return wethSpent    WETH the swap consumed (backing decreases by exactly this).
    /// @return juniorDrawn  USDC drawn from the junior buffer to reach `totalUsdc`.
    function batchSettleEth(uint256 totalUsdc, uint256 minUsdcOut, address rail)
        external
        onlyRelayer
        nonReentrant
        whenNotPaused
        returns (uint256 usdcFromSwap, uint256 wethSpent, uint256 juniorDrawn)
    {
        if (totalUsdc == 0) revert ZeroAmount();
        // AUDIT H4: pay ONLY the pinned rail — the relayer cannot redirect funds. The passed `rail` must
        // equal the stored destination (kept as a param for interface stability + an explicit caller assert).
        if (settlementRail == address(0)) revert RailNotSet();
        if (rail != settlementRail) revert RailMismatch();
        // AUDIT H4: per-call ceiling (defense in depth over the pin) — 0 = off.
        if (maxSettlePerCall != 0 && totalUsdc > maxSettlePerCall) revert SettlementCapExceeded();

        // AUDIT R2-M2: cumulative/windowed ceiling — bounds TOTAL extraction across repeated calls, not just
        // one call. Roll the window forward lazily, then accumulate and check.
        if (maxSettlePerWindow != 0) {
            if (block.timestamp >= _windowStart + settleWindow) {
                _windowStart     = block.timestamp;
                _settledInWindow = 0;
            }
            _settledInWindow += totalUsdc;
            if (_settledInWindow > maxSettlePerWindow) revert SettlementWindowCapExceeded();
        }

        // AUDIT R2-M2: floor the relayer-supplied `minUsdcOut` at a fraction of `totalUsdc` so a rogue relayer
        // can't pass 0 and let the bounded swap execute at a near-zero output (cheap WETH conversion + junior
        // top-up). 0 = off. The effective floor remains the tighter of this and the oracle band.
        if (minSettleOutBps != 0) {
            uint256 required = (totalUsdc * minSettleOutBps) / SETTLE_BPS;
            if (minUsdcOut < required) revert MinUsdcOutTooLow(minUsdcOut, required);
        }

        // Fail closed: never fire an UNBOUNDED settlement swap in production — require the oracle band.
        if (requireReadyOracle) {
            (, bool ready) = _oracle();
            if (!ready) revert OracleNotReady();
        }

        // NEVER IDLE: before the swap, unwind enough lent WETH so the swap has liquid inventory to consume.
        // Estimate the WETH this swap will need from the oracle price (~`settleMarginBps` cushion) and pull
        // `min(need − onHand, maxWithdrawable())` from the adapter (best-effort, never reverts). No-op while
        // `wethAdapter == 0`. If the adapter can't fully unwind (utilization crunch), the swap simply consumes
        // what's on-hand and the EXISTING shortfall path (junior top-up, minUsdcOut floor, revert-and-retry)
        // applies UNCHANGED — the lending layer sits underneath H4/R2-M2/oracle-band/junior/minUsdcOut.
        _ensureLiquidWeth(_estimateWethNeed(totalUsdc));

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 wethBefore = weth.balanceOf(address(this));

        // Swap inside the unlock (see unlockCallback): exact-output `totalUsdc`, oracle-bounded.
        _pendingUsdcOut = totalUsdc;
        poolManager.unlock("");
        _pendingUsdcOut = 0;

        usdcFromSwap = usdc.balanceOf(address(this)) - usdcBefore;
        wethSpent    = wethBefore - weth.balanceOf(address(this));

        // (1) Catastrophe floor: a swap worse than the edge's modeled minimum → revert, don't burn junior.
        if (usdcFromSwap < minUsdcOut) revert SettlementSlippageExceeded(usdcFromSwap, minUsdcOut);

        // (2) Top up any shortfall from the junior first-loss buffer, bounded by the per-call cap.
        if (usdcFromSwap < totalUsdc) {
            uint256 shortfall = totalUsdc - usdcFromSwap;
            uint256 cap = juniorTopUpCapPerCall == 0
                ? juniorUsdcBuffer
                : (juniorTopUpCapPerCall < juniorUsdcBuffer ? juniorTopUpCapPerCall : juniorUsdcBuffer);
            if (shortfall > cap) revert SettlementSlippageExceeded(usdcFromSwap, totalUsdc);
            juniorUsdcBuffer -= shortfall;
            juniorDrawn = shortfall;
        }

        // (3) Backing conservation: reduce ETH backing by the WETH consumed. AUDIT L4: clamp so a direct
        //     WETH donation (balance > tracked `wethBacking`) that lets a swap consume more than tracked
        //     can't underflow-revert and DoS settlement — the untracked donation is simply not double-counted.
        wethBacking = wethSpent >= wethBacking ? 0 : wethBacking - wethSpent;

        // (4) Pay the PINNED rail IN FULL (swap proceeds + junior top-up). Zero residual by construction.
        usdc.safeTransfer(settlementRail, totalUsdc);

        emit Settled(settlementRail, totalUsdc, usdcFromSwap, wethSpent, juniorDrawn);
    }

    function unlockCallback(bytes calldata) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        uint256 want = _pendingUsdcOut;
        if (want == 0) return "";

        // Selling WETH (input) for USDC (output). zeroForOne iff WETH is currency0.
        bool zeroForOne = wethIsCurrency0;
        (uint160 cur,,,) = poolManager.getSlot0(canonicalPoolId);

        BalanceDelta delta = poolManager.swap(
            _key(),
            SwapParams({
                zeroForOne:        zeroForOne,
                amountSpecified:   int256(want),                 // > 0 ⇒ EXACT OUTPUT of `want` USDC
                sqrtPriceLimitX96: _swapLimit(zeroForOne, cur)   // oracle-bounded → partial-fills at the band
            }),
            ""
        );
        _settleDelta(_key(), delta);
        return "";
    }

    // ── internals (mirror MintwareTreasuryJitHook's oracle-bounded sweep) ──────────────

    /// @dev Oracle-bounded price limit, clamped to the executable side of `cur` (never reverts). Not-ready
    ///      oracle ⇒ full range (pre-first-swap fallback). Identical shape to the JIT hook's `_swapLimit`.
    function _swapLimit(bool zeroForOne, uint160 cur) private view returns (uint160) {
        (int24 oTick, bool ready) = _oracle();
        if (!ready) return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        if (zeroForOne) {
            uint160 band = _sqrtAtClamped(int256(oTick) - bandTicks);
            if (band >= cur) return cur > TickMath.MIN_SQRT_PRICE + 1 ? cur - 1 : cur;
            return band;
        } else {
            uint160 band = _sqrtAtClamped(int256(oTick) + bandTicks);
            if (band <= cur) return cur < TickMath.MAX_SQRT_PRICE - 1 ? cur + 1 : cur;
            return band;
        }
    }

    function _oracle() private view returns (int24 tick, bool ready) {
        if (address(oracleSource) == address(0)) return (int24(0), false);
        return oracleSource.oracleTick();
    }

    // ── never-idle lending internals (mirror the treasury vault's _supplyToAdapter / _pullUSDC shape) ──────

    /// @dev Push WETH backing held above the liquid buffer into the lending adapter. Best-effort — a failed
    ///      deposit resets the approval and leaves the WETH on-hand (degrades to "stays liquid," never
    ///      reverts the caller). No-op while `wethAdapter == 0`. The buffer target is a fraction of TOTAL
    ///      tracked backing (`wethBacking`), so it lends only the excess that is actually on-hand.
    function _supplyExcessWeth() internal {
        if (address(wethAdapter) == address(0)) return;
        uint256 onHand = weth.balanceOf(address(this));
        uint256 target = FullMath.mulDiv(wethBacking, wethIdleBufferBps, SETTLE_BPS);
        if (onHand <= target) return;
        uint256 excess     = onHand - target;
        uint256 suppliable = wethAdapter.maxSuppliable();
        uint256 toSupply   = excess < suppliable ? excess : suppliable;
        if (toSupply == 0) return;
        weth.forceApprove(address(wethAdapter), toSupply);
        try wethAdapter.deposit(toSupply) {
            emit WethSuppliedToAdapter(toSupply);
        } catch {
            weth.forceApprove(address(wethAdapter), 0); // deposit reverted → un-approve, keep WETH liquid
        }
    }

    /// @dev Ensure the contract holds >= `need` WETH on-hand to feed the settlement swap, unwinding
    ///      `min(need − onHand, maxWithdrawable())` from the lending adapter. `withdraw` is best-effort and
    ///      NEVER reverts for a liquidity reason — a partial (or zero) unwind is safe because the swap then
    ///      just consumes what's on-hand and the existing shortfall path handles the rest. No-op while unset.
    function _ensureLiquidWeth(uint256 need) internal {
        if (address(wethAdapter) == address(0) || need == 0) return;
        uint256 onHand = weth.balanceOf(address(this));
        if (onHand >= need) return;
        uint256 short = need - onHand;
        uint256 avail = wethAdapter.maxWithdrawable();
        uint256 pull  = short < avail ? short : avail;
        if (pull == 0) return;
        uint256 got = wethAdapter.withdraw(pull); // best-effort; may return < pull under a utilization crunch
        emit WethUnwoundFromAdapter(pull, got);
    }

    /// @dev Estimate the WETH the next settlement swap will consume to produce `totalUsdc`, from the oracle
    ///      price, then apply the `settleMarginBps` cushion. Used ONLY to size the pre-settlement unwind — an
    ///      over-estimate just leaves harmless extra WETH on-hand (still counted in `totalWethBacking`), an
    ///      under-estimate falls through to the unchanged shortfall path. Returns 0 when no adapter is wired
    ///      (nothing to unwind); returns `type(uint256).max` (pull all available) when the oracle can't price
    ///      (only reachable when the require-ready-oracle guard is disabled for bootstrap).
    function _estimateWethNeed(uint256 totalUsdc) private view returns (uint256) {
        if (address(wethAdapter) == address(0)) return 0;
        (int24 oTick, bool ready) = _oracle();
        if (!ready) return type(uint256).max;

        uint160 sqrtP    = _sqrtAtClamped(int256(oTick));
        // price_Q96 = token1-per-token0 in RAW token units (decimals already baked into the pool price).
        uint256 priceQ96 = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96);
        if (priceQ96 == 0) return type(uint256).max;

        uint256 est = wethIsCurrency0
            // token1 = USDC per WETH ⇒ USDC-per-WETH = priceQ96/Q96 ⇒ wethNeed = totalUsdc·Q96/priceQ96
            ? FullMath.mulDiv(totalUsdc, Q96, priceQ96)
            // token1 = WETH per USDC ⇒ WETH-per-USDC = priceQ96/Q96 ⇒ wethNeed = totalUsdc·priceQ96/Q96
            : FullMath.mulDiv(totalUsdc, priceQ96, Q96);

        return FullMath.mulDiv(est, settleMarginBps, SETTLE_BPS);
    }

    function _sqrtAtClamped(int256 tick) private pure returns (uint160) {
        if (tick < TickMath.MIN_TICK) return TickMath.MIN_SQRT_PRICE + 1;
        if (tick > TickMath.MAX_TICK) return TickMath.MAX_SQRT_PRICE - 1;
        uint160 s = TickMath.getSqrtPriceAtTick(int24(tick));
        if (s < TickMath.MIN_SQRT_PRICE + 1) return TickMath.MIN_SQRT_PRICE + 1;
        if (s > TickMath.MAX_SQRT_PRICE - 1) return TickMath.MAX_SQRT_PRICE - 1;
        return s;
    }

    function _settleDelta(PoolKey memory key, BalanceDelta delta) private {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(key.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(key.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(key.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(key.currency1, address(this), uint256(uint128(d1)));
    }

    function _pay(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _key() private view returns (PoolKey memory) {
        return PoolKey({currency0: _c0, currency1: _c1, fee: _fee, tickSpacing: _tickSpacing, hooks: _hooks});
    }
}
