// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  VaultTypes
/// @notice Shared enums / structs for the Phase-3 two-surface vault system.
///         See docs/developers/phase3-track0-foundation-design.md.

/// @dev Which surface a vault belongs to.
enum VaultSurface {
    DeFi,
    RWA
}

/// @dev DeFi-surface pool profiles — drive the LP tick-range half-width.
///        BLUE_CHIP  600 ticks  (~±6%)
///        EMERGING  1200 ticks  (~±13%)
///        MEME      2400 ticks  (~±27%)
enum PoolProfile {
    BLUE_CHIP,
    EMERGING,
    MEME
}

/// @dev Lock tiers — shared by both surfaces.
///        Flex      (0d)   1.00×
///        Committed (30d)  1.15×
///        Aligned   (90d)  1.30×
///        Core     (180d)  1.50×
enum LockTier {
    Flex,
    Committed,
    Aligned,
    Core
}

/// @dev Registry record stored per vaultId.
struct VaultRecord {
    address vault;
    address feeVault;
    address hook;
    address vRWA;             // address(0) for DeFi
    VaultSurface surface;
    address provider;
    uint256 createdAt;
    bool    active;           // false once the owner retires the vault (deactivateVault)
}
