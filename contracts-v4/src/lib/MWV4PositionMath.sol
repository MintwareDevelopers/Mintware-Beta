// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {MWV4TickSpacing} from "./MWV4TickSpacing.sol";

/// @notice Shared round-down token composition for a Uniswap v4 liquidity position at a price.
/// @dev This is only position math. Callers retain price selection, token denomination, NAV,
///      transfer measurement, share accounting, and redemption policy.
library MWV4PositionMath {
    uint256 private constant Q96 = 0x1000000000000000000000000;

    /// @notice Derive the shared one-sided JIT range around the current tick.
    /// @dev `zeroForOne` means the swap output is currency1, so the JIT range sits below the
    ///      aligned tick. Caller retains usable-tick validation and failure/fallback policy.
    function jitRange(int24 tick, int24 spacing, int24 widthSpacings, bool zeroForOne)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        int24 width = spacing * widthSpacings;
        if (zeroForOne) {
            tickUpper = MWV4TickSpacing.alignDown(tick, spacing);
            tickLower = tickUpper - width;
        } else {
            tickLower = MWV4TickSpacing.alignDown(tick, spacing) + spacing;
            tickUpper = tickLower + width;
        }
    }

    /// @notice Size one-sided JIT liquidity using the output currency and its available amount.
    /// @dev Caller validates the range before invoking this function where its lifecycle requires
    ///      graceful handling of out-of-range ticks.
    function jitLiquidity(int24 tickLower, int24 tickUpper, bool zeroForOne, uint256 amount)
        internal
        pure
        returns (uint128 liquidity)
    {
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        return zeroForOne
            ? LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, amount)
            : LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, amount);
    }

    function amountsForLiquidity(uint160 sqrtPriceX96, uint160 sqrtA, uint160 sqrtB, uint128 liquidity)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);

        if (sqrtPriceX96 <= sqrtA) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liquidity, false);
        } else if (sqrtPriceX96 < sqrtB) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtB, liquidity, false);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtPriceX96, liquidity, false);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liquidity, false);
        }
    }

    /// @notice Size the shared maximal liquidity amount for a token pair at a pool price and range.
    /// @dev Callers retain their price selection, transfer measurement, minimums, and claim accounting.
    function liquidityForAmounts(
        uint160 sqrtPriceX96,
        uint160 sqrtA,
        uint160 sqrtB,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128) {
        return LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, amount0, amount1);
    }

    /// @notice Value a non-quote currency amount in quote units at the pool's sqrt price.
    /// @dev `quoteIsCurrency0` determines whether the amount is multiplied or divided by
    ///      `(sqrtPriceX96 / 2**96)^2`. Two full-precision stages avoid squaring sqrtPriceX96.
    function quoteValue(uint256 amount, uint160 sqrtPriceX96, bool quoteIsCurrency0)
        internal
        pure
        returns (uint256)
    {
        if (amount == 0) return 0;
        uint256 numerator = quoteIsCurrency0 ? Q96 : sqrtPriceX96;
        uint256 denominator = quoteIsCurrency0 ? sqrtPriceX96 : Q96;
        uint256 firstStage = FullMath.mulDiv(amount, numerator, denominator);
        return FullMath.mulDiv(firstStage, numerator, denominator);
    }
}
