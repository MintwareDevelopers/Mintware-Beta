// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MintwarePaymentGateway} from "../src/payments/MintwarePaymentGateway.sol";

/// @notice LIVE card-charge settlement on Arc testnet — the headline YPN demo: a user's EIP-712
///         `DelegatedSpendPermit` authorizes a spend, the RELAYER submits `settleSpend`, and the Gateway
///         burns the user's vault shares for USDC to the card rail (CPN treasury). $2 spend → permit-only
///         (under the $250 edge-auth threshold). Deployer plays user + relayer + admin for the demo.
///
///   Run:  forge script contracts-v4/script/LiveSettleArc.s.sol --rpc-url arc --broadcast --slow
///
///   ⚠ ARC CAVEAT: forge's LOCAL EVM mis-simulates Arc's system-contract USDC (0x3600…0000) and reverts with
///   a spurious StackUnderflow during the broadcast pre-sim, even though the real Arc node executes the
///   withdraw/settle path correctly (verified: a plain on-chain redeem + this settleSpend both succeed).
///   So on Arc, SETTLE VIA `cast send` (which estimates gas on the real node), not `forge script --broadcast`.
///   This script is the reference for building/signing the permit; the live settle was done with cast —
///   PROVEN on Arc testnet: tx 0x41e12fce…1a64c8de burned 2 USDC of shares → paid the merchant 2 USDC.
contract LiveSettleArc is Script {
    address constant GATEWAY = 0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399;
    bytes32 constant DELEGATED_SPEND_PERMIT_TYPEHASH =
        keccak256("DelegatedSpendPermit(address user,uint256 maxDailySpendUSDC,uint256 nonce,uint256 deadline)");

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address user = vm.addr(key); // deployer = user (permit signer) = relayer = admin, for the demo
        MintwarePaymentGateway gw = MintwarePaymentGateway(GATEWAY);

        address merchant = vm.addr(uint256(keccak256("mintware-arc-card-rail-demo")));
        uint256 assets = 2_000_000; // $2.00 (6dp) — under the $250 threshold → permit-only

        // Build + sign the DelegatedSpendPermit over the Gateway's LIVE EIP-712 domain.
        MintwarePaymentGateway.DelegatedSpendPermit memory permit = MintwarePaymentGateway.DelegatedSpendPermit({
            user: user,
            maxDailySpendUSDC: 1_000_000_000, // $1,000 daily cap
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });
        bytes32 structHash = keccak256(abi.encode(
            DELEGATED_SPEND_PERMIT_TYPEHASH, permit.user, permit.maxDailySpendUSDC, permit.nonce, permit.deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", gw.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        bytes memory permitSig = abi.encodePacked(r, s, v);

        // Permit-only path: empty edge auth (skipped for sub-$250).
        MintwarePaymentGateway.ShortLivedHoldAuth memory edge;
        bytes memory edgeSig = "";

        bytes32 holdId = keccak256(abi.encodePacked("arc-demo-hold", block.timestamp, user));

        vm.startBroadcast(key);
        gw.setCircleCpnTreasury(merchant); // point the card rail at the demo merchant (admin action)
        uint256 sharesBurned = gw.settleSpend(holdId, user, assets, merchant, permit, permitSig, edge, edgeSig);
        vm.stopBroadcast();

        console.log("=== LIVE settleSpend on Arc ===");
        console.log("user (spender):     ", user);
        console.log("merchant (card rail):", merchant);
        console.log("assets settled (6dp):", assets);
        console.log("sharesBurned:        ", sharesBurned);
    }
}
