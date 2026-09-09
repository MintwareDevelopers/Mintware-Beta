// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {EconBase} from "./EconBase.sol";

/// @title  Econ Q2 / Q5 -- IL exposure of depositor principal, and (post-decision) the absence of a subsidy
/// @notice Q2: for a balanced deploy (2/3 of principal into the LP, half of that zapped into the paired leg),
///         depositor NAV as a function of price on the +-22980 range. Model: NAV(P) = (1-c)*Pr + V(L(q), P) --
///         the CURVE is a property of the position's shape, so every figure below is unchanged by the
///         earn-vs-lp decision. What changed is the denominator: principal is now 150k (all depositor money)
///         rather than 100k plus a 50k Mintware subsidy, so the same NAV curve represents a straightforwardly
///         user-borne IL rather than one partly absorbed by the protocol.
///         Q5 -- STRUCTURALLY FIXED (earn-vs-lp decision, 2026-09-08): the finding this test recorded (the
///         owner's paired leg is a gift to whoever holds shares at deploy time, and a later depositor pays NAV
///         that includes it and carries its IL) DESCRIBES A MECHANISM THAT NO LONGER EXISTS. `deploy` cannot
///         accept an owner-supplied paired token at all. The test now asserts the consequence: with no subsidy
///         inside NAV, entry timing transfers nothing -- early and late depositors take the SAME proportional
///         loss through the same price move.
///
///         Run: LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-contract EconSubsidyIl -vv
contract EconSubsidyIlTest is EconBase {
    /// 150k deposited (was 100k + a 50k owner subsidy) and 100k staged with half zapped into paired: the
    /// IDENTICAL position shape -- 50k idle + 100k LP, NAV 150k -- funded entirely by alice.
    function _rig() internal {
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(150_000e18);
        pm.deploy(100_000e18, 50_000e18, 0, 0, block.timestamp); // NAV 150k = 50k idle + 100k LP
        _roll(1);
    }

    function _pushPairedPrice(uint256 sqFactor) internal {
        uint160 target = _sqrtForPairedSqrt(sqFactor);
        uint160 cur = _spot();
        // target below spot -> sell token0; token0 is quote iff q0
        bool zeroForOne = target < cur;
        _swapToSqrt(whale, zeroForOne == q0, target);
    }

    function test_Q2_navVsPrice_matchesModel() public {
        if (!live) return;
        _rig();
        assertApproxEqRel(pm.totalNav(), 150_000e18, 0.001e18, "at deploy: 150k, all of it alice's principal -- the deploy created no value");

        _pushPairedPrice(SQ_HALF); // -50%
        uint256 navHalf = pm.totalNav();
        _logQ("NAV at P=0.5", navHalf);
        assertApproxEqRel(navHalf, 118_720e18, 0.01e18, "model 118.7k = 79.1% of the 150k principal");

        _pushPairedPrice(SQ_0_3); // -70%: principal floor
        uint256 nav03 = pm.totalNav();
        _logQ("NAV at P=0.3 (principal floor)", nav03);
        assertApproxEqRel(nav03, 100_000e18, 0.01e18, "model 100.0k = 66.7% of principal; nothing absorbs this IL but the depositor");

        // lower edge: push to the tick just beyond Pa on the paired-cheap side (position 100% paired)
        uint160 edge = q0 ? TickMath.getSqrtPriceAtTick(TU + 60) : TickMath.getSqrtPriceAtTick(TL - 60);
        bool zeroForOne = edge < _spot();
        _swapToSqrt(whale, zeroForOne == q0, edge);
        uint256 navEdge = pm.totalNav();
        _logQ("NAV at P<=Pa (-90%)", navEdge);
        assertApproxEqRel(navEdge, 70_872e18, 0.015e18, "model 70.9k (47.2% of principal): 100% paired, marked at Pa");

        // recovery to +100%
        _arbToFair();
        _pushPairedPrice(SQ_DOUBLE);
        uint256 nav2 = pm.totalNav();
        _logQ("NAV at P=2", nav2);
        assertApproxEqRel(nav2, 187_440e18, 0.01e18, "model 187.4k");
    }

    function test_Q5_subsidy_incumbentCaptures_laterDepositorPays_FIXED() public {
        if (!live) return;
        _rig(); // alice: 150k in, claim 150k -- par, because there is nothing extra in NAV to capture
        vm.prank(bob);
        uint256 sB = pm.deposit(100_000e18); // priced at NAV 150k: bob buys 40% of the pool at par, no subsidy
        uint256 S = pm.totalShares();
        uint256 aliceClaim = (pm.sharesOf(alice) * pm.totalNav()) / S;
        uint256 bobClaim = (sB * pm.totalNav()) / S;
        _logQ("after bob: alice claim", aliceClaim);
        _logQ("after bob: bob claim", bobClaim);
        assertApproxEqRel(aliceClaim, 150_000e18, 0.001e18, "alice's claim is exactly her own deposit -- nothing captured");
        assertApproxEqRel(bobClaim, 100_000e18, 0.001e18, "bob got exactly what he paid");

        _pushPairedPrice(SQ_HALF); // the paired leg (incl. the gift) halves
        _roll(1);
        uint160 s = _spot();
        uint256 sA = pm.sharesOf(alice);
        uint256 a0 = _wealth(alice, s);
        uint256 b0 = _wealth(bob, s);
        // alice exits first (pro-rata). Whoever exits SECOND after a rounding re-credit is "all but dust" and
        // trips E-4 (EconExit.test_E4_*: the offset formula requests more liquidity than the position holds,
        // the LP leg reverts SafeCastOverflow and is re-credited) -- so bob leaves 1e-6 shares behind.
        vm.prank(alice);
        pm.withdraw(sA);
        sB = sB - 1e12;
        vm.prank(bob);
        pm.withdraw(sB);
        uint256 aliceGot = _wealth(alice, s) - a0;
        uint256 bobGot = _wealth(bob, s) - b0;
        _logQ("after -50%: alice exits with", aliceGot);
        _logQ("after -50%: bob exits with", bobGot);
        // Same position, same price move, so the same absolute figures -- but read against what each ACTUALLY
        // deposited they are now identical: alice 131.2k on 150k and bob 87.5k on 100k are both -12.5%.
        // That equality IS the fix: with no subsidy inside NAV, entry timing transfers nothing between holders.
        assertApproxEqRel(aliceGot, 131_232e18, 0.01e18, "alice 131.2k = -12.5% on her 150k");
        assertApproxEqRel(bobGot, 87_488e18, 0.01e18, "bob 87.5k = -12.5% on his 100k -- the SAME proportional loss");
        assertApproxEqRel(_pct(aliceGot, 150_000e18), _pct(bobGot, 100_000e18), 0.01e18, "early and late depositor take the identical proportional loss");
    }
}
