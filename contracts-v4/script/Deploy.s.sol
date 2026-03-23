// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

/// @notice Deploy order:
///   1. FeeVault
///   2. SocialVault (needs FeeVault address)
///   3. MWSocialHook via HookMiner (needs FeeVault + SocialVault addresses)
///   4. Wire: SocialVault.setHook(hook), FeeVault.setHook(hook)
///
/// @dev Run with:
///   forge script contracts-v4/script/Deploy.s.sol \
///     --rpc-url base_sepolia --broadcast --verify
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY
///   USDC_ADDRESS
///   V4_POOL_MANAGER
///   PYTH_ORACLE
///   ORACLE_SIGNER
///   TREASURY_ADDRESS
///   MINTWARE_DISTRIBUTOR   (existing MintwareDistributor.sol address)
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address usdc        = vm.envAddress("USDC_ADDRESS");
        address poolManager = vm.envAddress("V4_POOL_MANAGER");
        address pyth        = vm.envAddress("PYTH_ORACLE");
        address oracle      = vm.envAddress("ORACLE_SIGNER");
        address treasury    = vm.envAddress("TREASURY_ADDRESS");
        address distributor = vm.envAddress("MINTWARE_DISTRIBUTOR");

        console.log("Deploying Mintware Phase 2 contracts...");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // TODO (T1.6): deploy FeeVault, SocialVault, MWSocialHook
        // Use HookMiner.find() to compute correct CREATE2 salt for hook address
        // See: https://github.com/Uniswap/v4-periphery/blob/main/src/utils/HookMiner.sol

        vm.stopBroadcast();

        console.log("Deploy complete.");
    }
}
