// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MWOracleGuard} from "../src/hooks/MWOracleGuard.sol";
import {MWDynamicFee}  from "../src/hooks/MWDynamicFee.sol";

/// @dev Harness exposing the MWOracleGuard library over a storage State.
contract OracleGuardHarness {
    using MWOracleGuard for MWOracleGuard.State;
    MWOracleGuard.State internal s;

    constructor(int24 maxMove, int24 maxDev, uint32 catchup) {
        s.maxTickMovePerBlock = maxMove;
        s.maxDeviationTicks   = maxDev;
        s.maxCatchupBlocks    = catchup;
    }

    function update(int24 tick) external { s.update(tick); }
    function checkCircuitBreaker(int24 tick) external view { s.checkCircuitBreaker(tick); }
    function deviation(int24 tick) external view returns (uint256) { return s.deviationTicks(tick); }
    function oracleTick() external view returns (int24) { return s.oracleTick; }
    function initialized() external view returns (bool) { return s.initialized; }
}

contract FeeHarness {
    function volFee(uint24 b, uint24 m, uint256 v, uint256 slope) external pure returns (uint24) {
        return MWDynamicFee.volatilityFee(b, m, v, slope);
    }
    function rl(uint24 last, uint24 target, uint256 step) external pure returns (uint24) {
        return MWDynamicFee.rateLimit(last, target, step);
    }
}

contract MWHooksLibTest is Test {
    OracleGuardHarness internal guard;
    FeeHarness         internal fees;

    function setUp() public {
        // maxTickMovePerBlock = 100, circuit breaker at 500 ticks, catch-up cap 10 blocks.
        guard = new OracleGuardHarness(int24(100), int24(500), uint32(10));
        fees  = new FeeHarness();
        vm.roll(100);
    }

    // ── truncated oracle ──────────────────────────────────────────────────────

    function test_first_update_initializes() public {
        guard.update(1000);
        assertTrue(guard.initialized(), "initialized");
        assertEq(guard.oracleTick(), int24(1000), "oracle seeded at first tick");
    }

    function test_intra_block_updates_are_frozen() public {
        guard.update(1000);
        guard.update(5000); // same block → no move
        assertEq(guard.oracleTick(), int24(1000), "oracle frozen within a block");
    }

    function test_cross_block_move_is_truncated() public {
        guard.update(1000);
        vm.roll(block.number + 1);
        guard.update(5000); // wants +4000, capped to +100
        assertEq(guard.oracleTick(), int24(1100), "move truncated to maxTickMovePerBlock");
    }

    function test_move_budget_scales_with_blocks_then_caps() public {
        guard.update(1000);
        vm.roll(block.number + 5);
        guard.update(9000); // budget 100*5 = 500 → 1500
        assertEq(guard.oracleTick(), int24(1500), "budget scales with elapsed blocks");

        vm.roll(block.number + 50); // elapsed 50 > catchup 10 → budget 100*10 = 1000
        guard.update(99000);
        assertEq(guard.oracleTick(), int24(2500), "budget capped by maxCatchupBlocks");
    }

    function test_downward_move_also_truncated() public {
        guard.update(1000);
        vm.roll(block.number + 1);
        guard.update(-5000); // capped to -100
        assertEq(guard.oracleTick(), int24(900), "downward move truncated");
    }

    // ── circuit breaker + deviation ─────────────────────────────────────────────

    function test_circuit_breaker_reverts_offband() public {
        guard.update(1000); // oracle = 1000, band = 500
        guard.checkCircuitBreaker(1500); // exactly at band → ok
        vm.expectRevert(MWOracleGuard.PriceDeviationTooHigh.selector);
        guard.checkCircuitBreaker(1501); // beyond band → revert
    }

    function test_deviation_ticks() public {
        guard.update(1000);
        assertEq(guard.deviation(1300), 300, "abs tick deviation");
        assertEq(guard.deviation(600), 400, "abs tick deviation (below)");
    }

    // ── dynamic fee ────────────────────────────────────────────────────────────

    function test_volatility_fee_scales_and_clamps() public view {
        assertEq(fees.volFee(3000, 5000, 50, 10), 3500, "base + 50*10");
        assertEq(fees.volFee(3000, 5000, 500, 10), 5000, "clamped to max");
        assertEq(fees.volFee(3000, 0, 0, 10), 3000, "zero deviation = base");
    }

    // ── fee rate limit (Stage-1.2) ──────────────────────────────────────────────

    function test_rate_limit_clamps_moves() public view {
        assertEq(fees.rl(0, 5000, 100), 5000, "uninitialized adopts target");
        assertEq(fees.rl(3000, 5000, 100), 3100, "up-move clamped to last + step");
        assertEq(fees.rl(3000, 5000, 5000), 5000, "step large enough -> reaches target");
        assertEq(fees.rl(5000, 3000, 100), 4900, "down-move clamped to last - step");
        assertEq(fees.rl(3000, 3200, 500), 3200, "within budget -> exact target");
        assertEq(fees.rl(50, 3000, 100), 150, "small last, up-clamped");
    }
}
