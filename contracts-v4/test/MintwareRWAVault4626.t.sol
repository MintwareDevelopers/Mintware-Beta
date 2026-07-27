// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwareRWAVault4626} from "../src/rwa/MintwareRWAVault4626.sol";
import {MintwareBaseVault4626} from "../src/vaults/MintwareBaseVault4626.sol";
import {MintwareVRWA, TransferMode} from "../src/rwa/MintwareVRWA.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "../src/rwa/SPVBeneficiaryRegistry.sol";
import {VaultSurface, LockTier, VaultConfig} from "../src/vaults/VaultTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract MintwareRWAVault4626Test is Test {
    address internal deployer   = address(this);
    address internal alice      = makeAddr("alice");
    address internal bob        = makeAddr("bob");
    address internal issuer     = makeAddr("issuer");
    address internal kycProvider = makeAddr("kycProvider");
    address internal treasury   = makeAddr("treasury");
    address internal feeVault   = makeAddr("feeVault");
    address internal pmAddr     = makeAddr("poolManager"); // never called (reserve-only v1)

    MockERC20 internal usdc;
    MintwareVRWA internal vrwa;
    SPVBeneficiaryRegistry internal registry;
    MintwareRWAVault4626 internal vault;

    function setUp() public {
        usdc     = new MockERC20("USD Coin", "USDC", 6);
        vrwa     = new MintwareVRWA("Mintware vRWA", "vRWA", 6, deployer);
        registry = new SPVBeneficiaryRegistry(deployer);
        registry.setKycProvider(kycProvider);

        VaultConfig memory cfg = VaultConfig({
            surface:             VaultSurface.RWA,
            provider:            deployer,
            underlyingToken:     address(usdc),
            treasury:            treasury,
            name:                "MW RWA Vault Share",
            symbol:              "mwRWA",
            minDeposit:          0,
            entryFeeBps:         0,
            exitFeeBps:          0,
            enableMEVProtection: false,
            enableIdleCapital:   false,
            idleTargetRatio:     0
        });
        vault = new MintwareRWAVault4626(cfg, pmAddr, feeVault, address(vrwa), address(registry), issuer);
        vrwa.setMinter(address(vault));

        usdc.mint(alice, 100_000e6);
    }

    function _deposit(address who, uint256 amt) internal returns (uint256 shares) {
        vm.startPrank(who);
        usdc.approve(address(vault), amt);
        shares = vault.deposit(amt, who);
        vm.stopPrank();
    }

    function _kyc(address who) internal {
        vm.prank(kycProvider);
        registry.verifyBeneficiary(who, KYCLevel.BASIC, bytes32("ref"), bytes2("US"), 0, false);
    }

    function test_deposit_mints_shares_and_vrwa() public {
        uint256 shares = _deposit(alice, 1_000e6);
        assertEq(vault.balanceOf(alice), shares, "shares");
        assertEq(vrwa.balanceOf(alice), shares, "vRWA minted 1:1");
        assertEq(vault.totalPrincipal(), 1_000e6);
    }

    function test_vrwa_is_permissionless_bearer() public {
        _deposit(alice, 1_000e6);
        vm.prank(alice);
        vrwa.transfer(bob, 400e6); // freely transferable by default
        assertEq(vrwa.balanceOf(bob), 400e6);
        assertEq(vrwa.balanceOf(alice), 600e6);
    }

    function test_requestRedeem_requires_vrwa() public {
        _deposit(alice, 1_000e6);
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vrwa.transfer(bob, 1_000e6); // alice no longer holds the claim ticket
        vm.prank(alice);
        vm.expectRevert(MintwareRWAVault4626.InsufficientVRWA.selector);
        vault.requestRedeem(1_000e6);
    }

    function test_executeRedeem_disabled() public {
        _deposit(alice, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(MintwareRWAVault4626.UseConfirmSettlement.selector);
        vault.executeRedeem();
    }

    function test_confirmSettlement_only_issuer() public {
        _deposit(alice, 1_000e6);
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(1_000e6);
        vm.warp(block.timestamp + 30 days + 1);
        _kyc(alice);

        vm.prank(bob); // not issuer
        vm.expectRevert(MintwareRWAVault4626.OnlyIssuer.selector);
        vault.confirmSettlement(alice);
    }

    function test_confirmSettlement_requires_kyc() public {
        _deposit(alice, 1_000e6);
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(1_000e6);
        vm.warp(block.timestamp + 30 days + 1);
        // no KYC for alice
        vm.prank(issuer);
        vm.expectRevert(bytes("SPV: KYC required"));
        vault.confirmSettlement(alice);
    }

    function test_full_rwa_redemption_flow() public {
        _deposit(alice, 1_000e6);
        assertEq(vrwa.balanceOf(alice), 1_000e6);

        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(1_000e6);
        assertEq(vrwa.balanceOf(alice), 0, "vRWA burned on request");

        // Cannot settle before the 30-day window.
        _kyc(alice);
        vm.prank(issuer);
        vm.expectRevert(MintwareBaseVault4626.NoticeNotExpired.selector);
        vault.confirmSettlement(alice);

        vm.warp(block.timestamp + 30 days + 1);
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(issuer);
        uint256 out = vault.confirmSettlement(alice);

        assertEq(out, 1_000e6, "full principal settled");
        assertEq(usdc.balanceOf(alice) - balBefore, 1_000e6, "USDC returned");
        assertEq(vault.balanceOf(alice), 0, "shares burned");
        assertEq(vault.totalPrincipal(), 0);
    }

    function test_emergency_freeze_blocks_transfers() public {
        _deposit(alice, 1_000e6);
        vrwa.setGuardian(deployer);
        vrwa.emergencyFreeze();
        assertEq(uint256(vrwa.transferMode()), uint256(TransferMode.FROZEN));

        vm.prank(alice);
        vm.expectRevert(MintwareVRWA.TransfersFrozen.selector);
        vrwa.transfer(bob, 1e6);
    }
}
