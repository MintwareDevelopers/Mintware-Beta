// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MintwareWeightedDistributor} from "../src/MintwareWeightedDistributor.sol";

/// @notice Deploy MintwareWeightedDistributor and register one single-sided (USDC)
///         vault — this closes the vault reward loop's on-chain claim leg (Rail B):
///         the weighted-epoch cron signs a root, `closeEpoch` verifies it, and LPs
///         `claim(vaultId, epoch, amount0, amount1, proof)`.
///
/// Single-sided: token1 = address(0), so amount1 is always 0 (contract-supported).
///
/// ─── Addresses ──────────────────────────────────────────────────────────────
///   Base Sepolia (84532): USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e
///   Base Mainnet (8453):  USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
///
/// ─── Required env ─────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY   — funds gas (Base Sepolia faucet)
///   ORACLE_SIGNER          — MUST equal the address of WEIGHT_ORACLE_PRIVATE_KEY
///                            (getOracleSignerKey('weight')); it signs epoch roots.
/// ─── Optional env ─────────────────────────────────────────────────────────
///   USDC_ADDRESS           — default Base Sepolia USDC
///   VAULT_ID_SEED          — string hashed to the bytes32 vaultId (default below)
///
/// ─── Run ─────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeployWeightedDistributor.s.sol \
///     --rpc-url base_sepolia --broadcast -vvvv
///
/// After deploy, wire the `social_vaults` row:
///   weighted_distributor_address  = <printed Distributor>
///   weighted_distributor_vault_id = <printed VaultId>
///   token0_decimals = 6, token1_decimals = 0, chain_id = 84532
contract DeployWeightedDistributor is Script {
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address oracle      = vm.envAddress("ORACLE_SIGNER");
        address usdc        = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        string memory seed  = vm.envOr("VAULT_ID_SEED", string("mw-weighted-vault-1"));
        bytes32 vaultId     = keccak256(bytes(seed));

        console.log("=== Deploy MintwareWeightedDistributor ===");
        console.log("Chain:    ", block.chainid);
        console.log("Deployer: ", deployer);
        console.log("Oracle:   ", oracle);
        console.log("USDC:     ", usdc);
        console.log("VaultId seed:", seed);
        console.logBytes32(vaultId);

        vm.startBroadcast(deployerKey);
        MintwareWeightedDistributor dist = new MintwareWeightedDistributor(oracle, deployer);
        // Single-sided USDC vault: token1 = address(0) → amount1 always 0.
        dist.registerVault(vaultId, usdc, address(0));
        vm.stopBroadcast();

        console.log("--- Deployed ---");
        console.log("Distributor:", address(dist));
        console.log("Wire social_vaults.weighted_distributor_address to the above,");
        console.log("and weighted_distributor_vault_id to the VaultId bytes32 printed above.");
    }
}
