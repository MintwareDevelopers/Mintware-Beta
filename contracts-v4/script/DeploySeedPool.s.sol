// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MintwareSeedPool} from "../src/MintwareSeedPool.sol";

/// @notice Deploy the MintwareSeedPool singleton (one per chain; holds all raises).
///
/// ─── Required env ────────────────────────────────────────────────────────────
///   DEPLOYER_PRIVATE_KEY
///
/// ─── Run ─────────────────────────────────────────────────────────────────────
///   forge script contracts-v4/script/DeploySeedPool.s.sol --rpc-url base_sepolia --broadcast --verify -vvvv
///
/// Record the printed address as NEXT_PUBLIC_SEED_POOL_ADDRESS, then deploy a
/// per-vault adapter with DeploySeedAdapter.s.sol.
contract DeploySeedPool is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(key);
        MintwareSeedPool pool = new MintwareSeedPool();
        vm.stopBroadcast();

        console.log("MintwareSeedPool deployed:", address(pool));
    }
}
