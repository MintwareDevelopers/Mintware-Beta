// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MintwareRWAVault4626} from "../src/rwa/MintwareRWAVault4626.sol";
import {MintwareBaseVault4626} from "../src/vaults/MintwareBaseVault4626.sol";
import {MintwareVRWA, TransferMode} from "../src/rwa/MintwareVRWA.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "../src/rwa/SPVBeneficiaryRegistry.sol";
import {VaultSurface, LockTier, VaultConfig} from "../src/vaults/VaultTypes.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockYieldAdapter} from "./mocks/MockYieldAdapter.sol";

/// @dev WS3 (three-role model): `vRWA` is the issuer-supplied security token, NOT a wrapper minted
///      to depositors. Public 4626 deposit is CLOSED; the issuer capitalizes the USDC reserve via
///      fundReserve(); redemption is keyed on `vRWA` (not vault shares) so a secondary-market holder
///      can redeem, settled at par by the issuer after the window + KYC.
contract MintwareRWAVault4626Test is Test {
    address internal deployer   = address(this);
    address internal alice      = makeAddr("alice");
    address internal bob        = makeAddr("bob");
    address internal issuer     = makeAddr("issuer");
    address internal kycProvider = makeAddr("kycProvider");
    address internal treasury   = makeAddr("treasury");
    address internal dist       = makeAddr("distributor");
    address internal pmAddr     = makeAddr("poolManager"); // never called (reserve-only v1)

    MockERC20 internal usdc;
    MintwareVRWA internal vrwa;
    SPVBeneficiaryRegistry internal registry;
    FeeVault internal feeVault;
    MintwareRWAVault4626 internal vault;

    function setUp() public {
        usdc     = new MockERC20("USD Coin", "USDC", 6);
        vrwa     = new MintwareVRWA("Mintware vRWA", "vRWA", 6, deployer);
        registry = new SPVBeneficiaryRegistry(deployer);
        registry.setKycProvider(kycProvider);
        feeVault = new FeeVault(address(usdc), dist, makeAddr("oracle"), treasury);

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
        vault = new MintwareRWAVault4626(cfg, pmAddr, address(feeVault), address(vrwa), address(registry), issuer);
        vrwa.setMinter(address(vault));
        feeVault.setSocialVault(address(vault)); // authorize vault to notify rwa_yield

        usdc.mint(alice, 100_000e6);
    }

    // Simulate a holder acquiring `vRWA` (e.g. buying issuer-seeded inventory on the secondary
    // market): mint to them directly, then restore the vault as the minter (so redemption can burn).
    function _giveVrwa(address who, uint256 amt) internal {
        vrwa.setMinter(deployer);
        vrwa.mint(who, amt);
        vrwa.setMinter(address(vault));
    }

    // Issuer capitalizes the USDC redemption reserve.
    function _fundReserve(uint256 amt) internal {
        usdc.mint(issuer, amt);
        vm.startPrank(issuer);
        usdc.approve(address(vault), amt);
        vault.fundReserve(amt);
        vm.stopPrank();
    }

    function _kyc(address who) internal {
        vm.prank(kycProvider);
        registry.verifyBeneficiary(who, KYCLevel.BASIC, bytes32("ref"), bytes2("US"), 0, false);
    }

    // ── deposit is closed; vRWA is not a depositor wrapper ───────────────────

    function test_deposit_disabled() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(MintwareRWAVault4626.DepositsDisabled.selector);
        vault.deposit(1_000e6, alice);
        vm.stopPrank();
    }

    function test_vrwa_transfers_freely_by_default() public {
        _giveVrwa(alice, 1_000e6);
        vm.prank(alice);
        vrwa.transfer(bob, 400e6); // PERMISSIONLESS default (Reg A+)
        assertEq(vrwa.balanceOf(bob), 400e6);
        assertEq(vrwa.balanceOf(alice), 600e6);
    }

    // ── redemption is vRWA-keyed (works for a secondary-market holder) ────────

    function test_requestRedeem_requires_vrwa() public {
        // alice never deposited and holds no vRWA
        vm.prank(alice);
        vm.expectRevert(MintwareRWAVault4626.InsufficientVRWA.selector);
        vault.requestRedeem(1_000e6);
    }

    function test_requestRedeem_pending_guard() public {
        _giveVrwa(alice, 1_000e6);
        vm.startPrank(alice);
        vault.requestRedeem(600e6);
        vm.expectRevert(MintwareRWAVault4626.RedemptionPending.selector);
        vault.requestRedeem(400e6);
        vm.stopPrank();
    }

    function test_executeRedeem_disabled() public {
        vm.prank(alice);
        vm.expectRevert(MintwareRWAVault4626.UseConfirmSettlement.selector);
        vault.executeRedeem();
    }

    function test_confirmSettlement_only_issuer() public {
        _giveVrwa(alice, 1_000e6);
        vm.prank(alice);
        vault.requestRedeem(1_000e6);
        vm.warp(block.timestamp + 30 days + 1);
        _kyc(alice);

        vm.prank(bob); // not issuer
        vm.expectRevert(MintwareRWAVault4626.OnlyIssuer.selector);
        vault.confirmSettlement(alice);
    }

    function test_confirmSettlement_requires_kyc() public {
        _giveVrwa(alice, 1_000e6);
        vm.prank(alice);
        vault.requestRedeem(1_000e6);
        vm.warp(block.timestamp + 30 days + 1);
        // no KYC for alice
        vm.prank(issuer);
        vm.expectRevert(bytes("SPV: KYC required"));
        vault.confirmSettlement(alice);
    }

    /// The headline WS3 property: a secondary-market holder with ZERO vault shares redeems.
    function test_secondary_market_holder_redeems_at_par() public {
        _giveVrwa(alice, 1_000e6);      // alice bought vRWA; never deposited → holds no shares
        _fundReserve(1_000e6);          // issuer capitalizes the reserve
        assertEq(vault.balanceOf(alice), 0, "holder has no vault shares");

        vm.prank(alice);
        vault.requestRedeem(1_000e6);
        assertEq(vrwa.balanceOf(alice), 0, "vRWA burned on request");

        _kyc(alice);
        // Cannot settle before the window.
        vm.prank(issuer);
        vm.expectRevert(MintwareBaseVault4626.NoticeNotExpired.selector);
        vault.confirmSettlement(alice);

        vm.warp(block.timestamp + 30 days + 1);
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(issuer);
        uint256 out = vault.confirmSettlement(alice);

        assertEq(out, 1_000e6, "par settled");
        assertEq(usdc.balanceOf(alice) - balBefore, 1_000e6, "USDC returned at par");
    }

    // ── reserve funding + yield deployment ───────────────────────────────────

    function test_fundReserve_routes_60pct_to_yield() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vault.setYieldAdapter(address(adapter)); // default reserveRatio 40%

        _fundReserve(10_000e6);
        assertEq(adapter.totalAssets(), 6_000e6, "60% routed to yield");
        assertEq(vault.principalInYield(), 6_000e6);
        assertEq(usdc.balanceOf(address(vault)), 4_000e6, "40% reserve held");
    }

    function test_settlement_recalls_from_yield() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vault.setYieldAdapter(address(adapter));

        _fundReserve(10_000e6); // 6k to yield, 4k reserve
        _giveVrwa(alice, 10_000e6);

        vm.prank(alice);
        vault.requestRedeem(10_000e6);
        vm.warp(block.timestamp + 30 days + 1);
        _kyc(alice);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(issuer);
        vault.confirmSettlement(alice); // reserve (4k) short → recalls 6k from yield

        assertEq(usdc.balanceOf(alice) - balBefore, 10_000e6, "full par settled");
        assertEq(vault.principalInYield(), 0, "yield fully recalled");
    }

    function test_harvest_splits_70_30() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vault.setYieldAdapter(address(adapter));
        _fundReserve(10_000e6); // 6k in yield

        usdc.mint(address(adapter), 600e6); // simulate yield

        uint256 fBefore = usdc.balanceOf(address(feeVault));
        uint256 tBefore = usdc.balanceOf(treasury);
        uint256 yield = vault.harvestYield();

        assertEq(yield, 600e6);
        assertEq(usdc.balanceOf(address(feeVault)) - fBefore, 420e6, "70% depositors");
        assertEq(usdc.balanceOf(treasury) - tBefore, 180e6, "30% Mintware");
        assertEq(vault.principalInYield(), 6_000e6, "principal untouched");
    }

    function test_emergency_freeze_blocks_transfers() public {
        _giveVrwa(alice, 1_000e6);
        vrwa.setGuardian(deployer);
        vrwa.emergencyFreeze();
        assertEq(uint256(vrwa.transferMode()), uint256(TransferMode.FROZEN));

        vm.prank(alice);
        vm.expectRevert(MintwareVRWA.TransfersFrozen.selector);
        vrwa.transfer(bob, 1e6);
    }
}
