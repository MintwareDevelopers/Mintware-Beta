// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  Minimal Aave v3 interfaces
/// @notice Only the surface `AaveV3YieldAdapter` uses. We keep interfaces minimal + verify the
///         aToken on-chain (see adapter constructor) rather than pulling the full aave-v3-core dep
///         or decoding the large `ReserveData` struct (fragile across versions).

interface IPoolAddressesProvider {
    /// @notice The current Pool. Resolve live — the pool implementation is upgradeable; the
    ///         provider is the stable anchor. Never hardcode the pool address.
    function getPool() external view returns (address);
}

/// @dev Aave packs reserve flags into a single word. Bit positions are stable in Aave v3:
///      ACTIVE = 56, FROZEN = 57, PAUSED = 60 (see aave-v3-core ReserveConfiguration.sol).
struct ReserveConfigurationMap {
    uint256 data;
}

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    /// @notice `amount == type(uint256).max` withdraws the full balance. Returns amount withdrawn.
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getConfiguration(address asset) external view returns (ReserveConfigurationMap memory);
}

interface IAToken {
    function balanceOf(address) external view returns (uint256);
    /// @notice The underlying this aToken represents — used to VERIFY the adapter was wired to the
    ///         correct aToken for its asset (guards against a mis-configured / attacker-swapped aToken).
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
    function POOL() external view returns (address);
}

/// @dev Reserve-flag decoders over the packed configuration word.
library ReserveFlags {
    function isActive(ReserveConfigurationMap memory c) internal pure returns (bool) {
        return (c.data >> 56) & 1 == 1;
    }
    function isFrozen(ReserveConfigurationMap memory c) internal pure returns (bool) {
        return (c.data >> 57) & 1 == 1;
    }
    function isPaused(ReserveConfigurationMap memory c) internal pure returns (bool) {
        return (c.data >> 60) & 1 == 1;
    }
}
