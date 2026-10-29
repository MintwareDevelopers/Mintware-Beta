// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MWV4Settlement} from "./MWV4Settlement.sol";

/// @notice Shared direct-PoolManager position operation for Mintware's typed position owners.
/// @dev Executes one modifyLiquidity call and settles its delta in the caller's context. Position
///      identity, range, hook data, NAV, token measurement, and claim accounting remain caller-owned.
///      This function does not open or close an unlock; callers must already be inside their own
///      PoolManager unlock callback.
library MWV4PositionEngine {
    /// @notice Apply one V4 position mutation and return its raw delta to the typed position owner.
    /// @dev Use for paths whose payout is recipient-specific or whose delta remains an ERC-6909 claim.
    ///      The caller still owns all settlement and claim accounting.
    function modify(
        IPoolManager poolManager,
        PoolKey memory key,
        ModifyLiquidityParams memory params,
        bytes memory hookData
    ) internal returns (BalanceDelta delta) {
        (delta,) = poolManager.modifyLiquidity(key, params, hookData);
    }

    function modifyAndSettle(
        IPoolManager poolManager,
        PoolKey memory key,
        ModifyLiquidityParams memory params,
        bytes memory hookData
    ) internal {
        BalanceDelta delta = modify(poolManager, key, params, hookData);
        MWV4Settlement.settleDelta(poolManager, key, delta);
    }

    /// @notice Add a position and return each supplied asset's measured balance consumption.
    /// @dev Use only when the caller owns both tokens and needs actual usage for its own refund or
    ///      claim accounting. `assetA`/`assetB` are returned in the same order supplied, independent
    ///      of PoolKey currency order. The caller must already be inside its PoolManager unlock.
    function modifyAndSettleMeasured(
        IPoolManager poolManager,
        PoolKey memory key,
        ModifyLiquidityParams memory params,
        bytes memory hookData,
        IERC20 assetA,
        IERC20 assetB
    ) internal returns (uint256 usedA, uint256 usedB) {
        uint256 balanceABefore = assetA.balanceOf(address(this));
        uint256 balanceBBefore = assetB.balanceOf(address(this));

        modifyAndSettle(poolManager, key, params, hookData);

        usedA = balanceABefore - assetA.balanceOf(address(this));
        usedB = balanceBBefore - assetB.balanceOf(address(this));
    }

    /// @notice Mutate a position and return measured receipts in caller-supplied asset order.
    /// @dev Checked balance subtraction reverts if a removal produces a negative net receipt. The
    ///      caller keeps its liquidity guards, recipient policy, and claim accounting; it must
    ///      already be inside its PoolManager unlock.
    function modifyAndSettleReceived(
        IPoolManager poolManager,
        PoolKey memory key,
        ModifyLiquidityParams memory params,
        bytes memory hookData,
        IERC20 assetA,
        IERC20 assetB
    ) internal returns (uint256 receivedA, uint256 receivedB) {
        uint256 balanceABefore = assetA.balanceOf(address(this));
        uint256 balanceBBefore = assetB.balanceOf(address(this));

        modifyAndSettle(poolManager, key, params, hookData);

        receivedA = assetA.balanceOf(address(this)) - balanceABefore;
        receivedB = assetB.balanceOf(address(this)) - balanceBBefore;
    }

    /// @notice Collect position fees and return the amounts actually received by this caller.
    /// @dev The caller must already be inside its PoolManager unlock. Measured receipts are shared;
    ///      fee ownership, conversion, and accounting remain with the typed position owner.
    function collectMeasured(
        IPoolManager poolManager,
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        IERC20 currency0,
        IERC20 currency1,
        bytes memory hookData
    ) internal returns (uint256 amount0, uint256 amount1) {
        return modifyAndSettleReceived(
            poolManager,
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: bytes32(0)}),
            hookData,
            currency0,
            currency1
        );
    }

    /// @notice Collect a position's fees and return the nominal PoolManager delta.
    /// @dev Some position owners intentionally account from PoolManager's delta, while others use
    ///      measured receipt. Keep both policies explicit over the same zero-liquidity mutation.
    function collectDelta(
        IPoolManager poolManager,
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        bytes memory hookData
    ) internal returns (BalanceDelta delta) {
        delta = modify(
            poolManager,
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: bytes32(0)}),
            hookData
        );
        MWV4Settlement.settleDelta(poolManager, key, delta);
    }
}
