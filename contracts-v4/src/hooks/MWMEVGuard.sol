// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  MWMEVGuard
/// @notice Core MEV-protection primitives for the Phase-3 DeFi hooks (Track A3):
///         per-trader sandwich/cooldown detection + an EMA price-deviation guard.
///         Dependency-free (no V4 types) so it is unit-testable in isolation and
///         reusable by the new MEV-protection hook.
///
/// @dev    Sandwich model: a naive same-address sandwich is frontrun (dir A) →
///         victim → backrun (dir !A). This guard blocks a trader's opposite-direction
///         swap within `cooldownBlocks` of their last swap — killing the backrun leg.
///         Limitation: multi-address attackers are not caught here (that needs the
///         Attribution/sybil layer); this raises cost + friction for naive sandwiches.
library MWMEVGuard {
    struct State {
        uint32  cooldownBlocks;   // min blocks before a trader may swap the opposite direction
        uint16  maxDeviationBps;  // max |price - EMA| / EMA (0 = deviation guard disabled)
        uint16  emaAlphaBps;      // EMA smoothing factor in bps (e.g. 2000 = 0.2)
        uint160 emaSqrtPriceX96;  // running EMA reference price
        bool    emaInitialized;
        mapping(address => uint256) lastSwapBlock;
        mapping(address => bool)    lastZeroForOne;
        mapping(address => bool)    hasSwapped;
    }

    error SandwichCooldownActive();
    error PriceDeviationTooHigh();

    uint256 internal constant BPS = 10_000;

    /// @notice Revert if `trader`'s swap looks like a sandwich backrun, or if the
    ///         current price deviates from the EMA beyond `maxDeviationBps`.
    function checkBefore(
        State storage s,
        address trader,
        bool zeroForOne,
        uint160 currentSqrtPriceX96
    ) internal view {
        if (
            s.hasSwapped[trader] &&
            s.lastZeroForOne[trader] != zeroForOne &&
            block.number < s.lastSwapBlock[trader] + s.cooldownBlocks
        ) {
            revert SandwichCooldownActive();
        }

        if (s.maxDeviationBps != 0 && s.emaInitialized) {
            if (_deviationBps(currentSqrtPriceX96, s.emaSqrtPriceX96) > s.maxDeviationBps) {
                revert PriceDeviationTooHigh();
            }
        }
    }

    /// @notice Record post-swap trader state and fold the new price into the EMA.
    function recordAfter(
        State storage s,
        address trader,
        bool zeroForOne,
        uint160 newSqrtPriceX96
    ) internal {
        s.lastSwapBlock[trader]  = block.number;
        s.lastZeroForOne[trader] = zeroForOne;
        s.hasSwapped[trader]     = true;

        if (!s.emaInitialized) {
            s.emaSqrtPriceX96 = newSqrtPriceX96;
            s.emaInitialized  = true;
        } else {
            s.emaSqrtPriceX96 = _ema(s.emaSqrtPriceX96, newSqrtPriceX96, s.emaAlphaBps);
        }
    }

    /// @notice |a - b| / b in bps.
    function deviationBps(uint160 a, uint160 b) internal pure returns (uint256) {
        return _deviationBps(a, b);
    }

    function _deviationBps(uint160 a, uint160 b) private pure returns (uint256) {
        if (b == 0) return 0;
        uint256 diff = a > b ? uint256(a) - b : uint256(b) - a;
        return (diff * BPS) / b;
    }

    /// @dev EMA = prev + alpha·(next − prev).
    function _ema(uint160 prev, uint160 next, uint16 alphaBps) private pure returns (uint160) {
        if (next >= prev) {
            uint256 delta = (uint256(next - prev) * alphaBps) / BPS;
            return uint160(uint256(prev) + delta);
        }
        uint256 down = (uint256(prev - next) * alphaBps) / BPS;
        return uint160(uint256(prev) - down);
    }
}
