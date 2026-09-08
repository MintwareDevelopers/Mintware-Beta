// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {EconBase} from "./EconBase.sol";

/// @title  Econ Q2 / Q5 -- IL exposure of depositor principal vs the cap, and who captures the owner's paired leg
/// @notice Q2: for a balanced deploy at the cap (q = 50% of principal, owner matches paired), depositor NAV as
///         a function of price on the +-22980 range. Model: NAV(P) = (1-c)*Pr + V(L(q), P). Principal floor at
///         P ~ 0.30 (-70%): below it the owner's leg no longer covers the quote-leg IL. At the lower edge
///         (P = Pa, -90%) NAV = 70.9% of principal; P -> 0 gives 50% (= the cap).
///         Q5: the owner's paired leg is a gift to whoever holds shares at deploy time, realised on exit; a
///         later depositor pays NAV that includes it and carries its IL.
///
///         Run: LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-contract EconSubsidyIl -vv
contract EconSubsidyIlTest is EconBase {
    function _rig() internal {
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(100_000e18);
        pm.deploy(50_000e18, 50_000e18, 0, block.timestamp); // c = 0.5 ; NAV 150k = 50k idle + 100k LP
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
        assertApproxEqRel(pm.totalNav(), 150_000e18, 0.001e18, "at deploy: 150k (100k principal + 50k subsidy)");

        _pushPairedPrice(SQ_HALF); // -50%
        uint256 navHalf = pm.totalNav();
        _logQ("NAV at P=0.5", navHalf);
        assertApproxEqRel(navHalf, 118_720e18, 0.01e18, "model 118.7k (118.7% of principal)");

        _pushPairedPrice(SQ_0_3); // -70%: principal floor
        uint256 nav03 = pm.totalNav();
        _logQ("NAV at P=0.3 (principal floor)", nav03);
        assertApproxEqRel(nav03, 100_000e18, 0.01e18, "model 100.0k: the owner leg exactly covers the IL here");

        // lower edge: push to the tick just beyond Pa on the paired-cheap side (position 100% paired)
        uint160 edge = q0 ? TickMath.getSqrtPriceAtTick(TU + 60) : TickMath.getSqrtPriceAtTick(TL - 60);
        bool zeroForOne = edge < _spot();
        _swapToSqrt(whale, zeroForOne == q0, edge);
        uint256 navEdge = pm.totalNav();
        _logQ("NAV at P<=Pa (-90%)", navEdge);
        assertApproxEqRel(navEdge, 70_872e18, 0.015e18, "model 70.9k: 100% paired, marked at Pa");

        // recovery to +100%
        _arbToFair();
        _pushPairedPrice(SQ_DOUBLE);
        uint256 nav2 = pm.totalNav();
        _logQ("NAV at P=2", nav2);
        assertApproxEqRel(nav2, 187_440e18, 0.01e18, "model 187.4k");
    }

    function test_Q5_subsidy_incumbentCaptures_laterDepositorPays() public {
        if (!live) return;
        _rig(); // alice: 100k in, claim 150k
        vm.prank(bob);
        uint256 sB = pm.deposit(100_000e18); // priced at NAV 150k: bob buys 40% of the pool at par, no subsidy
        uint256 S = pm.totalShares();
        uint256 aliceClaim = (pm.sharesOf(alice) * pm.totalNav()) / S;
        uint256 bobClaim = (sB * pm.totalNav()) / S;
        _logQ("after bob: alice claim", aliceClaim);
        _logQ("after bob: bob claim", bobClaim);
        assertApproxEqRel(aliceClaim, 150_000e18, 0.001e18, "alice captured the whole 50k subsidy");
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
        // model: alice 131.2k (still +31% on 100k), bob 87.5k (-12.5%: he paid for a paired leg he never received)
        assertApproxEqRel(aliceGot, 131_232e18, 0.01e18, "alice 131.2k");
        assertApproxEqRel(bobGot, 87_488e18, 0.01e18, "bob 87.5k -- the subsidy he paid NAV for carried IL against him");
    }
}
