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

/// @dev Config for the (test-only) single-sided MintwareDeFiVault4626 constructor.
struct VaultConfig {
    VaultSurface surface;
    address provider;         // strategy manager (DeFi) / issuer (RWA)
    address underlyingToken;  // USDC for v1
    address treasury;         // recipient of entry/exit fees (Mintware treasury)
    string  name;             // ERC-20 share token name
    string  symbol;           // ERC-20 share token symbol
    uint256 minDeposit;
    uint256 entryFeeBps;      // e.g. 50 = 0.5% (spec fee model)
    uint256 exitFeeBps;       // e.g. 100 = 1.0%
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
    bool    active;           // false once the owner retires the vault (deactivateVault)
}
