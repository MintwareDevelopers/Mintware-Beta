// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  IYieldAdapter
/// @notice Pluggable idle-capital yield sink (Track A4). A concrete adapter wraps an
///         external yield source (Aave/Morpho/etc.); the vault deposits idle USDC,
///         withdraws principal/yield, and reads the adapter's total balance to harvest.
/// @dev    All amounts are in the vault's underlying (USDC). The vault approves the
///         adapter before deposit(). Concrete adapters are a later integration; a mock
///         exercises the flow in tests.
interface IYieldAdapter {
    /// @notice Pull `amount` underlying from the caller (the vault) into the yield source.
    function deposit(uint256 amount) external;

    /// @notice Return `amount` underlying to the caller (the vault).
    function withdraw(uint256 amount) external;

    /// @notice Total underlying currently attributable to the caller (principal + yield).
    function totalAssets() external view returns (uint256);
}
