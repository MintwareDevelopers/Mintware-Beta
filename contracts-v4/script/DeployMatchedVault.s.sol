// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}      from "forge-std/Script.sol";
import {MintwareMatchedLiquidityVault} from "../src/vaults/MintwareMatchedLiquidityVault.sol";
import {MWHookCoordinator}     from "../src/hooks/MWHookCoordinator.sol";
import {MintwareWeightedDistributor} from "../src/MintwareWeightedDistributor.sol";
import {HookMiner}             from "../src/lib/HookMiner.sol";
import {PoolProfile}           from "../src/vaults/VaultTypes.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice Deploy a team-locked / community-matched launch vault WITH its canonical hook wired, so
///         launches land in a PROTECTED pool (vault-only LP gate + oracle guard), never an open one.
///
/// ─── Deploy order (no chicken-and-egg: vault is deployed first, so the coordinator can bake in
///     the vault address at mine time) ─────────────────────────────────────────────────────────
///   1. Deploy  MintwareMatchedLiquidityVault
///   2. Mine + deploy  MWHookCoordinator(poolManager, vault, owner) at flags 0xAC8
///   3. vault.setExpectedHook(coordinator) — commitTeam then REQUIRES poolKey.hooks == coordinator
///   4. Optional: vault.setWeightedDistributor(dist, vaultId) for Rail B reward routing
///
/// The team later calls commitTeam(poolKey, ...) with poolKey.hooks == this coordinator. The
/// coordinator's beforeAddLiquidity permits only `vault` as the LP, and the pool is initialized
/// atomically inside commitTeam (front-run-proof).
///
/// ─── Required env ─────────────────────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY, V4_POOL_MANAGER, PROJECT_TOKEN, QUOTE_TOKEN, TEAM_ADDRESS, TREASURY_ADDRESS
///   Optional: PROFILE (1=EMERGING, 2=MEME; default 2), FEE_VAULT, WEIGHTED_DISTRIBUTOR + DISTRIBUTOR_VAULT_ID
///
/// ─── Run ──────────────────────────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeployMatchedVault.s.sol --rpc-url base_sepolia --broadcast --verify -vvvv
contract DeployMatchedVault is Script {
    address constant C2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address poolMgr  = vm.envAddress("V4_POOL_MANAGER");
        address proj     = vm.envAddress("PROJECT_TOKEN");
        address quote    = vm.envAddress("QUOTE_TOKEN");
        address team     = vm.envAddress("TEAM_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address feeVault = vm.envOr("FEE_VAULT", address(0));
        PoolProfile profile = PoolProfile(vm.envOr("PROFILE", uint256(2))); // MEME

        console.log("=== Mintware Matched Launch Vault Deploy ===");
        console.log("Chain:   ", block.chainid);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // 1. Vault
        MintwareMatchedLiquidityVault vault = new MintwareMatchedLiquidityVault(
            poolMgr, proj, quote, team, treasury, feeVault, profile, deployer
        );
        console.log("MatchedVault:", address(vault));

        // 2. Mine + deploy the coordinator with the vault baked in (vault addr is known now).
        bytes memory hookArgs = abi.encode(IPoolManager(poolMgr), address(vault), deployer);
        (address expectedHook, bytes32 salt) = HookMiner.find(
            C2_FACTORY, uint160(0xAC8), type(MWHookCoordinator).creationCode, hookArgs
        );
        MWHookCoordinator hook = new MWHookCoordinator{salt: salt}(IPoolManager(poolMgr), address(vault), deployer);
        require(address(hook) == expectedHook, "hook address mismatch");
        console.log("Coordinator:", address(hook));

        // 3. Bind the vault to its hook — commitTeam now requires poolKey.hooks == coordinator.
        vault.setExpectedHook(address(hook));

        // 4. Optional Rail B reward routing.
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
        console.log("Team commits via commitTeam(poolKey, ...) with poolKey.hooks =", address(hook));
        console.log("(sort currencies; tickSpacing per profile; the vault inits the pool on commit).");
    }
}
