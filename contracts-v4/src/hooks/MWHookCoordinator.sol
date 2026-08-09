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

    struct FeeParams {
        uint24  baseFeePips;        // floor fee (3000 = 0.30%)
        uint24  maxFeePips;         // ceiling (0 → 100%)
        uint256 slopePipsPerTick;   // pips added per tick of deviation from the oracle
        uint24  maxFeeStepPerBlock; // fee rate-limit budget per block (0 → no limit)
        bool    dynamicFeeEnabled;
        bool    guardEnabled;       // deviation circuit breaker
        bool    configured;
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
    mapping(PoolId => MWOracleGuard.State) internal oracle;

    // Fee rate-limit state (per pool).
    mapping(PoolId => uint24) public lastFee;
    mapping(PoolId => uint32) public lastFeeBlock;

    event VaultUpdated(address indexed vault);
    event PoolConfigured(PoolId indexed poolId, bool dynamicFee, bool guard);
    event OraclePoked(PoolId indexed poolId, int24 oracleTick, int24 currentTick);

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
        if (fp.guardEnabled) {
            oracle[id].checkCircuitBreaker(currentTick);
        }

        // ── am-AMM enrolled pools: the manager sets the fee and receives it; LP fee is zeroed ──
        // (Non-enrolled pools fall through to the deviation-priced dynamic fee below.)
        if (amAmmEnabled[id] && auction != address(0)) {
            return _beforeSwapAmAmm(id, key, params);
        }

        uint24 feeOverride = 0;
        if (fp.dynamicFeeEnabled) {
            uint256 dev = oracle[id].deviationTicks(currentTick);
            uint24 target = MWDynamicFee.volatilityFee(fp.baseFeePips, fp.maxFeePips, dev, fp.slopePipsPerTick);
            uint24 fee = _rateLimitedFee(id, target, fp.maxFeeStepPerBlock);
            feeOverride = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        }

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), feeOverride);
    }

    /// @dev The am-AMM manager-fee skim. Grounded in the v4-core delta accounting (see
    ///      docs/developers/am-amm-design.md §skim): for an exact-input swap the fee is taken on
    ///      the SPECIFIED (input) currency — a positive `deltaSpecified` shrinks the amount that
    ///      reaches the pool, and `POOL_MANAGER.take(spec, auction, fee)` books the offsetting
    ///      `-fee`, so the hook nets ZERO across the unlock (no residual delta → swap settles).
    ///      The trader covers `fee`; LPs earn nothing on managed swaps (the manager bought the flow).
    function _beforeSwapAmAmm(PoolId id, PoolKey calldata key, SwapParams calldata params)
        internal returns (bytes4, BeforeSwapDelta, uint24)
    {
        (address mgr, uint24 feePips) = IMWAmAuction(auction).poke(id);

        // Unmanaged: LPs keep the auction's default fee; no skim.
        if (mgr == address(0)) {
            return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), feePips | LPFeeLibrary.OVERRIDE_FEE_FLAG);
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
