// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {StateLibrary}        from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}        from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks}               from "@uniswap/v4-core/src/libraries/Hooks.sol";

import {MWOracleGuard} from "./MWOracleGuard.sol";
import {MWDynamicFee}  from "./MWDynamicFee.sol";

/// @title  MWFeeHook
/// @notice Aggregator-routable, auto-allowlistable Uniswap-V4 **fee-only** hook (Hook A of the
///         MWHookCoordinator decomposition). It sets a manipulation-resistant, deviation-priced
///         dynamic swap fee and NOTHING ELSE — no liquidity gate, no am-AMM manager skim, no JIT,
///         no delta capture. It is the surface an external router / aggregator can integrate with
///         **no gatekeeper**, because it satisfies Uniswap's strictest allowlist posture:
///
///           • **fee-override only** — `beforeSwap` returns a fee via `OVERRIDE_FEE_FLAG`;
///           • **ZERO delta** — `beforeSwap` returns `toBeforeSwapDelta(0,0)` and `afterSwap`
///             returns `int128(0)` (no `beforeSwapReturnDelta`/`afterSwapReturnDelta` bits), so a
///             router can simulate the pool as "a normal AMM plus a fee";
///           • **no `hookData`** — every fee input comes from `key` / `params` / pool state, never
///             from caller-supplied bytes (the bytes arg is ignored);
///           • **non-upgradeable + immutable** — all fee/oracle bounds are constructor immutables;
///             there are NO owner setters, no proxy, no admin surface of any kind;
///           • **address flags == 0xC0** — only `beforeSwap`(bit 7) + `afterSwap`(bit 6); the CREATE2
///             salt is mined for exactly these two bits (see `HookMiner` / `DeployFeeHook`).
///
///         The JIT/settlement hook (`MintwareTreasuryJitHook`) and the full `MWHookCoordinator`
///         stay separate and untouched; this contract carries ONLY the fee-pricing brain.
///
/// @dev    Manipulation model (inherited from `MWOracleGuard` + `MWDynamicFee`): a truncated in-pool
///         tick oracle lags spot and advances at most `MAX_TICK_MOVE_PER_BLOCK` per block, and never
///         within a block. A single-block price push barely moves the reference, so a swap that
///         deviates from it is priced UP (higher fee), and — with the directional Diamond-LVR lever —
///         the gap-closing (arb) direction that realizes LVR against LPs pays an extra surcharge while
///         benign, uninformed flow pays only the base. The truncated oracle is what neutralizes an
///         attacker trying to steer the reference within a block to buy a cheap fee.
///
/// @dev    The pool that installs this hook MUST be initialized with `LPFeeLibrary.DYNAMIC_FEE_FLAG`
///         as its `fee`, otherwise the PoolManager rejects the fee override. `DeployFeeHook` does this.
///
/// @dev    The ONLY mutable state is per-pool oracle + fee-rate-limit bookkeeping, advanced
///         automatically by swaps. It carries no privilege and cannot be set by any external caller
///         other than through the normal swap callbacks from the PoolManager.
contract MWFeeHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;
    using MWOracleGuard for MWOracleGuard.State;

    /// @notice The low-14 permission bits this hook's mined address must encode:
    ///         beforeSwap(bit 7) | afterSwap(bit 6) = 0xC0. NOTHING else.
    uint160 public constant HOOK_FLAGS = 0xC0;

    uint24 internal constant MAX_PIPS = 1_000_000; // 100%

    // ── immutable fee params (Tier-0: set once at construction, never mutable) ──────────────

    IPoolManager public immutable POOL_MANAGER;

    /// @notice Floor fee in pips (e.g. 3000 = 0.30%).
    uint24  public immutable BASE_FEE_PIPS;
    /// @notice Ceiling fee in pips — the applied fee is ALWAYS clamped to this.
    uint24  public immutable MAX_FEE_PIPS;
    /// @notice Pips added per tick of deviation from the truncated oracle (linear term).
    uint256 public immutable SLOPE_PIPS_PER_TICK;
    /// @notice Convex fee term per tick² of deviation (0 ⇒ pure linear volatility fee).
    uint256 public immutable QUAD_PIPS_PER_TICK_SQ;
    /// @notice Fee rate-limit budget per block (0 ⇒ no limit / sharp response).
    uint24  public immutable MAX_FEE_STEP_PER_BLOCK;

    /// @notice Diamond-LVR directional surcharge: pips per captured tick on the ARB direction only
    ///         (0 ⇒ lever off).
    uint256 public immutable LVR_SLOPE_PIPS_PER_TICK;
    /// @notice Diamond-LVR convex term per captured tick² (0 ⇒ linear).
    uint256 public immutable LVR_QUAD_PIPS_PER_TICK_SQ;

    /// @notice When true, `beforeSwap` reverts a gap-WIDENING swap at extreme deviation
    ///         (revert-only circuit breaker — returns no delta).
    bool    public immutable GUARD_ENABLED;

    // Oracle-guard bounds (immutable; seeded into each pool's oracle State on first touch).
    int24   public immutable MAX_TICK_MOVE_PER_BLOCK;
    int24   public immutable MAX_DEVIATION_TICKS;
    uint32  public immutable MAX_CATCHUP_BLOCKS;

    // ── the ONLY mutable state: per-pool oracle + rate-limit bookkeeping ────────────────────

    mapping(PoolId => MWOracleGuard.State) internal oracle;
    mapping(PoolId => uint24) public lastFee;
    mapping(PoolId => uint32) public lastFeeBlock;

    error OnlyPoolManager();
    error ZeroAddress();
    error BadFeeConfig();
    error NegativeGuardParam();

    modifier onlyPoolManager() {
        if (msg.sender != address(POOL_MANAGER)) revert OnlyPoolManager();
        _;
    }

    /// @param _poolManager           the V4 PoolManager
    /// @param baseFeePips            floor fee (≤ maxFeePips)
    /// @param maxFeePips             ceiling fee (0 < maxFeePips ≤ MAX_PIPS)
    /// @param slopePipsPerTick       linear deviation slope (≤ MAX_PIPS)
    /// @param quadPipsPerTickSq      convex deviation term (≤ MAX_PIPS; 0 ⇒ linear)
    /// @param maxFeeStepPerBlock     per-block fee rate-limit budget (0 ⇒ no limit)
    /// @param lvrSlopePipsPerTick    Diamond-LVR directional slope (≤ MAX_PIPS; 0 ⇒ off)
    /// @param lvrQuadPipsPerTickSq   Diamond-LVR convex term (≤ MAX_PIPS; 0 ⇒ linear)
    /// @param guardEnabled           enable the revert-only deviation circuit breaker
    /// @param maxTickMovePerBlock    oracle truncation budget per block (≥ 0)
    /// @param maxDeviationTicks      circuit-breaker band (≥ 0; 0 ⇒ breaker disabled)
    /// @param maxCatchupBlocks       cap on blocks counted toward the oracle move budget
    constructor(
        IPoolManager _poolManager,
        uint24  baseFeePips,
        uint24  maxFeePips,
        uint256 slopePipsPerTick,
        uint256 quadPipsPerTickSq,
        uint24  maxFeeStepPerBlock,
        uint256 lvrSlopePipsPerTick,
        uint256 lvrQuadPipsPerTickSq,
        bool    guardEnabled,
        int24   maxTickMovePerBlock,
        int24   maxDeviationTicks,
        uint32  maxCatchupBlocks
    ) {
        if (address(_poolManager) == address(0)) revert ZeroAddress();
        // maxFeePips must be a real, sub-100% ceiling so the applied fee can never brick swaps.
        if (maxFeePips == 0 || maxFeePips >= MAX_PIPS) revert BadFeeConfig();
        if (baseFeePips > maxFeePips) revert BadFeeConfig();
        // Bound the slopes to the range the pure libs' overflow-freedom assumes (mirrors the
        // coordinator's `configurePool`/`setLvrParams` bounds).
        if (slopePipsPerTick > MAX_PIPS || quadPipsPerTickSq > MAX_PIPS) revert BadFeeConfig();
        if (lvrSlopePipsPerTick > MAX_PIPS || lvrQuadPipsPerTickSq > MAX_PIPS) revert BadFeeConfig();
        // Signed oracle bounds must be non-negative; MWOracleGuard reads them as uint256(uint24(...)),
        // so a negative value wraps to ~16.7M and silently disables the breaker / collapses truncation.
        if (maxTickMovePerBlock < 0 || maxDeviationTicks < 0) revert NegativeGuardParam();

        POOL_MANAGER              = _poolManager;
        BASE_FEE_PIPS             = baseFeePips;
        MAX_FEE_PIPS              = maxFeePips;
        SLOPE_PIPS_PER_TICK       = slopePipsPerTick;
        QUAD_PIPS_PER_TICK_SQ     = quadPipsPerTickSq;
        MAX_FEE_STEP_PER_BLOCK    = maxFeeStepPerBlock;
        LVR_SLOPE_PIPS_PER_TICK   = lvrSlopePipsPerTick;
        LVR_QUAD_PIPS_PER_TICK_SQ = lvrQuadPipsPerTickSq;
        GUARD_ENABLED             = guardEnabled;
        MAX_TICK_MOVE_PER_BLOCK   = maxTickMovePerBlock;
        MAX_DEVIATION_TICKS       = maxDeviationTicks;
        MAX_CATCHUP_BLOCKS        = maxCatchupBlocks;

        // Validate the mined address encodes EXACTLY beforeSwap + afterSwap (0xC0) — an
        // Angstrom-class flag/address mismatch would otherwise brick or mis-gate the pool.
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    /// @notice The hook's declared permissions: ONLY beforeSwap + afterSwap. Everything else false.
    ///         (Not part of IHooks — a public view so integrators/tests can read the surface, and the
    ///         constructor validates the mined address against it.)
    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize:              false,
            afterInitialize:               false,
            beforeAddLiquidity:            false,
            afterAddLiquidity:             false,
            beforeRemoveLiquidity:         false,
            afterRemoveLiquidity:          false,
            beforeSwap:                    true,
            afterSwap:                     true,
            beforeDonate:                  false,
            afterDonate:                   false,
            beforeSwapReturnDelta:         false, // ← ZERO-delta: no return-delta bit
            afterSwapReturnDelta:          false, // ← ZERO-delta: no return-delta bit
            afterAddLiquidityReturnDelta:  false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ── IHooks: swap — deviation-priced dynamic fee (ZERO delta, no hookData) ────────────────

    /// @notice Price the swap by its deviation from the truncated oracle and return it as a pure fee
    ///         override. Returns `toBeforeSwapDelta(0,0)` unconditionally — the router can treat this
    ///         pool as a normal AMM plus a deterministic fee. `hookData` is ignored.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        (, int24 currentTick,,) = POOL_MANAGER.getSlot0(id);

        // Circuit breaker (revert-only, returns no delta): block only the gap-WIDENING direction at
        // extreme deviation; a gap-CLOSING (arb/heal) swap is always allowed, so a cheap push can never
        // brick the pool AND the swap that would heal it. (Mirrors MWHookCoordinator's M9 fix.)
        if (GUARD_ENABLED) {
            MWOracleGuard.State storage og = oracle[id];
            if (og.initialized) {
                bool widening = currentTick >= og.oracleTick ? !params.zeroForOne : params.zeroForOne;
                if (widening) og.checkCircuitBreaker(currentTick);
            }
        }

        // Deviation-priced, LVR-directional, rate-limited fee. Clamped to MAX_FEE_PIPS.
        uint256 dev    = oracle[id].deviationTicks(currentTick); // 0 until the oracle is seeded
        uint24  target = MWDynamicFee.volatilityFeeQuad(
            BASE_FEE_PIPS, MAX_FEE_PIPS, dev, SLOPE_PIPS_PER_TICK, QUAD_PIPS_PER_TICK_SQ
        );
        target        = _lvrTarget(id, target, dev, currentTick, params.zeroForOne);
        uint24 fee    = _rateLimitedFee(id, target);
        if (fee > MAX_FEE_PIPS) fee = MAX_FEE_PIPS;

        return (
            IHooks.beforeSwap.selector,
            toBeforeSwapDelta(0, 0),                        // ← provably zero delta
            fee | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }

    /// @notice Fold the post-swap tick into the truncated oracle. Returns int128(0) — zero delta.
    ///         `hookData` is ignored.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        PoolId id = key.toId();
        MWOracleGuard.State storage o = oracle[id];
        // Seed the immutable guard bounds into this pool's oracle State exactly once — on the swap that
        // first initializes it (update() flips `initialized` true). No admin call is needed or possible.
        if (!o.initialized) {
            o.maxTickMovePerBlock = MAX_TICK_MOVE_PER_BLOCK;
            o.maxDeviationTicks   = MAX_DEVIATION_TICKS;
            o.maxCatchupBlocks    = MAX_CATCHUP_BLOCKS;
        }
        (, int24 currentTick,,) = POOL_MANAGER.getSlot0(id);
        o.update(currentTick);
        return (IHooks.afterSwap.selector, int128(0));
    }

    // ── views ────────────────────────────────────────────────────────────────

    /// @notice Current truncated-oracle reference tick + init flag for a pool.
    function oracleTick(PoolId id) external view returns (int24 tick, bool initialized) {
        MWOracleGuard.State storage o = oracle[id];
        return (o.oracleTick, o.initialized);
    }

    /// @notice Deterministic fee quote for a given (tick) pool state and swap direction — the exact
    ///         value `beforeSwap` would apply, so a router can price the pool off-chain. Pure function
    ///         of pool state + immutables (no `hookData`); NOTE it does not apply the intra-block
    ///         rate-limit freeze (that depends on `block.number`), it returns the pre-rate-limit target.
    function quoteFee(PoolId id, bool zeroForOne) external view returns (uint24) {
        (, int24 currentTick,,) = POOL_MANAGER.getSlot0(id);
        uint256 dev = oracle[id].deviationTicks(currentTick);
        uint24 target = MWDynamicFee.volatilityFeeQuad(
            BASE_FEE_PIPS, MAX_FEE_PIPS, dev, SLOPE_PIPS_PER_TICK, QUAD_PIPS_PER_TICK_SQ
        );
        return _lvrTarget(id, target, dev, currentTick, zeroForOne);
    }

    // ── internal fee math ──────────────────────────────────────────────────────

    /// @dev Diamond-LVR directional surcharge: add it when THIS swap closes the gap toward the oracle
    ///      (the arb that realizes LVR against LPs), else return `base`. Clamped to MAX_FEE_PIPS.
    function _lvrTarget(PoolId id, uint24 base, uint256 dev, int24 currentTick, bool zeroForOne)
        internal view returns (uint24)
    {
        if ((LVR_SLOPE_PIPS_PER_TICK == 0 && LVR_QUAD_PIPS_PER_TICK_SQ == 0) || dev == 0) return base;
        int24 oTick = oracle[id].oracleTick; // dev > 0 ⇒ initialized
        bool arb = (currentTick > oTick && zeroForOne) || (currentTick < oTick && !zeroForOne);
        if (!arb) return base; // benign / gap-widening flow pays no LVR surcharge
        uint256 sur = MWDynamicFee.lvrSurchargePips(
            dev, LVR_SLOPE_PIPS_PER_TICK, LVR_QUAD_PIPS_PER_TICK_SQ, MAX_FEE_PIPS
        );
        uint256 t = uint256(base) + sur;
        return t > MAX_FEE_PIPS ? MAX_FEE_PIPS : uint24(t);
    }

    /// @dev Clamp the fee to `MAX_FEE_STEP_PER_BLOCK × blocksElapsed` of the last applied fee; frozen
    ///      within a block (no intra-block ramp a searcher could time).
    function _rateLimitedFee(PoolId id, uint24 target) internal returns (uint24 fee) {
        uint24 last = lastFee[id];
        uint32 lb   = lastFeeBlock[id];

        if (last == 0 || MAX_FEE_STEP_PER_BLOCK == 0) {
            fee = target;
        } else if (uint32(block.number) == lb) {
            fee = last; // frozen within a block
        } else {
            uint256 elapsed = block.number - lb;
            fee = MWDynamicFee.rateLimit(last, target, uint256(MAX_FEE_STEP_PER_BLOCK) * elapsed);
        }
        lastFee[id]      = fee;
        lastFeeBlock[id] = uint32(block.number);
    }

    // ── IHooks: unused callbacks (selector-only; never enabled in the flags) ──────────────────

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4) {
        return IHooks.beforeAddLiquidity.selector;
    }
    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }
    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external pure override returns (bytes4) {
        return IHooks.beforeRemoveLiquidity.selector;
    }
    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IHooks.afterDonate.selector;
    }
}
