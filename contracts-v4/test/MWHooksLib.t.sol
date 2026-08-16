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
    function surge(uint24 maxPips, uint256 elapsed, uint256 halfLife) external pure returns (uint24) {
        return MWDynamicFee.surgeFee(maxPips, elapsed, halfLife);
    }
    function volFeeQuad(uint24 b, uint24 m, uint256 v, uint256 slope, uint256 quad) external pure returns (uint24) {
        return MWDynamicFee.volatilityFeeQuad(b, m, v, slope, quad);
    }
    function mevTax(uint256 k, uint256 priorityWei, uint24 capPips) external pure returns (uint24) {
        return MWDynamicFee.mevTaxPips(k, priorityWei, capPips);
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
        guard.update(5000); // same block -> no move
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
        guard.update(9000); // budget 100*5 = 500 -> 1500
        assertEq(guard.oracleTick(), int24(1500), "budget scales with elapsed blocks");

        vm.roll(block.number + 50); // elapsed 50 > catchup 10 -> budget 100*10 = 1000
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
        guard.checkCircuitBreaker(1500); // exactly at band -> ok
        vm.expectRevert(MWOracleGuard.PriceDeviationTooHigh.selector);
        guard.checkCircuitBreaker(1501); // beyond band -> revert
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

    // ── surge floor (increment 2) ────────────────────────────────────────────────

    function test_surge_decays_by_halving() public view {
        assertEq(fees.surge(40_000, 0, 100), 40_000, "t0 = full surge");
        assertEq(fees.surge(40_000, 100, 100), 20_000, "one half-life = half");
        assertEq(fees.surge(40_000, 200, 100), 10_000, "two half-lives = quarter");
        assertEq(fees.surge(40_000, 50, 100), 30_000, "mid half-life = linear interp (40k->20k at 50%)");
        assertEq(fees.surge(40_000, 100 * 24, 100), 0, ">=24 half-lives = fully decayed");
        assertEq(fees.surge(40_000, 5, 0), 0, "halfLife 0 = disabled");
        assertEq(fees.surge(0, 0, 100), 0, "maxPips 0 = 0");
    }

    // ── quadratic base fee (increment 3) ─────────────────────────────────────────

    function test_quad_fee_matches_linear_when_zero() public view {
        // quad = 0 ⇒ EXACTLY volatilityFee (increment 1) for any inputs.
        assertEq(fees.volFeeQuad(3000, 50_000, 50, 10, 0), fees.volFee(3000, 50_000, 50, 10), "quad 0 != linear");
        assertEq(fees.volFeeQuad(3000, 50_000, 500, 10, 0), fees.volFee(3000, 50_000, 500, 10), "quad 0 != linear (clamped)");
    }

    function test_quad_fee_superlinear_and_clamps() public view {
        // Pure quadratic (slope 0): the fee's variable part scales with dev^2. Doubling dev quadruples it.
        assertEq(fees.volFeeQuad(3000, 1_000_000, 10, 0, 5), 3000 + 5 * 100, "dev=10 -> base + 5*100");
        assertEq(fees.volFeeQuad(3000, 1_000_000, 20, 0, 5), 3000 + 5 * 400, "dev=20 -> base + 5*400 (4x the term)");
        // Convex blend: base + slope*dev + quad*dev^2.
        assertEq(fees.volFeeQuad(3000, 1_000_000, 10, 10, 5), 3000 + 100 + 500, "blend = base + slope*dev + quad*dev^2");
        // Clamps to the ceiling.
        assertEq(fees.volFeeQuad(3000, 50_000, 1000, 0, 5), 50_000, "large dev clamps at maxFeePips");
    }

    /// Pure + revert-free + bounded + monotone non-decreasing in dev, within the caller-guaranteed bounds
    /// (slope, quad <= MAX_PIPS; dev tick-bounded <= ~1.77e6).
    function testFuzz_quad_bounded_and_monotone(uint24 base, uint24 maxPips, uint256 dev, uint256 slope, uint256 quad) public view {
        maxPips = uint24(bound(maxPips, 1, 1_000_000));
        base    = uint24(bound(base, 0, maxPips));
        slope   = bound(slope, 0, 1_000_000);
        quad    = bound(quad, 0, 1_000_000);
        dev     = bound(dev, 0, 1_774_544); // TickMath max |tick - tick|
        uint24 f = fees.volFeeQuad(base, maxPips, dev, slope, quad);
        assertLe(f, maxPips, "quad fee exceeded ceiling");
        assertGe(f, base, "quad fee below base floor");
        if (dev < 1_774_544) {
            assertGe(fees.volFeeQuad(base, maxPips, dev + 1, slope, quad), f, "quad fee not monotone in dev");
        }
    }

    /// Pure + revert-free + bounded for any input within the caller's documented bounds
    /// (maxPips <= MAX_LP_FEE, halfLife <= 365 days). Monotone non-increasing in elapsed.
    function testFuzz_surge_bounded_and_monotone(uint24 maxPips, uint256 elapsed, uint256 halfLife) public view {
        maxPips  = uint24(bound(maxPips, 0, 1_000_000));
        halfLife = bound(halfLife, 1, 365 days);
        elapsed  = bound(elapsed, 0, 4_000 days);
        uint24 s = fees.surge(maxPips, elapsed, halfLife);
        assertLe(s, maxPips, "surge exceeded its ceiling");
        // one second later never increases the surge
        uint24 s2 = fees.surge(maxPips, elapsed + 1, halfLife);
        assertLe(s2, s, "surge not monotone non-increasing");
    }

    // ── MEV-tax (Phase 2) ────────────────────────────────────────────────────────

    function test_mevTax_proportional_and_capped() public view {
        assertEq(fees.mevTax(0, 100 gwei, 50_000), 0, "k 0 = off");
        assertEq(fees.mevTax(50, 0, 50_000), 0, "zero priority = 0");
        assertEq(fees.mevTax(50, 999_999_999, 50_000), 0, "sub-gwei priority floors to 0");
        assertEq(fees.mevTax(50, 10 gwei, 50_000), 500, "50 pips/gwei * 10 gwei");
        assertEq(fees.mevTax(50, 100 gwei, 50_000), 5000, "50 * 100");
        assertEq(fees.mevTax(50, 10_000 gwei, 50_000), 50_000, "clamped at cap");
        assertEq(fees.mevTax(50, 100 gwei, 0), 0, "cap 0 = off");
    }

    /// Saturating + revert-free + bounded for ANY inputs (incl. adversarial k / priority) — the tax path
    /// must never overflow or revert on the swap.
    function testFuzz_mevTax_bounded_no_overflow(uint256 k, uint256 priorityWei, uint24 capPips) public view {
        assertLe(fees.mevTax(k, priorityWei, capPips), capPips, "mev-tax exceeded its cap");
    }
}
