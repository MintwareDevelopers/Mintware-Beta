// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  MWDynamicFee
/// @notice Volatility- and depth-adjusted swap-fee math for the Phase-3 DeFi
///         dynamic-fee hook (Track A2). Fees are expressed in V4 pips
///         (1_000_000 = 100%, so 3000 = 0.30%). Pure + unit-testable.
///
/// @dev    Volatility fee: higher recent volatility → higher fee (capture more of
///         the value that volatility creates). Depth discount: deeper liquidity →
///         lower fee (reward the pools that most reduce price impact).
library MWDynamicFee {
    uint24  internal constant MAX_PIPS = 1_000_000; // 100%
    uint256 internal constant BPS      = 10_000;

    /// @notice base + slope·volatility, clamped to `maxFeePips` (or 100% if 0).
    /// @param baseFeePips    floor fee in pips (e.g. 3000 = 0.30%)
    /// @param maxFeePips     ceiling fee in pips (0 → 100%)
    /// @param volatilityBps  recent volatility measure in bps (e.g. EMA deviation)
    /// @param slopePipsPerBp pips added per 1 bp of volatility
    function volatilityFee(
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint256 volatilityBps,
        uint256 slopePipsPerBp
    ) internal pure returns (uint24) {
        uint256 fee = uint256(baseFeePips) + (volatilityBps * slopePipsPerBp);
        uint256 cap = maxFeePips == 0 ? MAX_PIPS : maxFeePips;
        if (fee > cap) fee = cap;
        return uint24(fee);
    }

    /// @notice Reduce `feePips` by up to `maxDiscountBps` as liquidity scales from
    ///         1× the reference (no discount) to ≥2× (full discount), linearly.
    function applyDepthDiscount(
        uint24 feePips,
        uint128 liquidity,
        uint128 refLiquidity,
        uint16 maxDiscountBps
    ) internal pure returns (uint24) {
        if (refLiquidity == 0 || liquidity == 0 || maxDiscountBps == 0) return feePips;

        uint256 ratio = (uint256(liquidity) * BPS) / refLiquidity; // 10_000 == 1×
        uint256 discountBps;
        if (ratio <= BPS) {
            discountBps = 0;
        } else if (ratio >= 2 * BPS) {
            discountBps = maxDiscountBps;
        } else {
            discountBps = (uint256(maxDiscountBps) * (ratio - BPS)) / BPS;
        }

        uint256 fee = uint256(feePips) - (uint256(feePips) * discountBps) / BPS;
        return uint24(fee);
    }
}
