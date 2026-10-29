// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Read-only mark for an asset held by a quote-denominated market portfolio.
/// @dev `priceWad` is quote-token whole units per one whole asset token, scaled by 1e18.
///      The market owner remains responsible for checking `updatedAt`, rejecting stale/future
///      observations, and applying per-asset bounds. A pool spot price is not an independent mark.
///      Implementations may wrap an approved aggregator or partner valuation source; their
///      suitability and chain deployment must be verified before the market accepts deposits.
interface IMarketAssetMark {
    /// @notice Asset priced by `latestMark`, in whole-token units.
    function asset() external view returns (address);

    /// @notice Quote asset used by `latestMark`, in whole-token units.
    function quoteAsset() external view returns (address);

    /// @return priceWad Quote tokens per whole asset token, scaled by 1e18.
    /// @return updatedAt Timestamp of the source observation, not the wrapper call time.
    function latestMark() external view returns (uint256 priceWad, uint64 updatedAt);
}
