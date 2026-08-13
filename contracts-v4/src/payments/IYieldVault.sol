// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  IYieldVault
/// @notice The single-asset USDC settlement boundary the MintwarePaymentGateway talks to. Any yield
///         source that can (a) report its withdrawable USDC, (b) quote shares for an asset amount, and
///         (c) burn a user's shares for USDC on the Gateway's authority satisfies it. In YPN v1 this is
///         implemented natively by `MintwareYieldVault` (USDC over Aave); in v2 by a thin
///         `MintwarePaymentAdapter` wrapping the treasury-anchored ULV — the Gateway never changes.
interface IYieldVault {
    /// @notice Shares that must be burned to redeem `assets` USDC. MUST round UP so a subsequent
    ///         `burnForPayment` of the returned shares redeems >= `assets`.
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);

    /// @notice Burn `shares` from `user` and send the redeemed USDC to `receiver`. Callable ONLY by the
    ///         Gateway (the sole authority; it has verified the user's off-chain EIP-712 permit).
    function burnForPayment(address user, uint256 shares, address receiver) external returns (uint256 assetsRedeemed);

    /// @notice USDC currently withdrawable to fund a settlement (respects the yield source's liquidity).
    function idleBuffer() external view returns (uint256);
}
