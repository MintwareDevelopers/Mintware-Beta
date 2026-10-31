// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {MintwareRwaAppraisalHook} from "../../src/rwa/MintwareRwaAppraisalHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract RollingDriftRegression is Test {
    MintwareRwaAppraisalHook hook;
    int24 constant ORIGINAL = 230270;
    uint256 constant START = 1000000;

    function setUp() public {
        vm.warp(START);
        MintwareRwaAppraisalHook.Config memory c =
            MintwareRwaAppraisalHook.Config(300,1000,500,600,2592000,3000,10000,1000,604800);
        address a = address(uint160(0x2ac0));
        deployCodeTo("MintwareRwaAppraisalHook.sol:MintwareRwaAppraisalHook",
            abi.encode(IPoolManager(address(1)),address(this),address(this),address(this),c), a);
        hook = MintwareRwaAppraisalHook(a);
        hook.initAppraisal(ORIGINAL);
    }

    function test_MW03_windowBoundaryDoesNotResetBudget() public {
        vm.warp(1085200); hook.postAppraisal(ORIGINAL+500);
        vm.warp(1085800); hook.postAppraisal(ORIGINAL+1000);
        vm.warp(1086400);
        vm.expectRevert(MintwareRwaAppraisalHook.DailyDriftExceeded.selector);
        hook.postAppraisal(ORIGINAL+1500);
        assertEq(hook.appraisalTick(),ORIGINAL+1000);
    }

    function test_MW03_eachMoveExpiresAfterItsOwn24Hours() public {
        vm.warp(START + 600); hook.postAppraisal(ORIGINAL+500);
        vm.warp(START + 1200); hook.postAppraisal(ORIGINAL+1000);
        vm.warp(START + 1 days + 599);
        vm.expectRevert(MintwareRwaAppraisalHook.DailyDriftExceeded.selector);
        hook.postAppraisal(ORIGINAL+1500);
        vm.warp(START + 1 days + 600); hook.postAppraisal(ORIGINAL+1500);
        vm.warp(START + 1 days + 1200); hook.postAppraisal(ORIGINAL+2000);
    }

    function test_MW03_reversalDoesNotRefundMovementBudget() public {
        vm.warp(START + 600); hook.postAppraisal(ORIGINAL+500);
        vm.warp(START + 1200); hook.postAppraisal(ORIGINAL);
        vm.warp(START + 1800);
        vm.expectRevert(MintwareRwaAppraisalHook.DailyDriftExceeded.selector);
        hook.postAppraisal(ORIGINAL-1);
    }

    function test_MW03_idleHeartbeatAndLongOutage() public {
        vm.warp(START + 600); hook.postAppraisal(ORIGINAL+500);
        vm.warp(START + 1200); hook.postAppraisal(ORIGINAL+1000);
        vm.warp(START + 1800); hook.postAppraisal(ORIGINAL+1000);
        vm.warp(START + 40 days); hook.postAppraisal(ORIGINAL+1500);
        vm.warp(START + 40 days + 600); hook.postAppraisal(ORIGINAL+2000);
        vm.warp(START + 40 days + 1200);
        vm.expectRevert(MintwareRwaAppraisalHook.DailyDriftExceeded.selector);
        hook.postAppraisal(ORIGINAL+2001);
    }

    function testFuzz_MW03_everySlidingWindowMatchesMovementModel(uint256 seed) public {
        uint256[40] memory times;
        uint256[40] memory moves;
        uint256 timestamp = START;
        for (uint256 i; i < 40; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            timestamp += 600 + seed % 20000;
            vm.warp(timestamp);
            uint256 move = (seed >> 32) % 501;
            int24 next = hook.appraisalTick() + (seed % 2 == 0 ? int24(uint24(move)) : -int24(uint24(move)));
            uint256 used;
            for (uint256 j; j < i; ++j) if (times[j] + 1 days > timestamp) used += moves[j];
            if (used + move > 1000) {
                vm.expectRevert(MintwareRwaAppraisalHook.DailyDriftExceeded.selector);
                hook.postAppraisal(next);
            } else {
                hook.postAppraisal(next);
                assertEq(hook.appraisalTick(), next);
                times[i] = timestamp;
                moves[i] = move;
            }
        }
    }
}
