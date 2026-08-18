// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title  SeniorSharesMath
/// @notice The ONE audited copy of the senior-share ⇄ assets conversion used by the payment vaults
///         (`MintwareYieldVault` v1 and `MintwareTreasuryVault` v2). Both applied the identical symmetric
///         virtual-offset formula inline; this extracts it so the inflation defense lives in exactly one
///         place (Phase 1 of the vault consolidation plan).
///
/// @dev    Symmetric virtual offset `v` (virtual shares == virtual assets) added to BOTH sides:
///           shares = assets · (totalShares + v) / (totalAssets + v)
///           assets = shares · (totalAssets + v) / (totalShares + v)
///         Neutralizes the first-depositor donation attack (attacker must donate ~`v ×` a victim's
///         deposit) and cancels in the solvency algebra (`totalShares <= totalAssets`). `v` is passed by
///         the caller so each vault keeps its own offset (v1 = 1e3, v2 = 1e6) — this is a pure relocation
///         of the formula, NOT a behavior change. Rounding is the caller's choice (down favors the vault
///         on mint/redeem-assets; up on previewWithdraw).
library SeniorSharesMath {
    using Math for uint256;

    /// @notice assets → shares.
    function toShares(uint256 assets, uint256 totalShares, uint256 totalAssets, uint256 v, Math.Rounding rounding)
        internal pure returns (uint256)
    {
        return assets.mulDiv(totalShares + v, totalAssets + v, rounding);
    }

    /// @notice shares → assets.
    function toAssets(uint256 shares, uint256 totalAssets, uint256 totalShares, uint256 v, Math.Rounding rounding)
        internal pure returns (uint256)
    {
        return shares.mulDiv(totalAssets + v, totalShares + v, rounding);
    }
}
