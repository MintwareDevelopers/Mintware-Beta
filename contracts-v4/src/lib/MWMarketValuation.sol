// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMarketAssetMark} from "../vaults/IMarketAssetMark.sol";

/// @notice Freshness checks and decimal-aware conversion for quote-denominated market NAV.
/// @dev The caller chooses the accepted mark source and maximum age for each asset. The library
///      rejects stale/future/zero marks, but cannot establish provider quality or feed suitability.
library MWMarketValuation {
    uint8 internal constant MAX_TOKEN_DECIMALS = 18;
    uint256 private constant DECIMAL_BASE = 10;
    uint256 private constant WAD = 1e18;

    error ZeroAddress();
    error MarkHasNoCode();
    error InvalidDecimals();
    error ZeroMark();
    error MissingMarkTimestamp();
    error FutureMark();
    error StaleMark();

    /// @notice Read a mark and require its source observation to be fresh and non-future.
    function freshPriceWad(IMarketAssetMark source, uint256 maxAge)
        internal
        view
        returns (uint256 priceWad, uint64 updatedAt)
    {
        if (address(source) == address(0)) revert ZeroAddress();
        if (address(source).code.length == 0) revert MarkHasNoCode();
        (priceWad, updatedAt) = source.latestMark();
        if (priceWad == 0) revert ZeroMark();
        if (updatedAt == 0) revert MissingMarkTimestamp();
        if (updatedAt > block.timestamp) revert FutureMark();
        if (block.timestamp - updatedAt > maxAge) revert StaleMark();
    }

    /// @notice Convert an asset quantity into quote-token raw units using a WAD mark.
    /// @param amountRaw       Asset amount in its raw ERC-20 units.
    /// @param assetDecimals   Configured decimals for the asset.
    /// @param quoteDecimals   Configured decimals for the quote token.
    /// @param priceWad        Quote whole tokens per whole asset token, scaled by 1e18.
    function quoteValueRaw(uint256 amountRaw, uint8 assetDecimals, uint8 quoteDecimals, uint256 priceWad)
        internal
        pure
        returns (uint256 quoteAmountRaw)
    {
        if (assetDecimals > MAX_TOKEN_DECIMALS || quoteDecimals > MAX_TOKEN_DECIMALS) revert InvalidDecimals();
        if (amountRaw == 0 || priceWad == 0) return 0;

        // amountRaw × (quoteWhole / assetWhole) × 10**quoteDecimals / 10**assetDecimals
        // where priceWad = quoteWhole / assetWhole × 1e18. One full-precision division keeps
        // rounding to a single conservative floor in quote-token raw units.
        uint256 denominator = DECIMAL_BASE ** (assetDecimals + 18 - quoteDecimals);
        quoteAmountRaw = Math.mulDiv(amountRaw, priceWad, denominator);
    }
}
