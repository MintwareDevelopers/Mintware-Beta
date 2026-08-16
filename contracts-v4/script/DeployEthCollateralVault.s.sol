// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console}    from "forge-std/Script.sol";
import {MintwareYieldVault} from "../src/payments/MintwareYieldVault.sol";
import {MockERC20}          from "../test/mocks/MockERC20.sol";
import {MockYieldAdapter}   from "../test/mocks/MockYieldAdapter.sol";

/// @notice Deploy a Base Sepolia ETH-COLLATERAL vault for the multi-collateral edge-auth arm: a mock WETH
///         (18dp) + a yield adapter + `MintwareYieldVault` (token-agnostic — the "usdc_" ctor arg is just
///         the underlying). Seeds a deposit so the edge reads a real NAV. The vault exposes exactly the
///         edge's V1 ABI (`totalAssets`/`totalShares`/`shares`/`idleBuffer`), so the edge reads it as an
///         ETH leg and applies the VaR haircut against the LIVE Chainlink ETH/USD feed below.
///
///   Run:  forge script contracts-v4/script/DeployEthCollateralVault.s.sol --rpc-url base_sepolia --broadcast --slow
contract DeployEthCollateralVault is Script {
    /// Base Sepolia ETH/USD Chainlink feed — verified live (8dp, ~$1,881).
    address constant ETH_USD_FEED = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockYieldAdapter adapter = new MockYieldAdapter(address(weth));
        MintwareYieldVault vault = new MintwareYieldVault(address(weth), address(adapter), deployer);

        // Seed a real position: 10 WETH → the deployer holds ETH-collateral shares the edge can value.
        uint256 seed = 10 ether; // 10 WETH (18dp)
        weth.mint(deployer, seed);
        weth.approve(address(vault), seed);
        uint256 sharesMinted = vault.deposit(seed, deployer);
        vm.stopBroadcast();

        console.log("=== ETH-collateral vault deployed (Base Sepolia) ===");
        console.log("deployer:          ", deployer);
        console.log("WETH (mock, 18dp): ", address(weth));
        console.log("YieldAdapter:      ", address(adapter));
        console.log("EthCollateralVault:", address(vault));
        console.log("deposited (wei):   ", seed);
        console.log("shares minted:     ", sharesMinted);
        console.log("ETH/USD feed:      ", ETH_USD_FEED);
        console.log("");
        console.log("=== edge-auth EDGE_EXTRA_ config (an ETH portfolio leg) ===");
        console.log("EDGE_EXTRA_VAULT_ADDRESS =", address(vault));
        console.log("EDGE_EXTRA_VAULT_KIND    = v1");
        console.log("EDGE_EXTRA_COLLATERAL    = eth");
        console.log("EDGE_EXTRA_PRICE_FEED    =", ETH_USD_FEED);
        console.log("EDGE_EXTRA_FEED_DECIMALS = 8");
    }
}
