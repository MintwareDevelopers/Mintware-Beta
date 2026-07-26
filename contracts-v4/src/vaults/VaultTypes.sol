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

/// @dev Lock tiers — shared by both surfaces. Multipliers live in LockLib.
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

/// @dev Config passed to MintwareVaultFactory.createVault().
struct VaultConfig {
    VaultSurface surface;
    address provider;         // strategy manager (DeFi) / issuer (RWA)
    address underlyingToken;  // USDC for v1
    string  name;             // ERC-20 share token name
    string  symbol;           // ERC-20 share token symbol
    uint256 minDeposit;
    uint256 entryFeeBps;      // 0 unless enabled (Track A fee decision)
    uint256 exitFeeBps;
    bool    enableMEVProtection;
    bool    enableIdleCapital;
    uint256 idleTargetRatio;  // WAD, e.g. 60e18 = 60%
}

/// @dev Registry record stored by the factory per vaultId.
struct VaultRecord {
    address vault;
    address feeVault;
    address hook;
    address vRWA;             // address(0) for DeFi
    VaultSurface surface;
    address provider;
    uint256 createdAt;
}
