// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  MWOracleGuard
/// @notice Manipulation-resistant price reference for the Phase-3 DeFi hook (Stage-1.2 rebuild).
///
///         Replaces the previous per-trader, `tx.origin`-keyed sandwich cooldown — which V4's
///         router-as-`sender` design forced and which only caught naive single-EOA attackers —
///         with a **truncated geometric-mean-style tick oracle that reads no trader identity at
///         all.** The oracle tick lags spot and advances at most `maxTickMovePerBlock` per block;
///         swaps within the same block do NOT move it. So a single-block price push (the shape of
///         a sandwich frontrun, or any spot manipulation) barely moves the reference. The hook
///         then prices that swap by its DEVIATION from the oracle (see MWDynamicFee) and, at the
///         extreme, trips a circuit breaker — working identically for single- and multi-address
///         attackers, which the old model could not.
///
/// @dev    Pure tick math over a storage State; no V4 types, unit-testable in isolation.
library MWOracleGuard {
    struct State {
        int24  oracleTick;          // truncated reference tick (lags spot)
        uint32 lastBlock;           // block of the last cross-block advance
        int24  maxTickMovePerBlock; // truncation budget per block
        int24  maxDeviationTicks;   // hard circuit breaker (0 = disabled)
        uint32 maxCatchupBlocks;    // cap on the blocks counted toward the move budget
        bool   initialized;
    }

    error PriceDeviationTooHigh();

    /// @notice |currentTick - oracleTick| in ticks (0 before init).
    function deviationTicks(State storage s, int24 currentTick) internal view returns (uint256) {
        if (!s.initialized) return 0;
        int24 d = currentTick >= s.oracleTick ? currentTick - s.oracleTick : s.oracleTick - currentTick;
        return uint256(uint24(d));
    }

    /// @notice Revert if the current tick deviates beyond the circuit-breaker band.
    function checkCircuitBreaker(State storage s, int24 currentTick) internal view {
        if (!s.initialized || s.maxDeviationTicks == 0) return;
        if (deviationTicks(s, currentTick) > uint256(uint24(s.maxDeviationTicks))) {
            revert PriceDeviationTooHigh();
        }
    }

    /// @notice Fold the (post-swap) tick into the truncated oracle. Intra-block calls are no-ops
    ///         (the oracle advances at most once per block), and each advance is clamped to
    ///         `maxTickMovePerBlock × min(blocksElapsed, maxCatchupBlocks)`.
    function update(State storage s, int24 currentTick) internal {
        if (!s.initialized) {
            s.oracleTick  = currentTick;
            s.lastBlock   = uint32(block.number);
            s.initialized = true;
            return;
        }
        if (block.number == s.lastBlock) return; // frozen within a block

        uint256 elapsed = block.number - s.lastBlock;
        uint256 catchup = s.maxCatchupBlocks == 0 ? 1 : s.maxCatchupBlocks;
        if (elapsed > catchup) elapsed = catchup;

        int256 cap = int256(uint256(uint24(s.maxTickMovePerBlock)) * elapsed);
        int256 lo  = int256(s.oracleTick) - cap;
        int256 hi  = int256(s.oracleTick) + cap;
        int256 t   = int256(currentTick);
        int256 nt  = t < lo ? lo : (t > hi ? hi : t);

        s.oracleTick = int24(nt);
        s.lastBlock  = uint32(block.number);
    }
}
