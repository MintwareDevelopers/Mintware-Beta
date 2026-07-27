// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Issuer / asset-provider due-diligence lifecycle.
enum ProviderStatus {
    NONE,
    REGISTERED, // self-registered, pending diligence
    VERIFIED,   // due diligence cleared
    SUSPENDED   // paused / delisted
}

/// @title  SPVAssetProviderRegistry
/// @notice Tracks RWA asset-provider (issuer) due-diligence status (Track B). A provider
///         self-registers; Mintware governance verifies or suspends. RWA vault creation and
///         SPV distributions should require a VERIFIED provider.
contract SPVAssetProviderRegistry is Ownable {
    struct Provider {
        ProviderStatus status;
        uint64  registeredAt;
        uint64  verifiedAt;
        bytes32 metadataHash; // off-chain diligence pack reference
    }

    mapping(address => Provider) public providers;

    event ProviderRegistered(address indexed provider, bytes32 metadataHash);
    event ProviderVerified(address indexed provider);
    event ProviderSuspended(address indexed provider);

    constructor(address owner_) Ownable(owner_) {}

    /// @notice Self-register as a provider (pending diligence).
    function registerProvider(bytes32 metadataHash) external {
        Provider storage p = providers[msg.sender];
        if (p.status == ProviderStatus.NONE) {
            p.registeredAt = uint64(block.timestamp);
        }
        p.status       = ProviderStatus.REGISTERED;
        p.metadataHash = metadataHash;
        emit ProviderRegistered(msg.sender, metadataHash);
    }

    function verifyProvider(address provider) external onlyOwner {
        Provider storage p = providers[provider];
        p.status     = ProviderStatus.VERIFIED;
        p.verifiedAt = uint64(block.timestamp);
        emit ProviderVerified(provider);
    }

    function suspendProvider(address provider) external onlyOwner {
        providers[provider].status = ProviderStatus.SUSPENDED;
        emit ProviderSuspended(provider);
    }

    function getProviderStatus(address provider) external view returns (ProviderStatus) {
        return providers[provider].status;
    }

    function isVerified(address provider) external view returns (bool) {
        return providers[provider].status == ProviderStatus.VERIFIED;
    }
}
