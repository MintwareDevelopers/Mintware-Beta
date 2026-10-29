// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared tick-spacing rounding used by V4 positions and hooks.
library MWV4TickSpacing {
    /// @dev Round down to a spacing multiple, including negative ticks (toward -infinity).
    ///      Callers must pass the positive tickSpacing from a valid Uniswap V4 PoolKey.
    function alignDown(int24 tick, int24 spacing) internal pure returns (int24 rounded) {
        rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
    }
}
