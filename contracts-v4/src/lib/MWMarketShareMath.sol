// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Share conversion for a quote-valued, pro-rata market portfolio.
/// @dev Uses real NAV and actual supply so minted shares and in-kind exits describe the same
///      fractional claim. This library does not choose or validate NAV marks, liabilities, or
///      measured asset values; the position owner must supply those inputs consistently.
library MWMarketShareMath {
    uint8 internal constant SHARE_DECIMALS = 18;
    uint8 internal constant MAX_QUOTE_DECIMALS = 36;
    uint256 private constant DECIMAL_BASE = 10;

    error InvalidShareState();
    error ZeroBootstrapNav();
    error UnsupportedQuoteDecimals();
    error ShareNormalizationOverflow();
    error ZeroContribution();
    error ZeroShares();
    error ZeroNavReduction();
    error ExitExceedsClaim();
    error IncompleteExitConsumesRequest();
    error FinalShareWouldLeaveNav();

    /// @notice Initial 18-decimal shares for recognized post-inflow NAV, including recognized donations.
    /// @dev `quoteDecimals` describes the quote-unit precision used by `recognizedNavAfter`.
    function sharesForBootstrap(uint256 recognizedNavAfter, uint8 quoteDecimals)
        internal
        pure
        returns (uint256 shares)
    {
        if (recognizedNavAfter == 0) revert ZeroBootstrapNav();
        if (quoteDecimals > MAX_QUOTE_DECIMALS) revert UnsupportedQuoteDecimals();
        if (quoteDecimals <= SHARE_DECIMALS) {
            uint256 scale = DECIMAL_BASE ** (SHARE_DECIMALS - quoteDecimals);
            if (recognizedNavAfter > type(uint256).max / scale) revert ShareNormalizationOverflow();
            shares = recognizedNavAfter * scale;
        } else {
            shares = recognizedNavAfter / (DECIMAL_BASE ** (quoteDecimals - SHARE_DECIMALS));
        }
        if (shares == 0) revert ZeroShares();
    }

    /// @notice Shares minted for a measured contribution against initialized portfolio NAV and supply.
    /// @dev Contribution and NAV must use the same quote units; virtual offsets are not used.
    function sharesForDeposit(uint256 contributionValue, uint256 navBefore, uint256 supplyBefore)
        internal
        pure
        returns (uint256 shares)
    {
        if (contributionValue == 0) revert ZeroContribution();
        if (supplyBefore == 0 || navBefore == 0) revert InvalidShareState();
        shares = Math.mulDiv(contributionValue, supplyBefore, navBefore, Math.Rounding.Floor);
        if (shares == 0) revert ZeroShares();
    }

    /// @notice Shares burned for the measured NAV reduction from an incomplete in-kind exit.
    /// @param requestedShares Shares the holder offered to redeem.
    /// @param navReduction    Pre-exit NAV minus post-exit NAV under the same marks/liability rules.
    /// @param navBefore       Portfolio NAV immediately before the exit attempt.
    /// @param supplyBefore    Actual share supply immediately before the exit attempt.
    /// @return burned Shares consumed by the measured NAV reduction, rounded up.
    /// @return retained Unburned portion of the requested shares, still held by the same user.
    function sharesForPartialExit(
        uint256 requestedShares,
        uint256 navReduction,
        uint256 navBefore,
        uint256 supplyBefore
    ) internal pure returns (uint256 burned, uint256 retained) {
        if (requestedShares == 0 || supplyBefore == 0) revert ZeroShares();
        if (requestedShares > supplyBefore) revert ExitExceedsClaim();
        if (navBefore == 0) revert InvalidShareState();
        if (navReduction == 0) revert ZeroNavReduction();

        uint256 requestedClaim = Math.mulDiv(requestedShares, navBefore, supplyBefore, Math.Rounding.Floor);
        if (navReduction > requestedClaim) revert ExitExceedsClaim();

        burned = Math.mulDiv(navReduction, supplyBefore, navBefore, Math.Rounding.Ceil);
        if (burned == 0 || burned > requestedShares) revert ExitExceedsClaim();
        if (burned == requestedShares) revert IncompleteExitConsumesRequest();
        retained = requestedShares - burned;
    }

    /// @notice Burn all requested shares after a complete delivery of every exit bucket.
    /// @dev A complete delivery still cannot remove more portfolio value than the requested claim or burn
    ///      the final share while recognized NAV remains. Zero measured NAV reduction rejects a payout
    ///      rounded to zero so it cannot consume ownership without transferring recognized value.
    ///      Partial delivery uses `sharesForPartialExit`.
    function sharesForCompleteExit(
        uint256 requestedShares,
        uint256 navReduction,
        uint256 navBefore,
        uint256 supplyBefore
    ) internal pure returns (uint256 burned) {
        if (requestedShares == 0 || supplyBefore == 0) revert ZeroShares();
        if (requestedShares > supplyBefore) revert ExitExceedsClaim();
        if (navBefore == 0) revert InvalidShareState();
        if (navReduction == 0) revert ZeroNavReduction();

        uint256 requestedClaim = Math.mulDiv(requestedShares, navBefore, supplyBefore, Math.Rounding.Floor);
        if (navReduction > requestedClaim) revert ExitExceedsClaim();
        if (requestedShares == supplyBefore && navBefore > navReduction) revert FinalShareWouldLeaveNav();

        return requestedShares;
    }
}
