// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AIAttribution}   from "../src/AIAttribution.sol";

/// @notice Deploy AIAttribution contract.
///
/// ─── Required env vars ─────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY  — hex, no 0x prefix
///   ORACLE_ADDRESS        — Mintware oracle wallet (same keypair as onchainPublisher.ts)
///
/// ─── Run commands ──────────────────────────────────────────────────────────
///   Dry-run:
///     forge script contracts-v4/script/DeployAIAttribution.s.sol --rpc-url base_sepolia -vvvv
///
///   Deploy + verify (Base Sepolia):
///     forge script contracts-v4/script/DeployAIAttribution.s.sol \
///       --rpc-url base_sepolia --broadcast --verify -vvvv
///
///   Deploy + verify (Base mainnet):
///     forge script contracts-v4/script/DeployAIAttribution.s.sol \
///       --rpc-url base --broadcast --verify -vvvv
///
contract DeployAIAttribution is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address oracleAddr  = vm.envAddress("ORACLE_ADDRESS");

        console.log("=== AIAttribution Deploy ===");
        console.log("Chain:    ", block.chainid);
        console.log("Deployer: ", deployer);
        console.log("Oracle:   ", oracleAddr);

        vm.startBroadcast(deployerKey);
        AIAttribution aiAttribution = new AIAttribution(oracleAddr);
        vm.stopBroadcast();

        console.log("");
        console.log("=== Deploy complete ===");
        console.log("AIAttribution:", address(aiAttribution));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Set NEXT_PUBLIC_AI_ATTRIBUTION_CONTRACT_BASE_SEPOLIA=", address(aiAttribution), "in .env.local");
        console.log("  2. Apply supabase/migrations/20260325000001_ai_attribution_schema.sql");
        console.log("  3. Set AI_ATTRIBUTION_ORACLE_SECRET in .env.local and Vercel");
        console.log("  4. Set NEXT_PUBLIC_AI_ATTRIBUTION_ENABLED=true in Vercel (Production only)");
    }
}
