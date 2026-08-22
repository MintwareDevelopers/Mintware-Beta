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
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";

import {MWGuardianPausable} from "../lib/MWGuardianPausable.sol";
import {MWOracleGuard} from "./MWOracleGuard.sol";
import {MWDynamicFee}  from "./MWDynamicFee.sol";

/// @dev Minimal view of MWAmAuction the swap hot path needs.
interface IMWAmAuction {
    function poke(PoolId id) external returns (address manager, uint24 fee);
    function recordManagerFee(PoolId id, address token, uint256 amount) external;
}

/// @dev Minimal view of the pair vault's size-gated JIT bridge (Lever B). The hook calls jitOpen in
///      beforeSwap and jitClose in afterSwap; both run inside the swapper's existing unlock and settle
///      on the VAULT's own delta account (disjoint from this hook's am-AMM fee delta).
interface IMWJitVault {
    function jitOpen(bool zeroForOne, uint256 outputBudget) external returns (uint128 liquidity);
    function jitClose() external;
}

/// @title  MWHookCoordinator
/// @notice Phase-3 DeFi V4 hook. Composes modular protection:
///           beforeSwap  — deviation circuit breaker + deviation-priced, rate-limited dynamic fee
///           afterSwap   — fold the post-swap tick into the truncated oracle
///           before(Add|Remove)Liquidity — vault-only LP gate
///         Built on the dependency-free MWOracleGuard + MWDynamicFee libraries.
///
/// @dev    Permission bits (address-encoded via HookMiner): beforeAddLiquidity(11) +
///         beforeRemoveLiquidity(9) + beforeSwap(7) + afterSwap(6) + beforeSwapReturnDelta(3)
///         = 0xAC8. The return-delta bit lets enrolled am-AMM pools skim the manager fee in
///         beforeSwap (Stage 2.2); non-enrolled pools return a zero delta (bit unused).
///
/// @dev    MEV model (Stage-1.2 rebuild): NO trader identity is read — the old `tx.origin`
///         sandwich cooldown is gone. Manipulation resistance comes from MWOracleGuard's
///         truncated tick oracle (a single-block price push barely moves the reference), and
///         swaps are priced by their deviation from that oracle via MWDynamicFee, with a
///         block-to-block fee rate-limit so a searcher cannot cleanly time a predictable
///         fee hike/drop. An extreme deviation trips the circuit breaker. This defends single-
///         AND multi-address attackers, unlike the retired identity-keyed model.
///
///         Tradeoff (documented): the fee rate-limit smooths fee response, which mutes the
///         immediate deviation-pricing of a manipulator's first-block swap. It is a per-pool
///         knob (maxFeeStepPerBlock == 0 → sharp/unlimited). The structural resolution is the
///         am-AMM auction (Stage-2.2); this is the interim on-chain defense.
///
/// @dev    Kill-switch (Stage-1.4): pause gates `beforeAddLiquidity` only — blocks NEW liquidity
///         while always allowing `beforeRemoveLiquidity` (positions exit to safety) and never
///         the swap path (a reverting beforeSwap would brick the pool). Guardian pauses; owner
///         unpauses.
contract MWHookCoordinator is IHooks, MWGuardianPausable {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;
    using MWOracleGuard for MWOracleGuard.State;

    uint160 public constant HOOK_FLAGS = 0xAC8;

    /// @notice Fallback surge ceiling for the UNMANAGED am-AMM fee path (Inc-1c). If a dynamic-fee
    ///         pool is misconfigured with `maxFeePips == 0`, MWDynamicFee.volatilityFee would be free
    ///         to reach 100% (1e6) — a fee that bricks swaps. On the unmanaged fallback we clamp the
    ///         surge to this ceiling (10%) instead, so a config slip can never DoS the pool. Pools
    ///         that set `maxFeePips` explicitly are bounded by THAT value, not this one.
    uint24 internal constant FALLBACK_MAX_FEE_PIPS = 100_000; // 10%

    struct FeeParams {
        uint24  baseFeePips;        // floor fee (3000 = 0.30%)
        uint24  maxFeePips;         // ceiling (0 → 100%)
        uint256 slopePipsPerTick;   // pips added per tick of deviation from the oracle
        uint24  maxFeeStepPerBlock; // fee rate-limit budget per block (0 → no limit)
        bool    dynamicFeeEnabled;
        bool    guardEnabled;       // deviation circuit breaker
        bool    configured;
    }

    /// @notice Diamond-style LVR lever (opt-in, default OFF). A DIRECTIONAL surcharge added on top of the
    ///         symmetric volatility fee, charged ONLY on the swap that closes spot toward the truncated
    ///         oracle (the arbitrage that realizes LVR against LPs). Benign flow that widens the gap — the
    ///         uninformed flow LPs earn on — is never surcharged. See `MWDynamicFee.lvrSurchargePips`.
    struct LvrParams {
        uint256 slopePipsPerTick;          // LVR surcharge pips per captured tick (0 ⇒ off)
        uint256 quadMultiplierPipsPerTickSq; // convex term per captured tick² (0 ⇒ linear)
        bool    enabled;
    }

    IPoolManager public immutable POOL_MANAGER;

    /// @notice The only address permitted to add/remove liquidity in coordinated pools.
    address public vault;

    /// @notice The am-AMM auction driving enrolled pools (set once by the owner).
    address public auction;
    /// @notice Per-pool am-AMM enrollment. Owner mirrors the auction's `amParams.enabled`.
    mapping(PoolId => bool) public amAmmEnabled;
    /// @notice Per-pool exact-output allowance on managed am-AMM swaps. Default false: v1 handles
    ///         exact-input only and reverts exact-output, closing a manager-fee-avoidance hole.
    mapping(PoolId => bool) public allowExactOutput;

    mapping(PoolId => FeeParams) public feeParams;
    /// @notice Per-pool Diamond-LVR lever config (default zero-value ⇒ disabled).
    mapping(PoolId => LvrParams) public lvrParams;
    mapping(PoolId => MWOracleGuard.State) internal oracle;

    /// @notice Size gate for JIT: only swaps with |amountSpecified| >= this trigger a JIT open.
    ///         Global (per-pool enrollment via `jitEnabled` narrows it further). Owner-set.
    uint256 public jitThreshold;
    /// @notice Per-pool JIT allowlist (threat model §1.5 — exact pools only). Owner-set, and only for
    ///         pools whose `vault` really is the JIT bridge. Default false ⇒ JIT never fires.
    mapping(PoolId => bool) public jitEnabled;

    // Fee rate-limit state (per pool).
    mapping(PoolId => uint24) public lastFee;
    mapping(PoolId => uint32) public lastFeeBlock;

    event VaultUpdated(address indexed vault);
    event PoolConfigured(PoolId indexed poolId, bool dynamicFee, bool guard);
    event OraclePoked(PoolId indexed poolId, int24 oracleTick, int24 currentTick);
    event JitThresholdSet(uint256 threshold);
    event JitEnabledSet(PoolId indexed poolId, bool enabled);
    event LvrParamsSet(PoolId indexed poolId, uint256 slopePipsPerTick, uint256 quadMultiplierPipsPerTickSq, bool enabled);

    error OnlyPoolManager();
    error OnlyVaultCanModifyLiquidity();
    error ExactOutputNotSupported();
    error AuctionAlreadySet();
    error FeeTooHigh();

    modifier onlyPoolManager() {
        if (msg.sender != address(POOL_MANAGER)) revert OnlyPoolManager();
        _;
    }

    constructor(IPoolManager _poolManager, address _vault, address _initialOwner) MWGuardianPausable(_initialOwner) {
        POOL_MANAGER = _poolManager;
        vault        = _vault;

        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize:              false,
                afterInitialize:               false,
                beforeAddLiquidity:            true,
                afterAddLiquidity:             false,
                beforeRemoveLiquidity:         true,
                afterRemoveLiquidity:          false,
                beforeSwap:                    true,
                afterSwap:                     true,
                beforeDonate:                  false,
                afterDonate:                   false,
                beforeSwapReturnDelta:         true,
                afterSwapReturnDelta:          false,
                afterAddLiquidityReturnDelta:  false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ── admin ──────────────────────────────────────────────────────────────

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
        emit VaultUpdated(_vault);
    }

    /// @notice Wire the am-AMM auction once (chicken-and-egg with the auction's setCoordinator).
    function setAuction(address _auction) external onlyOwner {
        if (auction != address(0)) revert AuctionAlreadySet();
        auction = _auction;
    }

    /// @notice Enroll/unenroll a pool in the am-AMM. Owner must keep this in sync with the
    ///         auction's `configurePool`/`setEnabled` for the same pool.
    function setAmAmmEnabled(PoolId poolId, bool enabled) external onlyOwner {
        amAmmEnabled[poolId] = enabled;
    }

    /// @notice Allow exact-output swaps on a managed am-AMM pool (default false). Flip on only
    ///         after the exact-output skim path is fuzzed (see am-amm-design.md).
    function setAllowExactOutput(PoolId poolId, bool allowed) external onlyOwner {
        allowExactOutput[poolId] = allowed;
    }

    /// @notice Set the global size gate for JIT (|amountSpecified| >= threshold to trigger).
    function setJitThreshold(uint256 threshold) external onlyOwner {
        jitThreshold = threshold;
        emit JitThresholdSet(threshold);
    }

    /// @notice Enroll/unenroll a pool for size-gated JIT. Only enable for pools whose configured
    ///         `vault` is the JIT bridge for that exact pool.
    function setJitEnabled(PoolId poolId, bool enabled) external onlyOwner {
        jitEnabled[poolId] = enabled;
        emit JitEnabledSet(poolId, enabled);
    }

    /// @notice Set a pool's Diamond-LVR lever (opt-in, default OFF). A directional surcharge on the
    ///         gap-closing (arb) swap direction only — recaptures LVR to LPs without taxing benign flow.
    ///         Bound `slope`/`quad` ≤ 1_000_000 (MWDynamicFee.MAX_PIPS); the applied fee is always clamped
    ///         to the pool's `maxFeePips`, so the "fee ≤ cap" invariant is preserved.
    error BadFeeConfig();
    error BadLvrParams();

    function setLvrParams(PoolId poolId, uint256 slopePipsPerTick, uint256 quadMultiplierPipsPerTickSq, bool enabled)
        external onlyOwner
    {
        // AUDIT M11: enforce the ≤ MAX_PIPS bound the libs' overflow-freedom + the 7/7 invariants assume
        // (the NatSpec above always required it; now the code does too).
        if (slopePipsPerTick > 1_000_000 || quadMultiplierPipsPerTickSq > 1_000_000) revert BadLvrParams();
        lvrParams[poolId] = LvrParams(slopePipsPerTick, quadMultiplierPipsPerTickSq, enabled);
        emit LvrParamsSet(poolId, slopePipsPerTick, quadMultiplierPipsPerTickSq, enabled);
    }

    /// @notice Configure a pool's dynamic-fee + oracle-guard parameters.
    function configurePool(
        PoolId poolId,
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint256 slopePipsPerTick,
        uint24 maxFeeStepPerBlock,
        bool dynamicFeeEnabled,
        bool guardEnabled,
        int24 maxTickMovePerBlock,
        int24 maxDeviationTicks,
        uint32 maxCatchupBlocks
    ) external onlyOwner {
        // AUDIT M11: bound the deviation slope to the range the fee-lib overflow-freedom + the 7/7
        // invariants assume. (`maxFeePips == 0` is handled safely by the FALLBACK clamp on BOTH fee paths —
        // see beforeSwap — so it need not be rejected here.)
        if (slopePipsPerTick > 1_000_000) revert BadFeeConfig();
        feeParams[poolId] = FeeParams({
            baseFeePips:        baseFeePips,
            maxFeePips:         maxFeePips,
            slopePipsPerTick:   slopePipsPerTick,
            maxFeeStepPerBlock: maxFeeStepPerBlock,
            dynamicFeeEnabled:  dynamicFeeEnabled,
            guardEnabled:       guardEnabled,
            configured:         true
        });
        MWOracleGuard.State storage o = oracle[poolId];
        o.maxTickMovePerBlock = maxTickMovePerBlock;
        o.maxDeviationTicks   = maxDeviationTicks;
        o.maxCatchupBlocks    = maxCatchupBlocks;
        emit PoolConfigured(poolId, dynamicFeeEnabled, guardEnabled);
    }

    // ── IHooks: liquidity gate ───────────────────────────────────────────────

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external view override onlyPoolManager whenNotPaused returns (bytes4)
    {
        if (sender != vault) revert OnlyVaultCanModifyLiquidity();
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external view override onlyPoolManager returns (bytes4)
    {
        if (sender != vault) revert OnlyVaultCanModifyLiquidity();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    // ── IHooks: swap — oracle circuit breaker + deviation-priced dynamic fee ─────

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        FeeParams storage fp = feeParams[id];

        (, int24 currentTick,,) = POOL_MANAGER.getSlot0(id);

        // Circuit breaker: revert swaps at extreme deviation from the truncated oracle.
        // AUDIT M9: only block the gap-WIDENING direction. A swap that REDUCES the deviation (the arb that
        // restores price) must always be allowed — otherwise a cheap push past the band on a thin pool bricks
        // the pool AND the very swap that would heal it. When this swap closes the gap toward the oracle, skip
        // the breaker entirely.
        if (fp.guardEnabled) {
            MWOracleGuard.State storage og = oracle[id];
            if (og.initialized) {
                bool widening = currentTick >= og.oracleTick ? !params.zeroForOne : params.zeroForOne;
                if (widening) og.checkCircuitBreaker(currentTick);
            }
        }

        // ── Fee path (UNCHANGED). am-AMM enrolled pools: the manager sets the fee and receives it;
        //    LP fee is zeroed. Non-enrolled pools fall through to the deviation-priced dynamic fee. ──
        bytes4          selector;
        BeforeSwapDelta bsd;
        uint24          feeOverride;
        if (amAmmEnabled[id] && auction != address(0)) {
            (selector, bsd, feeOverride) = _beforeSwapAmAmm(id, key, params, currentTick, fp);
        } else {
            selector    = IHooks.beforeSwap.selector;
            bsd         = toBeforeSwapDelta(0, 0);
            feeOverride = 0;
            if (fp.dynamicFeeEnabled) {
                uint256 dev = oracle[id].deviationTicks(currentTick);
                // AUDIT M10: a 0 ceiling means "unset" — clamp to the safe FALLBACK (mirrors the am-AMM
                // branch below) so the surge can NEVER reach 100% and brick swaps when honest arb is needed.
                uint24 feeCeil = fp.maxFeePips == 0 ? FALLBACK_MAX_FEE_PIPS : fp.maxFeePips;
                uint24 target = MWDynamicFee.volatilityFee(fp.baseFeePips, feeCeil, dev, fp.slopePipsPerTick);
                // Diamond-LVR: directional surcharge on the arb (gap-closing) direction only.
                target = _lvrTarget(id, target, dev, currentTick, params.zeroForOne, feeCeil);
                uint24 fee = _rateLimitedFee(id, target, fp.maxFeeStepPerBlock);
                if (fee > feeCeil) fee = feeCeil; // bounded (mirrors the unmanaged am-AMM branch)
                feeOverride = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;
            }
        }

        // ── Size-gated JIT (Lever B) — composes ALONGSIDE the fee path above. The vault's jitOpen adds
        //    real single-sided liquidity via modifyLiquidity and self-settles on the VAULT's delta
        //    account (disjoint from this hook's am-AMM fee delta `bsd`), so both net to zero by unlock
        //    end. A revert or 0-return is a silent fallback: the swap proceeds on resting liquidity.
        //    NO price is read — the output budget is derived only from |amountSpecified|.
        if (jitEnabled[id] && vault != address(0)) {
            uint256 outputBudget = params.amountSpecified < 0
                ? uint256(-params.amountSpecified)
                : uint256(params.amountSpecified);
            if (outputBudget >= jitThreshold) {
                try IMWJitVault(vault).jitOpen(params.zeroForOne, outputBudget) returns (uint128) {} catch {}
            }
        }

        return (selector, bsd, feeOverride);
    }

    /// @dev The am-AMM manager-fee skim. Grounded in the v4-core delta accounting (see
    ///      docs/developers/am-amm-design.md §skim): for an exact-input swap the fee is taken on
    ///      the SPECIFIED (input) currency — a positive `deltaSpecified` shrinks the amount that
    ///      reaches the pool, and `POOL_MANAGER.take(spec, auction, fee)` books the offsetting
    ///      `-fee`, so the hook nets ZERO across the unlock (no residual delta → swap settles).
    ///      The trader covers `fee`; LPs earn nothing on managed swaps (the manager bought the flow).
    function _beforeSwapAmAmm(
        PoolId id,
        PoolKey calldata key,
        SwapParams calldata params,
        int24 currentTick,
        FeeParams storage fp
    )
        internal returns (bytes4, BeforeSwapDelta, uint24)
    {
        (address mgr, uint24 feePips) = IMWAmAuction(auction).poke(id);

        // Unmanaged (Inc-1c): with NO manager, an arbitrageur would otherwise swap at the auction's
        // calm-market default and pocket the volatility value (LVR) that belongs to LPs. So we price
        // the swap by its deviation from the truncated oracle exactly like the non-auction path —
        // deviation-priced, rate-limited surge — and return max(default, surge) as the LP fee. Calm
        // markets keep at least the auction default; volatile markets surge above it, recapturing LVR
        // as LP fee. No skim, no delta. The oracle read is deviation-only (read-only circuit breaker),
        // so the money path still reads no price. If the pool does NOT run the dynamic fee we keep the
        // flat default (backward compatible).
        if (mgr == address(0)) {
            uint24 lpFee = feePips;
            if (fp.dynamicFeeEnabled) {
                uint256 dev = oracle[id].deviationTicks(currentTick);
                // Never pass a 0 ceiling into volatilityFee on this fallback: a misconfigured
                // maxFeePips==0 would let it reach 100% and brick swaps. Clamp to the pool's
                // configured max when set, else to FALLBACK_MAX_FEE_PIPS.
                uint24 feeCeil = fp.maxFeePips == 0 ? FALLBACK_MAX_FEE_PIPS : fp.maxFeePips;
                uint24 target  = MWDynamicFee.volatilityFee(fp.baseFeePips, feeCeil, dev, fp.slopePipsPerTick);
                // Diamond-LVR: directional surcharge on the arb direction (recapture LVR when unmanaged).
                target         = _lvrTarget(id, target, dev, currentTick, params.zeroForOne, feeCeil);
                uint24 surge   = _rateLimitedFee(id, target, fp.maxFeeStepPerBlock);
                if (surge > lpFee) lpFee = surge;      // max(auction default, surge)
                if (lpFee > feeCeil) lpFee = feeCeil;  // bounded: <= maxFeePips (or FALLBACK) < 1e6
            }
            return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), lpFee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
        }

        // Managed: LP fee 0, manager skims. Guard against a fee that could zero/flip the swap.
        if (feePips >= 1_000_000) revert FeeTooHigh();
        uint24 zeroLp = uint24(0) | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        // v1 handles exact-input only; a silent exact-output pass-through would let traders dodge
        // the manager fee (fee basis is only known for the specified amount in beforeSwap).
        if (params.amountSpecified > 0 && !allowExactOutput[id]) revert ExactOutputNotSupported();

        // Specified currency == the token the trader gave an exact amount of (v4-core Hooks.sol).
        Currency spec = (params.amountSpecified < 0 == params.zeroForOne) ? key.currency0 : key.currency1;
        uint256 amt = params.amountSpecified < 0
            ? uint256(-params.amountSpecified)
            : uint256(params.amountSpecified);
        uint256 fee = (amt * uint256(feePips)) / 1_000_000; // floor; feePips < 1e6 ⇒ fee < amt

        if (fee == 0) {
            return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), zeroLp);
        }

        // (A) take the fee straight to the auction (books -fee to the hook), then
        // (B) credit the manager (tokens are now at the auction — its push-then-record model), then
        // (C) return +fee on the specified delta, booked to the hook in afterSwap → net zero.
        POOL_MANAGER.take(spec, auction, fee);
        IMWAmAuction(auction).recordManagerFee(id, Currency.unwrap(spec), fee);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), zeroLp);
    }

    /// @dev Diamond-LVR: add the directional surcharge to `base` when this swap CLOSES the gap toward the
    ///      truncated oracle (the arb direction that realizes LVR), else return `base` unchanged. `dev > 0`
    ///      implies the oracle is initialized. Arb direction: spot ABOVE oracle & selling down (zeroForOne),
    ///      or spot BELOW oracle & buying up (!zeroForOne). Result is clamped to `cap`, so `fee ≤ cap` holds.
    function _lvrTarget(PoolId id, uint24 base, uint256 dev, int24 currentTick, bool zeroForOne, uint24 cap)
        internal view returns (uint24)
    {
        LvrParams storage lp = lvrParams[id];
        if (!lp.enabled || dev == 0) return base;
        int24 oTick = oracle[id].oracleTick; // dev > 0 ⇒ initialized
        bool arb = (currentTick > oTick && zeroForOne) || (currentTick < oTick && !zeroForOne);
        if (!arb) return base; // benign / gap-widening flow pays no LVR surcharge
        uint256 sur = MWDynamicFee.lvrSurchargePips(dev, lp.slopePipsPerTick, lp.quadMultiplierPipsPerTickSq, cap);
        uint256 t = uint256(base) + sur;
        return t > cap ? cap : uint24(t);
    }

    /// @dev Clamp the fee to `maxStepPerBlock × blocksElapsed` of the last applied fee. Within a
    ///      single block the fee is frozen (no intra-block ramp a searcher could exploit).
    function _rateLimitedFee(PoolId id, uint24 target, uint24 maxStepPerBlock) internal returns (uint24 fee) {
        uint24 last = lastFee[id];
        uint32 lb   = lastFeeBlock[id];

        if (last == 0 || maxStepPerBlock == 0) {
            fee = target;
        } else if (uint32(block.number) == lb) {
            fee = last; // frozen within a block
        } else {
            uint256 elapsed = block.number - lb;
            fee = MWDynamicFee.rateLimit(last, target, uint256(maxStepPerBlock) * elapsed);
        }
        lastFee[id]      = fee;
        lastFeeBlock[id] = uint32(block.number);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        PoolId id = key.toId();
        if (feeParams[id].dynamicFeeEnabled || feeParams[id].guardEnabled) {
            (, int24 currentTick,,) = POOL_MANAGER.getSlot0(id);
            oracle[id].update(currentTick);
        }
        // Close any JIT position opened in beforeSwap. Best-effort — jitClose is itself best-effort on
        // re-supply, so it cannot revert for a recoverable reason; a revert here would (safely) unwind
        // the whole swap rather than leave a half-open position.
        if (jitEnabled[id] && vault != address(0)) {
            try IMWJitVault(vault).jitClose() {} catch {}
        }
        return (IHooks.afterSwap.selector, 0);
    }

    // ── views ────────────────────────────────────────────────────────────────

    /// @notice Current truncated-oracle reference tick + init flag for a pool.
    function oracleTick(PoolId id) external view returns (int24 tick, bool initialized) {
        MWOracleGuard.State storage o = oracle[id];
        return (o.oracleTick, o.initialized);
    }


    /// @notice Permissionless circuit-breaker heal path. The breaker reverts swaps at extreme
    ///         deviation, and the oracle only advances in `afterSwap` — which a reverting
    ///         `beforeSwap` never reaches. Without this, one large swap that pushes spot past the
    ///         band would brick the pool forever (audit HIGH: circuit-breaker deadlock). `pokeOracle`
    ///         advances the truncated oracle toward CURRENT spot using the identical clamped
    ///         per-block budget the swap path uses (intra-block frozen, capped per block), so over a
    ///         few blocks the reference catches up, the deviation falls back within band, and swaps
    ///         resume. It grants no new power: the same clamp that resists single-block manipulation
    ///         applies here, so nobody can jump the oracle — poke only lets the natural per-block
    ///         catch-up proceed while swaps are halted.
    function pokeOracle(PoolKey calldata key) external {
        PoolId id = key.toId();
        MWOracleGuard.State storage o = oracle[id];
        if (!o.initialized) return; // nothing to heal until the first swap seeds the oracle
        (, int24 currentTick,,) = POOL_MANAGER.getSlot0(id);
        o.update(currentTick);
        emit OraclePoked(id, o.oracleTick, currentTick);
    }

    // ── IHooks: unused callbacks (selector-only) ─────────────────────────────

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }
    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
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
