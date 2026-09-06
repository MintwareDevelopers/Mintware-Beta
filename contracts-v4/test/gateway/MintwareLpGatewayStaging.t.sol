// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareLpGatewayStaging} from "../../src/gateway/MintwareLpGatewayStaging.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";

contract MintwareLpGatewayStagingTest is Test {
    MintwareLpGatewayStaging staging;
    MockERC20 usdg;
    MockYieldAdapter adapter;
    address stranger = address(0xBEEF);

    function setUp() public {
        usdg = new MockERC20("USD Global", "USDG", 6);
        adapter = new MockYieldAdapter(address(usdg));
        staging = new MintwareLpGatewayStaging(IERC20(address(usdg)), adapter);
        staging.setController(address(this)); // this test acts as the position manager
        usdg.mint(address(this), 1_000_000e6);
        usdg.approve(address(staging), type(uint256).max);
    }

    function test_setController_isOneWay() public {
        vm.expectRevert(MintwareLpGatewayStaging.AlreadySet.selector);
        staging.setController(stranger);
    }

    function test_stage_onlyController() public {
        vm.prank(stranger);
        vm.expectRevert(MintwareLpGatewayStaging.NotController.selector);
        staging.stage(1e6);
    }

    function test_stage_earnsFromDeposit() public {
        staging.stage(100_000e6);
        assertEq(staging.stagedAssets(), 100_000e6);
    }

    function test_yield_accrues_to_staged() public {
        staging.stage(100_000e6);
        usdg.mint(address(adapter), 3_000e6); // simulated Morpho yield
        assertEq(staging.stagedAssets(), 103_000e6);
    }

    function test_unstage_returns_principal_plus_yield() public {
        staging.stage(100_000e6);
        usdg.mint(address(adapter), 3_000e6);
        uint256 before = usdg.balanceOf(address(this));
        uint256 got = staging.unstage(50_000e6);
        assertEq(got, 50_000e6);
        assertEq(usdg.balanceOf(address(this)) - before, 50_000e6);
        assertEq(staging.stagedAssets(), 53_000e6);
    }

    function test_unstage_isBestEffort_underIlliquidity() public {
        staging.stage(100_000e6);
        adapter.setWithdrawableCap(30_000e6);
        uint256 got = staging.unstage(100_000e6); // must NOT revert
        assertEq(got, 30_000e6);
        assertEq(staging.maxUnstageable(), 30_000e6); // still capped: min(70k remaining, 30k cap)
    }

    function test_unstage_onlyController() public {
        staging.stage(1_000e6);
        vm.prank(stranger);
        vm.expectRevert(MintwareLpGatewayStaging.NotController.selector);
        staging.unstage(1e6);
    }
}
