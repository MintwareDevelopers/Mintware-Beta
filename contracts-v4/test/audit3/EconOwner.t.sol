// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";
import {EconBase} from "./EconBase.sol";
import {MintwareLpGatewayPositionManager} from "../../src/gateway/MintwareLpGatewayPositionManager.sol";

/// @title  Econ invariant 15 -- compromised owner seat: maximum principal extraction under cap + band
/// @notice Enumerates the owner-reachable transitions and quantifies the worst one. `deploy` is the only
///         path that moves depositor quote out of the reserve; the cap fixes HOW MUCH (<= 50% at cost) and
///         the band fixes AT WHAT PRICE relative to the follower -- but the follower can be walked by the
///         owner (or anyone) and the position's RANGE has an all-quote edge. Pump to that edge, walk, deploy
///         quote only (no paired leg = no owner capital), dump back through the gateway's fresh liquidity:
///         the position converts ~52% of the deployed quote into paired bought at the top -> depositors lose
///         ~26% of principal; the owner books it as quote. RT-9c (mid-range, owner-funded paired leg) was
///         owner-NEGATIVE; this path is owner-POSITIVE once the fresh deploy is > ~1.6% of pool depth.
///
///         Run: LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-contract EconOwner -vv
contract EconOwnerTest is EconBase {
    /// Pump to the all-quote range edge and (optionally) walk the follower there. Returns the blocks walked.
    function _pumpAndWalk(bool anchored, bool walk) internal returns (uint256 blocksWalked, uint256 navBefore) {
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(200_000e18);
        if (anchored) {
            pm.deploy(1_000e18, 1_000e18, 0, block.timestamp); // a live instance with a position
            _roll(1);
        }
        navBefore = pm.totalNav();
        _swapToSqrt(address(this), true, _beyondAllQuoteEdge());
        blocksWalked = walk ? _walkFollower(60, BAND) : 0;
    }

    /// FIXED (round-3 invariant 15): the pump + walk still lands the follower at the range edge, but `deploy` now
    /// requires the amounts actually MINTED to be two-sided (paired value within [0.5x, 2x] of quote), so an all-quote
    /// position cannot be created — with or without paired offered (at the edge the paired leg is returned unused).
    /// Pre-fix (same rig, q = 99k): depositors lost 50.8k = 51.3% of q = 25.4% of principal; the seat booked +31k.
    function test_I15_liveInstance_pumpWalkAllQuoteDeploy_FIXED() public {
        if (!live) return;
        (uint256 blocks, uint256 navBefore) = _pumpAndWalk(true, true);
        assertGe(blocks, 20, "the follower can still be walked to the edge (~24 blocks)");
        uint256 idle0 = staging.stagedAssets();
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployNotTwoSided.selector);
        pm.deploy(99_000e18, 0, 0, block.timestamp);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployNotTwoSided.selector);
        pm.deploy(99_000e18, 99_000e18, 0, block.timestamp); // paired offered but unused at the edge -> still one-sided
        assertEq(staging.stagedAssets(), idle0, "no depositor quote left the reserve");
        _roll(1);
        _arbToFair();
        assertGe(pm.totalNav() + 50e18, navBefore, "depositor NAV untouched by the attempt");
        console2.log("blocks walked", blocks);
    }

    /// FIXED (round-3 XR-2 / X-7): a FRESH instance is anchored at creation, so the first deploy is banded like every
    /// later one — the one-block variant reverts `DeployPriceOutOfBand`; walking the follower there instead runs into
    /// the two-sided check. Pre-fix: no follower before the first deploy -> the same ~52% of q in a single block.
    function test_I15_freshInstance_firstDeployIsBanded_FIXED() public {
        if (!live) return;
        (uint256 blocks,) = _pumpAndWalk(false, false);
        assertEq(blocks, 0);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployPriceOutOfBand.selector);
        pm.deploy(99_000e18, 0, 0, block.timestamp);
        _walkFollower(60, BAND);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployNotTwoSided.selector);
        pm.deploy(99_000e18, 0, 0, block.timestamp);
        assertEq(pm.tokenId(), 0, "no position was ever minted");
    }

    /// The cost-basis cap still bounds an HONEST seat: a balanced deploy at the cap, then any further deploy is refused,
    /// and the seat has no path to the remaining idle (RT-9d).
    function test_I15_capBoundsRepeat_FAILS() public {
        if (!live) return;
        _addExternalLiquidity(2_200_000e18);
        vm.prank(alice);
        pm.deposit(200_000e18);
        pm.deploy(100_000e18, 100_000e18, 0, block.timestamp); // exactly the 50% cap
        _roll(1);
        vm.expectRevert(MintwareLpGatewayPositionManager.DeployCapExceeded.selector);
        pm.deploy(1_000e18, 1_000e18, 0, block.timestamp);
        vm.expectRevert();
        staging.unstage(1e18);
        assertGe(staging.stagedAssets(), 99_000e18, "alice keeps >= 50% of principal idle in the reserve");
    }
}
