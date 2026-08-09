// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {VaultSurface, VaultRecord} from "./VaultTypes.sol";

/// @title  MintwareVaultRegistry
/// @notice On-chain multi-tenant registry of Mintware vaults — the source of truth
///         Supabase indexes (rather than being the registry itself). See
///         docs/developers/phase3-track0-foundation-design.md (D8).
///
/// @dev    v1 scope: vaults + FeeVaults are deployed and wired by the deploy script
///         (as today), then registered here. A full on-chain `createVault` that deploys
///         everything is deferred — it requires minimal-proxy clones + an initializer
///         refactor (the concrete `MintwareDeFiVault4626` at ~22 KB cannot be embedded
///         in a `new`-based factory without exceeding the 24 KB code-size limit) and
///         vendoring `openzeppelin-contracts-upgradeable`. Tracked for Track A.
contract MintwareVaultRegistry is Ownable {
    mapping(bytes32 => VaultRecord) public vaults;
    bytes32[] public vaultIds;

    event VaultRegistered(
        bytes32 indexed vaultId,
        VaultSurface surface,
        address indexed vault,
        address feeVault,
        address indexed provider
    );
    event VaultDeactivated(bytes32 indexed vaultId);

    error VaultExists();
    error UnknownVault();
    error ZeroAddress();

    constructor() Ownable(msg.sender) {}

    /// @notice Register a deployed + wired vault.
    function registerVault(
        bytes32 vaultId,
        VaultSurface surface,
        address vault,
        address feeVault,
        address hook,
        address vRWA,
        address provider
    ) external onlyOwner {
        if (vaults[vaultId].vault != address(0)) revert VaultExists();
        // feeVault may be address(0): the dual-sided MintwareDeFiPairVault has no FeeVault
        // (penalties → treasury, rewards → MintwareWeightedDistributor). Only vault + provider
        // are structurally required.
        if (vault == address(0) || provider == address(0)) revert ZeroAddress();

        vaults[vaultId] = VaultRecord({
            vault:     vault,
            feeVault:  feeVault,
            hook:      hook,
            vRWA:      vRWA,
            surface:   surface,
            provider:  provider,
            createdAt: block.timestamp
        });
        vaultIds.push(vaultId);

        emit VaultRegistered(vaultId, surface, vault, feeVault, provider);
    }

    function getVault(bytes32 vaultId) external view returns (VaultRecord memory) {
        if (vaults[vaultId].vault == address(0)) revert UnknownVault();
        return vaults[vaultId];
    }

    function vaultCount() external view returns (uint256) {
        return vaultIds.length;
    }

    function allVaultIds() external view returns (bytes32[] memory) {
        return vaultIds;
    }
}
