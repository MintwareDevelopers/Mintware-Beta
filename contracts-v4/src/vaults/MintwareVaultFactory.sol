// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable}  from "@openzeppelin/contracts/access/Ownable.sol";
import {Create2}  from "@openzeppelin/contracts/utils/Create2.sol";

import {FeeVault} from "../FeeVault.sol";
import {VaultSurface, VaultConfig, VaultRecord} from "./VaultTypes.sol";

interface IMintwareVaultInit {
    function setFeeVault(address feeVault) external;
    function transferOwnership(address newOwner) external;
    function asset() external view returns (address);
    function provider() external view returns (address);
    function treasury() external view returns (address);
}

/// @title  MintwareVaultFactory
/// @notice On-chain `createVault`: deploys a per-vault {Vault, FeeVault} pair, wires
///         them, hands ownership to the provider, and records the vault in the registry
///         (the multi-tenant on-chain source of truth). Replaces the Track-0 registry.
///
/// @dev    The vault is deployed via CREATE2 from caller-supplied `vaultInitcode` so the
///         factory stays under the 24 KB code-size limit (it does not embed the ~22 KB
///         vault creation code). CREATE2 runs the real constructor, so immutables and the
///         EIP-712 domain separator are set correctly (a minimal-proxy clone would break
///         both). Callers build the initcode as:
///           abi.encodePacked(type(MintwareDeFiVault4626).creationCode,
///                            abi.encode(cfg, poolManager, address(0)))
///         (feeVault == address(0); wired here via setFeeVault). A post-deploy check
///         asserts the deployed vault matches `cfg`, so a mismatched initcode reverts.
contract MintwareVaultFactory is Ownable {
    address public immutable poolManager;
    address public immutable distributor;

    mapping(bytes32 => VaultRecord) public vaults;
    bytes32[] public vaultIds;

    event VaultCreated(
        bytes32 indexed vaultId,
        VaultSurface surface,
        address indexed vault,
        address feeVault,
        address indexed provider
    );

    error RWANotImplemented();
    error VaultExists();
    error ZeroAddress();
    error VaultConfigMismatch();

    constructor(address _poolManager, address _distributor) Ownable(msg.sender) {
        if (_poolManager == address(0) || _distributor == address(0)) revert ZeroAddress();
        poolManager = _poolManager;
        distributor = _distributor;
    }

    /// @notice Deploy + wire a vault and its FeeVault, hand ownership to the provider.
    function createVault(
        bytes calldata vaultInitcode,
        bytes32 salt,
        VaultConfig calldata cfg,
        address hook,
        address oracleSigner,
        address treasury
    ) external onlyOwner returns (bytes32 vaultId, address vault, address feeVault) {
        if (cfg.surface == VaultSurface.RWA) revert RWANotImplemented();
        if (cfg.underlyingToken == address(0) || cfg.provider == address(0)) revert ZeroAddress();

        vaultId = keccak256(abi.encode(cfg.provider, cfg.underlyingToken, cfg.symbol, vaultIds.length));
        if (vaults[vaultId].vault != address(0)) revert VaultExists();

        // 1. FeeVault (factory is initial owner → can wire)
        FeeVault fv = new FeeVault(cfg.underlyingToken, distributor, oracleSigner, treasury);
        feeVault = address(fv);

        // 2. CREATE2 deploy the vault (owner becomes this factory)
        vault = Create2.deploy(0, salt, vaultInitcode);

        // 3. Verify the deployed vault matches cfg (guards against mismatched initcode)
        IMintwareVaultInit v = IMintwareVaultInit(vault);
        if (
            v.asset()    != cfg.underlyingToken ||
            v.provider() != cfg.provider ||
            v.treasury() != cfg.treasury
        ) revert VaultConfigMismatch();

        // 4. Wire FeeVault <-> vault (+ hook)
        v.setFeeVault(feeVault);
        fv.setSocialVault(vault);
        if (hook != address(0)) fv.setHook(hook);

        // 5. Hand both to the provider
        v.transferOwnership(cfg.provider);
        fv.transferOwnership(cfg.provider);

        // 6. Register
        vaults[vaultId] = VaultRecord({
            vault:     vault,
            feeVault:  feeVault,
            hook:      hook,
            vRWA:      address(0),
            surface:   cfg.surface,
            provider:  cfg.provider,
            createdAt: block.timestamp,
            active:    true
        });
        vaultIds.push(vaultId);

        emit VaultCreated(vaultId, cfg.surface, vault, feeVault, cfg.provider);
    }

    function getVault(bytes32 vaultId) external view returns (VaultRecord memory) {
        return vaults[vaultId];
    }

    function vaultCount() external view returns (uint256) {
        return vaultIds.length;
    }

    function allVaultIds() external view returns (bytes32[] memory) {
        return vaultIds;
    }
}
