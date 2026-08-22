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
import {FullMath}              from "@uniswap/v4-core/src/libraries/FullMath.sol";

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MWGuardianPausable}    from "../lib/MWGuardianPausable.sol";
import {IYieldAdapter}         from "../vaults/IYieldAdapter.sol";

/// @dev The truncated-oracle reference the ETH/USDC swap leg bounds against — the SAME surface the JIT hook
///      exposes (`MintwareTreasuryJitHook.oracleTick()`). In production the WETH/USDC pool's hook supplies it;
///      `ready == false` (or a zero source) makes the swap fall back to unbounded (pre-first-swap only).
interface IOracleTickSource {
    function oracleTick() external view returns (int24 tick, bool ready);
}

/// @dev The Lido wstETH exchange-rate reference: ETH (WETH) redeemable per 1e18 wstETH (Lido's
///      `stEthPerToken()` / `getStETHByWstETH(1e18)`). A rate, not a market price — it can't be sandwiched,
///      so the `wstETH→ETH` swap leg is bounded against it (arithmetic floor), while the manipulation-sensitive
///      `ETH/USDC` leg is bounded against the truncated in-pool oracle.
interface IWstEthRate {
    function stEthPerToken() external view returns (uint256 ethPerWstEth1e18);
}

/// @title  MintwareTreasuryFloatSettlement
/// @notice Go-forward YPN settlement that **decouples card spend from collateral liquidation** (supersedes the
///         swap-on-settle path of `MintwareEthSettlement`). Three balances:
///           • **wstETH backing** — the ETH-side reserve, earns by staking appreciation (+ optional lending
///             double-stack via `wstEthAdapter`). Never touched on the hot path.
///           • **USDC operating float** — pays card settlements INSTANTLY with no swap / no pool / no same-block
///             liquidity dependency; the idle portion above `floatMinUsdc` earns USDC lending yield via
///             `usdcFloatAdapter`.
///           • **junior USDC buffer** — existing first-loss top-up.
///
///         **Hot path (`batchSettle`)** pays `totalUsdc` to the pinned rail straight from the float (unwinding
///         the float adapter best-effort if on-hand is short) → junior top-up on a residual shortfall → else
///         revert-and-retry. The rail is NEVER underpaid, and NO wstETH swap happens on this path.
///
///         **Async replenish (`rebalanceFloat`, onlyKeeper)** converts a slice of wstETH backing → USDC float
///         via the deep 2-hop `wstETH→ETH→USDC` route, oracle-bounded on the ETH/USDC leg + Lido-rate-bounded
///         on the wstETH/ETH leg + a `minUsdcOut` floor. It is additive to the treasury (backing→float, never
///         a payout) and bounded by its own per-call / windowed cap, so a rogue keeper can't churn the backing.
///
///         **Emergency valve (`batchSettleViaSwap`)** is the old inline-swap path, now 2-hop, for when the
///         float is exhausted: the same bounded 2-hop swap sources exactly `totalUsdc`, junior tops up any
///         bounded shortfall, and the pinned rail is paid in full or the tx reverts.
///
/// @dev    AUDITED PRIMITIVES CARRIED OVER VERBATIM from `MintwareEthSettlement` (do NOT lose these): the H4
///         pinned rail, the R2-M2 per-call + windowed settlement caps, the `minUsdcOut` catastrophe floor, the
///         junior first-loss top-up, and the oracle-bounded `_swapLimit`/`_sqrtAtClamped` swap. The ONLY new
///         surface is the operating float (hot path) and the second (`wstETH/ETH`) hop on the keeper/emergency
///         paths. Senior stays price-free: a settlement pays the rail a FIXED `totalUsdc` or reverts.
///
/// @dev    DECIMALS SCOPE — the USD valuation math (`totalBackingUsd`, the Lido/oracle price conversions)
///         assumes the wstETH / WETH / USDC test tokens are all 18-dp (as deployed with mocks on testnet).
///         Real-decimal handling (USDC 6-dp) is part of the post-audit wiring, together with the real
///         Lido / pool / adapter addresses — none of which are wired into a live deploy here.
contract MintwareTreasuryFloatSettlement is IUnlockCallback, MWGuardianPausable, ReentrancyGuard {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    uint256 private constant WAD = 1e18;
    uint256 private constant Q96 = 0x1000000000000000000000000; // 2**96

    // ── immutable wiring ─────────────────────────────────────────────────────────────
    IPoolManager public immutable poolManager;
    IERC20       public immutable wstEth;   // ETH-side collateral (a Lido LST — a rate, not a staking service)
    IERC20       public immutable weth;     // the ETH hop token
    IERC20       public immutable usdc;     // settlement asset (paid to the rail) + the operating float

    // Canonical wstETH/WETH pool ("stake pool" — the near-1:1 rate hop, deepest wstETH liquidity).
    PoolId  public immutable stakePoolId;
    bool    public immutable wstEthIsCurrency0Stake;
    Currency private immutable _s0; Currency private immutable _s1;
    uint24   private immutable _sFee; int24 private immutable _sSpacing; IHooks private immutable _sHooks;

    // Canonical ETH/USDC pool ("eth pool" — the manipulation-sensitive, oracle-bounded leg; deepest pair anywhere).
    PoolId  public immutable ethPoolId;
    bool    public immutable wethIsCurrency0Eth;
    Currency private immutable _e0; Currency private immutable _e1;
    uint24   private immutable _eFee; int24 private immutable _eSpacing; IHooks private immutable _eHooks;

    // ── roles ────────────────────────────────────────────────────────────────────────
    /// @notice The settlement role — the relayer that batches settling holds and pays the rail (hot + emergency).
    address public relayer;
    /// @notice The replenish role — DISTINCT from the relayer. Only converts backing→float; never a payout.
    address public keeper;

    // ── the three balances (tracked, on-hand) ─────────────────────────────────────────
    /// @notice On-hand USDC operating float (physical). The lent portion lives in `usdcFloatAdapter`; total
    ///         float value = `usdcFloat + usdcFloatAdapter.totalAssets()`.
    uint256 public usdcFloat;
    /// @notice On-hand wstETH backing (physical). The lent portion lives in `wstEthAdapter`; total backing
    ///         (wstETH units) = `wstEthBacking + wstEthAdapter.totalAssets()`.
    uint256 public wstEthBacking;
    /// @notice First-loss USDC reserve. Tops up a float/swap shortfall so the rail is paid in full.
    uint256 public juniorUsdcBuffer;

    // ── optional yield seams (safe-default OFF = address(0), just hold) ────────────────
    /// @notice Optional lending sink for idle USDC float above `floatMinUsdc`. `address(0)` ⇒ no lending.
    IYieldAdapter public usdcFloatAdapter;
    /// @notice Optional lending sink for idle wstETH backing (the double-stack). `address(0)` ⇒ no lending.
    IYieldAdapter public wstEthAdapter;

    // ── float sizing (bounded risk params — adopt the shared 48h timelock; see setters) ─
    /// @notice Target on-hand+lent float the keeper replenishes toward. Informational to the keeper.
    uint256 public floatTargetUsdc;
    /// @notice Working minimum on-hand float kept instantly liquid — sweeps to the float adapter may not push
    ///         on-hand below it. Settlements may still dip into it (then junior / emergency valve / retry).
    uint256 public floatMinUsdc;

    // ── oracle band (ETH/USDC leg) — carried from MintwareEthSettlement ────────────────
    int24 public bandTicks = 500;
    IOracleTickSource public oracleSource;
    bool public requireReadyOracle = true;

    /// @notice Tolerance (bps) the realized `wstETH→ETH` swap rate may fall below the Lido reference before the
    ///         leg reverts. Bounds the sandwich-able wstETH/ETH pool against the un-sandwich-able Lido rate.
    uint16 public lidoBandBps = 100; // 1%
    /// @notice The Lido wstETH-rate reference. `address(0)` ⇒ the wstETH/ETH leg is unbounded (bootstrap only).
    IWstEthRate public lidoRateSource;

    // ── H4 pinned rail + R2-M2 settlement caps (SHARED by batchSettle + batchSettleViaSwap) ─
    address public settlementRail;
    uint256 public juniorTopUpCapPerCall;
    uint256 public maxSettlePerCall;
    uint256 public maxSettlePerWindow;
    uint256 public settleWindow;
    uint256 private _settleWindowStart;
    uint256 private _settledInWindow;
    uint16  public minSettleOutBps;
    uint16  internal constant BPS = 10_000;

    // ── keeper rebalance caps (bound backing→float churn) ──────────────────────────────
    /// @notice Per-call ceiling on `wstEthIn` a single `rebalanceFloat` may convert (0 ⇒ off).
    uint256 public maxRebalancePerCall;
    /// @notice Cumulative wstETH a keeper may convert within a rolling `rebalanceWindow` (0 ⇒ off).
    uint256 public maxRebalancePerWindow;
    uint256 public rebalanceWindow;
    uint256 private _rebalWindowStart;
    uint256 private _rebalancedInWindow;

    /// @notice Extra wstETH (bps) the emergency valve converts above the reference size, so fees/slippage don't
    ///         leave the swap short of `totalUsdc` on a healthy market. Any overshoot lands back in the float
    ///         (additive, never a payout). Default 2%.
    uint16 public emergencySwapHeadroomBps = 200;

    // ── transient swap plumbing (set → unlock → clear in one call) ─────────────────────
    uint8   private constant OP_NONE = 0;
    uint8   private constant OP_REBALANCE = 1; // exact-input wstEthIn → USDC
    uint8   private constant OP_EMERGENCY = 2; // exact-output totalUsdc, sourced from wstETH
    uint8   private _op;
    uint256 private _swapArg;      // wstEthIn (rebalance) | totalUsdc (emergency)
    uint256 private _outUsdc;      // result: USDC produced
    uint256 private _outWstSpent;  // result: wstETH consumed

    // ── events ─────────────────────────────────────────────────────────────────────────
    event RelayerSet(address indexed relayer);
    event KeeperSet(address indexed keeper);
    event OracleSourceSet(address indexed source);
    event LidoRateSourceSet(address indexed source);
    event BandSet(int24 bandTicks);
    event LidoBandSet(uint16 bps);
    event RequireReadyOracleSet(bool required);
    event JuniorTopUpCapSet(uint256 cap);
    event SettlementRailSet(address indexed rail);
    event MaxSettlePerCallSet(uint256 cap);
    event SettlementWindowCapSet(uint256 cap, uint256 windowSecs);
    event MinSettleOutBpsSet(uint16 bps);
    event RebalanceCapsSet(uint256 perCall, uint256 perWindow, uint256 windowSecs);
    event EmergencyHeadroomSet(uint16 bps);
    event FloatParamsSet(uint256 target, uint256 min);
    event FloatAdapterSet(address indexed adapter);
    event WstEthAdapterSet(address indexed adapter);
    event WstEthBackingFunded(address indexed from, uint256 amount, uint256 onHand);
    event WstEthBackingWithdrawn(address indexed to, uint256 amount, uint256 onHand);
    event FloatFunded(address indexed from, uint256 amount, uint256 onHand);
    event FloatWithdrawn(address indexed to, uint256 amount, uint256 onHand);
    event JuniorBufferFunded(address indexed from, uint256 amount, uint256 total);
    event JuniorBufferWithdrawn(address indexed to, uint256 amount, uint256 total);
    event FloatSweptToAdapter(uint256 amount, uint256 onHand);
    event WstEthSweptToAdapter(uint256 amount, uint256 onHand);
    event SettledFromFloat(address indexed rail, uint256 totalUsdc, uint256 fromFloat, uint256 fromAdapter, uint256 juniorDrawn);
    event SettledViaSwap(address indexed rail, uint256 totalUsdc, uint256 usdcFromSwap, uint256 wstEthSpent, uint256 juniorDrawn);
    event FloatRebalanced(address indexed keeper, uint256 wstEthIn, uint256 usdcOut);

    // ── errors ─────────────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error NotWstEthWethPool();
    error NotWethUsdcPool();
    error OnlyRelayer();
    error OnlyKeeper();
    error OnlyPoolManager();
    error InsufficientBacking();
    error InsufficientFloat();
    error FloatBelowMin();
    error SettlementSlippageExceeded(uint256 produced, uint256 required);
    error FloatExhausted(uint256 available, uint256 required);
    error LidoRateFloorBreached(uint256 got, uint256 required);
    error OracleNotReady();
    error RailNotSet();
    error RailMismatch();
    error SettlementCapExceeded();
    error SettlementWindowCapExceeded();
    error RebalanceCapExceeded();
    error RebalanceWindowCapExceeded();
    error MinUsdcOutTooLow(uint256 supplied, uint256 required);
    error BadParam();

    modifier onlyRelayer() { if (msg.sender != relayer) revert OnlyRelayer(); _; }
    modifier onlyKeeper()  { if (msg.sender != keeper)  revert OnlyKeeper();  _; }

    /// @param pm         The V4 PoolManager.
    /// @param stakeKey   The canonical wstETH/WETH pool key (currencies must be exactly {wstEth_, weth_}).
    /// @param ethKey     The canonical WETH/USDC pool key (currencies must be exactly {weth_, usdc_}).
    /// @param wstEth_    ETH-side collateral (Lido LST).
    /// @param weth_      ETH hop token.
    /// @param usdc_      Settlement asset + operating float.
    /// @param owner_     Admin (roles, band, buffers, risk params).
    /// @param relayer_   Initial settlement role.
    /// @param keeper_    Initial replenish role.
    constructor(
        IPoolManager pm,
        PoolKey memory stakeKey,
        PoolKey memory ethKey,
        address wstEth_,
        address weth_,
        address usdc_,
        address owner_,
        address relayer_,
        address keeper_
    ) MWGuardianPausable(owner_) {
        if (wstEth_ == address(0) || weth_ == address(0) || usdc_ == address(0)) revert ZeroAddress();
        if (relayer_ == address(0) || keeper_ == address(0)) revert ZeroAddress();

        // Verify the stake pool is exactly {wstEth, weth}.
        {
            address c0 = Currency.unwrap(stakeKey.currency0);
            address c1 = Currency.unwrap(stakeKey.currency1);
            bool ok = (c0 == wstEth_ && c1 == weth_) || (c0 == weth_ && c1 == wstEth_);
            if (!ok) revert NotWstEthWethPool();
            wstEthIsCurrency0Stake = (c0 == wstEth_);
            stakePoolId = stakeKey.toId();
            _s0 = stakeKey.currency0; _s1 = stakeKey.currency1;
            _sFee = stakeKey.fee; _sSpacing = stakeKey.tickSpacing; _sHooks = stakeKey.hooks;
        }
        // Verify the eth pool is exactly {weth, usdc}.
        {
            address c0 = Currency.unwrap(ethKey.currency0);
            address c1 = Currency.unwrap(ethKey.currency1);
            bool ok = (c0 == weth_ && c1 == usdc_) || (c0 == usdc_ && c1 == weth_);
            if (!ok) revert NotWethUsdcPool();
            wethIsCurrency0Eth = (c0 == weth_);
            ethPoolId = ethKey.toId();
            _e0 = ethKey.currency0; _e1 = ethKey.currency1;
            _eFee = ethKey.fee; _eSpacing = ethKey.tickSpacing; _eHooks = ethKey.hooks;
        }

        poolManager = pm;
        wstEth = IERC20(wstEth_);
        weth   = IERC20(weth_);
        usdc   = IERC20(usdc_);

        relayer = relayer_; emit RelayerSet(relayer_);
        keeper  = keeper_;  emit KeeperSet(keeper_);
    }

    // ── admin: roles + oracle band ─────────────────────────────────────────────────────

    function setRelayer(address r) external onlyOwner { if (r == address(0)) revert ZeroAddress(); relayer = r; emit RelayerSet(r); }
    function setKeeper(address k)  external onlyOwner { if (k == address(0)) revert ZeroAddress(); keeper  = k; emit KeeperSet(k); }
    function setOracleSource(address s) external onlyOwner { oracleSource = IOracleTickSource(s); emit OracleSourceSet(s); }
    function setLidoRateSource(address s) external onlyOwner { lidoRateSource = IWstEthRate(s); emit LidoRateSourceSet(s); }

    function setBandTicks(int24 band) external onlyOwner { if (band <= 0) revert ZeroAmount(); bandTicks = band; emit BandSet(band); }
    function setLidoBandBps(uint16 bps) external onlyOwner { if (bps > BPS) revert BadParam(); lidoBandBps = bps; emit LidoBandSet(bps); }
    function setRequireReadyOracle(bool required) external onlyOwner { requireReadyOracle = required; emit RequireReadyOracleSet(required); }

    // ── admin: H4 pin + R2-M2 caps (shared) ────────────────────────────────────────────

    function setJuniorTopUpCapPerCall(uint256 cap) external onlyOwner { juniorTopUpCapPerCall = cap; emit JuniorTopUpCapSet(cap); }

    /// @notice AUDIT H4: pin (or re-point) the sole settlement destination. Set before enabling settlement.
    function setSettlementRail(address rail) external onlyOwner { if (rail == address(0)) revert ZeroAddress(); settlementRail = rail; emit SettlementRailSet(rail); }
    function setMaxSettlePerCall(uint256 cap) external onlyOwner { maxSettlePerCall = cap; emit MaxSettlePerCallSet(cap); }

    /// @notice AUDIT R2-M2: cumulative/windowed settlement ceiling (USDC) + rolling window (secs). Bounds TOTAL
    ///         extraction a runaway relayer can push through the pinned rail (hot + emergency), giving the
    ///         guardian time to pause.
    function setSettlementWindowCap(uint256 cap, uint256 windowSecs) external onlyOwner {
        if (cap != 0 && windowSecs == 0) revert BadParam();
        maxSettlePerWindow = cap; settleWindow = windowSecs;
        _settleWindowStart = block.timestamp; _settledInWindow = 0;
        emit SettlementWindowCapSet(cap, windowSecs);
    }

    /// @notice AUDIT R2-M2: require the emergency-swap `minUsdcOut` to be ≥ this fraction (bps) of `totalUsdc`.
    function setMinSettleOutBps(uint16 bps) external onlyOwner { if (bps > BPS) revert BadParam(); minSettleOutBps = bps; emit MinSettleOutBpsSet(bps); }

    /// @notice Bound backing→float churn: per-call + rolling-window wstETH ceilings for `rebalanceFloat`.
    function setRebalanceCaps(uint256 perCall, uint256 perWindow, uint256 windowSecs) external onlyOwner {
        if (perWindow != 0 && windowSecs == 0) revert BadParam();
        maxRebalancePerCall = perCall; maxRebalancePerWindow = perWindow; rebalanceWindow = windowSecs;
        _rebalWindowStart = block.timestamp; _rebalancedInWindow = 0;
        emit RebalanceCapsSet(perCall, perWindow, windowSecs);
    }

    /// @notice Set the emergency-valve conversion headroom (bps). Must be ≤ 100%.
    function setEmergencySwapHeadroomBps(uint16 bps) external onlyOwner { if (bps > BPS) revert BadParam(); emergencySwapHeadroomBps = bps; emit EmergencyHeadroomSet(bps); }

    /// @notice Bounded float-sizing risk params. NatSpec: adopt the shared 48h timelock (`MWTimelockedOracleSigner`
    ///         pattern) before mainnet — these gate how far a settlement may dip on-hand liquidity.
    function setFloatParams(uint256 target, uint256 min) external onlyOwner { floatTargetUsdc = target; floatMinUsdc = min; emit FloatParamsSet(target, min); }

    /// @notice Wire the optional USDC-float lending adapter (safe-default `address(0)` = no lending, just hold).
    ///         NatSpec: adopt the shared 48h timelock before mainnet.
    function setUsdcFloatAdapter(address a) external onlyOwner { usdcFloatAdapter = IYieldAdapter(a); emit FloatAdapterSet(a); }
    /// @notice Wire the optional wstETH double-stack lending adapter (safe-default `address(0)` = no lending).
    function setWstEthAdapter(address a) external onlyOwner { wstEthAdapter = IYieldAdapter(a); emit WstEthAdapterSet(a); }

    // ── funding / withdrawal (all three balances) ──────────────────────────────────────

    /// @notice Pull `amount` wstETH in as ETH-side backing (the vault funds this). Nominal credit (standard token).
    function fundWstEthBacking(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        wstEth.safeTransferFrom(msg.sender, address(this), amount);
        wstEthBacking += amount;
        emit WstEthBackingFunded(msg.sender, amount, wstEthBacking);
    }

    /// @notice Owner reclaims on-hand wstETH backing (wind-down). Cannot touch float or junior.
    function withdrawWstEthBacking(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > wstEthBacking) revert InsufficientBacking();
        wstEthBacking -= amount;
        wstEth.safeTransfer(to, amount);
        emit WstEthBackingWithdrawn(to, amount, wstEthBacking);
    }

    /// @notice Fund the USDC operating float.
    function fundFloat(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdcFloat += amount;
        emit FloatFunded(msg.sender, amount, usdcFloat);
    }

    /// @notice Owner reclaims on-hand USDC float (wind-down). Unwinds the float adapter best-effort if short.
    function withdrawFloat(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > usdcFloat) {
            _unwindFloatAdapter(amount - usdcFloat);
        }
        if (amount > usdcFloat) revert InsufficientFloat();
        usdcFloat -= amount;
        usdc.safeTransfer(to, amount);
        emit FloatWithdrawn(to, amount, usdcFloat);
    }

    /// @notice Fund the junior first-loss USDC buffer.
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

    // ── double-stack sweeps (idle balance → lending adapter) ────────────────────────────

    /// @notice Lend idle USDC float above `floatMinUsdc`. Keeps at least `floatMinUsdc` on-hand + instantly liquid.
    function sweepFloatToAdapter(uint256 amount) external onlyKeeper whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (address(usdcFloatAdapter) == address(0)) revert ZeroAddress();
        if (usdcFloat < amount || usdcFloat - amount < floatMinUsdc) revert FloatBelowMin();
        usdcFloat -= amount;
        usdc.forceApprove(address(usdcFloatAdapter), amount);
        usdcFloatAdapter.deposit(amount);
        emit FloatSweptToAdapter(amount, usdcFloat);
    }

    /// @notice Lend idle wstETH backing (the double-stack). onlyKeeper.
    function sweepWstEthToAdapter(uint256 amount) external onlyKeeper whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (address(wstEthAdapter) == address(0)) revert ZeroAddress();
        if (amount > wstEthBacking) revert InsufficientBacking();
        wstEthBacking -= amount;
        wstEth.forceApprove(address(wstEthAdapter), amount);
        wstEthAdapter.deposit(amount);
        emit WstEthSweptToAdapter(amount, wstEthBacking);
    }

    // ── HOT PATH: settle from the float, NO swap ───────────────────────────────────────

    /// @notice Pay `totalUsdc` to the pinned rail from the USDC operating float — instant, no swap, no pool.
    ///         Order on a shortfall: on-hand float → unwind the float adapter (best-effort) → junior top-up
    ///         (bounded) → else revert-and-retry (the keeper replenishes first). The rail is NEVER underpaid.
    /// @param totalUsdc USDC owed to the rail for this batch.
    /// @param rail      Must equal the pinned `settlementRail` (H4).
    /// @return fromFloat    USDC drawn from on-hand float.
    /// @return fromAdapter  USDC unwound from the float adapter.
    /// @return juniorDrawn  USDC drawn from the junior buffer.
    function batchSettle(uint256 totalUsdc, address rail)
        external
        onlyRelayer
        nonReentrant
        whenNotPaused
        returns (uint256 fromFloat, uint256 fromAdapter, uint256 juniorDrawn)
    {
        _settleGuards(totalUsdc, rail);

        uint256 remaining = totalUsdc;

        // (1) on-hand float
        fromFloat = usdcFloat < remaining ? usdcFloat : remaining;
        usdcFloat -= fromFloat;
        remaining -= fromFloat;

        // (2) unwind the float adapter best-effort
        if (remaining > 0 && address(usdcFloatAdapter) != address(0)) {
            uint256 pulled = _unwindFloatAdapterRaw(remaining);
            fromAdapter = pulled;
            remaining -= pulled; // pulled <= remaining by construction
        }

        // (3) junior first-loss top-up, bounded by the per-call cap
        if (remaining > 0) {
            uint256 cap = juniorTopUpCapPerCall == 0
                ? juniorUsdcBuffer
                : (juniorTopUpCapPerCall < juniorUsdcBuffer ? juniorTopUpCapPerCall : juniorUsdcBuffer);
            if (remaining > cap) revert FloatExhausted((totalUsdc - remaining) + cap, totalUsdc);
            juniorUsdcBuffer -= remaining;
            juniorDrawn = remaining;
            remaining = 0;
        }

        // (4) pay the PINNED rail in full
        usdc.safeTransfer(settlementRail, totalUsdc);
        emit SettledFromFloat(settlementRail, totalUsdc, fromFloat, fromAdapter, juniorDrawn);
    }

    // ── EMERGENCY VALVE: 2-hop bounded swap when the float is exhausted ─────────────────

    /// @notice Source exactly `totalUsdc` from wstETH backing via the bounded 2-hop `wstETH→ETH→USDC` swap, then
    ///         pay the pinned rail. For when the float is empty. The wstETH/ETH leg is Lido-rate-bounded, the
    ///         ETH/USDC leg is oracle-bounded, and the swap output must clear `minUsdcOut` before any junior draw.
    /// @param totalUsdc  USDC owed to the rail.
    /// @param minUsdcOut Catastrophe floor for the swap output (edge's conservative price × γ).
    /// @param rail       Must equal the pinned `settlementRail` (H4).
    function batchSettleViaSwap(uint256 totalUsdc, uint256 minUsdcOut, address rail)
        external
        onlyRelayer
        nonReentrant
        whenNotPaused
        returns (uint256 usdcFromSwap, uint256 wstEthSpent, uint256 juniorDrawn)
    {
        _settleGuards(totalUsdc, rail);

        // R2-M2: floor the relayer-supplied minUsdcOut at a fraction of totalUsdc.
        if (minSettleOutBps != 0) {
            uint256 required = (totalUsdc * minSettleOutBps) / BPS;
            if (minUsdcOut < required) revert MinUsdcOutTooLow(minUsdcOut, required);
        }
        // Fail closed: never fire an UNBOUNDED ETH/USDC leg in production.
        if (requireReadyOracle) { (, bool ready) = _oracle(); if (!ready) revert OracleNotReady(); }

        // Size the wstETH to convert from the oracle + Lido references (+ headroom for fees/slippage), capped
        // by available backing (unwinds the wstETH double-stack adapter best-effort if on-hand is short).
        uint256 wstIn = _wstEthForUsdc(totalUsdc);
        wstIn = wstIn * (BPS + emergencySwapHeadroomBps) / BPS;
        if (wstIn > wstEthBacking && address(wstEthAdapter) != address(0)) {
            uint256 got = wstEthAdapter.withdraw(wstIn - wstEthBacking);
            wstEthBacking += got;
        }
        if (wstIn > wstEthBacking) wstIn = wstEthBacking; // convert all we hold; junior covers any residual
        if (wstIn == 0) revert InsufficientBacking();

        _op = OP_EMERGENCY; _swapArg = wstIn; _outUsdc = 0; _outWstSpent = 0;
        poolManager.unlock("");
        usdcFromSwap = _outUsdc; wstEthSpent = _outWstSpent;
        _op = OP_NONE; _swapArg = 0; _outUsdc = 0; _outWstSpent = 0;

        // (1) Catastrophe floor: worse than the edge's modeled minimum → revert, don't burn junior.
        if (usdcFromSwap < minUsdcOut) revert SettlementSlippageExceeded(usdcFromSwap, minUsdcOut);

        // (2) Backing conservation: reduce by exactly the wstETH consumed (clamp donations, L4).
        wstEthBacking = wstEthSpent >= wstEthBacking ? 0 : wstEthBacking - wstEthSpent;

        if (usdcFromSwap >= totalUsdc) {
            // Overshoot (headroom) lands back in the float — additive, never a payout.
            uint256 excess = usdcFromSwap - totalUsdc;
            if (excess > 0) usdcFloat += excess;
        } else {
            // (3) Junior tops up the shortfall to totalUsdc, bounded by the per-call cap.
            uint256 shortfall = totalUsdc - usdcFromSwap;
            uint256 cap = juniorTopUpCapPerCall == 0
                ? juniorUsdcBuffer
                : (juniorTopUpCapPerCall < juniorUsdcBuffer ? juniorTopUpCapPerCall : juniorUsdcBuffer);
            if (shortfall > cap) revert SettlementSlippageExceeded(usdcFromSwap, totalUsdc);
            juniorUsdcBuffer -= shortfall;
            juniorDrawn = shortfall;
        }

        // (4) Pay the PINNED rail in full.
        usdc.safeTransfer(settlementRail, totalUsdc);
        emit SettledViaSwap(settlementRail, totalUsdc, usdcFromSwap, wstEthSpent, juniorDrawn);
    }

    // ── ASYNC REPLENISH: keeper converts backing → float ───────────────────────────────

    /// @notice Convert `wstEthIn` of backing into USDC float via the bounded 2-hop swap. Additive to the
    ///         treasury (backing→float) — never a payout, and the keeper cannot redirect anything. Bounded by
    ///         `maxRebalancePerCall` / `maxRebalancePerWindow` so a rogue keeper can't churn the backing.
    /// @param wstEthIn   wstETH to convert (from on-hand backing; unwinds the wstETH adapter if on-hand short).
    /// @param minUsdcOut Floor for the USDC produced (Lido/oracle-conservative × slippage headroom).
    function rebalanceFloat(uint256 wstEthIn, uint256 minUsdcOut)
        external
        onlyKeeper
        nonReentrant
        whenNotPaused
        returns (uint256 usdcOut)
    {
        if (wstEthIn == 0) revert ZeroAmount();
        if (maxRebalancePerCall != 0 && wstEthIn > maxRebalancePerCall) revert RebalanceCapExceeded();
        if (maxRebalancePerWindow != 0) {
            if (block.timestamp >= _rebalWindowStart + rebalanceWindow) { _rebalWindowStart = block.timestamp; _rebalancedInWindow = 0; }
            _rebalancedInWindow += wstEthIn;
            if (_rebalancedInWindow > maxRebalancePerWindow) revert RebalanceWindowCapExceeded();
        }
        if (requireReadyOracle) { (, bool ready) = _oracle(); if (!ready) revert OracleNotReady(); }

        // Source the wstETH on-hand (unwind the double-stack adapter best-effort if short).
        if (wstEthIn > wstEthBacking && address(wstEthAdapter) != address(0)) {
            uint256 need = wstEthIn - wstEthBacking;
            uint256 got = wstEthAdapter.withdraw(need);
            wstEthBacking += got;
        }
        if (wstEthIn > wstEthBacking) revert InsufficientBacking();

        _op = OP_REBALANCE; _swapArg = wstEthIn; _outUsdc = 0; _outWstSpent = 0;
        poolManager.unlock("");
        usdcOut = _outUsdc;
        _op = OP_NONE; _swapArg = 0; _outUsdc = 0; _outWstSpent = 0;

        if (usdcOut < minUsdcOut) revert SettlementSlippageExceeded(usdcOut, minUsdcOut);

        // backing → float (conserves value up to bounded swap slippage; never a payout).
        wstEthBacking -= wstEthIn;
        usdcFloat     += usdcOut;
        emit FloatRebalanced(msg.sender, wstEthIn, usdcOut);
    }

    // ── unlock callback: the 2-hop swap ────────────────────────────────────────────────

    function unlockCallback(bytes calldata) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        // Both the rebalance and the emergency valve execute the SAME bounded 2-hop exact-input swap
        // (`wstEthIn → WETH → USDC`); only the outer accounting differs (rebalance credits the float, the
        // emergency valve pays the rail + tops up junior). One code path = one thing to audit.
        if (_op == OP_REBALANCE || _op == OP_EMERGENCY) _do2HopExactIn(_swapArg);
        return "";
    }

    /// @dev The bounded 2-hop `wstETH→ETH→USDC` swap: exact-input `wstEthIn → WETH` (Lido-rate-bounded), then
    ///      exact-input `WETH → USDC` (oracle-bounded). Settled sequentially (leg1 produces WETH on-hand, leg2
    ///      consumes it) — no cross-pool net-delta arithmetic. Results land in `_outUsdc` / `_outWstSpent`.
    function _do2HopExactIn(uint256 wstEthIn) private {
        // Leg 1 (wstETH→ETH): sell wstETH for WETH, full-range limit → arithmetic Lido-rate floor after.
        uint256 wethMid = _swapExactIn(_stakeKey(), wstEthIsCurrency0Stake, wstEthIn);
        _enforceLidoFloor(wstEthIn, wethMid);
        _outWstSpent = wstEthIn;

        // Leg 2 (ETH→USDC): sell WETH for USDC, oracle-bounded (the manipulation-sensitive leg).
        if (wethMid > 0) {
            _outUsdc = _swapExactInBounded(_ethKey(), ethPoolId, wethIsCurrency0Eth, wethMid);
        }
    }

    // ── swap helpers ───────────────────────────────────────────────────────────────────

    /// @dev Exact-input swap, full-range price limit, settled sequentially; returns the output amount.
    function _swapExactIn(PoolKey memory key, bool zeroForOne, uint256 amountIn) private returns (uint256 out) {
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({ zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1 }),
            ""
        );
        out = _settleAndReturnOut(key, delta, zeroForOne);
    }

    /// @dev Exact-input swap, ORACLE-bounded price limit (the audited ETH/USDC leg), settled sequentially.
    function _swapExactInBounded(PoolKey memory key, PoolId id, bool zeroForOne, uint256 amountIn) private returns (uint256 out) {
        (uint160 cur,,,) = poolManager.getSlot0(id);
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({ zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: _swapLimit(zeroForOne, cur) }),
            ""
        );
        out = _settleAndReturnOut(key, delta, zeroForOne);
    }

    /// @dev Settle a single-pool swap delta (pay the input, take the output) and return the output amount.
    function _settleAndReturnOut(PoolKey memory key, BalanceDelta delta, bool zeroForOne) private returns (uint256 out) {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(key.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(key.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(key.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(key.currency1, address(this), uint256(uint128(d1)));
        // output is the currency we did NOT sell
        out = zeroForOne
            ? (d1 > 0 ? uint256(uint128(d1)) : 0)
            : (d0 > 0 ? uint256(uint128(d0)) : 0);
    }

    /// @dev The realized `wstETH→ETH` rate must be at least the Lido reference minus `lidoBandBps`. A sandwiched
    ///      wstETH/ETH pool (or a depeg) drops the realized rate below the floor → revert. `lidoRateSource == 0`
    ///      ⇒ no bound (bootstrap only).
    function _enforceLidoFloor(uint256 wstIn, uint256 wethOut) private view {
        // Skip the rate check on economically-meaningless dust (< 1e-12 wstETH), where integer + pool-fee
        // rounding dominates the ratio (e.g. a fully band-bound emergency that sources only wei of WETH).
        if (address(lidoRateSource) == address(0) || wstIn < 1e6) return;
        uint256 rate = lidoRateSource.stEthPerToken();            // WETH per wstETH, 1e18
        uint256 floorWeth = FullMath.mulDiv(wstIn, rate * (BPS - lidoBandBps) / BPS, WAD);
        if (wethOut < floorWeth) revert LidoRateFloorBreached(wethOut, floorWeth);
    }

    // ── oracle-bounded limit (carried from MintwareEthSettlement) ───────────────────────

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

    function _pay(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    // ── shared settlement guards (H4 pin + R2-M2 caps) ──────────────────────────────────

    function _settleGuards(uint256 totalUsdc, address rail) private {
        if (totalUsdc == 0) revert ZeroAmount();
        if (settlementRail == address(0)) revert RailNotSet();
        if (rail != settlementRail) revert RailMismatch();
        if (maxSettlePerCall != 0 && totalUsdc > maxSettlePerCall) revert SettlementCapExceeded();
        if (maxSettlePerWindow != 0) {
            if (block.timestamp >= _settleWindowStart + settleWindow) { _settleWindowStart = block.timestamp; _settledInWindow = 0; }
            _settledInWindow += totalUsdc;
            if (_settledInWindow > maxSettlePerWindow) revert SettlementWindowCapExceeded();
        }
    }

    // ── float-adapter unwind helpers ────────────────────────────────────────────────────

    /// @dev Pull up to `need` USDC from the float adapter and credit `usdcFloat`. Best-effort (never reverts
    ///      for liquidity). Used by `withdrawFloat`.
    function _unwindFloatAdapter(uint256 need) private {
        if (address(usdcFloatAdapter) == address(0) || need == 0) return;
        uint256 got = usdcFloatAdapter.withdraw(need);
        usdcFloat += got;
    }

    /// @dev Pull up to `need` USDC from the float adapter, return the amount pulled WITHOUT crediting
    ///      `usdcFloat` (the caller spends it directly). Best-effort.
    function _unwindFloatAdapterRaw(uint256 need) private returns (uint256 got) {
        got = usdcFloatAdapter.withdraw(need);
        if (got > need) got = need; // defensive; the caller only accounts up to `need`
    }

    // ── valuation / views ───────────────────────────────────────────────────────────────

    /// @notice Total USD backing = USDC float (on-hand + lent) + wstETH value in USDC + wstETH lent value.
    ///         wstETH is valued at the LESSER of the Lido redemption rate and the current pool spot rate, times
    ///         the truncated-oracle ETH/USD price — so a depeg (pool rate below Lido) LOWERS the reported
    ///         backing and it NEVER overstates what the treasury could realize. Fee-aware via the adapters'
    ///         own `totalAssets` (the fee-aware ERC-4626 adapter values NAV net of exit fees).
    function totalBackingUsd() public view returns (uint256) {
        uint256 floatUsd = usdcFloat;
        if (address(usdcFloatAdapter) != address(0)) floatUsd += usdcFloatAdapter.totalAssets();

        uint256 wstTotal = wstEthBacking;
        if (address(wstEthAdapter) != address(0)) wstTotal += wstEthAdapter.totalAssets();

        return floatUsd + _wstEthValueUsd(wstTotal);
    }

    /// @notice Convenience: `totalBackingUsd() + juniorUsdcBuffer` — the full solvency numerator.
    function coverageUsd() external view returns (uint256) { return totalBackingUsd() + juniorUsdcBuffer; }

    /// @dev wstETH → USDC value at the CONSERVATIVE effective rate (min of Lido + pool spot) × oracle ETH/USD.
    function _wstEthValueUsd(uint256 wstAmount) private view returns (uint256) {
        if (wstAmount == 0) return 0;
        uint256 effEthPerWst = _effEthPerWst();     // WETH per wstETH, 1e18
        uint256 ethUsd       = _oracleEthUsd();     // USDC per WETH, 1e18
        if (effEthPerWst == 0 || ethUsd == 0) return 0; // no reference ⇒ don't overstate (value 0)
        uint256 ethValue = FullMath.mulDiv(wstAmount, effEthPerWst, WAD); // in WETH units
        return FullMath.mulDiv(ethValue, ethUsd, WAD);                    // in USDC units
    }

    /// @dev The conservative WETH-per-wstETH rate: min(Lido redemption rate, current pool spot). Depeg-aware.
    function _effEthPerWst() private view returns (uint256) {
        uint256 lido = address(lidoRateSource) != address(0) ? lidoRateSource.stEthPerToken() : 0;
        uint256 spot = _stakeSpotRate();
        if (lido == 0) return spot;
        if (spot == 0) return lido;
        return lido < spot ? lido : spot;
    }

    /// @dev WETH-per-wstETH implied by the stake pool's current sqrtPrice (1e18).
    function _stakeSpotRate() private view returns (uint256) {
        (uint160 sp,,,) = poolManager.getSlot0(stakePoolId);
        if (sp == 0) return 0;
        uint256 priceC1PerC0 = _priceFromSqrt(sp); // currency1 per currency0, 1e18
        // rate = WETH per wstETH
        if (wstEthIsCurrency0Stake) return priceC1PerC0;          // c1=WETH per c0=wstETH
        return priceC1PerC0 == 0 ? 0 : FullMath.mulDiv(WAD, WAD, priceC1PerC0); // invert
    }

    /// @dev USDC-per-WETH from the TRUNCATED ORACLE tick (manipulation-resistant), 1e18. Spot is not used here.
    function _oracleEthUsd() private view returns (uint256) {
        (int24 oTick, bool ready) = _oracle();
        if (!ready) return 0;
        uint160 sp = _sqrtAtClamped(int256(oTick));
        uint256 priceC1PerC0 = _priceFromSqrt(sp); // currency1 per currency0 of the ETH/USDC pool, 1e18
        if (wethIsCurrency0Eth) return priceC1PerC0;               // c1=USDC per c0=WETH
        return priceC1PerC0 == 0 ? 0 : FullMath.mulDiv(WAD, WAD, priceC1PerC0); // invert
    }

    /// @dev price (currency1 per currency0), 1e18, from sqrtPriceX96. (sqrtP/2^96)^2 × 1e18.
    function _priceFromSqrt(uint160 sqrtP) private pure returns (uint256) {
        uint256 a = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), Q96); // price × 2^96
        return FullMath.mulDiv(a, WAD, Q96);                             // price × 1e18
    }

    // ── pool-key / currency plumbing ────────────────────────────────────────────────────

    function _stakeKey() private view returns (PoolKey memory) {
        return PoolKey({currency0: _s0, currency1: _s1, fee: _sFee, tickSpacing: _sSpacing, hooks: _sHooks});
    }
    function _ethKey() private view returns (PoolKey memory) {
        return PoolKey({currency0: _e0, currency1: _e1, fee: _eFee, tickSpacing: _eSpacing, hooks: _eHooks});
    }

    /// @dev wstETH needed to realize `usdcAmount`, at the conservative Lido/oracle references (pre-headroom).
    ///      Reverts if a reference is missing (can't size an emergency swap without a price/rate).
    function _wstEthForUsdc(uint256 usdcAmount) private view returns (uint256) {
        uint256 ethUsd = _oracleEthUsd();  // USDC per WETH, 1e18
        uint256 eff    = _effEthPerWst();  // WETH per wstETH, 1e18
        if (ethUsd == 0 || eff == 0) revert OracleNotReady();
        uint256 wethNeeded = FullMath.mulDiv(usdcAmount, WAD, ethUsd); // WETH for the USDC
        return FullMath.mulDiv(wethNeeded, WAD, eff);                  // wstETH for the WETH
    }
}
