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

        // Impair HARD: a very large team dump to crash the LP's recoverable USDC below deployed par.
        _impairPoolAndSweep(500_000_000 * ONE);

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

        (uint256 psAlice,,, bool aRev) = _redeemAll(alice);
        (uint256 psUser,,,  bool uRev) = _redeemAll(user);

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

        // KNOWN RESIDUAL (R6, exploit red-team probe — DOCUMENTED FOR EXTERNAL AUDIT, deliberately NOT
        // fixed). Under SEVERE impairment (loss exceeding TOTAL junior first-loss capacity), the redemption
        // waterfall is first-come-first-served on the depleting junior buffer / senior principal, so the
        // LAST/tail redeemer is shortchanged (here carol ~0.09 vs the early alice ~0.89) while junior sits
        // unspent and senior par (`totalSeniorAssets`) collapses toward 0 (min(par,real) then zeroes the
        // tail). It is SAFE-DIRECTION — the tail senior is UNDER-paid, never over-paid, and total payout ≤
        // vault assets (solvency invariants stay green) — but it is NOT the pro-rata the NatSpec promises.
        // A correct fix needs a loss-SOCIALIZATION / redemption-gate REDESIGN, not a patch: two patch
        // attempts were validated and rejected — (1) crediting the junior buffer in `seniorRealizableAssets`
        // is a no-op here (par, not realizable, is the binding term); (2) having `_recoverFromLP` un-earmark
        // junior to cushion the par write-down trades the under-pay for an `InsufficientIdleLiquidity` REVERT
        // (the freed junior is consumed by EARLIER redeemers, over-stating the tail's claim). This test PINS
        // the current behavior so any future redesign FLIPS it (alerting the maintainer to re-characterize).
        bool tailShortchanged = cRev || (psCarol * 100 < psAlice * 99);
        assertTrue(
            tailShortchanged,
            "R6 KNOWN RESIDUAL: tail redeemer shortchanged under severe impairment (documented for audit)"
        );
    }
}
