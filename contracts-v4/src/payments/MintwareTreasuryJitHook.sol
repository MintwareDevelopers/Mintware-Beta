// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}                 from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager}           from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}        from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}                from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary}  from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}               from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}           from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams}       from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks}                  from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath}               from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}           from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}           from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {MWOracleGuard}          from "../hooks/MWOracleGuard.sol";
import {MWDynamicFee}           from "../hooks/MWDynamicFee.sol";
import {LiquidityAmounts}       from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}   from "@openzeppelin/contracts/access/Ownable.sol";

import {MWTimelockedRiskParams} from "../lib/MWTimelockedRiskParams.sol";

/// @dev The minimal vault surface the hook drives — the borrow-seam (increment 1).
interface IJitVault {
    function borrowIdleForJit(uint256 want) external returns (uint256 lent);
    function settleJitReturn(uint256 usdcReturned) external;
    /// @dev AUDIT R2-H2: read the outstanding par-counted JIT slice so the keeper sweep can reconcile a
    ///      strand (physical drained but nothing converted) instead of leaving it outstanding forever.
    function jitBorrowed() external view returns (uint256);
}

/// @title  MintwareTreasuryJitHook
/// @notice The real Uniswap-V4 JIT hook for the treasury-anchored ULV (#5, option C). On a swap that
///         BUYS USDC (team→USDC), it borrows a bounded slice of senior idle USDC from the vault
///         (`borrowIdleForJit`) and opens a tight single-sided USDC position for that ONE swap, capturing
///         the extra fee; then closes it and, once the swap has settled, converts the proceeds back to
///         USDC and returns them (`settleJitReturn`). Price-free (no oracle); the vault caps the slice and
///         the junior backstops the close cost.
///
/// @dev    THE afterSwap GOTCHA. The swapper settles their team token AFTER `afterSwap`, so during the
///         callback the PoolManager doesn't hold it yet — the hook can't `take()` what the closed position
///         owes it. So `afterSwap` MINTS ERC-6909 claims for the owed amounts and returns; a later keeper
///         `sweepJit()` (post-settlement) redeems the claims, swaps team→USDC, and settles with the vault.
///         Between the two phases the vault's `jitBorrowed` stays outstanding at par (senior NAV held).
///
/// @dev    Single pool / single vault. Permissioned callbacks: `beforeInitialize` + `beforeSwap` +
///         `afterSwap` (address flags 0x20C0). The hook returns ZERO delta on every path — it only ever
///         overrides the LP fee (which needs no `beforeSwapReturnDelta` bit). The am-AMM manager-fee skim
///         (which had required that bit) was shelved off this hook; `MWAmAuction`/`MWAmAuctionLib` remain
///         standalone for a future opt-in upgrade. The module's full-range liquidity (salt 0) and the JIT
///         position (JIT_SALT) coexist in the pool without any liquidity-callback. V4 auto-skips these
///         callbacks for the hook's OWN swap (`msg.sender == self`), so the sweep's team→USDC swap needs
///         no reentrancy guard.
contract MintwareTreasuryJitHook is IHooks, IUnlockCallback, Ownable, MWTimelockedRiskParams {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;
    using MWOracleGuard for MWOracleGuard.State;

    IPoolManager public immutable poolManager;
    IJitVault    public immutable vault;
    IERC20       public immutable usdc;
    IERC20       public immutable teamToken;

    Currency private immutable _c0;
    Currency private immutable _c1;
    uint24   private immutable _fee;
    int24    private immutable _tickSpacing;
    bool     public  immutable usdcIsCurrency0;

    /// @notice AUDIT (Cork class): the ONE pool this hook serves. `beforeSwap`/`afterSwap` are gated to
    ///         it — anyone can initialize a *different* pool that names this hook and swap on it, which
    ///         would otherwise drive `_open`/`borrowIdleForJit` against an attacker-chosen PoolKey and
    ///         deploy senior USDC into an attacker pool. Mismatched keys no-op (never revert the swap).
    PoolId public immutable canonicalPoolId;

    bytes32 private constant JIT_SALT = bytes32(uint256(0x314));

    // ── governed risk-parameter id + bounds (legal 48h-timelock rail) ──────────────────────────────
    // The truncated-oracle clamp is the ONE senior-solvency-relevant knob on this hook: the vault values its
    // position at `min(spot, oracle)` and the settlement swap bounds against this oracle, so LOOSENING the
    // clamp weakens manipulation resistance for the whole stack. It therefore routes through the 48h timelock
    // (risk-increasing = looser clamp); tightening is instant; instant before the oracle's first swap
    // (bootstrap). The pure fee/MEV levers below are NOT governed here — they are bounded ≤ MAX_LP_FEE, can
    // never brick a swap or touch principal, and are explicitly "bonus, not solvency"; ops must tune them
    // responsively, so a 48h delay on a fee tweak would be counter-productive.
    bytes32 public constant RP_ORACLE_PARAMS       = keccak256("MintwareTreasuryJitHook.oracleParams");
    int24   public constant MAX_ORACLE_MOVE_TICKS  = 2_000;   // fat-finger ceiling on the per-block move clamp
    uint32  public constant MAX_ORACLE_CATCHUP     = 7_200;   // fat-finger ceiling on the catch-up block cap

    /// @notice Minimum |amountSpecified| for JIT to fire (size gate; skip dust swaps).
    uint256 public jitThreshold;
    /// @notice JIT range width, in tickSpacings, to one side of the live tick.
    int24 public jitWidthSpacings = 3;
    /// @notice Swaps initiated by this address never fire JIT — set to the LP module, whose own
    ///         recover/collect swaps must NOT recursively borrow + open a JIT position.
    address public jitSkipSender;

    /// @notice AUDIT (#7/#3): a truncated tick oracle over the canonical pool. Advanced once per block in
    ///         `afterSwap` and clamped to `maxTickMovePerBlock` — so a same-tx / single-block spot push
    ///         (a flash manipulation) can move it by at most that clamp. The LP module values the position
    ///         at `min(spot, oracle)` (conservative), and the unwind swaps bound `minAmountOut` off it, so
    ///         neither the solvency floor nor the sweep can be gamed by moving spot within the tx.
    MWOracleGuard.State private _oracle;

    // ── deviation-scaled dynamic-fee lever (YPN MEV engine — Phase 1, increment 1) ──────────────
    /// @notice The pool is initialized with `LPFeeLibrary.DYNAMIC_FEE_FLAG`, so `beforeSwap` returns a
    ///         per-swap LP-fee override (`fee | OVERRIDE_FEE_FLAG`). The fee scales with the swap's
    ///         DEVIATION from the truncated oracle (via `MWDynamicFee.volatilityFee`): mean-reverting
    ///         retail pays the floor `baseFeePips`, while a toxic/arb-sized print that moves price pays
    ///         more — capped at `maxFeePips` (≤ `MAX_LP_FEE`). Oracle-free in the sense the plan requires:
    ///         `deviationTicks` returns 0 before the oracle is ready and `volatilityFee` clamps to the
    ///         ceiling, so the fee path is pure + clamped and CANNOT revert a swap (the Bunni-class bar).
    ///         The captured fee accrues to the vault's existing LP position → senior/junior fee split.
    uint24  public baseFeePips = 3000;       // floor fee (0.30%)
    uint24  public maxFeePips  = 50_000;     // ceiling fee (5%); always ≤ MAX_LP_FEE
    uint256 public slopePipsPerTick = 100;   // pips added per tick of |spot − oracle| (linear term)
    /// @notice Quadratic term (increment 3): pips added per tick² of deviation, so toxic/arb-sized prints
    ///         pay SUPER-linearly while retail pays ≈ the floor. 0 ⇒ pure linear (the default — inc1/inc2
    ///         behavior is unchanged until ops raises this). The base fee is `base + slope·dev + quad·dev²`.
    uint256 public quadMultiplierPipsPerTickSq;
    /// @notice Optional per-block fee-move budget for `MWDynamicFee.rateLimit` (0 ⇒ rate-limit OFF, the
    ///         default: fee is the pure clamped deviation curve). When set, a single block can move the
    ///         override by at most `maxFeeStepPerBlock × blocksElapsed` — blunting predictable-hike MEV.
    uint256 public maxFeeStepPerBlock;
    uint24  private _lastFeePips;             // last override applied (rate-limit anchor)
    uint32  private _lastFeeBlock;            // block of `_lastFeePips`
    /// @notice Diamond-LVR lever (increment 4, opt-in, default OFF). A DIRECTIONAL surcharge added on top of
    ///         the deviation curve, charged ONLY on the swap that closes spot toward the truncated oracle —
    ///         the arb that realizes LVR against LPs. Benign flow that widens the gap (the uninformed flow
    ///         LPs earn on) is never surcharged. Fattest on THIN community pools (this hook's core). Off by
    ///         default (`lvrEnabled=false`); the surcharge is clamped to `maxFeePips` so it can't brick a swap.
    uint256 public lvrSlopePipsPerTick;           // pips of LVR surcharge per captured tick
    uint256 public lvrQuadMultiplierPipsPerTickSq; // convex term per captured tick² (0 ⇒ linear)
    bool    public lvrEnabled;

    // ── surge-floor lever (YPN MEV engine — Phase 1, increment 2) ────────────────────────────────
    /// @notice A time-decaying fee FLOOR taken as `max(baseCurve, surge)` in `_dynamicFee`. It is ARMED
    ///         the instant we reposition liquidity (a JIT open) or ops signals a backing-NAV move
    ///         (`armSurge`), spikes to `maxSurgeFeePips`, and decays over `surgeHalfLifeSecs`
    ///         (`MWDynamicFee.surgeFee`, ≈ `2^(−Δt/halfLife)`). It is the explicit anti-sandwich / anti-
    ///         stale clamp: a sandwich's front+back legs sit in the SAME block as our reposition, so both
    ///         pay the full surge. It only ever RAISES the fee (→ strictly helps senior/junior backing) and
    ///         is deliberately NOT rate-limited (the rate limiter is for the predictable base curve).
    ///         OFF by default (`surgeHalfLifeSecs = 0`) — ships dark; ops enables it via `setSurgeParams`.
    uint24  public maxSurgeFeePips   = 50_000; // surge ceiling (5%); bounded ≤ MAX_LP_FEE. Cosmetic until armed.
    uint256 public surgeHalfLifeSecs;          // 0 ⇒ surge OFF (default). Set > 0 (≤ 365d) to enable.
    uint32  private _lastSurgeTs;              // block.timestamp the surge was last armed (0 ⇒ never)

    // ── MEV-tax lever (YPN MEV engine — Phase 2) ────────────────────────────────────────────────
    /// @notice An ADDITIVE fee component proportional to the swap's revealed priority-fee bid:
    ///         `min(mevTaxK · priorityFeeGwei, mevTaxCapPips)`, added on top of `max(base, surge)` and
    ///         clamped to `MAX_LP_FEE`. Under Base's priority ordering a searcher arbing us must reveal its
    ///         edge through a higher priority fee → we recapture it to the vault. Oracle-free. OFF by default
    ///         (`mevTaxK = 0`); per-chain opt-in via `setMevTax`.
    /// @dev    ⚠ BASE-ONLY / SOFT GUARANTEE. This leans on the (centralized Base) sequencer honoring priority
    ///         ordering — NOT a cryptographic guarantee, and it does NOT hold under L1 builder auctions. Treat
    ///         captured MEV-tax as BONUS revenue, never core solvency; size `mevTaxK` conservatively.
    uint256 public mevTaxK;                     // pips of fee per gwei of priority fee (0 ⇒ tax OFF, default)
    uint24  public mevTaxCapPips = 50_000;      // max tax contribution (5%); bounded ≤ MAX_LP_FEE. Cosmetic until k>0.

    // ── am-AMM (SHELVED off this hook) ────────────────────────────────────────────────────────────
    // The am-AMM manager-fee skim was the ONLY writer of a non-zero BeforeSwapDelta and the sole reason the
    // hook carried the `beforeSwapReturnDelta` bit. It has been unwired from this JIT hook (decided shelf):
    // the hook now returns ZERO delta on every path and drops the delta bit (flags 0x20C8 → 0x20C0), making
    // it smaller and audit/allowlist-friendlier. `MWAmAuction.sol` + `MWAmAuctionLib.sol` remain as
    // standalone contracts for a future opt-in upgrade — they are simply no longer referenced here.

    // ── per-swap open state (0 between swaps) ──────────────────────────────────
    uint128 private jitLiquidity;
    int24   private jitLower;
    int24   private jitUpper;

    // ── proceeds accumulated across swaps, awaiting the keeper sweep ────────────
    /// @notice ERC-6909 claims minted in afterSwap for the closed position's owed tokens.
    uint256 public usdcClaim;
    uint256 public teamClaim;

    event JitOpened(uint256 lent, uint128 liquidity);
    event JitClosed(uint256 usdcClaimed, uint256 teamClaimed);
    event JitSwept(uint256 usdcReturned);
    event JitThresholdSet(uint256 threshold);
    event JitWidthSet(int24 spacings);
    event OracleParamsSet(int24 maxMovePerBlock, uint32 maxCatchupBlocks);
    event BaseFeeSet(uint24 baseFeePips);
    event LvrSet(uint256 slopePipsPerTick, uint256 quadMultiplierPipsPerTickSq, bool enabled);
    event MaxFeeSet(uint24 maxFeePips);
    event FeeSlopeSet(uint256 slopePipsPerTick);
    event QuadMultiplierSet(uint256 quadMultiplierPipsPerTickSq);
    event MaxFeeStepSet(uint256 maxFeeStepPerBlock);
    event SurgeParamsSet(uint24 maxSurgeFeePips, uint256 halfLifeSecs);
    event SurgeArmed(uint32 ts);
    event MevTaxSet(uint256 k, uint24 capPips);

    error OnlyPoolManager();
    error UnauthorizedInitializer();
    error FeeParam();
    error NotArmer();
    error BadParam();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    constructor(address poolManager_, PoolKey memory key, address usdc_, address vault_, address owner_)
        Ownable(owner_)
    {
        poolManager = IPoolManager(poolManager_);
        vault       = IJitVault(vault_);
        _c0 = key.currency0;
        _c1 = key.currency1;
        _fee = key.fee;
        _tickSpacing = key.tickSpacing;
        // The canonical pool always names THIS hook (hooks = address(this)); compute its id from that,
        // not from the passed key.hooks (which is unset/placeholder pre-CREATE2 deploy).
        canonicalPoolId = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: IHooks(address(this))
        }).toId();

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool isC0 = (usdc_ == c0);
        require(isC0 || usdc_ == c1, "usdc not in pool");
        usdcIsCurrency0 = isC0;
        usdc      = IERC20(usdc_);
        teamToken = IERC20(isC0 ? c1 : c0);

        // Oracle defaults: ~2% (200 ticks) max per-block move, catching up over <=30 blocks. Owner-tunable.
        _oracle.maxTickMovePerBlock = 200;
        _oracle.maxCatchupBlocks    = 30;

        // Address must carry exactly the beforeInitialize|beforeSwap|afterSwap permission bits
        // (0x20C0, mined CREATE2). No `beforeSwapReturnDelta`: the hook returns ZERO delta always
        // (am-AMM skim shelved off this hook), so it does not need the delta bit.
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true, afterInitialize: false,
                beforeAddLiquidity: false, afterAddLiquidity: false,
                beforeRemoveLiquidity: false, afterRemoveLiquidity: false,
                beforeSwap: true, afterSwap: true,
                beforeDonate: false, afterDonate: false,
                beforeSwapReturnDelta: false, afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ── admin ──────────────────────────────────────────────────────────────────
    function setJitThreshold(uint256 t) external onlyOwner { jitThreshold = t; emit JitThresholdSet(t); }
    function setJitWidth(int24 s) external onlyOwner { require(s > 0, "width"); jitWidthSpacings = s; emit JitWidthSet(s); }
    /// @notice Exempt an initiator (the LP module) from firing JIT on its own swaps.
    function setJitSkipSender(address s) external onlyOwner { jitSkipSender = s; }

    /// @notice Governed (48h-timelocked) risk param — the truncated oracle's max per-block tick move
    ///         (manipulation clamp) + catch-up cap. RAISING either value tracks spot faster → weaker
    ///         manipulation resistance for the vault NAV floor + settlement band (risk-increasing →
    ///         timelocked); LOWERING both (safety) is instant. Instant before the oracle's first swap
    ///         (bootstrap). Bounded (0, MAX_ORACLE_MOVE_TICKS] / ≤ MAX_ORACLE_CATCHUP at propose time.
    function setOracleParams(int24 maxMovePerBlock, uint32 maxCatchupBlocks) external onlyOwner {
        _changeRiskParam(RP_ORACLE_PARAMS, uint256(uint24(maxMovePerBlock)), uint256(maxCatchupBlocks));
    }

    /// @notice Confirm a 48h-timelocked risk-parameter change once its delay has elapsed. `param` is `RP_*`.
    function confirmRiskParam(bytes32 param) external onlyOwner { _confirmRiskParam(param); }

    /// @notice Cancel a pending (not-yet-confirmed) risk-parameter change — abort a rogue/superseded proposal.
    function cancelRiskParam(bytes32 param) external onlyOwner { _cancelRiskParam(param); }

    // ── MWTimelockedRiskParams hooks ───────────────────────────────────────────────────────────────

    /// @dev "Live" (timelock binds) once the truncated oracle has seen its first swap; before that the
    ///      clamp isn't yet protecting anything, so bootstrap sets are instant (first-set-immediate).
    function _riskParamsLive() internal view override returns (bool) {
        return _oracle.initialized;
    }

    function _validateRiskParam(bytes32 param, uint256 v, uint256 v2) internal pure override {
        if (param != RP_ORACLE_PARAMS) revert BadParam();
        if (v == 0 || v > uint256(uint24(MAX_ORACLE_MOVE_TICKS))) revert BadParam();
        if (v2 > MAX_ORACLE_CATCHUP) revert BadParam();
    }

    function _readRiskParam(bytes32 param) internal view override returns (uint256) {
        if (param != RP_ORACLE_PARAMS) revert BadParam();
        return uint256(uint24(_oracle.maxTickMovePerBlock));
    }

    function _writeRiskParam(bytes32 param, uint256 v, uint256 v2) internal override {
        if (param != RP_ORACLE_PARAMS) revert BadParam();
        _oracle.maxTickMovePerBlock = int24(uint24(v));
        _oracle.maxCatchupBlocks    = uint32(v2);
        emit OracleParamsSet(int24(uint24(v)), uint32(v2));
    }

    /// @dev Instant before the oracle is live, else instant only when BOTH the move clamp and the catch-up
    ///      cap are TIGHTENED (not-increased) — raising either loosens manipulation resistance.
    function _riskParamInstant(bytes32, uint256 v, uint256 v2) internal view override returns (bool) {
        if (!_oracle.initialized) return true; // first-set-immediate (pre-first-swap bootstrap)
        return v <= uint256(uint24(_oracle.maxTickMovePerBlock)) && v2 <= uint256(_oracle.maxCatchupBlocks);
    }

    // ── dynamic-fee lever tuning (owner-gated, bounded so the fee path can never exceed MAX_LP_FEE) ──
    /// @notice Set the floor fee. Must not exceed the ceiling (`maxFeePips`).
    function setBaseFeePips(uint24 v) external onlyOwner {
        if (v > maxFeePips) revert FeeParam();
        baseFeePips = v;
        emit BaseFeeSet(v);
    }
    /// @notice Set the ceiling fee. Must be ≥ the floor and ≤ V4's `MAX_LP_FEE` (100%).
    function setMaxFeePips(uint24 v) external onlyOwner {
        if (v < baseFeePips || v > LPFeeLibrary.MAX_LP_FEE) revert FeeParam();
        maxFeePips = v;
        emit MaxFeeSet(v);
    }
    /// @notice Set the per-tick slope (linear term). Bounded to `MAX_LP_FEE` per tick (overflow-safe; the
    ///         fee is clamped).
    function setSlopePipsPerTick(uint256 v) external onlyOwner {
        if (v > LPFeeLibrary.MAX_LP_FEE) revert FeeParam();
        slopePipsPerTick = v;
        emit FeeSlopeSet(v);
    }
    /// @notice Set the per-tick² quadratic multiplier (increment 3). Bounded to `MAX_LP_FEE` so
    ///         `quad·dev²` (dev tick-bounded ≤ ~1.77e6) stays overflow-safe on the fee path. 0 ⇒ pure linear.
    function setQuadMultiplier(uint256 v) external onlyOwner {
        if (v > LPFeeLibrary.MAX_LP_FEE) revert FeeParam();
        quadMultiplierPipsPerTickSq = v;
        emit QuadMultiplierSet(v);
    }
    /// @notice Set the per-block fee-move budget for the rate limiter (0 ⇒ off).
    function setMaxFeeStepPerBlock(uint256 v) external onlyOwner {
        maxFeeStepPerBlock = v;
        emit MaxFeeStepSet(v);
    }

    // ── surge-floor tuning + arming ──────────────────────────────────────────────────────────────
    /// @notice Configure the surge floor. `halfLifeSecs == 0` disables it (the default). Bounded so the
    ///         fee path can never overflow or exceed V4's cap: `maxPips ≤ MAX_LP_FEE` and
    ///         `halfLifeSecs ≤ 365 days` (real half-lives are seconds–minutes; the bound only guards the
    ///         `MWDynamicFee.surgeFee` multiplication).
    function setSurgeParams(uint24 maxPips, uint256 halfLifeSecs) external onlyOwner {
        if (maxPips > LPFeeLibrary.MAX_LP_FEE || halfLifeSecs > 365 days) revert FeeParam();
        maxSurgeFeePips  = maxPips;
        surgeHalfLifeSecs = halfLifeSecs;
        emit SurgeParamsSet(maxPips, halfLifeSecs);
    }

    /// @notice Arm the surge floor NOW (spike to `maxSurgeFeePips`, then decay). Gated to the vault (for a
    ///         backing-NAV move / main-LP reposition) and the owner (ops/keeper). Not attacker-callable, so
    ///         it can't be used to grief traders with a stuck-high fee. No-op effect while the surge is
    ///         disabled (`surgeHalfLifeSecs == 0`), but still records the timestamp so enabling it later
    ///         starts from a fresh arm.
    function armSurge() external {
        if (msg.sender != address(vault) && msg.sender != owner()) revert NotArmer();
        _armSurge();
    }

    function _armSurge() private {
        _lastSurgeTs = uint32(block.timestamp);
        emit SurgeArmed(_lastSurgeTs);
    }

    /// @notice Configure the MEV-tax (Phase 2). `k == 0` disables it (the default). `capPips ≤ MAX_LP_FEE`;
    ///         `k` needs no bound (the `mevTaxPips` saturation is overflow-safe for any k). ⚠ Base-only /
    ///         soft-sequencer-trust — enable per chain, size `k` conservatively (see the field NatSpec).
    function setMevTax(uint256 k, uint24 capPips) external onlyOwner {
        if (capPips > LPFeeLibrary.MAX_LP_FEE) revert FeeParam();
        mevTaxK       = k;
        mevTaxCapPips = capPips;
        emit MevTaxSet(k, capPips);
    }

    // ── IHooks: the two active callbacks ────────────────────────────────────────

    /// @notice On a team→USDC swap (output = USDC), borrow a bounded slice + open a tight single-sided
    ///         USDC position. Never reverts the swap path (a revert would brick the pool).
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        // AUDIT (Cork class): only ever act on the canonical pool. A swap on any other pool that names
        // this hook no-ops (never reverts — a revert would brick that pool for its users).
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(canonicalPoolId)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        bool usdcIsOutput = params.zeroForOne ? !usdcIsCurrency0 : usdcIsCurrency0;
        uint256 mag = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);

        if (usdcIsOutput && mag >= jitThreshold && sender != jitSkipSender) {
            _open(key, params.zeroForOne, mag);
        }
        // Deviation-scaled dynamic-fee override for THIS swap (canonical pool only). Pure + clamped —
        // never reverts; ignored by V4 unless the pool carries DYNAMIC_FEE_FLAG.
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, _dynamicFee(key, params.zeroForOne));
    }

    /// @notice Set the Diamond-LVR lever (opt-in, default OFF). Directional surcharge on the gap-closing
    ///         (arb) swap direction only. Bound `slope`/`quad` ≤ 1_000_000 (MWDynamicFee.MAX_PIPS); the
    ///         applied fee is always clamped to `maxFeePips`, so `fee ≤ MAX_LP_FEE` is preserved.
    function setLvr(uint256 lvrSlope, uint256 lvrQuad, bool enabled) external onlyOwner {
        lvrSlopePipsPerTick = lvrSlope;
        lvrQuadMultiplierPipsPerTickSq = lvrQuad;
        lvrEnabled = enabled;
        emit LvrSet(lvrSlope, lvrQuad, enabled);
    }

    /// @notice The LP-fee override for the canonical pool: `volatilityFee(base, max, deviation, slope)`,
    ///         optionally rate-limited per block, tagged with `OVERRIDE_FEE_FLAG`. Reads only the live
    ///         tick + the truncated oracle (both revert-free); the result is clamped to `maxFeePips`, so
    ///         no input can brick the swap. `zeroForOne` feeds the Diamond-LVR directional surcharge.
    function _dynamicFee(PoolKey calldata key, bool zeroForOne) private returns (uint24) {
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        uint256 dev = _oracle.deviationTicks(tick);
        uint24 fee = MWDynamicFee.volatilityFeeQuad(baseFeePips, maxFeePips, dev, slopePipsPerTick, quadMultiplierPipsPerTickSq);
        // Diamond-LVR (increment 4): directional surcharge on the arb (gap-closing) direction only. `dev != 0`
        // ⇒ the oracle is initialized. Arb: spot ABOVE oracle & selling down, or spot BELOW & buying up.
        if (lvrEnabled && dev != 0) {
            int24 oTick = _oracle.oracleTick;
            bool arb = (tick > oTick && zeroForOne) || (tick < oTick && !zeroForOne);
            if (arb) {
                uint256 t = uint256(fee)
                    + MWDynamicFee.lvrSurchargePips(dev, lvrSlopePipsPerTick, lvrQuadMultiplierPipsPerTickSq, maxFeePips);
                fee = t > maxFeePips ? maxFeePips : uint24(t);
            }
        }
        uint256 step = maxFeeStepPerBlock;
        if (step != 0) {
            uint256 elapsed = block.number > _lastFeeBlock ? block.number - _lastFeeBlock : 0;
            fee = MWDynamicFee.rateLimit(_lastFeePips, fee, step * elapsed);
            _lastFeePips  = fee;
            _lastFeeBlock = uint32(block.number);
        }
        // Surge floor (increment 2): take max() with the decaying anti-sandwich spike. Applied AFTER the
        // rate limiter so the surge itself is never blunted (it is meant to jump instantly); only ever
        // raises `fee`. Skipped entirely while disabled (halfLife 0) or unarmed — then `fee` is identical
        // to increment 1. `surge ≤ maxSurgeFeePips ≤ MAX_LP_FEE`, so the OVERRIDE_FEE_FLAG OR stays clean.
        uint256 hl = surgeHalfLifeSecs;
        if (hl != 0 && _lastSurgeTs != 0) {
            uint256 sEl = block.timestamp > _lastSurgeTs ? block.timestamp - _lastSurgeTs : 0;
            uint24 surge = MWDynamicFee.surgeFee(maxSurgeFeePips, sEl, hl);
            if (surge > fee) fee = surge;
        }
        // MEV-tax (Phase 2): ADD the priority-fee-proportional tax on top, then clamp the total to
        // MAX_LP_FEE. Base-only / bonus-not-solvency (see the field NatSpec); off unless mevTaxK > 0.
        uint256 k = mevTaxK;
        if (k != 0) {
            uint256 priority = tx.gasprice > block.basefee ? tx.gasprice - block.basefee : 0;
            uint256 total = uint256(fee) + MWDynamicFee.mevTaxPips(k, priority, mevTaxCapPips);
            fee = total > LPFeeLibrary.MAX_LP_FEE ? uint24(LPFeeLibrary.MAX_LP_FEE) : uint24(total);
        }
        return fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;
    }

    /// @notice Close the JIT position and MINT ERC-6909 claims for the owed tokens (can't take physical
    ///         here — see the afterSwap-gotcha NatSpec). The keeper `sweepJit()` converts + settles.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        // AUDIT (Cork class): mirror the beforeSwap guard — never touch a non-canonical pool.
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(canonicalPoolId)) {
            return (IHooks.afterSwap.selector, int128(0));
        }
        if (jitLiquidity > 0) _close(key);
        // AUDIT (#7/#3): advance the truncated oracle with the post-swap tick (once per block, clamped).
        (, int24 tick,,) = poolManager.getSlot0(key.toId());
        _oracle.update(tick);
        return (IHooks.afterSwap.selector, int128(0));
    }

    /// @notice The truncated-oracle reference tick and whether it has seen its first swap. The LP module
    ///         reads this to value its position conservatively (`min(spot, oracle)`), immune to a same-tx
    ///         spot push. `ready == false` before the first swap — callers fall back to spot.
    function oracleTick() external view returns (int24 tick, bool ready) {
        return (_oracle.oracleTick, _oracle.initialized);
    }

    // ── keeper: convert claims → USDC and settle with the vault ─────────────────

    /// @notice Redeem the accumulated ERC-6909 claims (post-swap, so the physical tokens now exist),
    ///         swap the team side to USDC, and return the total to the vault. Permissionless — anyone can
    ///         crank it; it only ever moves value from the pool back to the senior.
    function sweepJit() external returns (uint256 usdcReturned) {
        // AUDIT R2-H2: also retry while PHYSICAL balances remain on the hook — not just while claims do.
        // A prior sweep can redeem the claims to physical but be UNABLE to convert the team leg (the
        // team→USDC unwind is oracle-band-clamped and can execute ~nothing when spot is outside the band),
        // stranding physical team/USDC on the hook while the vault's `jitBorrowed` stays outstanding. The
        // old `(usdcClaim==0 && teamClaim==0)` short-circuit then made that strand PERMANENT: it returned
        // before retrying even after the oracle caught up, so all future JIT stayed disabled and the phantom
        // slice counted at par in the senior NAV. Retrying while any physical remains lets it self-heal.
        if (
            usdcClaim == 0 && teamClaim == 0 &&
            teamToken.balanceOf(address(this)) == 0 &&
            usdc.balanceOf(address(this)) == 0
        ) return 0;

        poolManager.unlock(""); // redeem + swap inside the unlock (see unlockCallback)
        usdcReturned = usdc.balanceOf(address(this));
        if (usdcReturned > 0) {
            // AUDIT R5-H1: APPROVE and let the vault PULL exactly this amount inside `settleJitReturn` (it
            // books the balance-diff), so the credited return is measured LOCALLY to that call — immune to
            // any vault-balance movement between this permissionless sweep and the opening swap.
            usdc.forceApprove(address(vault), usdcReturned);
            vault.settleJitReturn(usdcReturned); // reconciles jitBorrowed (junior absorbs any shortfall)
        } else if (
            // AUDIT R2-H2: reconcile on ANY sweep that fully drains the position (no claims, no physical
            // recovered) while the vault still shows an outstanding slice — book it as a junior-absorbed
            // loss rather than leave `jitBorrowed` outstanding forever. `forceSettleJit()` on the vault is
            // the owner backstop for the case even this can't clear.
            usdcClaim == 0 && teamClaim == 0 &&
            teamToken.balanceOf(address(this)) == 0 &&
            vault.jitBorrowed() > 0
        ) {
            vault.settleJitReturn(0);
        }
        emit JitSwept(usdcReturned);
    }

    function unlockCallback(bytes calldata) external override onlyPoolManager returns (bytes memory) {
        // 1. Redeem the USDC-side claims to physical.
        uint256 uc = usdcClaim;
        if (uc > 0) {
            uint256 avail = usdc.balanceOf(address(poolManager));
            uint256 r = uc < avail ? uc : avail;
            if (r > 0) {
                poolManager.burn(address(this), _usdcCurrency().toId(), r);
                poolManager.take(_usdcCurrency(), address(this), r);
                usdcClaim = uc - r;
            }
        }
        // 2. Redeem the team-side claims to physical.
        uint256 tc = teamClaim;
        if (tc > 0) {
            uint256 availT = teamToken.balanceOf(address(poolManager));
            uint256 rt = tc < availT ? tc : availT;
            if (rt > 0) {
                poolManager.burn(address(this), _teamCurrency().toId(), rt);
                poolManager.take(_teamCurrency(), address(this), rt);
                teamClaim = tc - rt;
            }
        }
        // 3. Swap all physical team → USDC (V4 auto-skips this hook's callbacks on its own swap).
        uint256 teamBal = teamToken.balanceOf(address(this));
        if (teamBal > 0) _swapTeamToUsdc(teamBal);
        return "";
    }

    // ── internals ────────────────────────────────────────────────────────────────

    function _open(PoolKey calldata key, bool zeroForOne, uint256 mag) private {
        uint256 lent = vault.borrowIdleForJit(mag);
        if (lent == 0) return;

        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(key.toId());
        int24 spacing = _tickSpacing;
        int24 width = spacing * jitWidthSpacings;
        int24 lo;
        int24 hi;
        if (zeroForOne) {
            // output = currency1 (USDC); tight range just BELOW the tick, single-sided currency1.
            hi = _alignTick(tick, spacing);
            lo = hi - width;
        } else {
            // output = currency0 (USDC); tight range just ABOVE the tick, single-sided currency0.
            lo = _alignTick(tick, spacing) + spacing;
            hi = lo + width;
        }
        // AUDIT M6: clamp to usable ticks. Near a tick extreme, lo/hi can fall outside [MIN,MAX] and
        // TickMath.getSqrtPriceAtTick would revert INSIDE beforeSwap — bricking the pool. If the range
        // is unusable, no-op the JIT (return the borrow) rather than let the swap revert.
        if (lo < TickMath.minUsableTick(spacing) || hi > TickMath.maxUsableTick(spacing) || lo >= hi) {
            usdc.forceApprove(address(vault), lent); // AUDIT R5-H1: vault pulls; return measured in-call
            vault.settleJitReturn(lent);
            return;
        }
        uint128 L = zeroForOne
            ? LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), lent)
            : LiquidityAmounts.getLiquidityForAmount0(TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), lent);
        if (L == 0) {
            // couldn't form a position — return the USDC to the vault (settles the borrow immediately).
            usdc.forceApprove(address(vault), lent); // AUDIT R5-H1: vault pulls; return measured in-call
            vault.settleJitReturn(lent);
            return;
        }

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(L)), salt: JIT_SALT}),
            ""
        );
        _settleDelta(key, delta);

        jitLiquidity = L;
        jitLower = lo;
        jitUpper = hi;
        emit JitOpened(lent, L);
        // Increment 2: repositioning liquidity arms the anti-sandwich surge (only when enabled, to avoid a
        // dead SSTORE while it's off). Fires before `_dynamicFee` runs later in this same `beforeSwap`, so
        // the surge is live for the rest of the block — including any back-run leg of a sandwich.
        if (surgeHalfLifeSecs != 0) _armSurge();
        (sqrtP); // silence unused
    }

    function _close(PoolKey calldata key) private {
        uint128 L = jitLiquidity;
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: jitLower, tickUpper: jitUpper, liquidityDelta: -int256(uint256(L)), salt: JIT_SALT}),
            ""
        );
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        // Removal yields a non-negative delta per side; defensively pay any negative side.
        if (d0 < 0) _pay(key.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _pay(key.currency1, uint256(uint128(-d1)));
        // MINT claims for the owed sides (physical isn't available until the swapper settles post-callback).
        uint256 owed0 = d0 > 0 ? uint256(uint128(d0)) : 0;
        uint256 owed1 = d1 > 0 ? uint256(uint128(d1)) : 0;
        if (owed0 > 0) poolManager.mint(address(this), key.currency0.toId(), owed0);
        if (owed1 > 0) poolManager.mint(address(this), key.currency1.toId(), owed1);

        (uint256 usdcOwed, uint256 teamOwed) = usdcIsCurrency0 ? (owed0, owed1) : (owed1, owed0);
        usdcClaim += usdcOwed;
        teamClaim += teamOwed;

        jitLiquidity = 0;
        emit JitClosed(usdcOwed, teamOwed);
    }

    /// @notice Band (ticks) the sweep may move price past the oracle before stopping (AUDIT #3, ~5%).
    int24 private constant SWEEP_BAND_TICKS = 500;

    function _swapTeamToUsdc(uint256 amountIn) private {
        bool zeroForOne = !usdcIsCurrency0; // selling team; team is currency0 iff usdc is currency1
        // AUDIT (#3): bound the sweep to the truncated-oracle price ± band so a sandwich that moved spot
        // can't force the unwind to realize at the manipulated price. Clamped to the executable side of
        // spot → never reverts; if spot is already past the band the sweep converts ~nothing (team stays
        // as claims for a later sweep) rather than dumping at the bad price.
        (uint160 cur,,,) = poolManager.getSlot0(_key().toId());
        BalanceDelta delta = poolManager.swap(
            _key(),
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn), // exact input
                sqrtPriceLimitX96: _swapLimit(zeroForOne, cur)
            }),
            ""
        );
        _settleDelta(_key(), delta);
    }

    /// @dev Oracle-bounded price limit for the sweep, clamped to the executable side of `cur` (no revert).
    function _swapLimit(bool zeroForOne, uint160 cur) private view returns (uint160) {
        if (!_oracle.initialized) return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        int24 oTick = _oracle.oracleTick;
        if (zeroForOne) {
            uint160 band = _sqrtAtClamped(int256(oTick) - SWEEP_BAND_TICKS);
            if (band >= cur) return cur > TickMath.MIN_SQRT_PRICE + 1 ? cur - 1 : cur;
            return band;
        } else {
            uint160 band = _sqrtAtClamped(int256(oTick) + SWEEP_BAND_TICKS);
            if (band <= cur) return cur < TickMath.MAX_SQRT_PRICE - 1 ? cur + 1 : cur;
            return band;
        }
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

    function _usdcCurrency() private view returns (Currency) { return usdcIsCurrency0 ? _c0 : _c1; }
    function _teamCurrency() private view returns (Currency) { return usdcIsCurrency0 ? _c1 : _c0; }

    function _key() private view returns (PoolKey memory) {
        return PoolKey({currency0: _c0, currency1: _c1, fee: _fee, tickSpacing: _tickSpacing, hooks: IHooks(address(this))});
    }

    function _alignTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }

    // ── IHooks: un-permissioned no-ops (never called — address lacks the bits) ──────

    /// @notice AUDIT (pre-audit review): gate pool initialization to the hook's OWNER. The canonical pool
    ///         is initialized exactly once, by the same actor that deployed the hook (the factory in the
    ///         multi-tenant path, or the deployer in the standalone script), BEFORE ownership is handed off
    ///         to the ops owner — so `sender == owner()` is the authorized initializer in every flow. This
    ///         stops anyone who sees the mined hook/salt from front-running `initialize` to grief the deploy.
    function beforeInitialize(address sender, PoolKey calldata, uint160) external view override returns (bytes4) {
        if (sender != owner()) revert UnauthorizedInitializer();
        return IHooks.beforeInitialize.selector;
    }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }
    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }
    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4) { revert HookNotImplemented(); }

    error HookNotImplemented();
}
