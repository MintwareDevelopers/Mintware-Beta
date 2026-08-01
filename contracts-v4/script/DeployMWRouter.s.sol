// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager}     from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {MWRouter}         from "../src/MWRouter.sol";

/// @notice Deploy MWRouter (the internal best-execution swap router).
///
/// Env:
///   POOL_MANAGER        — Uniswap V4 PoolManager on the target chain (required)
///   MW_ROUTER_TREASURY  — receives the router fee (required)
///   MW_ROUTER_FEE_BPS   — fee in bps of output (optional, default 50 = 0.5%, cap 100)
///   MW_ROUTER_OWNER     — owner that can set the fee (optional, default: broadcaster)
///
/// Run (Base Sepolia):
///   forge script contracts-v4/script/DeployMWRouter.s.sol \
///     --rpc-url base_sepolia --broadcast --verify
///
/// After deploy, set the app env: MW_ROUTER_ADDRESS_BASE[_SEPOLIA], MW_ROUTER_ADDRESSES
/// (for reward verification), MW_V4_QUOTER_BASE[_SEPOLIA], NEXT_PUBLIC_MW_ROUTER_ENABLED=true,
/// then seed a `router_pools` row. See docs/developers/phase3-router-design.md §10.
contract DeployMWRouter is Script {
    function run() external {
        address poolManager = vm.envAddress("POOL_MANAGER");
        address treasury    = vm.envAddress("MW_ROUTER_TREASURY");
        uint16  feeBps      = uint16(vm.envOr("MW_ROUTER_FEE_BPS", uint256(50)));
        address owner       = vm.envOr("MW_ROUTER_OWNER", msg.sender);

        vm.startBroadcast();
        MWRouter router = new MWRouter(IPoolManager(poolManager), treasury, feeBps, owner);
        vm.stopBroadcast();

        console2.log("MWRouter deployed:", address(router));
        console2.log("  poolManager:", poolManager);
        console2.log("  treasury:   ", treasury);
        console2.log("  feeBps:     ", feeBps);
        console2.log("  owner:      ", owner);
    }
}
