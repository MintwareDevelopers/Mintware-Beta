// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {FeeVault}        from "../src/FeeVault.sol";
import {SocialVault}     from "../src/SocialVault.sol";
import {MWSocialHook}    from "../src/MWSocialHook.sol";
import {HookMiner}       from "../src/lib/HookMiner.sol";
import {IPoolManager}    from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice Deploy Mintware Phase 2 Phase contracts in the correct order.
///
/// ─── Deploy order (avoids circular deps) ───────────────────────────────────
///
///   1. Deploy  FeeVault  (usdc, distributor, oracleSigner, treasury)
///   2. Mine    CREATE2 salt for MWSocialHook using HookMiner.find()
///              → constructor uses feeVault addr + poolManager (socialVault = address(0))
///   3. Deploy  SocialVault  (usdc, poolManager, feeVault)
///   4. Deploy  MWSocialHook at the mined CREATE2 address
///              new MWSocialHook{salt: salt}(poolManager, feeVault, address(0), pyth)
///   5. Wire:   hook.setSocialVault(socialVault)
///   6. Wire:   feeVault.setSocialVault(socialVault)
///   7. Wire:   feeVault.setHook(hook)
///
/// ─── Key addresses ─────────────────────────────────────────────────────────
///
///   Base Sepolia (84532):
///     V4_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA7E2C1b33b63
///     USDC_ADDRESS    = 0x036CbD53842c5426634e7929541eC2318f3dCF7e
///     PYTH_ORACLE     = 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729
///
///   Base Mainnet (8453):
///     V4_POOL_MANAGER = 0x498581ff9918ee3e5f1fc97e9fa62afc18901efa
///     USDC_ADDRESS    = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
///     PYTH_ORACLE     = 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a
///
/// ─── Required env vars ─────────────────────────────────────────────────────
///
///   DEPLOYER_PRIVATE_KEY   — deployer's private key (hex, no 0x prefix needed)
///   USDC_ADDRESS           — ERC-20 USDC on the target chain
///   V4_POOL_MANAGER        — Uniswap V4 PoolManager address
///   PYTH_ORACLE            — Pyth network oracle (address(0) to disable)
///   ORACLE_SIGNER          — Mintware oracle wallet (for FeeVault EIP-712 claims)
///   TREASURY_ADDRESS       — Mintware treasury (platform fee recipient)
///   MINTWARE_DISTRIBUTOR   — Existing MintwareDistributor.sol address
///
/// ─── Run commands ──────────────────────────────────────────────────────────
///
///   Dry-run (no broadcast):
///     forge script contracts-v4/script/Deploy.s.sol \
///       --rpc-url base_sepolia -vvvv
///
///   Deploy + verify (Base Sepolia):
///     forge script contracts-v4/script/Deploy.s.sol \
///       --rpc-url base_sepolia --broadcast --verify -vvvv
///
///   Deploy + verify (Base Mainnet):
///     forge script contracts-v4/script/Deploy.s.sol \
///       --rpc-url base --broadcast --verify -vvvv
///
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address usdc        = vm.envAddress("USDC_ADDRESS");
        address poolMgr     = vm.envAddress("V4_POOL_MANAGER");
        address pyth        = vm.envOr("PYTH_ORACLE", address(0));
        address oracle      = vm.envAddress("ORACLE_SIGNER");
        address treasury    = vm.envAddress("TREASURY_ADDRESS");
        address distributor = vm.envAddress("MINTWARE_DISTRIBUTOR");

        console.log("=== Mintware Phase 2 Deploy ===");
        console.log("Chain:      ", block.chainid);
        console.log("Deployer:   ", deployer);
        console.log("PoolManager:", poolMgr);
        console.log("USDC:       ", usdc);
        console.log("Pyth:       ", pyth);

        // ─── Step 1: Deploy FeeVault ─────────────────────────────────────────
        // socialVault and hook wired post-deploy (breaks circular dep)
        vm.startBroadcast(deployerKey);
        FeeVault feeVault = new FeeVault(usdc, distributor, oracle, treasury);
        console.log("FeeVault:   ", address(feeVault));
        vm.stopBroadcast();

        // ─── Step 2: Mine CREATE2 salt for MWSocialHook ──────────────────────
        // Constructor args: (poolMgr, feeVault, socialVault=address(0), pyth, initialOwner)
        // socialVault is address(0) at deploy — set via setSocialVault() after deploy.
        // initialOwner = deployer so the EOA owns the hook (not the Create2Deployer).
        bytes memory hookCreationCode = type(MWSocialHook).creationCode;
        bytes memory hookArgs = abi.encode(
            IPoolManager(poolMgr),
            address(feeVault),
            address(0),     // socialVault — wired in step 5
            pyth,
            deployer        // initialOwner — must be in hookArgs so initcode hash is correct
        );

        // IMPORTANT: Foundry's vm.startBroadcast() intercepts all CREATE2 calls
        // (including inline assembly) and routes them through the deterministic
        // deployment proxy at 0x4e59b44847b379578588920cA78FbF26c0B4956C.
        // We must mine using THAT address as the CREATE2 factory — NOT the EOA.
        address CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

        console.log("Mining CREATE2 salt for hook (flags=0x0AC4)...");
        (address expectedHookAddr, bytes32 hookSalt) = HookMiner.find(
            CREATE2_FACTORY,
            uint160(0x0AC4), // beforeAddLiq(11)+beforeRemoveLiq(9)+beforeSwap(7)+afterSwap(6)+afterSwapDelta(2)
            hookCreationCode,
            hookArgs
        );
        console.log("Hook salt found - expected address:", expectedHookAddr);

        // ─── Step 3: Deploy SocialVault ──────────────────────────────────────
        // Hook address known from mining — PoolKey will carry it when pool is created
        vm.startBroadcast(deployerKey);
        SocialVault socialVault = new SocialVault(usdc, poolMgr, address(feeVault));
        console.log("SocialVault:", address(socialVault));

        // ─── Step 4: Deploy MWSocialHook at mined address ────────────────────
        // new Contract{salt:}() is routed through Foundry's Create2Deployer —
        // address matches the one mined with CREATE2_FACTORY above.
        MWSocialHook hook = new MWSocialHook{salt: hookSalt}(
            IPoolManager(poolMgr),
            address(feeVault),
            address(0),     // socialVault — wired below
            pyth,
            deployer        // initialOwner — EOA takes ownership, not Create2Deployer
        );
        require(address(hook) == expectedHookAddr, "Deploy: hook address mismatch");
        console.log("MWSocialHook:", address(hook));

        // ─── Step 5: Wire — hook.setSocialVault ──────────────────────────────
        hook.setSocialVault(address(socialVault));
        console.log("hook.setSocialVault done");

        // ─── Step 6: Wire — feeVault.setSocialVault ──────────────────────────
        feeVault.setSocialVault(address(socialVault));
        console.log("feeVault.setSocialVault done");

        // ─── Step 7: Wire — feeVault.setHook ────────────────────────────────
        feeVault.setHook(address(hook));
        console.log("feeVault.setHook done");

        vm.stopBroadcast();

        // ─── Summary ─────────────────────────────────────────────────────────
        console.log("");
        console.log("=== Deploy complete ===");
        console.log("FeeVault:    ", address(feeVault));
        console.log("SocialVault: ", address(socialVault));
        console.log("Hook:        ", address(hook));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Set NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS=", address(socialVault), " in .env.local");
        console.log("  2. Set NEXT_PUBLIC_PHASE2_ENABLED=true in .env.local");
        console.log("  3. Call seedTeamTokens() to initialize a vault pool");
        console.log("     (PoolKey must include hook=", address(hook), ")");
    }
}
