// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwareVRWA, TransferMode} from "../src/rwa/MintwareVRWA.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "../src/rwa/SPVBeneficiaryRegistry.sol";

/// @dev WS1 — the three-role trader gate. In WHITELISTED mode vRWA may only move between permitted
///      counterparties: infra addresses on the `whitelisted` allowlist (pool / router / vault /
///      issuer) and human wallets KYC-verified in the SPVBeneficiaryRegistry. This is the gate that
///      makes a swap-out leg reach only a verified trader, enforced at the ERC-20 transfer boundary.
contract MintwareVRWAGateTest is Test {
    address internal deployer    = address(this);
    address internal kycProvider = makeAddr("kycProvider");
    address internal pool        = makeAddr("pool");    // infra permitted holder (e.g. PoolManager)
    address internal trader      = makeAddr("trader");  // human — needs registry KYC
    address internal stranger    = makeAddr("stranger");

    MintwareVRWA internal vrwa;
    SPVBeneficiaryRegistry internal registry;

    function setUp() public {
        vrwa     = new MintwareVRWA("Mintware vRWA", "vRWA", 6, deployer);
        registry = new SPVBeneficiaryRegistry(deployer);
        registry.setKycProvider(kycProvider);

        vrwa.setMinter(deployer);           // let the test mint inventory
        vrwa.setRegistry(address(registry));
        vrwa.setWhitelist(pool, true);      // enroll the pool as an infra permitted holder

        vrwa.mint(pool, 1_000e6);           // seed pool inventory (mint always allowed)
    }

    function _enterWhitelistedMode() internal {
        vrwa.proposeTransferMode(TransferMode.WHITELISTED);
        vm.warp(block.timestamp + 48 hours);
        vrwa.confirmTransferMode();
        assertEq(uint8(vrwa.transferMode()), uint8(TransferMode.WHITELISTED));
    }

    function _verify(address who) internal {
        vm.prank(kycProvider);
        registry.verifyBeneficiary(who, KYCLevel.BASIC, bytes32(0), bytes2("US"), 0, false);
    }

    /// Baseline: PERMISSIONLESS mode (Reg A+) leaves transfers fully open.
    function test_permissionless_transfersOpen() public {
        vm.prank(pool);
        vrwa.transfer(stranger, 10e6);
        assertEq(vrwa.balanceOf(stranger), 10e6);
    }

    /// WHITELISTED: a non-verified recipient (the swap-out leg to an un-KYC'd trader) reverts.
    function test_whitelisted_unverifiedRecipientReverts() public {
        _enterWhitelistedMode();
        vm.prank(pool);
        vm.expectRevert(MintwareVRWA.NotWhitelisted.selector);
        vrwa.transfer(trader, 10e6);
    }

    /// WHITELISTED: a registry-verified trader can receive vRWA.
    function test_whitelisted_verifiedTraderReceives() public {
        _enterWhitelistedMode();
        _verify(trader);
        vm.prank(pool);
        vrwa.transfer(trader, 10e6);
        assertEq(vrwa.balanceOf(trader), 10e6);
    }

    /// WHITELISTED: infra allowlist passes without any registry entry.
    function test_whitelisted_infraAllowlistPasses() public {
        address router = makeAddr("router");
        vrwa.setWhitelist(router, true);
        _enterWhitelistedMode();
        vm.prank(pool);
        vrwa.transfer(router, 10e6);
        assertEq(vrwa.balanceOf(router), 10e6);
    }

    /// WHITELISTED: revoking KYC re-closes the gate for that wallet.
    function test_whitelisted_revokeBlocksTransfer() public {
        _enterWhitelistedMode();
        _verify(trader);
        vm.prank(pool);
        vrwa.transfer(trader, 10e6);

        vm.prank(kycProvider);
        registry.revokeBeneficiary(trader);

        vm.prank(trader);
        vm.expectRevert(MintwareVRWA.NotWhitelisted.selector);
        vrwa.transfer(pool, 5e6);
    }

    /// WHITELISTED: mint/burn stay allowed regardless of holder status (issuer inventory + redemption).
    function test_whitelisted_mintBurnStillAllowed() public {
        _enterWhitelistedMode();
        vrwa.mint(stranger, 5e6);          // mint to a non-verified wallet: allowed
        assertEq(vrwa.balanceOf(stranger), 5e6);
        vrwa.burn(stranger, 5e6);          // burn from a non-verified wallet: allowed
        assertEq(vrwa.balanceOf(stranger), 0);
    }

    /// WHITELISTED with the registry disabled (zero) falls back to allowlist-only enforcement.
    function test_whitelisted_registryDisabledIsAllowlistOnly() public {
        vrwa.setRegistry(address(0));
        _enterWhitelistedMode();
        _verify(trader); // registry marks verified, but vRWA no longer consults it
        vm.prank(pool);
        vm.expectRevert(MintwareVRWA.NotWhitelisted.selector);
        vrwa.transfer(trader, 10e6);
    }

    /// End-to-end enrollment recipe (mirrors script/RwaWhitelistEnroll.s.sol): set registry + KYC
    /// provider, enroll infra, propose+confirm WHITELISTED, then verify a trader and prove the gate.
    function test_enrollmentRecipe_endToEnd() public {
        address router = makeAddr("router");
        address issuer = makeAddr("issuer");

        // --- script run(): enroll + propose ---
        registry.setKycProvider(kycProvider);
        vrwa.setRegistry(address(registry));
        vrwa.setWhitelist(pool, true);
        vrwa.setWhitelist(router, true);
        vrwa.setWhitelist(issuer, true);
        vrwa.proposeTransferMode(TransferMode.WHITELISTED);

        // --- script confirm(): after the 48h timelock ---
        vm.warp(block.timestamp + 48 hours);
        vrwa.confirmTransferMode();
        assertEq(uint8(vrwa.transferMode()), uint8(TransferMode.WHITELISTED));

        // infra moves freely; an un-KYC'd human cannot receive the swap-out leg
        vm.prank(pool);
        vrwa.transfer(router, 100e6);
        assertEq(vrwa.balanceOf(router), 100e6);

        vm.prank(pool);
        vm.expectRevert(MintwareVRWA.NotWhitelisted.selector);
        vrwa.transfer(trader, 100e6);

        // oracle verifies the trader → the swap-out leg now lands
        _verify(trader);
        vm.prank(pool);
        vrwa.transfer(trader, 100e6);
        assertEq(vrwa.balanceOf(trader), 100e6);
    }
}
