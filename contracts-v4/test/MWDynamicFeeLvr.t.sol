// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MWDynamicFee} from "../src/hooks/MWDynamicFee.sol";

/// @notice Unit + fuzz proof for the Diamond-LVR surcharge lever (`MWDynamicFee.lvrSurchargePips`).
///         The DIRECTIONAL application (arb vs benign) is asserted at the coordinator level; here we prove
///         the pure math: off-by-default, linear + convex terms, hard clamp to cap, and revert-free for
///         any input (the swap-path bar).
contract MWDynamicFeeLvrTest is Test {
    uint24 constant CAP = 30_000; // 3%

    function test_off_when_slope_and_quad_zero() public pure {
        assertEq(MWDynamicFee.lvrSurchargePips(100, 0, 0, CAP), 0, "lever off => no surcharge");
    }

    function test_zero_when_no_captured_ticks() public pure {
        // captured == 0 is how the caller encodes benign (gap-widening) flow.
        assertEq(MWDynamicFee.lvrSurchargePips(0, 50, 1, CAP), 0, "benign flow => no surcharge");
    }

    function test_linear_term() public pure {
        // 10 pips/tick x 100 ticks = 1000 pips, under the 30000 cap.
        assertEq(MWDynamicFee.lvrSurchargePips(100, 10, 0, CAP), 1000);
    }

    function test_convex_term_makes_toxic_prints_pay_superlinearly() public pure {
        // 10.100 + 1.100^2 = 1000 + 10000 = 11000.
        assertEq(MWDynamicFee.lvrSurchargePips(100, 10, 1, CAP), 11000);
        // double the mispricing -> the quad term more than doubles the surcharge (super-linear).
        uint24 at100 = MWDynamicFee.lvrSurchargePips(100, 10, 1, 1_000_000);
        uint24 at200 = MWDynamicFee.lvrSurchargePips(200, 10, 1, 1_000_000);
        assertGt(at200, 2 * at100, "convex: 2x mispricing pays > 2x surcharge");
    }

    function test_clamped_to_cap() public pure {
        // 1000 pips/tick x 100 = 100000 -> clamp to 30000.
        assertEq(MWDynamicFee.lvrSurchargePips(100, 1000, 0, CAP), CAP);
    }

    function test_linear_saturates_before_quadratic_multiply() public pure {
        // linear alone (100000) >= cap -> returns cap without ever touching the huge quad term (no overflow).
        assertEq(MWDynamicFee.lvrSurchargePips(100, 1000, type(uint256).max, CAP), CAP);
    }

    function test_cap_zero_means_max_pips() public pure {
        // cap 0 => MAX_PIPS (1e6). 1000.100 = 100000 < 1e6.
        assertEq(MWDynamicFee.lvrSurchargePips(100, 1000, 0, 0), 100_000);
    }

    /// The swap-path guarantee: never exceeds the effective cap, never reverts, for any bounded input.
    function testFuzz_never_exceeds_cap_and_revert_free(uint256 captured, uint256 slope, uint256 quad, uint24 cap)
        public
        pure
    {
        captured = bound(captured, 0, 1_770_000); // tick-space bound (~ max V4 deviation)
        slope = bound(slope, 0, 1_000_000);
        quad = bound(quad, 0, 1_000_000);
        uint24 sur = MWDynamicFee.lvrSurchargePips(captured, slope, quad, cap);
        uint256 effCap = cap == 0 ? 1_000_000 : cap;
        assertLe(uint256(sur), effCap, "surcharge <= cap");
    }

    /// Monotone in the mispricing being captured (more LVR on the table => >= surcharge).
    function testFuzz_monotone_in_captured(uint256 a, uint256 b) public pure {
        a = bound(a, 0, 100_000);
        b = bound(b, 0, 100_000);
        if (a > b) (a, b) = (b, a); // a <= b
        assertLe(
            MWDynamicFee.lvrSurchargePips(a, 25, 1, 1_000_000),
            MWDynamicFee.lvrSurchargePips(b, 25, 1, 1_000_000),
            "surcharge non-decreasing in captured ticks"
        );
    }
}
