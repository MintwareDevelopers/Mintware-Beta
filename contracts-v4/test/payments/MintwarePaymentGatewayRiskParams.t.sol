// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MintwarePaymentGateway} from "../../src/payments/MintwarePaymentGateway.sol";
import {MWTimelockedRiskParams} from "../../src/lib/MWTimelockedRiskParams.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice The retained PaymentGateway's refill-cap governance rail: bounds, disclosure, delay,
///         cancellation, immediate tightening, access control, and pause independence.
contract MintwarePaymentGatewayRiskParamsTest is Test {
    MockERC20 internal usdc;
    MintwarePaymentGateway internal gateway;
    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    address internal user = makeAddr("user");
    uint256 internal constant DELAY = 48 hours;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        gateway = new MintwarePaymentGateway(address(0x100), address(usdc), address(0x200), owner);
    }

    function _param() internal view returns (bytes32) {
        return keccak256(abi.encode("MW_REFILL_CAP", user));
    }

    function test_tightening_appliesImmediately() public {
        uint256 cap = gateway.DEFAULT_GLOBAL_REFILL_CAP() / 2;
        vm.expectEmit(true, false, false, true, address(gateway));
        emit MWTimelockedRiskParams.RiskParamConfirmed(_param(), 0, cap, 0);
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, cap);
        assertEq(gateway.userDailyRefillCap(user), cap);
        (,, uint256 eta) = gateway.pendingRiskParam(_param());
        assertEq(eta, 0, "tightening is immediate");
    }

    function test_looseningWaits48HoursAndIsDisclosed() public {
        uint256 initial = gateway.DEFAULT_GLOBAL_REFILL_CAP() / 2;
        uint256 wider = gateway.DEFAULT_GLOBAL_REFILL_CAP() * 2;
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, initial);
        uint256 eta = block.timestamp + DELAY;

        vm.expectEmit(true, false, false, true, address(gateway));
        emit MWTimelockedRiskParams.RiskParamProposed(_param(), initial, wider, 0, eta);
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, wider);
        assertEq(gateway.userDailyRefillCap(user), initial, "loosening applied before delay");
        (uint256 proposed,, uint256 pendingEta) = gateway.pendingRiskParam(_param());
        assertEq(proposed, wider);
        assertEq(pendingEta, eta);

        vm.expectRevert(MWTimelockedRiskParams.RiskParamDelayNotElapsed.selector);
        vm.prank(owner);
        gateway.confirmUserDailyRefillCap(user);

        vm.warp(eta + 1);
        vm.expectEmit(true, false, false, true, address(gateway));
        emit MWTimelockedRiskParams.RiskParamConfirmed(_param(), initial, wider, 0);
        vm.prank(owner);
        gateway.confirmUserDailyRefillCap(user);
        assertEq(gateway.userDailyRefillCap(user), wider);
        (,, pendingEta) = gateway.pendingRiskParam(_param());
        assertEq(pendingEta, 0, "confirmed change clears pending state");
    }

    function test_tighteningCancelsQueuedLoosening() public {
        uint256 initial = gateway.DEFAULT_GLOBAL_REFILL_CAP() / 2;
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, initial);
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, initial * 2);
        assertGt(_pendingEta(), 0);

        vm.expectEmit(true, false, false, true, address(gateway));
        emit MWTimelockedRiskParams.RiskParamCancelled(_param(), initial * 2, 0);
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, initial / 2);
        assertEq(gateway.userDailyRefillCap(user), initial / 2);
        assertEq(_pendingEta(), 0, "instant tightening removes stale queued loosening");
    }

    function test_zeroResetsToDefaultAndLooseningIsTimelocked() public {
        uint256 initial = gateway.DEFAULT_GLOBAL_REFILL_CAP() / 2;
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, initial);
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, 0);
        assertEq(gateway.userDailyRefillCap(user), initial);
        assertGt(_pendingEta(), 0, "reset to larger global default is delayed");
        vm.warp(_pendingEta() + 1);
        vm.prank(owner);
        gateway.confirmUserDailyRefillCap(user);
        assertEq(gateway.userDailyRefillCap(user), 0);
    }

    function test_outOfBoundsRejectedBeforeScheduling() public {
        uint256 tooHigh = gateway.MAX_REFILL_CAP() + 1;
        vm.expectRevert(MintwarePaymentGateway.RefillCapTooHigh.selector);
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, tooHigh);
        assertEq(_pendingEta(), 0);
    }

    function test_cancelPendingLoosening() public {
        uint256 initial = gateway.DEFAULT_GLOBAL_REFILL_CAP() / 2;
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, initial);
        uint256 wider = initial * 2;
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, wider);
        vm.expectEmit(true, false, false, true, address(gateway));
        emit MWTimelockedRiskParams.RiskParamCancelled(_param(), wider, 0);
        vm.prank(owner);
        gateway.cancelUserDailyRefillCap(user);
        assertEq(_pendingEta(), 0);
        assertEq(gateway.userDailyRefillCap(user), initial);
        vm.expectRevert(MWTimelockedRiskParams.NoRiskParamPending.selector);
        vm.prank(owner);
        gateway.confirmUserDailyRefillCap(user);
    }

    function test_onlyAdminCanChangeOrConfirmCap() public {
        vm.expectRevert();
        vm.prank(stranger);
        gateway.setUserDailyRefillCap(user, 1);
        uint256 initialCap = gateway.DEFAULT_GLOBAL_REFILL_CAP() / 2;
        vm.prank(owner);
        gateway.setUserDailyRefillCap(user, initialCap);
        vm.expectRevert();
        vm.prank(stranger);
        gateway.confirmUserDailyRefillCap(user);
        vm.expectRevert();
        vm.prank(stranger);
        gateway.cancelUserDailyRefillCap(user);
    }

    function test_gatewayPauseIsInstant() public {
        vm.prank(owner);
        gateway.pause();
        assertTrue(gateway.paused(), "admin pause is immediate and separate from parameter timelocks");
    }

    function _pendingEta() internal view returns (uint256 eta) {
        (,, eta) = gateway.pendingRiskParam(_param());
    }
}
