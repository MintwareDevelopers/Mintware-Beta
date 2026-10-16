// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MintwareYieldVault} from "../src/payments/MintwareYieldVault.sol";
import {MintwareIdleYieldAdapter} from "../src/vaults/MintwareIdleYieldAdapter.sol";

/// @title  Agent "park" vault — Base Sepolia (TESTNET)
/// @notice The default vault behind the agent toolkits' park / unpark actions (the agentkit-actions package's
///         MINTWARE_PARK / MINTWARE_UNPARK, the eliza-plugin's PARK_USDC / UNPARK_USDC). Those actions call
///         `MintwareYieldVault.deposit(uint256,address)` / `redeem(uint256)` with **Circle testnet USDC** — the old
///         default (`0x09Cd…7E42`) is the ETH-collateral `MintwareYieldVault` instance whose asset is MOCK WETH, so
///         every park reverted. This deploys a USDC instance.
/// @dev    Adapter = the PRODUCTION zero-yield `MintwareIdleYieldAdapter` (onlyVault, one-time `setVault`,
///         deposit-capped) — NOT `MockYieldAdapter`, which anyone can drain. Parked USDC is held, not earning, on
///         testnet. Swap the adapter for a real ERC-4626 source on any real deployment.
///         Env: DEPLOYER_PRIVATE_KEY (0x-prefixed), optional PARK_USDC (default Circle Base Sepolia USDC),
///         optional PARK_DEPOSIT_CAP (6dp, default 100,000 USDC).
contract DeployAgentParkVault is Script {
    address constant CIRCLE_USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        require(block.chainid == 84532, "testnet only: Base Sepolia");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address usdc = vm.envOr("PARK_USDC", CIRCLE_USDC_BASE_SEPOLIA);
        uint256 cap = vm.envOr("PARK_DEPOSIT_CAP", uint256(100_000e6));

        vm.startBroadcast(deployerKey);
        MintwareIdleYieldAdapter adapter = new MintwareIdleYieldAdapter(usdc, address(0), deployer, cap);
        MintwareYieldVault vault = new MintwareYieldVault(usdc, address(adapter), deployer);
        adapter.setVault(address(vault)); // one-time
        vm.stopBroadcast();

        console.log("=== Agent park vault (Base Sepolia, TESTNET) ===");
        console.log("deployer / owner:        ", deployer);
        console.log("USDC:                    ", usdc);
        console.log("MintwareIdleYieldAdapter:", address(adapter));
        console.log("MintwareYieldVault:      ", address(vault));
        console.log("adapter deposit cap (6dp):", cap);
        console.log("Set MINTWARE_PARK_VAULT =", address(vault));
    }
}
