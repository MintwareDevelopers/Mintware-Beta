// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  MWDynamicFee
/// @notice Deviation-priced swap-fee math for the Phase-3 DeFi dynamic-fee hook (Track A2).
///         Fees are expressed in V4 pips (1_000_000 = 100%, so 3000 = 0.30%). Pure + unit-testable.
///
/// @dev    Volatility fee: the further spot deviates from the truncated oracle, the higher the fee
///         (capture more of the value that volatility/manipulation creates). The caller
///         (MWHookCoordinator) supplies the deviation in TICKS and a per-tick slope.
library MWDynamicFee {
    uint24  internal constant MAX_PIPS = 1_000_000; // 100%

    /// @notice base + slope·deviation, clamped to `maxFeePips` (or 100% if 0).
    /// @param baseFeePips      floor fee in pips (e.g. 3000 = 0.30%)
    /// @param maxFeePips       ceiling fee in pips (0 → 100%)
    /// @param deviationTicks   |spot − oracle| in ticks (from MWOracleGuard.deviationTicks)
    /// @param slopePipsPerTick pips added per tick of deviation
    function volatilityFee(
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint256 deviationTicks,
        uint256 slopePipsPerTick
    ) internal pure returns (uint24) {
        uint256 fee = uint256(baseFeePips) + (deviationTicks * slopePipsPerTick);
        uint256 cap = maxFeePips == 0 ? MAX_PIPS : maxFeePips;
        if (fee > cap) fee = cap;
        return uint24(fee);
    }

    /// @notice Rate-limit a fee move: clamp `target` to within `maxStep` of `last` (Stage-1.2).
    /// @dev    Prevents a single-block jump from base fee to max fee, which is what lets an MEV
    ///         searcher cleanly front-run a predictable hike / back-run a predictable drop. The
    ///         caller passes `maxStep = maxFeeStepPerBlock × blocksElapsed` so the budget scales
    ///         with elapsed time. `last == 0` (uninitialized) adopts `target` directly.
    function rateLimit(uint24 last, uint24 target, uint256 maxStep) internal pure returns (uint24) {
        if (last == 0) return target;
        if (target > last) {
            uint256 up = uint256(last) + maxStep;
            return target > up ? uint24(up) : target;
        }
        uint256 down = uint256(last) > maxStep ? uint256(last) - maxStep : 0;
        return uint256(target) < down ? uint24(down) : target;
    }
}
