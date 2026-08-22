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

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MWTimelockedRiskParams} from "../lib/MWTimelockedRiskParams.sol";

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
contract MintwareEthSettlement is IUnlockCallback, Ownable, Pausable, ReentrancyGuard, MWTimelockedRiskParams {
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

    // ── governed risk-parameter ids + bounds (legal 48h-timelock rail) ─────────────────────────────
    // Every risk setter below routes through `MWTimelockedRiskParams`: bounded at propose time; instant
    // while pre-arming (before `settlementRail` is pinned — i.e. deploy + test setUp) OR when the change
    // TIGHTENS safety; else 48h-timelocked + disclosed. Ids are public for `confirmRiskParam`/`cancelRiskParam`.
    bytes32 public constant RP_BAND_TICKS            = keccak256("MintwareEthSettlement.bandTicks");
    bytes32 public constant RP_JUNIOR_TOPUP_CAP      = keccak256("MintwareEthSettlement.juniorTopUpCapPerCall");
    bytes32 public constant RP_MAX_SETTLE_PER_CALL   = keccak256("MintwareEthSettlement.maxSettlePerCall");
    bytes32 public constant RP_SETTLE_WINDOW_CAP     = keccak256("MintwareEthSettlement.settlementWindowCap");
    bytes32 public constant RP_MIN_SETTLE_OUT_BPS    = keccak256("MintwareEthSettlement.minSettleOutBps");
    bytes32 public constant RP_REQUIRE_READY_ORACLE  = keccak256("MintwareEthSettlement.requireReadyOracle");
    /// @notice Widest slippage band the settlement swap may open (~20% at spacing-60). Fat-finger ceiling.
    int24   public constant MAX_BAND_TICKS           = 2_000;
    /// @notice Fat-finger ceilings on the "0 == off" USDC caps + window. Decimals-agnostic (USDC may be 6dp
    ///         or 18dp across deployments) — these only reject an absurd typo; the timelock governs the
    ///         meaningful (loosening) direction, not a numeric economic bound.
    uint256 public constant MAX_SETTLE_CAP           = type(uint128).max;
    uint256 public constant MAX_SETTLE_WINDOW        = 3650 days;

    /// @dev Transient exact-output target read inside `unlockCallback` (set→unlock→clear in one call).
    uint256 private _pendingUsdcOut;

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

    /// @notice Governed (48h-timelocked) risk param — the ticks the settlement swap may move past the oracle
    ///         before stopping. WIDENING the band tolerates more slippage (risk-increasing → timelocked);
    ///         NARROWING it (safety) is instant. Bounded (0, MAX_BAND_TICKS] at propose time.
    function setBandTicks(int24 band) external onlyOwner {
        _changeRiskParam(RP_BAND_TICKS, uint256(uint24(band)), 0);
    }

    /// @notice Governed (48h-timelocked) risk param — the fail-closed require-ready-oracle guard. DISABLING
    ///         it (→ unbounded, sandwichable swaps) is risk-increasing → timelocked; ENABLING it (safety) is
    ///         instant. Keep TRUE in production; only disable for a pre-oracle bootstrap (before the rail is
    ///         pinned, so instant then).
    function setRequireReadyOracle(bool required) external onlyOwner {
        _changeRiskParam(RP_REQUIRE_READY_ORACLE, required ? 1 : 0, 0);
    }

    /// @notice Governed (48h-timelocked) risk param — max junior top-up per settlement (0 = off = up to the
    ///         WHOLE buffer = loosest). RAISING the cap (or setting 0) lets more first-loss bleed per call
    ///         (risk-increasing → timelocked); LOWERING a non-zero cap (safety) is instant. Bounded ≤ MAX_SETTLE_CAP.
    function setJuniorTopUpCapPerCall(uint256 cap) external onlyOwner {
        _changeRiskParam(RP_JUNIOR_TOPUP_CAP, cap, 0);
    }

    /// @notice AUDIT H4: pin (or re-point) the sole settlement destination. Set to the Gateway / CPN
    ///         settlement address before enabling settlement; the relayer can never pay anywhere else.
    function setSettlementRail(address rail) external onlyOwner {
        if (rail == address(0)) revert ZeroAddress();
        settlementRail = rail;
        emit SettlementRailSet(rail);
    }

    /// @notice AUDIT H4 — Governed (48h-timelocked) risk param: the per-call `totalUsdc` ceiling (0 = off =
    ///         loosest). RAISING it (or setting 0) lets a single settlement move more (risk-increasing →
    ///         timelocked); LOWERING a non-zero cap (safety) is instant. Bounded ≤ MAX_SETTLE_CAP.
    function setMaxSettlePerCall(uint256 cap) external onlyOwner {
        _changeRiskParam(RP_MAX_SETTLE_PER_CALL, cap, 0);
    }

    /// @notice AUDIT R2-M2 — Governed (48h-timelocked) risk param: the cumulative/windowed settlement ceiling
    ///         (USDC) + rolling window (seconds). `cap == 0` disables it; when enabled `windowSecs` must be
    ///         non-zero. LOOSENING (raising the cap, disabling it, or shortening the window) is risk-increasing
    ///         → timelocked; TIGHTENING (enabling from off, lowering the cap without shortening the window) is
    ///         instant. Bounds TOTAL extraction a runaway relayer can push through the pinned rail.
    function setSettlementWindowCap(uint256 cap, uint256 windowSecs) external onlyOwner {
        _changeRiskParam(RP_SETTLE_WINDOW_CAP, cap, windowSecs);
    }

    /// @notice AUDIT R2-M2 — Governed (48h-timelocked) risk param: require the relayer's `minUsdcOut` to be
    ///         ≥ this fraction (bps) of `totalUsdc` (0 = off = loosest). LOWERING it weakens the swap-output
    ///         floor (risk-increasing → timelocked); RAISING it (safety) is instant. Bounded ≤ 100%.
    function setMinSettleOutBps(uint16 bps) external onlyOwner {
        _changeRiskParam(RP_MIN_SETTLE_OUT_BPS, bps, 0);
    }

    /// @notice Confirm a 48h-timelocked risk-parameter change once its delay has elapsed. `param` is an `RP_*` id.
    function confirmRiskParam(bytes32 param) external onlyOwner { _confirmRiskParam(param); }

    /// @notice Cancel a pending (not-yet-confirmed) risk-parameter change — abort a rogue/superseded proposal.
    function cancelRiskParam(bytes32 param) external onlyOwner { _cancelRiskParam(param); }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── MWTimelockedRiskParams hooks (describe this contract's governed params) ─────────────────────

    /// @dev "Live" (timelock binds) once the settlement destination is pinned. Before the rail is set,
    ///      settlement reverts (`RailNotSet`) so no value can flow — hence risk-param sets are instant then
    ///      (first-set-immediate: deploy wiring + test setUp).
    function _riskParamsLive() internal view override returns (bool) {
        return settlementRail != address(0);
    }

    function _validateRiskParam(bytes32 param, uint256 v, uint256 v2) internal view override {
        if (param == RP_BAND_TICKS) {
            if (v == 0 || v > uint256(uint24(MAX_BAND_TICKS))) revert BadParam();
        } else if (param == RP_JUNIOR_TOPUP_CAP || param == RP_MAX_SETTLE_PER_CALL) {
            if (v > MAX_SETTLE_CAP) revert BadParam();
        } else if (param == RP_SETTLE_WINDOW_CAP) {
            if (v != 0 && v2 == 0) revert BadParam();          // enabled cap needs a window (existing rule)
            if (v > MAX_SETTLE_CAP || v2 > MAX_SETTLE_WINDOW) revert BadParam();
        } else if (param == RP_MIN_SETTLE_OUT_BPS) {
            if (v > SETTLE_BPS) revert BadParam();
        } else if (param == RP_REQUIRE_READY_ORACLE) {
            if (v > 1) revert BadParam();
        } else {
            revert BadParam();
        }
    }

    function _readRiskParam(bytes32 param) internal view override returns (uint256) {
        if (param == RP_BAND_TICKS)           return uint256(uint24(bandTicks));
        if (param == RP_JUNIOR_TOPUP_CAP)     return juniorTopUpCapPerCall;
        if (param == RP_MAX_SETTLE_PER_CALL)  return maxSettlePerCall;
        if (param == RP_SETTLE_WINDOW_CAP)    return maxSettlePerWindow;
        if (param == RP_MIN_SETTLE_OUT_BPS)   return minSettleOutBps;
        if (param == RP_REQUIRE_READY_ORACLE) return requireReadyOracle ? 1 : 0;
        revert BadParam();
    }

    function _writeRiskParam(bytes32 param, uint256 v, uint256 v2) internal override {
        if (param == RP_BAND_TICKS) {
            bandTicks = int24(uint24(v)); emit BandSet(bandTicks);
        } else if (param == RP_JUNIOR_TOPUP_CAP) {
            juniorTopUpCapPerCall = v; emit JuniorTopUpCapSet(v);
        } else if (param == RP_MAX_SETTLE_PER_CALL) {
            maxSettlePerCall = v; emit MaxSettlePerCallSet(v);
        } else if (param == RP_SETTLE_WINDOW_CAP) {
            maxSettlePerWindow = v;
            settleWindow       = v2;
            _windowStart       = block.timestamp; // fresh window on (re)config (unchanged behavior)
            _settledInWindow   = 0;
            emit SettlementWindowCapSet(v, v2);
        } else if (param == RP_MIN_SETTLE_OUT_BPS) {
            minSettleOutBps = uint16(v); emit MinSettleOutBpsSet(uint16(v));
        } else if (param == RP_REQUIRE_READY_ORACLE) {
            requireReadyOracle = (v != 0); emit RequireReadyOracleSet(v != 0);
        } else {
            revert BadParam();
        }
    }

    /// @dev Direction gate: instant before the rail is pinned, else instant only when the change TIGHTENS.
    function _riskParamInstant(bytes32 param, uint256 v, uint256 v2) internal view override returns (bool) {
        if (settlementRail == address(0)) return true; // first-set-immediate (pre-arming)
        // higher == stricter → instant on raise/equal: min-settle-out floor, require-ready-oracle guard (0/1)
        if (param == RP_MIN_SETTLE_OUT_BPS || param == RP_REQUIRE_READY_ORACLE) {
            return v >= _readRiskParam(param);
        }
        // lower == stricter → instant on lower/equal: slippage band
        if (param == RP_BAND_TICKS) {
            return v <= _readRiskParam(param);
        }
        // "0 == off == loosest" caps → stricter == a lower NON-ZERO value (map 0 → +inf).
        if (param == RP_JUNIOR_TOPUP_CAP || param == RP_MAX_SETTLE_PER_CALL) {
            uint256 cur = _readRiskParam(param);
            uint256 effNew = v   == 0 ? type(uint256).max : v;
            uint256 effOld = cur == 0 ? type(uint256).max : cur;
            return effNew <= effOld;
        }
        // windowed cap (two-value): enabling from OFF is always tightening; otherwise instant only when the
        // absolute cap does not loosen AND the window does not shorten (both conservative — no rate increase).
        // Any other change (raise cap / disable / shorten window) is risk-increasing → timelocked.
        // (param == RP_SETTLE_WINDOW_CAP)
        uint256 oldCap = maxSettlePerWindow;
        if (oldCap == 0 && v != 0) return true;            // adding a limit where there was none
        uint256 effNewCap = v      == 0 ? type(uint256).max : v;
        uint256 effOldCap = oldCap == 0 ? type(uint256).max : oldCap;
        return effNewCap <= effOldCap && v2 >= settleWindow;
    }

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
    }

    /// @notice Owner reclaims unused WETH backing (e.g. wind-down). Cannot touch the junior USDC buffer.
    function withdrawWethBacking(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > wethBacking) revert InsufficientWethBacking();
        wethBacking -= amount;
        weth.safeTransfer(to, amount);
        emit WethBackingWithdrawn(to, amount, wethBacking);
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
