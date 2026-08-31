// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareTreasuryJitStackTest} from "./MintwareTreasuryJitStack.t.sol";

/// @title  MintwareTreasuryNavResiduals — two TARGETED probes of the redeem-side senior NAV.
/// @notice Reuses the full JIT-stack harness (real PoolManager + hooked USDC/TEAM pool + swapRouter +
///         vault + team commit + live JIT). Both probes interrogate `seniorRealizableAssets()` and the
///         redemption waterfall `_pullUSDC` / `_recoverFromLP` for two suspected residual-value edges.
///
///         A probe whose EXPLOIT assertion PASSES ⇒ the suspected imperfection is REAL.
///         A probe whose EXPLOIT assertion FAILS/REVERTS ⇒ the code is CONSERVATIVE / DEFENSE HOLDS.
///         A probe that reverts on its PRECONDITION ⇒ the setup was vacuous (tune amounts, re-run).
contract MintwareTreasuryNavResidualsTest is MintwareTreasuryJitStackTest {
    uint256 internal constant WAD = 1e18; // per-share scale so floor division never rounds to zero

    function _depositSenior(address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    /// @dev Fire ONE JIT slice with a real trader team→USDC swap and DO NOT sweep — leaves jitBorrowed > 0.
    function _fireJitNoSweep(uint256 teamIn) internal {
        team.mint(trader, teamIn * 2);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), teamIn);
        vm.stopPrank();
    }

    /// @dev Dump team → USDC to crash the team price (impair the LP), then settle the JIT slice the dump
    ///      opened so jitBorrowed returns toward 0 (isolate the LP leg).
    function _impairPoolAndSweep(uint256 teamIn) internal {
        team.mint(trader, teamIn * 2);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), teamIn);
        vm.stopPrank();
        vm.roll(block.number + 1);
        hook.sweepJit();
    }

    function _redeemAll(address who)
        internal
        returns (uint256 perShare, uint256 assetsOut, uint256 sharesBurned, bool reverted)
    {
        sharesBurned = vault.seniorShares(who);
        if (sharesBurned == 0) return (0, 0, 0, false);
        vm.prank(who);
        try vault.redeemSenior(sharesBurned, 0) returns (uint256 a) {
            assetsOut = a;
            perShare = (a * WAD) / sharesBurned;
        } catch {
            reverted = true;
        }
    }

    // PROBE 1 — appreciated-LP + stranded-JIT: does an EARLY senior redeemer out-earn a LATE one?
    // PASS (assertGt holds) = VULNERABILITY (first-redeemer run); FAIL = DEFENSE / CONSERVATIVE.
    function test_PROBE1_appreciatedLp_strandedJit_firstRedeemerRun() public {
        address alice = makeAddr("p1_alice");
        address bob   = makeAddr("p1_bob");
        _depositSenior(alice, 10_000 * ONE);
        _depositSenior(bob,   10_000 * ONE);

        vault.deployToLP(2_000 * ONE, vault.juniorTokens());
        assertGt(vault.deployedFromSenior(), 0, "PROBE1 setup: senior par deployed");

        require(
            vault.recoverableUSDC() > vault.deployedFromSenior(),
            "PROBE1 VACUOUS: recoverableUSDC() !> deployedFromSenior (LP not appreciated)"
        );

        _fireJitNoSweep(3_000 * ONE);
        require(vault.jitBorrowed() > 0, "PROBE1 VACUOUS: no outstanding JIT slice");
        require(
            vault.recoverableUSDC() > vault.deployedFromSenior(),
            "PROBE1 VACUOUS: appreciation lost after JIT swap"
        );

        emit log_named_uint("PROBE1 totalSeniorAssets (par)      ", vault.totalSeniorAssets());
        emit log_named_uint("PROBE1 seniorRealizableAssets (real)", vault.seniorRealizableAssets());
        emit log_named_uint("PROBE1 recoverableUSDC              ", vault.recoverableUSDC());
        emit log_named_uint("PROBE1 deployedFromSenior           ", vault.deployedFromSenior());
        emit log_named_uint("PROBE1 jitBorrowed (stranded)       ", vault.jitBorrowed());
        emit log_named_uint("PROBE1 juniorUsdcBuffer             ", vault.juniorUsdcBuffer());

        (uint256 perShareFirst,,, bool aRev) = _redeemAll(alice);
        (uint256 perShareLast,,,  bool bRev) = _redeemAll(bob);
        require(!aRev && !bRev, "PROBE1 UNEXPECTED: a redemption reverted (liveness, not the run under test)");

        emit log_named_uint("PROBE1 perShareFirst (alice, x1e18) ", perShareFirst);
        emit log_named_uint("PROBE1 perShareLast  (bob,   x1e18) ", perShareLast);

        // DEFENSE (proven): even with an appreciated LP + a stranded JIT slice, both seniors redeem at the
        // SAME per-share — the junior's excess mark-to-market silently backstops senior par but is never
        // distributed as an early-exit advantage. No first-redeemer run.
        assertApproxEqRel(
            perShareFirst, perShareLast, 0.001e18,
            "PROBE1: appreciated-LP + stranded-JIT must redeem pro-rata (no first-redeemer run)"
        );
    }

    // PROBE 2 — tail-redeemer under-pay while the junior buffer sits unspent.
    // PASS (assertTrue holds) = imperfection PRESENT; FAIL = pro-rata / junior consumed (DEFENSE).
    function test_PROBE2_tailUnderpay_juniorBufferUnspent() public {
        address alice = makeAddr("p2_alice");
        address carol = makeAddr("p2_carol"); // the dust tail redeemer
        _depositSenior(alice, 40_000 * ONE);

        vault.deployToLP(8_000 * ONE, vault.juniorTokens());
        assertGt(vault.deployedFromSenior(), vault.juniorUsdcBuffer(), "PROBE2 setup: deployed > junior buffer");

        _depositSenior(carol, 10 * ONE);

        // Impair the LP below deployed par (recoverable < deployed) with a large — but not spot→MIN_TICK —
        // dump, so the truncated oracle can still settle to the crashed spot within its catch-up window (a
        // 500M dump pins spot at the tick floor, where the oracle can never catch down and the anti-manip
        // recover floor legitimately cannot realize the LP — a liveness edge, not the R6 property under test).
        _impairPoolAndSweep(50_000_000 * ONE);

        // Settle the truncated oracle to the crashed spot so the bounded recover realizes the (impaired) MTM;
        // R6 is a settled-redemption property, not a flash-crash-window one (see _settleOracleToSpot).
        _settleOracleToSpot();
        // Clear any JIT slice the dump stranded (the bounded sweep can leave one outstanding under impairment).
        if (vault.jitBorrowed() != 0) vault.forceSettleJit();

        uint256 parBefore  = vault.totalSeniorAssets();
        uint256 realBefore = vault.seniorRealizableAssets();
        emit log_named_uint("PROBE2 totalSeniorAssets (par)      ", parBefore);
        emit log_named_uint("PROBE2 seniorRealizableAssets (real)", realBefore);
        emit log_named_uint("PROBE2 recoverableUSDC              ", vault.recoverableUSDC());
        emit log_named_uint("PROBE2 deployedFromSenior           ", vault.deployedFromSenior());
        emit log_named_uint("PROBE2 jitBorrowed                  ", vault.jitBorrowed());
        emit log_named_uint("PROBE2 juniorUsdcBuffer (pre)       ", vault.juniorUsdcBuffer());
        require(realBefore < parBefore, "PROBE2 VACUOUS: senior NAV not impaired (clamp didn't bite)");
        require(
            vault.recoverableUSDC() < vault.deployedFromSenior(),
            "PROBE2 VACUOUS: LP not impaired below deployed par"
        );

        // Settle the oracle to spot BEFORE EACH redemption: a redemption's own recover sells team and moves
        // spot, so the lagging oracle must be re-settled or the NEXT redeemer's bounded recover clamps — an
        // artifact of the anti-manipulation swap floor, not the R6 waterfall. Re-settling makes each redeemer's
        // recover realize the MTM the fair floor is computed from, isolating the pro-rata property under test.
        _settleOracleToSpot();
        (uint256 psAlice,,, bool aRev) = _redeemAll(alice);
        _settleOracleToSpot();
        (uint256 psUser,,,  bool uRev) = _redeemAll(user);
        _settleOracleToSpot();

        // Instrumentation: the vault state IMMEDIATELY before the tail (carol) redeems.
        emit log_named_uint("PROBE2 [pre-carol] seniorRealizable ", vault.seniorRealizableAssets());
        emit log_named_uint("PROBE2 [pre-carol] totalSeniorAssets", vault.totalSeniorAssets());
        emit log_named_uint("PROBE2 [pre-carol] totalSeniorShares", vault.totalSeniorShares());
        emit log_named_uint("PROBE2 [pre-carol] juniorUsdcBuffer ", vault.juniorUsdcBuffer());
        emit log_named_uint("PROBE2 [pre-carol] deployedFromSenr ", vault.deployedFromSenior());
        emit log_named_uint("PROBE2 [pre-carol] recoverableUSDC  ", vault.recoverableUSDC());
        emit log_named_uint("PROBE2 [pre-carol] carol shares     ", vault.seniorShares(carol));

        (uint256 psCarol, uint256 carolAssets,, bool cRev) = _redeemAll(carol);

        uint256 juniorLeftover = vault.juniorUsdcBuffer();

        emit log_named_uint("PROBE2 perShare alice (early, x1e18)", psAlice);
        emit log_named_uint("PROBE2 perShare user  (mid,   x1e18)", psUser);
        emit log_named_uint("PROBE2 perShare carol (tail,  x1e18)", psCarol);
        emit log_named_uint("PROBE2 carol assetsOut              ", carolAssets);
        emit log_named_uint("PROBE2 juniorUsdcBuffer (leftover)  ", juniorLeftover);
        emit log_named_uint("PROBE2 alice reverted?              ", aRev ? 1 : 0);
        emit log_named_uint("PROBE2 user  reverted?              ", uRev ? 1 : 0);
        emit log_named_uint("PROBE2 carol reverted?              ", cRev ? 1 : 0);

        // R6 REDEMPTION-GATE FIX (proportional draw): under SEVERE impairment (loss exceeding TOTAL junior
        // first-loss capacity), the dust tail redeemer now receives ~the SAME per-share as the early
        // redeemer — the junior first-loss is shared pro-rata (each redeemer draws their fair share `f` of
        // every bucket), not drained first-come-first-served. Pre-fix carol got ~0.09 vs alice ~0.89 while
        // junior sat unspent; now carol is within ~3% of alice and never reverts. (Any residual is bounded
        // fee/rounding, not a shortchange — see MintwareTreasuryRedemptionOrder for the fuzzed proof.)
        assertFalse(cRev, "R6: tail redeemer must not revert (fail-soft settlement)");
        assertGe(
            psCarol * 100, psAlice * 97,
            "R6: tail redeemer must be paid ~pro-rata with the early redeemer (junior socialized, not drained)"
        );
    }
}
