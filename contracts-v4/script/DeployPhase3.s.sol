// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {FeeVault}                from "../src/FeeVault.sol";
import {MWSocialHook}            from "../src/MWSocialHook.sol";
import {HookMiner}               from "../src/lib/HookMiner.sol";
import {MintwareDeFiVault4626}   from "../src/vaults/MintwareDeFiVault4626.sol";
import {MintwareVaultRegistry}   from "../src/vaults/MintwareVaultRegistry.sol";
import {VaultSurface, VaultConfig} from "../src/vaults/VaultTypes.sol";
import {IPoolManager}            from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice Phase-3 Track 0 deploy — ERC-4626 DeFi vault stack + on-chain registry.
///
/// ─── Deploy order (mirrors the Phase-2 script; avoids circular deps) ─────────
///   1. Deploy  FeeVault(usdc, distributor, oracle, treasury)
///   2. Mine    CREATE2 salt for MWSocialHook (flags 0x0AC4)
///   3. Deploy  MintwareDeFiVault4626(cfg, poolManager, feeVault)
///   4. Deploy  MWSocialHook at the mined address
///   5. Wire    hook.setSocialVault(vault) / feeVault.setSocialVault(vault) / feeVault.setHook(hook)
///   6. Deploy  MintwareVaultRegistry (reuse REGISTRY_ADDRESS if provided)
///   7. Register the vault in the registry
///
/// ─── Key addresses ───────────────────────────────────────────────────────────
///   Base Sepolia (84532): V4_POOL_MANAGER 0x05E73354cFDd6745C338b50BcFDfA7E2C1b33b63,
///     USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e, PYTH 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729
///   Base Mainnet (8453):  V4_POOL_MANAGER 0x498581ff9918ee3e5f1fc97e9fa62afc18901efa,
///     USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, PYTH 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a
///
/// ─── Required env vars ─────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY, USDC_ADDRESS, V4_POOL_MANAGER, ORACLE_SIGNER,
///   TREASURY_ADDRESS, MINTWARE_DISTRIBUTOR
///   Optional: PYTH_ORACLE (default 0), REGISTRY_ADDRESS (reuse existing registry),
///             VAULT_NAME, VAULT_SYMBOL
///
/// ─── Run ───────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeployPhase3.s.sol --rpc-url base_sepolia --broadcast --verify -vvvv
contract DeployPhase3 is Script {
    address constant C2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address usdc        = vm.envAddress("USDC_ADDRESS");
        address poolMgr     = vm.envAddress("V4_POOL_MANAGER");
        address pyth        = vm.envOr("PYTH_ORACLE", address(0));
        address oracle      = vm.envAddress("ORACLE_SIGNER");
        address treasury    = vm.envAddress("TREASURY_ADDRESS");
        address distributor = vm.envAddress("MINTWARE_DISTRIBUTOR");
        address registryAddr = vm.envOr("REGISTRY_ADDRESS", address(0));
        string memory vaultName   = vm.envOr("VAULT_NAME",   string("Mintware DeFi Vault Share"));
        string memory vaultSymbol = vm.envOr("VAULT_SYMBOL", string("mwDEFI"));

        console.log("=== Mintware Phase 3 (Track 0) Deploy ===");
        console.log("Chain:      ", block.chainid);
        console.log("Deployer:   ", deployer);

        // 1. FeeVault
        vm.startBroadcast(deployerKey);
        FeeVault feeVault = new FeeVault(usdc, distributor, oracle, treasury);
        console.log("FeeVault:   ", address(feeVault));
        vm.stopBroadcast();

        // 2. Mine hook salt
        bytes memory hookArgs = abi.encode(
            IPoolManager(poolMgr), usdc, address(feeVault), treasury, address(0), pyth, deployer
        );
        (address expectedHook, bytes32 hookSalt) = HookMiner.find(
            C2_FACTORY, uint160(0x0AC4), type(MWSocialHook).creationCode, hookArgs
        );
        console.log("Expected hook:", expectedHook);

        // 3. Vault  +  4. Hook  +  5. Wiring
        VaultConfig memory cfg = VaultConfig({
            surface:             VaultSurface.DeFi,
            provider:            deployer,
            underlyingToken:     usdc,
            treasury:            treasury,
            name:                vaultName,
            symbol:              vaultSymbol,
            minDeposit:          0,
            entryFeeBps:         50,   // 0.5% (spec fee model)
            exitFeeBps:          100,  // 1.0%
            enableMEVProtection: true,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });

        vm.startBroadcast(deployerKey);
        MintwareDeFiVault4626 vault = new MintwareDeFiVault4626(cfg, poolMgr, address(feeVault));
        console.log("DeFiVault:  ", address(vault));

        MWSocialHook hook = new MWSocialHook{salt: hookSalt}(
            IPoolManager(poolMgr), usdc, address(feeVault), treasury, address(0), pyth, deployer
        );
        require(address(hook) == expectedHook, "hook address mismatch");
        console.log("Hook:       ", address(hook));

        hook.setSocialVault(address(vault));
        feeVault.setSocialVault(address(vault));
        feeVault.setHook(address(hook));

        // 6. Registry (reuse or deploy)
        MintwareVaultRegistry registry = registryAddr == address(0)
            ? new MintwareVaultRegistry()
            : MintwareVaultRegistry(registryAddr);
        console.log("Registry:   ", address(registry));

        // 7. Register
        bytes32 vaultId = keccak256(abi.encode(block.chainid, address(vault)));
        registry.registerVault(
            vaultId, VaultSurface.DeFi, address(vault), address(feeVault), address(hook), address(0), deployer
        );
        vm.stopBroadcast();

        console.log("");
        console.log("=== Deploy complete ===");
        console.log("vaultId (bytes32):");
        console.logBytes32(vaultId);
        console.log("Next: seedTeamTokens() with PoolKey.hooks =", address(hook));
        console.log("Set NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS / registry in .env.local + Supabase social_vaults row.");
    }
}
