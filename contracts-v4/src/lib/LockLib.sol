// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  LockLib
/// @notice Lock tier durations, multipliers, and early-exit penalty math
library LockLib {
    uint256 internal constant BPS          = 10_000;
    uint256 internal constant LOCK_FLEX      = 0;
    uint256 internal constant LOCK_COMMITTED = 30 days;
    uint256 internal constant LOCK_ALIGNED   = 90 days;
    uint256 internal constant LOCK_CORE      = 180 days;

    // Fee multipliers in bps (10_000 = 1.0×)
    uint256 internal constant MULT_FLEX      = 10_000; // 1.00×
    uint256 internal constant MULT_COMMITTED = 11_500; // 1.15×
    uint256 internal constant MULT_ALIGNED   = 13_000; // 1.30×
    uint256 internal constant MULT_CORE      = 15_000; // 1.50×

    // Early exit penalties in bps
    uint256 internal constant PENALTY_1 = 200; // 2.0% — < 20% elapsed
    uint256 internal constant PENALTY_2 = 100; // 1.0% — 20–50% elapsed
    uint256 internal constant PENALTY_3 =  50; // 0.5% — 50–80% elapsed

    function lockDuration(uint8 tier) internal pure returns (uint256) {
        if (tier == 1) return LOCK_COMMITTED;
        if (tier == 2) return LOCK_ALIGNED;
        if (tier == 3) return LOCK_CORE;
        return LOCK_FLEX;
    }

    function feeMultiplier(uint8 tier) internal pure returns (uint256) {
        if (tier == 1) return MULT_COMMITTED;
        if (tier == 2) return MULT_ALIGNED;
        if (tier == 3) return MULT_CORE;
        return MULT_FLEX;
    }

    function penaltyBps(
        uint8   tier,
        uint256 depositedAt,
        uint256 lockedUntil
    ) internal view returns (uint256) {
        if (tier == 0) return 0; // Flex — no penalty
        if (block.timestamp >= lockedUntil) return 0; // lock expired

        uint256 duration = lockDuration(tier);
        uint256 elapsed  = block.timestamp - depositedAt;
        uint256 pct      = (elapsed * 100) / duration;

        if (pct < 20)  return PENALTY_1;
        if (pct < 50)  return PENALTY_2;
        if (pct < 80)  return PENALTY_3;
        return 0;
    }
}
