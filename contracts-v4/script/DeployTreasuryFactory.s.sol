// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}                     from "forge-std/Script.sol";
import {MintwareTreasuryVaultRegistry}       from "../src/payments/MintwareTreasuryVaultRegistry.sol";
import {MintwareTreasuryVaultFactory}        from "../src/payments/MintwareTreasuryVaultFactory.sol";
import {
    MintwareTreasuryVaultDeployer,
    MintwareTreasuryJitHookDeployer,
    MintwareTreasuryGatewayDeployer
} from "../src/payments/MintwareTreasuryDeployers.sol";

/// @notice Deploy the YPN multi-tenant factory ONCE per chain: the registry, the two deployer helpers
///         (which hold the hook + gateway creation code off the factory's own bytecode, for EIP-170), and
///         the factory — then wire the factory into all three (`setFactory`). After this, launch per-team
///         vaults with `CreateTreasuryVault.s.sol`.
///
/// ─── Required env ───────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY, V4_POOL_MANAGER
///   Optional: FACTORY_OWNER (default deployer) — the Mintware curator that may call `createVault`.
///
/// ─── Run ────────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeployTreasuryFactory.s.sol --rpc-url base_sepolia --broadcast -vvvv
contract DeployTreasuryFactory is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address poolMgr     = vm.envAddress("V4_POOL_MANAGER");
        address owner       = vm.envOr("FACTORY_OWNER", deployer);

        vm.startBroadcast(deployerKey);

        // Registry + deployer helpers (admin = deployer so it can point them at the factory below).
        MintwareTreasuryVaultRegistry   registry      = new MintwareTreasuryVaultRegistry(owner);
        MintwareTreasuryVaultDeployer   vaultDeployer = new MintwareTreasuryVaultDeployer(deployer);
        MintwareTreasuryJitHookDeployer hookDeployer  = new MintwareTreasuryJitHookDeployer(deployer);
        MintwareTreasuryGatewayDeployer gwDeployer     = new MintwareTreasuryGatewayDeployer(deployer);

        // Factory (immutable refs to the above).
        MintwareTreasuryVaultFactory factory = new MintwareTreasuryVaultFactory(
            poolMgr, address(registry), address(vaultDeployer), address(hookDeployer), address(gwDeployer), owner
        );

        // Two-phase wiring: bind the factory into the registry + deployers (set-once).
        // registry.setFactory is owner-gated; if FACTORY_OWNER != deployer, the owner must call it.
        if (owner == deployer) {
            registry.setFactory(address(factory));
        } else {
            console.log("NOTE: registry owner != deployer; owner must call registry.setFactory(factory).");
        }
        vaultDeployer.setFactory(address(factory));
        hookDeployer.setFactory(address(factory));
        gwDeployer.setFactory(address(factory));

        vm.stopBroadcast();

        console.log("=== YPN Treasury Vault Factory deployed ===");
        console.log("Registry:       ", address(registry));
        console.log("VaultDeployer:  ", address(vaultDeployer));
        console.log("HookDeployer:   ", address(hookDeployer));
        console.log("GatewayDeployer:", address(gwDeployer));
        console.log("Factory:        ", address(factory));
        console.log("Factory owner:  ", owner);
    }
}
