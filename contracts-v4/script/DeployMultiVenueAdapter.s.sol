// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {MintwareMultiVenueYieldAdapter} from "../src/vaults/MintwareMultiVenueYieldAdapter.sol";
import {IYieldAdapter}                   from "../src/vaults/IYieldAdapter.sol";

/// @notice Wire the multi-source yield-routing layer (Phase 1b): deploy `MintwareMultiVenueYieldAdapter`,
///         set the per-venue risk cap, and point it at up to 3 child adapters with an initial weighting.
///         The off-chain rate-keeper (`lib/yield/rateKeeper.ts`) later re-weights it toward the best
///         current rate via `setVenues` + `rebalance` — this script just stands the layer up.
///
///         **The vault wiring (deploy-gated on the vault too):** the treasury vault's `adapter` slot is
///         `immutable`, so to route a vault through this, deploy the VAULT with this adapter's address as
///         its `adapter_` (e.g. in `DeployTreasuryV2.s.sol`), then call each child's `setVault(thisAdapter)`
///         and `thisAdapter.setVault(vault)`. Children must all share the vault's USDC as their underlying.
///
///   Env (addresses; a zero/unset child is skipped):
///     USDC, OWNER, MV_MAX_VENUE_BPS (default 4000),
///     MV_CHILD_1/2/3 (child IYieldAdapter addresses), MV_WEIGHT_1/2/3 (bps; Σ ≤ 10000, each ≤ cap).
///
///   Run (dry-run):  forge script contracts-v4/script/DeployMultiVenueAdapter.s.sol --rpc-url base_sepolia -vvvv
contract DeployMultiVenueAdapter is Script {
    function run() external {
        address usdc  = vm.envAddress("USDC");
        address owner = vm.envAddress("OWNER");
        uint16  cap   = uint16(vm.envOr("MV_MAX_VENUE_BPS", uint256(4_000)));

        // Collect the configured children (skip any left at address(0)).
        address[3] memory rawChild = [
            vm.envOr("MV_CHILD_1", address(0)),
            vm.envOr("MV_CHILD_2", address(0)),
            vm.envOr("MV_CHILD_3", address(0))
        ];
        uint16[3] memory rawWeight = [
            uint16(vm.envOr("MV_WEIGHT_1", uint256(0))),
            uint16(vm.envOr("MV_WEIGHT_2", uint256(0))),
            uint16(vm.envOr("MV_WEIGHT_3", uint256(0)))
        ];
        uint256 n;
        for (uint256 i; i < 3; ++i) if (rawChild[i] != address(0)) n++;

        IYieldAdapter[] memory children = new IYieldAdapter[](n);
        uint16[] memory weights = new uint16[](n);
        uint256 j;
        for (uint256 i; i < 3; ++i) {
            if (rawChild[i] == address(0)) continue;
            children[j] = IYieldAdapter(rawChild[i]);
            weights[j] = rawWeight[i];
            j++;
        }

        vm.startBroadcast();
        // vault set later (chicken-and-egg): the vault is deployed pointing AT this adapter, then wired.
        MintwareMultiVenueYieldAdapter mv = new MintwareMultiVenueYieldAdapter(usdc, address(0), owner);
        mv.setMaxVenueWeightBps(cap); // risk cap (PR #335) — no single venue above this
        if (n > 0) mv.setVenues(children, weights);
        vm.stopBroadcast();

        console.log("=== MintwareMultiVenueYieldAdapter (Phase 1b routing layer) ===");
        console.log("adapter:        ", address(mv));
        console.log("owner (curator):", owner);
        console.log("maxVenueBps:    ", cap);
        console.log("child venues:   ", n);
        console.log("NEXT: deploy the vault with adapter_ = the address above, then wire setVault both ways.");
    }
}
