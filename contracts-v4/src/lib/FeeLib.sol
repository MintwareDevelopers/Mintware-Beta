// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  FeeLib
/// @notice Attribution-weighted fee share calculation
/// @dev    Attribution percentiles are provided by oracle signature (off-chain).
///         This library handles the on-chain math only.
library FeeLib {
    uint256 internal constant BPS = 10_000;

    /// @notice Attribution multiplier from liquidity percentile
    /// @param  percentile  0–100 (provided by oracle)
    /// @return multiplier  in bps (10_000 = 1.0×, 15_000 = 1.5×)
    function attributionMultiplier(uint16 percentile) internal pure returns (uint256) {
        if (percentile >= 67) return 15_000; // 1.5×
        if (percentile >= 34) return 12_500; // 1.25×
        return 10_000;                        // 1.0×
    }

    /// @notice Sharing (referral) multiplier from sharing percentile
    /// @param  percentile  0–100
    /// @return multiplier  in bps
    function sharingMultiplier(uint16 percentile) internal pure returns (uint256) {
        if (percentile >= 67) return 13_000; // 1.3×
        if (percentile >= 34) return 11_500; // 1.15×
        return 10_000;                        // 1.0×
    }

    /// @notice Combined multiplier (attribution × sharing), capped at 1.95×
    function combinedMultiplier(
        uint16 liquidityPercentile,
        uint16 sharingPercentile
    ) internal pure returns (uint256) {
        uint256 a = attributionMultiplier(liquidityPercentile);
        uint256 s = sharingMultiplier(sharingPercentile);
        uint256 combined = (a * s) / BPS;
        // Cap at 1.95× (19_500 bps)
        return combined > 19_500 ? 19_500 : combined;
    }

    /// @notice Weighted share for one LP in an epoch
    /// @param  deposit         LP's USDC deposit
    /// @param  totalDeposits   vault total USDC
    /// @param  lockMultiplier  from LockLib.feeMultiplier()
    /// @param  attrMultiplier  from FeeLib.combinedMultiplier()
    /// @param  epochPool       total USDC available for LP distribution
    function lpShare(
        uint256 deposit,
        uint256 totalDeposits,
        uint256 lockMultiplier,
        uint256 attrMultiplier,
        uint256 epochPool
    ) internal pure returns (uint256) {
        if (totalDeposits == 0) return 0;
        uint256 base    = (epochPool * deposit) / totalDeposits;
        uint256 boosted = (base * lockMultiplier) / BPS;
        boosted         = (boosted * attrMultiplier) / BPS;
        return boosted;
    }
}
