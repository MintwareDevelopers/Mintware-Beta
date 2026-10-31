// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MarketEngineFixture} from "../market-engine/MarketEngineCore.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareMarketEngineCore} from "../../src/vaults/MintwareMarketEngineCore.sol";

contract PartialExitRegression is MarketEngineFixture {
    function test_MW01_precheckedRecipientKeepsUndeliveredValue() public {
        _checkExit(100e18, 100e18, true, true);
    }

    function test_MW01_failedTransferKeepsUndeliveredValue() public {
        _checkExit(100e18, 100e18, false, true);
    }

    function test_MW01_failedFirstTransferStillPaysSecondLeg() public {
        _checkExit(100e18, 100e18, false, false);
    }

    function testFuzz_MW01_unequalLegsPreserveBothHolders(uint96 a, uint96 b, bool precheck, bool failSecond) public {
        _checkExit(bound(a, 1e18, 1000e18), bound(b, 1e18, 1000e18), precheck, failSecond);
    }

    function _checkExit(uint256 a, uint256 b, bool precheck, bool failSecond) internal {
        _deposit(alice, a, b);
        _deposit(bob, a, b);
        uint256 shares = engine.balanceOf(bob);
        uint256 supply = engine.totalSupply();
        uint256 nav = engine.totalNav();
        uint256 bobBefore = nav * shares / supply;
        uint256 aliceBefore = nav * engine.balanceOf(alice) / supply;
        if (precheck) {
            (failSecond ? token1 : token0).freezeRecipient(bob);
        } else {
            // Zero-transfer probe succeeds; only the real positive transfer fails.
            vm.mockCallRevert(address(failSecond ? token1 : token0),
                abi.encodeCall(IERC20.transfer, (bob, failSecond ? b : a)), "blocked");
        }
        vm.prank(bob);
        (uint256 burned, uint256 out0, uint256 out1) = engine.withdraw(shares, bob, 0, 0);
        assertEq(out0, failSecond ? a : 0);
        assertEq(out1, failSecond ? 0 : b);
        assertGt(burned, 0);
        assertLt(burned, shares);
        uint256 bobAfter = engine.totalNav() * engine.balanceOf(bob) / engine.totalSupply();
        uint256 aliceAfter = engine.totalNav() * engine.balanceOf(alice) / engine.totalSupply();
        // Rounding is against the exiting holder, limited to a few atomic quote units.
        assertLe(out0 + out1 + bobAfter, bobBefore);
        assertApproxEqAbs(out0 + out1 + bobAfter, bobBefore, 3);
        assertGe(aliceAfter, aliceBefore);
        assertApproxEqAbs(aliceAfter, aliceBefore, 3);
    }

    function test_MW01_missingMarkRevertsOnlyIncompleteDelivery() public {
        _deposit(alice, 100e18, 100e18);
        token1.freezeRecipient(alice);
        uint256 shares = engine.balanceOf(alice);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        vm.expectRevert(MintwareMarketEngineCore.ExitMarkUnavailable.selector);
        engine.withdraw(shares, alice, 0, 0);
        assertEq(engine.balanceOf(alice), shares);
    }

    function test_MW01_recipientFailureDoesNotExpandLiquidityLimitedPayout() public {
        _deposit(alice, 100e18, 100e18);
        _deposit(bob, 100e18, 100e18);
        adapter0.setWithdrawableCap(10e18);
        token1.freezeRecipient(bob);
        uint256 shares = engine.balanceOf(bob);
        vm.prank(bob);
        (uint256 burned, uint256 out0, uint256 out1) = engine.withdraw(shares, bob, 0, 0);
        assertEq(out0, 10e18);
        assertEq(out1, 0);
        assertEq(burned, 10e18);
        assertEq(engine.totalNav() * engine.balanceOf(bob) / engine.totalSupply(), 190e18);
    }
    function test_MW01_deployedLiquidityPreservesUndeliveredValue() public {
        _deposit(alice, 100e18, 100e18);
        _deposit(bob, 100e18, 100e18);
        _deployBand();
        uint256 shares = engine.balanceOf(bob);
        uint256 bobBefore = engine.totalNav() * shares / engine.totalSupply();
        uint256 aliceBefore = engine.totalNav() * engine.balanceOf(alice) / engine.totalSupply();
        token1.freezeRecipient(bob);
        vm.prank(bob);
        (,uint256 out0,uint256 out1) = engine.withdraw(shares, bob, 0, 0);
        assertGt(out0, 0);
        assertEq(out1, 0);
        uint256 bobAfter = engine.totalNav() * engine.balanceOf(bob) / engine.totalSupply();
        uint256 aliceAfter = engine.totalNav() * engine.balanceOf(alice) / engine.totalSupply();
        assertLe(out0 + bobAfter, bobBefore);
        assertApproxEqAbs(out0 + bobAfter, bobBefore, 3);
        assertGe(aliceAfter, aliceBefore);
        assertApproxEqAbs(aliceAfter, aliceBefore, 3);
    }

    function test_MW01_repeatedPartialExitsThenRecoveryConserveMarkedValue() public {
        _deposit(alice, 100e18, 100e18);
        _deposit(bob, 100e18, 100e18);
        mark.set(1.03e18, uint64(block.timestamp));
        token0.freezeRecipient(bob);
        uint256 bobBefore = engine.totalNav() * engine.balanceOf(bob) / engine.totalSupply();
        uint256 aliceBefore = engine.totalNav() * engine.balanceOf(alice) / engine.totalSupply();
        uint256 delivered;
        for (uint256 i; i < 4; ++i) {
            if (i == 3) token0.freezeRecipient(address(0));
            uint256 shares = engine.balanceOf(bob);
            vm.prank(bob);
            (,uint256 out0,uint256 out1) = engine.withdraw(shares, bob, 0, 0);
            delivered += out0 + out1 * 103 / 100;
            uint256 retained = engine.totalNav() * engine.balanceOf(bob) / engine.totalSupply();
            assertLe(delivered + retained, bobBefore);
            assertApproxEqAbs(delivered + retained, bobBefore, 8);
        }
        assertEq(engine.balanceOf(bob), 0);
        assertApproxEqAbs(engine.totalNav() * engine.balanceOf(alice) / engine.totalSupply(), aliceBefore, 8);
    }

}
