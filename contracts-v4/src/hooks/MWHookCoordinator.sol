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

import {MWGuardianPausable} from "../lib/MWGuardianPausable.sol";
import {MWOracleGuard} from "./MWOracleGuard.sol";
import {MWDynamicFee}  from "./MWDynamicFee.sol";

/// @title  MWHookCoordinator
/// @notice Phase-3 DeFi V4 hook. Composes modular protection:
///           beforeSwap  — deviation circuit breaker + deviation-priced, rate-limited dynamic fee
///           afterSwap   — fold the post-swap tick into the truncated oracle
///           before(Add|Remove)Liquidity — vault-only LP gate
///         Built on the dependency-free MWOracleGuard + MWDynamicFee libraries.
///
/// @dev    Permission bits (address-encoded via HookMiner): beforeAddLiquidity(11) +
///         beforeRemoveLiquidity(9) + beforeSwap(7) + afterSwap(6) = 0xAC0. No return-delta
///         permissions — this hook skims no swap delta. (Stage-1.2 changed beforeSwap from
///         `view` to state-changing for the fee rate-limiter, but the permission BITS are
///         unchanged, so no CREATE2 re-mine is needed.)
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

    uint160 public constant HOOK_FLAGS = 0xAC0;

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

    mapping(PoolId => FeeParams) public feeParams;
    mapping(PoolId => MWOracleGuard.State) internal oracle;

    // Fee rate-limit state (per pool).
    mapping(PoolId => uint24) public lastFee;
    mapping(PoolId => uint32) public lastFeeBlock;

    event VaultUpdated(address indexed vault);
    event PoolConfigured(PoolId indexed poolId, bool dynamicFee, bool guard);

    error OnlyPoolManager();
    error OnlyVaultCanModifyLiquidity();

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
                beforeSwapReturnDelta:         false,
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

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        FeeParams storage fp = feeParams[id];

        (, int24 currentTick,,) = POOL_MANAGER.getSlot0(id);

        // Circuit breaker: revert swaps at extreme deviation from the truncated oracle.
        if (fp.guardEnabled) {
            oracle[id].checkCircuitBreaker(currentTick);
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
