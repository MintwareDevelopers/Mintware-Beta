// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MWMEVGuard}   from "../src/hooks/MWMEVGuard.sol";
import {MWDynamicFee} from "../src/hooks/MWDynamicFee.sol";

/// @dev Harness exposing the MWMEVGuard library over a storage State.
contract MEVGuardHarness {
    using MWMEVGuard for MWMEVGuard.State;
    MWMEVGuard.State internal s;

    constructor(uint32 cooldown, uint16 maxDev, uint16 alpha) {
        s.cooldownBlocks  = cooldown;
        s.maxDeviationBps = maxDev;
        s.emaAlphaBps     = alpha;
    }

    function checkBefore(address t, bool z, uint160 p) external view { s.checkBefore(t, z, p); }
    function recordAfter(address t, bool z, uint160 p) external { s.recordAfter(t, z, p); }
    function ema() external view returns (uint160) { return s.emaSqrtPriceX96; }
}

contract FeeHarness {
    function volFee(uint24 b, uint24 m, uint256 v, uint256 slope) external pure returns (uint24) {
        return MWDynamicFee.volatilityFee(b, m, v, slope);
    }
    function depth(uint24 f, uint128 l, uint128 r, uint16 d) external pure returns (uint24) {
        return MWDynamicFee.applyDepthDiscount(f, l, r, d);
    }
}

contract MWHooksLibTest is Test {
    MEVGuardHarness internal guard;
    FeeHarness      internal fees;

    address internal alice = makeAddr("alice");
    uint160 internal constant P = 79228162514264337593543950336; // 1:1

    function setUp() public {
        guard = new MEVGuardHarness(3, 100, 2000); // cooldown 3 blocks, 1% dev, alpha 0.2
        fees  = new FeeHarness();
        vm.roll(100);
    }

    // ── MEV guard ────────────────────────────────────────────────────────────

    function test_first_swap_not_blocked() public view {
        guard.checkBefore(alice, true, P); // no prior swap → ok
    }

    function test_cooldown_blocks_opposite_direction_in_window() public {
        guard.recordAfter(alice, true, P);          // block 100, zeroForOne
        vm.expectRevert(MWMEVGuard.SandwichCooldownActive.selector);
        guard.checkBefore(alice, false, P);         // same block, opposite dir → blocked
    }

    function test_same_direction_not_blocked() public {
        guard.recordAfter(alice, true, P);
        guard.checkBefore(alice, true, P);          // same direction → allowed
    }

    function test_cooldown_expires() public {
        guard.recordAfter(alice, true, P);          // block 100
        vm.roll(103);                                // 100 + cooldown(3)
        guard.checkBefore(alice, false, P);         // now allowed
    }

    function test_deviation_guard_blocks_offband_price() public {
        guard.recordAfter(alice, true, P);          // seeds EMA = P
        uint160 off = uint160(uint256(P) + uint256(P) / 20); // +5% >> 1%
        vm.expectRevert(MWMEVGuard.PriceDeviationTooHigh.selector);
        guard.checkBefore(alice, true, off);
    }

    function test_ema_moves_toward_new_price() public {
        guard.recordAfter(alice, true, P);
        uint160 higher = uint160(uint256(P) + uint256(P) / 10); // +10%
        guard.recordAfter(alice, true, higher);
        uint160 e = guard.ema();
        assertGt(e, P, "EMA rose");
        assertLt(e, higher, "EMA below latest (smoothed)");
    }

    // ── dynamic fee ────────────────────────────────────────────────────────────

    function test_volatility_fee_scales_and_clamps() public view {
        assertEq(fees.volFee(3000, 5000, 50, 10), 3500, "base + 50bp*10");
        assertEq(fees.volFee(3000, 5000, 500, 10), 5000, "clamped to max");
        assertEq(fees.volFee(3000, 0, 0, 10), 3000, "zero vol = base");
    }

    function test_depth_discount() public view {
        assertEq(fees.depth(3000, 1000, 1000, 5000), 3000, "1x -> no discount");
        assertEq(fees.depth(3000, 2000, 1000, 5000), 1500, "2x -> 50% off");
        assertEq(fees.depth(3000, 1500, 1000, 5000), 2250, "1.5x -> 25% off");
        assertEq(fees.depth(3000, 5000, 1000, 5000), 1500, ">=2x caps at 50% off");
    }
}
