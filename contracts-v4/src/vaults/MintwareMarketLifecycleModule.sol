// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

import {MWV4PositionEngine} from "../lib/MWV4PositionEngine.sol";
import {MWV4PositionMath} from "../lib/MWV4PositionMath.sol";
import {MWV4Settlement} from "../lib/MWV4Settlement.sol";

/// @notice Stateless callback executor for a Mintware market owner.
/// @dev Intended only for delegatecall from the configured engine. Its own runtime stores no assets or
///      claim state; PoolManager and token calls execute as the engine address, and the engine persists
///      the returned liquidity and range state.
contract MintwareMarketLifecycleModule {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    error InvalidConfiguration();
    error InsufficientLiquidity();
    error InvalidSwap();

    /// @dev Action values match MintwareMarketEngine.UnlockAction.
    function executeCallback(
        IPoolManager poolManager,
        PoolKey calldata poolKey,
        int24 tickLower,
        int24 tickUpper,
        IERC20 token0,
        IERC20 token1,
        uint8 action,
        bytes calldata data,
        uint128 currentLiquidity
    ) external returns (uint128 nextLiquidity, bytes memory result) {
        if (action == 0) {
            (uint256 amount0, uint256 amount1) = MWV4PositionEngine.collectMeasured(
                poolManager, poolKey, tickLower, tickUpper, token0, token1, bytes("")
            );
            return (currentLiquidity, abi.encode(amount0, amount1));
        }

        if (action == 1) {
            (, int128 delta, uint256 max0, uint256 max1) =
                abi.decode(data, (uint8, int128, uint256, uint256));
            if (delta <= 0 || max0 > type(uint128).max || max1 > type(uint128).max) {
                revert InvalidConfiguration();
            }
            (uint256 used0, uint256 used1) = MWV4PositionEngine.modifyAndSettleMeasured(
                poolManager,
                poolKey,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: delta,
                    salt: bytes32(0)
                }),
                bytes(""),
                token0,
                token1
            );
            if (used0 > max0 || used1 > max1) revert InvalidConfiguration();
            return (currentLiquidity + uint128(delta), abi.encode(used0, used1));
        }

        if (action == 2) {
            (, int128 delta) = abi.decode(data, (uint8, int128));
            if (delta >= 0 || uint128(-delta) > currentLiquidity) revert InsufficientLiquidity();
            (uint256 received0, uint256 received1) = MWV4PositionEngine.modifyAndSettleReceived(
                poolManager,
                poolKey,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: delta,
                    salt: bytes32(0)
                }),
                bytes(""),
                token0,
                token1
            );
            return (currentLiquidity - uint128(-delta), abi.encode(received0, received1));
        }

        if (action == 3) {
            (, bool zeroForOne, uint256 amountIn, uint160 sqrtPriceLimitX96) =
                abi.decode(data, (uint8, bool, uint256, uint160));
            if (amountIn == 0 || amountIn > uint256(type(int256).max)) revert InvalidSwap();
            BalanceDelta delta = poolManager.swap(
                poolKey,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -int256(amountIn),
                    sqrtPriceLimitX96: sqrtPriceLimitX96
                }),
                bytes("")
            );
            (uint256 amountOut, bool exactOutputReceived) =
                MWV4Settlement.settleSwapDeltaExactOutput(poolManager, poolKey, delta, zeroForOne);
            if (!exactOutputReceived) revert InvalidSwap();
            return (currentLiquidity, abi.encode(amountOut));
        }

        if (action == 4) {
            (, int24 nextLower, int24 nextUpper, uint128 minLiquidity) =
                abi.decode(data, (uint8, int24, int24, uint128));
            if (
                currentLiquidity == 0 || currentLiquidity > uint128(type(int128).max)
                    || nextLower >= nextUpper || minLiquidity == 0
            ) revert InsufficientLiquidity();

            (uint160 sqrtPriceBefore,,,) = poolManager.getSlot0(poolKey.toId());
            uint256 before0 = token0.balanceOf(address(this));
            uint256 before1 = token1.balanceOf(address(this));
            MWV4PositionEngine.modifyAndSettleReceived(
                poolManager,
                poolKey,
                ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: -int128(currentLiquidity),
                    salt: bytes32(0)
                }),
                bytes(""),
                token0,
                token1
            );
            uint256 available0 = token0.balanceOf(address(this)) - before0;
            uint256 available1 = token1.balanceOf(address(this)) - before1;
            (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
            if (sqrtPriceX96 != sqrtPriceBefore) revert InvalidConfiguration();
            uint128 recenteredLiquidity = MWV4PositionMath.liquidityForAmounts(
                sqrtPriceX96,
                TickMath.getSqrtPriceAtTick(nextLower),
                TickMath.getSqrtPriceAtTick(nextUpper),
                available0,
                available1
            );
            if (
                recenteredLiquidity < minLiquidity || recenteredLiquidity == 0
                    || recenteredLiquidity > uint128(type(int128).max)
            ) revert InsufficientLiquidity();
            (uint256 used0, uint256 used1) = MWV4PositionEngine.modifyAndSettleMeasured(
                poolManager,
                poolKey,
                ModifyLiquidityParams({
                    tickLower: nextLower,
                    tickUpper: nextUpper,
                    liquidityDelta: int128(recenteredLiquidity),
                    salt: bytes32(0)
                }),
                bytes(""),
                token0,
                token1
            );
            if (used0 > available0 || used1 > available1) revert InvalidConfiguration();
            (uint160 sqrtPriceAfter,,,) = poolManager.getSlot0(poolKey.toId());
            if (sqrtPriceAfter != sqrtPriceBefore) revert InvalidConfiguration();
            return (recenteredLiquidity, abi.encode(nextLower, nextUpper, used0, used1));
        }

        revert InvalidConfiguration();
    }
}
