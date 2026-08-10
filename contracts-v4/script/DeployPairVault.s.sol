// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}      from "forge-std/Script.sol";
import {MintwareDeFiPairVault} from "../src/vaults/MintwareDeFiPairVault.sol";
import {MWHookCoordinator}     from "../src/hooks/MWHookCoordinator.sol";
import {MintwareWeightedDistributor} from "../src/MintwareWeightedDistributor.sol";
import {HookMiner}             from "../src/lib/HookMiner.sol";
import {MintwareVaultRegistry} from "../src/vaults/MintwareVaultRegistry.sol";
import {VaultSurface, PoolProfile} from "../src/vaults/VaultTypes.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Deploy the SOLVENT dual-sided pair vault as the production DeFi stack.
///
/// Replaces the single-sided MintwareDeFiVault4626 (DeployPhase3) — whose shares are
/// pinned to par NAV over a lossy single-sided position — with MintwareDeFiPairVault,
/// where a share IS a Uniswap-V4 liquidity unit (a claim on BOTH tokens) and redemption
/// returns both tokens at their real value. There is no par-NAV / bank-run flaw here.
///
/// ─── Deploy order (hook↔vault chicken-and-egg, mirrors DeployPhase3) ──────────
///   1. Mine  CREATE2 salt for MWHookCoordinator (flags 0xAC8; vault wired post-deploy)
///   2. Build PoolKey (sorted currencies, hooks = mined hook address)
///   3. Deploy MintwareDeFiPairVault(poolManager, poolKey, profile, treasury, provider, owner)
///   4. Deploy MWHookCoordinator at the mined address; hook.setVault(vault)
///   5. Deploy / reuse MintwareVaultRegistry; register the vault
///   6. vault.initializePool(INIT_SQRT_PRICE) — opens the V4 pool + profile range
///
/// The coordinator here enforces the vault-only LP gate (beforeAddLiquidity /
/// beforeRemoveLiquidity revert non-vault senders). Dynamic fee + MEV capture stay
/// OFF until configurePool(...) is called — that is Phase-4 work, deliberately not
/// enabled at go-live. The pair vault's reward loop is Rail B
/// (MintwareWeightedDistributor); wire it post-deploy via setWeightedDistributor if
/// WEIGHTED_DISTRIBUTOR is provided.
///
/// ─── Required env vars ─────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY, V4_POOL_MANAGER, TOKEN_A_ADDRESS, TOKEN_B_ADDRESS,
///   TREASURY_ADDRESS
///   Optional: PROVIDER (default deployer), POOL_FEE (3000), TICK_SPACING (60),
///             PROFILE (0=BLUE_CHIP,1=EMERGING,2=MEME; default 1),
///             INIT_SQRT_PRICE (default 1:1), REGISTRY_ADDRESS (reuse),
///             WEIGHTED_DISTRIBUTOR + DISTRIBUTOR_VAULT_ID (wire Rail B rewards)
///
/// ─── Run ───────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeployPairVault.s.sol --rpc-url base_sepolia --broadcast --verify -vvvv
contract DeployPairVault is Script {
    address constant C2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    // 1:1 price at tick 0 — sensible default for a fresh pool.
    uint160 constant DEFAULT_SQRT_PRICE = 79228162514264337593543950336;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address poolMgr  = vm.envAddress("V4_POOL_MANAGER");
        address tokenA   = vm.envAddress("TOKEN_A_ADDRESS");
        address tokenB   = vm.envAddress("TOKEN_B_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address provider = vm.envOr("PROVIDER", deployer);
        uint24  poolFee     = uint24(vm.envOr("POOL_FEE", uint256(3000)));
        int24   tickSpacing = int24(uint24(vm.envOr("TICK_SPACING", uint256(60))));
        PoolProfile profile = PoolProfile(vm.envOr("PROFILE", uint256(1))); // EMERGING
        uint160 initPrice   = uint160(vm.envOr("INIT_SQRT_PRICE", uint256(DEFAULT_SQRT_PRICE)));
        address registryAddr = vm.envOr("REGISTRY_ADDRESS", address(0));

        require(tokenA != tokenB, "identical tokens");
        (address c0, address c1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        console.log("=== Mintware Pair Vault Deploy (solvent DeFi stack) ===");
        console.log("Chain:    ", block.chainid);
        console.log("Deployer: ", deployer);
        console.log("token0:   ", c0);
        console.log("token1:   ", c1);

        // 1. Mine coordinator salt (vault wired post-deploy → vault == address(0))
        bytes memory hookArgs = abi.encode(IPoolManager(poolMgr), address(0), deployer);
        (address expectedHook, bytes32 hookSalt) = HookMiner.find(
            C2_FACTORY, uint160(0xAC8), type(MWHookCoordinator).creationCode, hookArgs
        );
        console.log("Expected hook:", expectedHook);

        // 2. PoolKey with the mined hook baked in
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee:       poolFee,
            tickSpacing: tickSpacing,
            hooks:     IHooks(expectedHook)
        });

        vm.startBroadcast(deployerKey);

        // 3. Vault (shares == V4 liquidity units — dual-sided, solvent)
        MintwareDeFiPairVault vault = new MintwareDeFiPairVault(
            poolMgr, key, profile, treasury, provider, deployer
        );
        console.log("PairVault:", address(vault));

        // 4. Hook at the mined address + wire the vault-only LP gate
        MWHookCoordinator hook = new MWHookCoordinator{salt: hookSalt}(
            IPoolManager(poolMgr), address(0), deployer
        );
        require(address(hook) == expectedHook, "hook address mismatch");
        hook.setVault(address(vault));
        console.log("Hook:     ", address(hook));

        // 5. Registry (reuse or deploy) — pair vault uses no FeeVault (feeVault = 0)
        MintwareVaultRegistry registry = registryAddr == address(0)
            ? new MintwareVaultRegistry()
            : MintwareVaultRegistry(registryAddr);
        bytes32 vaultId = keccak256(abi.encode(block.chainid, address(vault)));
        registry.registerVault(
            vaultId, VaultSurface.DeFi, address(vault), address(0), address(hook), address(0), provider
        );
        console.log("Registry: ", address(registry));

        // 6. Open the pool + profile range
        vault.initializePool(initPrice);

        // Optional: wire Rail B reward routing if a distributor is provided
        address wdist = vm.envOr("WEIGHTED_DISTRIBUTOR", address(0));
        if (wdist != address(0)) {
            bytes32 dvid = vm.envOr("DISTRIBUTOR_VAULT_ID", bytes32(0));
            // The distributor gates registerVault to an allowlist (front-run guard). Authorize the
            // vault first. Requires the deployer to own the distributor (the fresh-deploy path); for
            // an externally-owned distributor, the operator must authorize the vault separately.
            MintwareWeightedDistributor(wdist).setAuthorizedRegistrar(address(vault), true);
            vault.setWeightedDistributor(wdist, dvid);
            console.log("WeightedDistributor wired:", wdist);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deploy complete ===");
        console.log("vaultId (bytes32):");
        console.logBytes32(vaultId);
        console.log("Set NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS = PairVault, update Supabase social_vaults");
        console.log("(token0_decimals / token1_decimals, contract_address). Depositors bring BOTH tokens.");
    }
}
