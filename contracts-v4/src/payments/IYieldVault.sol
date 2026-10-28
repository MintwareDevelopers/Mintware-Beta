// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  IYieldVault
/// @notice Earn vault boundary used by the legacy gateway until its T7b redesign.
interface IYieldVault {
    /// @notice ERC-4626 quote for the shares required to withdraw an exact asset amount; rounds up.
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);

    /// @notice Gateway-only redemption of a member's own shares to that member's registered destination.
    ///         Returns the amount actually obtained; illiquidity can make it lower than the share quote.
    function gatewayRedeem(address member, uint256 shares) external returns (uint256 assetsRedeemed);
    function registerDestination(address member, address destination) external;

    /// @notice USDC currently withdrawable to fund a settlement (respects the yield source's liquidity).
    function idleBuffer() external view returns (uint256);
}
