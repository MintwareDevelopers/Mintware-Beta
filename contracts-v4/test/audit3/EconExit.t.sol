// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";
import {EconBase} from "./EconBase.sol";
import {MintwareLpGatewayPositionManager} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";

/// @title  Econ Q4 -- pro-rata exit composition risk: the re-credit weight under adapter shortfall
/// @notice RT-1b/1c/1d showed price manipulation around a plain withdraw only hurts the manipulator (pro-rata
///         slice; the un-arbitraged composition is worth MORE at fair). The residual is the A-1 re-credit:
///         reCredit = shares * (claim - delivered) / claim, with claim = f*idle + f*V(spot_cached). When the
///         idle leg under-delivers (Morpho paused / per-block cap), a same-block dump shrinks V(spot) ->
///         the withdrawer is re-credited MORE shares for the same undelivered idle -> co-depositors pay.
///         No follower involved (the exit reads spot directly), so any dump size works atomically.
///
///         Run: LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-contract EconExit -vv
contract EconExitTest is EconBase {
    /// Earn-vs-lp decision (2026-09-08): `deploy` has no owner-supplied paired leg -- it stages 200k of the
    /// depositors' own quote and zaps half of it into paired in-contract. 150k each (was 100k each) reproduces
    /// the IDENTICAL post-state the old owner-funded rig produced -- idle 100k, LP 200k, NAV 300k, bob f = 0.5 --
    /// with the paired leg funded by the depositors rather than by Mintware. Every figure below is unchanged.
    function _rig() internal {
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(150_000e18);
        vm.prank(bob);
        pm.deposit(150_000e18);
        pm.deploy(200_000e18, 100_000e18, 0, 0, block.timestamp); // idle 100k, LP 200k, NAV 300k; bob f = 0.5
        _roll(1);
    }

    /// Bob's fair claim = 150k -- his own 150k deposit; there is no subsidy in it any more.
    function _bobExit(bool dump, uint256 sqFactor) internal returns (uint256 bobValue, uint256 recredited, uint256 aliceNav) {
        _rig();
        adapter.setPerBlockWithdrawCap(1); // Morpho illiquid: the idle leg serves ~0 (X = f*idle = 50k undelivered)
        uint256 w0 = _wealth(bob, SQRT_1);
        uint256 sB = pm.sharesOf(bob);
        if (dump) _swapToSqrt(bob, false, _sqrtForPairedSqrt(sqFactor));
        vm.prank(bob);
        pm.withdraw(sB);
        recredited = pm.sharesOf(bob);
        if (dump) _swapToSqrt(bob, true, SQRT_1);
        _roll(1);
        _arbToFair();
        // value the re-credited shares at the fair NAV per share (that is what bob realises once Morpho serves again)
        uint256 shareVal = (recredited * pm.totalNav()) / pm.totalShares();
        bobValue = _wealth(bob, SQRT_1) - w0 + shareVal;
        aliceNav = ((pm.totalShares() - recredited) * pm.totalNav()) / pm.totalShares();
    }

    function test_Q4_recreditWeight_noDump_control() public {
        if (!live) return;
        (uint256 v, uint256 rc, uint256 a) = _bobExit(false, 0);
        _logQ("control: bob total value", v);
        _logQ("control: bob shares re-credited", rc);
        _logQ("control: alice claim", a);
        assertApproxEqRel(v, 150_000e18, 0.002e18, "fair: 150k");
        assertApproxEqRel(rc, uint256(100_000e18) / 3, 0.01e18, "re-credit = X/claim = 50k/150k of his 100k shares");
        assertApproxEqRel(a, 150_000e18, 0.002e18, "alice untouched");
    }

    /// FIXED (round-3 E-2): the exit is weighted at the holder-favourable mark (spot / follower / entry memory), not
    /// the spot a withdrawer just dumped, so the undelivered idle leg re-credits AT MOST the control's share count.
    /// Pre-fix (same rig): +3.49% shares re-credited, bob +571 net / alice -1,271 (one step); +59.2% / +8.9k / -19.3k (4x).
    function test_Q4_recreditWeight_oneStepDump_FIXED() public {
        if (!live) return;
        (uint256 v, uint256 rc, uint256 a) = _bobExit(true, SQ_DOWN_1STEP);
        _logQ("1-step dump: bob total value (net of fees)", v);
        _logQ("1-step dump: bob shares re-credited", rc);
        _logQ("1-step dump: alice claim", a);
        assertLe(rc, uint256(100_000e18) / 3 + 1e15, "re-credit <= the control's 50k/150k of his shares (dust)");
        assertLe(v, 150_000e18 + 10e18, "bob cannot net more than fair by dumping first");
        assertGe(a, 150_000e18 - 300e18, "alice's claim is whole (control tolerance)");
    }

    function test_Q4_recreditWeight_4xDump_FIXED() public {
        if (!live) return;
        (uint256 v, uint256 rc, uint256 a) = _bobExit(true, SQ_QUARTER);
        _logQ("4x dump: bob total value (net of fees)", v);
        _logQ("4x dump: bob shares re-credited", rc);
        _logQ("4x dump: alice claim", a);
        assertLe(rc, uint256(100_000e18) / 3 + 1e15, "re-credit <= the control's share count even at 4x");
        assertLe(v, 150_000e18 + 10e18, "bob nets less than fair (he paid the 4x round trip)");
        assertGe(a, 150_000e18 - 300e18, "alice's claim is whole");
    }

    /// E-4 — FIXED (round-3, with the fuzz F1 root-cause fix): the liquidity slice is the SAME fraction of the position
    /// as the LP value slice (`min(liq, liq * lpEntitled / lpVal)`), never the per-leg offset formula, so it can never
    /// exceed the position and a fully-paid exit re-credits nothing. Pre-fix: an all-but-dust holder's request
    /// overshot `liq`, v4 reverted SafeCastOverflow, and the LP leg fell to the re-credit path on every retry.
    function test_E4_allButDustHolder_liqSliceOvershoots_lpLegReCredited_FIXED() public {
        if (!live) return;
        _rig();
        _swapToSqrt(whale, false, _sqrtForPairedSqrt(SQ_HALF)); // off-unity price: the case that used to leave dust
        _roll(1);
        uint256 sA = pm.sharesOf(alice);
        vm.prank(alice);
        pm.withdraw(sA);
        assertEq(pm.sharesOf(alice), 0, "a fully-paid exit re-credits nothing (no phantom dust)");
        // make bob an all-but-dust holder explicitly and exit him: the LP leg must deliver
        vm.prank(whale);
        pm.deposit(1e12);
        _roll(1);
        uint256 sB = pm.sharesOf(bob);
        uint128 liq = _gwLiq();
        vm.prank(bob);
        (, uint256 p) = pm.withdraw(sB);
        assertGt(p, 0, "LP leg delivered for the all-but-dust holder");
        assertLt(_gwLiq(), liq, "position reduced by his slice");
        assertLe(pm.sharesOf(bob), sB / 1_000_000, "no material re-credit");
    }

    /// The withdraw sandwich against a VICTIM (RT-1b) is value-positive for the victim at fair, but the
    /// composition moves ~7% per follower step: withdrawWithMin floors at 1% catch it; loose floors do not.
    function test_Q4_victimComposition_floors() public {
        if (!live) return;
        _rig();
        uint256 sB = pm.sharesOf(bob);
        // dry-run expected legs at fair: half the idle (50k) + half the LP quote leg (50k) ; paired 50k
        uint256 expQ = 100_000e18;
        uint256 expP = 50_000e18;
        _swapToSqrt(mallory, false, _sqrtForPairedSqrt(SQ_DOWN_1STEP)); // one-step dump before bob's exit
        vm.prank(bob);
        vm.expectRevert(MintwareLpGatewayPositionManager.SlippageExceeded.selector);
        pm.withdrawWithMin(sB, (expQ * 99) / 100, (expP * 99) / 100); // 1% floors: protected
        vm.prank(bob);
        (uint256 q, uint256 p) = pm.withdrawWithMin(sB, (expQ * 90) / 100, (expP * 90) / 100); // 10% floors: passes
        _swapToSqrt(mallory, true, SQRT_1);
        _roll(1);
        _arbToFair();
        uint256 val = q + _p2q(p, SQRT_1);
        _logQ("victim quote out", q);
        _logQ("victim paired out", p);
        _logQ("victim value at fair", val);
        console2.log("quote leg vs expected (bps)", _pct(q, expQ));
        console2.log("paired leg vs expected (bps)", _pct(p, expP));
        assertGe(val, 150_000e18 - 10e18, "value at fair >= fair claim (pro-rata; RT-1b)");
        assertLt(q, (expQ * 97) / 100, "but the quote leg is >3% light (LP quote leg -7% per step)");
        assertGt(p, (expP * 104) / 100, "and the paired leg is heavy -- inventory the victim must sell");
    }
}
