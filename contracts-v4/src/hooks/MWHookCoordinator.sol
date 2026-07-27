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
import {Ownable}             from "@openzeppelin/contracts/access/Ownable.sol";

import {MWMEVGuard}   from "./MWMEVGuard.sol";
import {MWDynamicFee} from "./MWDynamicFee.sol";

/// @title  MWHookCoordinator
/// @notice New Phase-3 DeFi V4 hook (Track A2/A3) that composes modular protection:
///           beforeSwap  — MEV sandwich/deviation guard + volatility dynamic-fee override
///           afterSwap   — record price observation (EMA) + trader state
///           before(Add|Remove)Liquidity — vault-only LP gate
///         Built on the dependency-free MWMEVGuard + MWDynamicFee libraries.
///
/// @dev    Permission bits (address-encoded via HookMiner): beforeAddLiquidity(11) +
///         beforeRemoveLiquidity(9) + beforeSwap(7) + afterSwap(6) = 0xAC0. No
///         afterSwapReturnDelta — this hook does not skim a swap delta (value capture
///         stays a separate concern; 50/25/25 fee collection lands with the FeeVault wiring).
///
/// @dev    Trader identity for MEV cooldown keys on tx.origin, because V4 reports the
///         router as `sender`. This catches naive single-EOA sandwiches; multi-address
///         attackers are the Attribution/sybil layer's job. Documented tradeoff.
contract MWHookCoordinator is IHooks, Ownable {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;
    using MWMEVGuard    for MWMEVGuard.State;

    uint160 public constant HOOK_FLAGS = 0xAC0;

    struct FeeParams {
        uint24  baseFeePips;      // floor fee (3000 = 0.30%)
        uint24  maxFeePips;       // ceiling (0 → 100%)
        uint256 slopePipsPerBp;   // pips added per bp of volatility
        bool    dynamicFeeEnabled;
        bool    mevEnabled;
        bool    configured;
    }

    IPoolManager public immutable POOL_MANAGER;

    /// @notice The only address permitted to add/remove liquidity in coordinated pools.
    address public vault;

    mapping(PoolId => FeeParams) public feeParams;
    mapping(PoolId => MWMEVGuard.State) internal mev;

    event VaultUpdated(address indexed vault);
    event PoolConfigured(PoolId indexed poolId, bool dynamicFee, bool mev);

    error OnlyPoolManager();
    error OnlyVaultCanModifyLiquidity();

    modifier onlyPoolManager() {
        if (msg.sender != address(POOL_MANAGER)) revert OnlyPoolManager();
        _;
    }

    constructor(IPoolManager _poolManager, address _vault, address _initialOwner) Ownable(_initialOwner) {
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

    /// @notice Configure a pool's dynamic-fee + MEV parameters.
    function configurePool(
        PoolId poolId,
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint256 slopePipsPerBp,
        bool dynamicFeeEnabled,
        bool mevEnabled,
        uint32 cooldownBlocks,
        uint16 maxDeviationBps,
        uint16 emaAlphaBps
    ) external onlyOwner {
        feeParams[poolId] = FeeParams({
            baseFeePips:       baseFeePips,
            maxFeePips:        maxFeePips,
            slopePipsPerBp:    slopePipsPerBp,
            dynamicFeeEnabled: dynamicFeeEnabled,
            mevEnabled:        mevEnabled,
            configured:        true
        });
        MWMEVGuard.State storage s = mev[poolId];
        s.cooldownBlocks  = cooldownBlocks;
        s.maxDeviationBps = maxDeviationBps;
        s.emaAlphaBps     = emaAlphaBps;
        emit PoolConfigured(poolId, dynamicFeeEnabled, mevEnabled);
    }

    // ── IHooks: liquidity gate ───────────────────────────────────────────────

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external view override onlyPoolManager returns (bytes4)
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

    // ── IHooks: swap — MEV guard + dynamic fee ───────────────────────────────

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external view override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        FeeParams storage fp = feeParams[id];

        (uint160 sqrtP,,,) = POOL_MANAGER.getSlot0(id);

        if (fp.mevEnabled) {
            mev[id].checkBefore(tx.origin, params.zeroForOne, sqrtP);
        }

        uint24 feeOverride = 0;
        if (fp.dynamicFeeEnabled) {
            uint256 volBps = mev[id].emaInitialized
                ? MWMEVGuard.deviationBps(sqrtP, mev[id].emaSqrtPriceX96)
                : 0;
            uint24 fee = MWDynamicFee.volatilityFee(fp.baseFeePips, fp.maxFeePips, volBps, fp.slopePipsPerBp);
            feeOverride = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        }

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), feeOverride);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        PoolId id = key.toId();
        if (feeParams[id].mevEnabled) {
            (uint160 sqrtP,,,) = POOL_MANAGER.getSlot0(id);
            mev[id].recordAfter(tx.origin, params.zeroForOne, sqrtP);
        }
        return (IHooks.afterSwap.selector, 0);
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
