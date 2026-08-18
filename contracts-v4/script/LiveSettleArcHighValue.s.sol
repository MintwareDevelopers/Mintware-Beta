// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MintwarePaymentGateway} from "../src/payments/MintwarePaymentGateway.sol";

/// @notice The HIGH-VALUE (>= $250) settle reference: the two-signer lane. A charge at/above the threshold
///         needs BOTH the user's long-lived `DelegatedSpendPermit` AND a short-lived `ShortLivedHoldAuth`
///         signed by an EDGE_SIGNER (<= 5-min window) — so a rogue relayer can't push a large settlement
///         through alone. This script builds + EIP-712-signs both structs and calls `settleSpend`.
///
/// @dev    The two-signer control is already PROVEN in `MintwareGatewayTreasuryV2.t.sol`
///         (test_highValue_settles_withEdgeAuth / _withoutEdge_reverts / _edgeAmountMismatch_reverts). This
///         is the runnable reference for producing a real >= $250 settle. To run it LIVE on Arc the user
///         must hold >= $250 of vault shares (the testnet faucet caps at 20 USDC / 2h, so a live >= $250 run
///         needs more funding); for the demo, DEPLOYER = user + relayer + edge signer.
///
/// @dev    ARC caveat (same as LiveSettleArc): settle via `cast send`, not `forge script --broadcast` —
///         forge's local EVM mis-simulates Arc's system-contract USDC.
contract LiveSettleArcHighValue is Script {
    address constant GATEWAY = 0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399;
    bytes32 constant DELEGATED_SPEND_PERMIT_TYPEHASH =
        keccak256("DelegatedSpendPermit(address user,uint256 maxDailySpendUSDC,uint256 nonce,uint256 deadline)");
    bytes32 constant SHORT_LIVED_HOLD_AUTH_TYPEHASH =
        keccak256("ShortLivedHoldAuth(bytes32 holdId,address user,uint256 amountUSDC,uint256 nonce,uint256 expiry)");

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");        // user (permit signer)
        uint256 edgeKey = vm.envOr("EDGE_SIGNER_KEY", key);       // EDGE_SIGNER (defaults to deployer for demo)
        address user = vm.addr(key);
        MintwarePaymentGateway gw = MintwarePaymentGateway(GATEWAY);

        uint256 assets = 300_000_000; // $300 — over the $250 threshold → edge auth REQUIRED
        bytes32 dsep = gw.domainSeparator();
        bytes32 holdId = keccak256(abi.encodePacked("arc-hv-hold", block.timestamp, user));

        // (1) Long-lived spend permit (user).
        MintwarePaymentGateway.DelegatedSpendPermit memory permit = MintwarePaymentGateway.DelegatedSpendPermit({
            user: user, maxDailySpendUSDC: 1_000_000_000, nonce: 1, deadline: block.timestamp + 1 hours
        });
        bytes32 pHash = keccak256(abi.encode(
            DELEGATED_SPEND_PERMIT_TYPEHASH, permit.user, permit.maxDailySpendUSDC, permit.nonce, permit.deadline
        ));
        (uint8 pv, bytes32 pr, bytes32 ps) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", dsep, pHash)));
        bytes memory permitSig = abi.encodePacked(pr, ps, pv);

        // (2) Short-lived edge authorization (EDGE_SIGNER) — must match holdId/user/amount, <= 5-min window.
        MintwarePaymentGateway.ShortLivedHoldAuth memory edge = MintwarePaymentGateway.ShortLivedHoldAuth({
            holdId: holdId, user: user, amountUSDC: assets, nonce: 1, expiry: block.timestamp + 4 minutes
        });
        bytes32 eHash = keccak256(abi.encode(
            SHORT_LIVED_HOLD_AUTH_TYPEHASH, edge.holdId, edge.user, edge.amountUSDC, edge.nonce, edge.expiry
        ));
        (uint8 ev, bytes32 er, bytes32 es) = vm.sign(edgeKey, keccak256(abi.encodePacked("\x19\x01", dsep, eHash)));
        bytes memory edgeSig = abi.encodePacked(er, es, ev);

        vm.startBroadcast(key);
        uint256 sharesBurned = gw.settleSpend(holdId, user, assets, user, permit, permitSig, edge, edgeSig);
        vm.stopBroadcast();

        console.log("=== HIGH-VALUE settleSpend ($300, edge-signed) ===");
        console.log("user:        ", user);
        console.log("assets (6dp):", assets);
        console.log("sharesBurned:", sharesBurned);
    }
}
