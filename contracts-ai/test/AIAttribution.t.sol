// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {AIAttribution}  from "../src/AIAttribution.sol";

contract AIAttributionTest is Test {
    AIAttribution internal ai;

    address internal owner  = makeAddr("owner");
    address internal oracle = makeAddr("oracle");
    address internal agent1 = makeAddr("agent1");
    address internal agent2 = makeAddr("agent2");
    address internal rando  = makeAddr("rando");

    function setUp() public {
        vm.prank(owner);
        ai = new AIAttribution(oracle);
    }

    // ── Construction ──────────────────────────────────────────────────────────

    function test_constructor_setsOracleAndOwner() public view {
        assertEq(ai.oracle(), oracle);
        assertEq(ai.owner(), owner);
    }

    function test_constructor_revertsZeroOracle() public {
        vm.prank(owner);
        vm.expectRevert("AIAttribution: zero oracle");
        new AIAttribution(address(0));
    }

    // ── Registration ──────────────────────────────────────────────────────────

    function test_registerAgent_succeeds() public {
        vm.prank(agent1);
        vm.expectEmit(true, true, false, false);
        emit AIAttribution.AgentRegistered(agent1, 0);
        ai.registerAgent();
        assertTrue(ai.registered(agent1));
    }

    function test_registerAgent_permissionless_noErc8004() public {
        // requireErc8004 is false by default — anyone can register
        vm.prank(rando);
        ai.registerAgent();
        assertTrue(ai.registered(rando));
    }

    // ── recordVerifiedAction ──────────────────────────────────────────────────

    function test_recordVerifiedAction_incrementsBehavior() public {
        vm.prank(agent1);
        ai.registerAgent();

        uint256 volume = 5 ether; // 5e18 → behavior += 5
        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, volume, bytes32(0), 0);

        (, uint128 behavior,,,,,, ) = ai.getScore(agent1);
        assertEq(behavior, 5);
    }

    function test_recordVerifiedAction_revertsNotOracle() public {
        vm.prank(agent1);
        ai.registerAgent();

        vm.prank(rando);
        vm.expectRevert("AIAttribution: not oracle");
        ai.recordVerifiedAction(agent1, 1 ether, bytes32(0), 0);
    }

    function test_recordVerifiedAction_revertsNotRegistered() public {
        vm.prank(oracle);
        vm.expectRevert("AIAttribution: agent not registered");
        ai.recordVerifiedAction(agent1, 1 ether, bytes32(0), 0);
    }

    function test_recordVerifiedAction_withMwpHash_setsTransparent() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 mwpHash = keccak256("mwp-snapshot-1");
        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, 1 ether, mwpHash, 0);

        (,,,, uint64 interp, bool isTransparent, bytes32 lastHash,) = ai.getScore(agent1);
        assertEq(interp, 50);
        assertTrue(isTransparent);
        assertEq(lastHash, mwpHash);
    }

    function test_recordVerifiedAction_sameHashNotDoubleCredited() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 mwpHash = keccak256("mwp-snapshot-1");
        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, 1 ether, mwpHash, 0);
        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, 1 ether, mwpHash, 0); // same hash — no bonus

        (,,,, uint64 interp,,,) = ai.getScore(agent1);
        assertEq(interp, 50); // still 50, not 100
    }

    // ── MWP hash cap ──────────────────────────────────────────────────────────

    function test_interpretabilityCappedAt500() public {
        vm.prank(agent1);
        ai.registerAgent();

        // Submit 11 unique hashes × 50 = 550 → should cap at 500
        for (uint256 i = 0; i < 11; i++) {
            bytes32 h = keccak256(abi.encodePacked("hash", i));
            vm.prank(agent1);
            ai.submitMwpHash(h);
        }

        (,,,, uint64 interp,,,) = ai.getScore(agent1);
        assertEq(interp, 500);
    }

    // ── submitMwpHash ─────────────────────────────────────────────────────────

    function test_submitMwpHash_setsTransparent() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 h = keccak256("mwp-v1");
        vm.prank(agent1);
        vm.expectEmit(true, true, false, true);
        emit AIAttribution.MwpHashSubmitted(agent1, h, 1);
        ai.submitMwpHash(h);

        assertTrue(ai.isAgentTransparent(agent1));
    }

    function test_submitMwpHash_revertsNotRegistered() public {
        vm.prank(rando);
        vm.expectRevert("AIAttribution: not registered");
        ai.submitMwpHash(keccak256("hash"));
    }

    function test_submitMwpHash_revertsEmptyHash() public {
        vm.prank(agent1);
        ai.registerAgent();

        vm.prank(agent1);
        vm.expectRevert("AIAttribution: empty hash");
        ai.submitMwpHash(bytes32(0));
    }

    function test_submitMwpHash_revertsDuplicateHash() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 h = keccak256("mwp-v1");
        vm.prank(agent1);
        ai.submitMwpHash(h);

        vm.prank(agent1);
        vm.expectRevert("AIAttribution: hash already submitted");
        ai.submitMwpHash(h);
    }

    // ── Volume campaigns ──────────────────────────────────────────────────────

    function test_createVolumeCampaign_succeeds() public {
        vm.prank(rando);
        vm.expectEmit(true, true, false, false);
        emit AIAttribution.CampaignCreated(1, rando, "Test Campaign");
        uint256 id = ai.createVolumeCampaign("Test Campaign", 100 ether, 7 days);
        assertEq(id, 1);
        assertEq(ai.campaignCount(), 1);
    }

    function test_createVolumeCampaign_revertsEmptyName() public {
        vm.prank(rando);
        vm.expectRevert("AIAttribution: empty name");
        ai.createVolumeCampaign("", 100 ether, 7 days);
    }

    function test_createVolumeCampaign_revertsZeroTarget() public {
        vm.prank(rando);
        vm.expectRevert("AIAttribution: zero target");
        ai.createVolumeCampaign("Test", 0, 7 days);
    }

    function test_recordAction_tracksCampaignVolume() public {
        vm.prank(agent1);
        ai.registerAgent();

        vm.prank(rando);
        uint256 campaignId = ai.createVolumeCampaign("Vol Campaign", 1000 ether, 7 days);

        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, 100 ether, bytes32(0), campaignId);

        assertEq(ai.getAgentCampaignVolume(campaignId, agent1), 100 ether);
    }

    // ── Risk penalty ──────────────────────────────────────────────────────────

    function test_applyRiskPenalty_reducesTotal() public {
        vm.prank(agent1);
        ai.registerAgent();

        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, 100 ether, bytes32(0), 0);

        (uint256 before,,,,,,, ) = ai.getScore(agent1);
        assertEq(before, 100);

        vm.prank(oracle);
        ai.applyRiskPenalty(agent1, 30, "sybil detected");

        (uint256 after_,,,,,,, ) = ai.getScore(agent1);
        assertEq(after_, 70);
    }

    function test_applyRiskPenalty_revertsNotOracle() public {
        vm.prank(agent1);
        ai.registerAgent();

        vm.prank(rando);
        vm.expectRevert("AIAttribution: not oracle");
        ai.applyRiskPenalty(agent1, 10, "test");
    }

    function test_totalScoreFloorZero() public {
        vm.prank(agent1);
        ai.registerAgent();

        // Apply penalty larger than score — should floor at 0, not underflow
        vm.prank(oracle);
        ai.applyRiskPenalty(agent1, 999, "test");

        (uint256 total,,,,,,, ) = ai.getScore(agent1);
        assertEq(total, 0);
    }

    // ── Oracle admin ──────────────────────────────────────────────────────────

    function test_setOracle_onlyOwner() public {
        address newOracle = makeAddr("newOracle");
        vm.prank(owner);
        ai.setOracle(newOracle);
        assertEq(ai.oracle(), newOracle);
    }

    function test_setOracle_revertsNotOwner() public {
        vm.prank(rando);
        vm.expectRevert();
        ai.setOracle(makeAddr("newOracle"));
    }

    function test_setOracle_revertsZero() public {
        vm.prank(owner);
        vm.expectRevert("AIAttribution: zero oracle");
        ai.setOracle(address(0));
    }

    // ── getScore view ─────────────────────────────────────────────────────────

    function test_getScore_returnsAllFields() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 mwpHash = keccak256("mwp");
        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, 10 ether, mwpHash, 0);

        (
            uint256 total,
            uint128 behavior,
            uint128 contribution,
            uint64  risk,
            uint64  interp,
            bool    isTransparent,
            bytes32 lastHash,
            uint256 tokenId
        ) = ai.getScore(agent1);

        assertEq(total,         60);  // behavior(10) + interp(50)
        assertEq(behavior,      10);
        assertEq(contribution,   0);
        assertEq(risk,           0);
        assertEq(interp,        50);
        assertTrue(isTransparent);
        assertEq(lastHash,   mwpHash);
        assertEq(tokenId,        0);  // not ERC-8004 linked
    }

    // ── Multi-agent leaderboard scenario ─────────────────────────────────────

    function test_multiAgentScores() public {
        // agent1: high volume, transparent
        vm.prank(agent1);
        ai.registerAgent();
        vm.prank(oracle);
        ai.recordVerifiedAction(agent1, 500 ether, keccak256("mwp-a1"), 0);

        // agent2: lower volume, not transparent
        vm.prank(agent2);
        ai.registerAgent();
        vm.prank(oracle);
        ai.recordVerifiedAction(agent2, 200 ether, bytes32(0), 0);

        (uint256 score1,,,,,,,) = ai.getScore(agent1);
        (uint256 score2,,,,,,,) = ai.getScore(agent2);

        assertGt(score1, score2);
        assertTrue(ai.isAgentTransparent(agent1));
        assertFalse(ai.isAgentTransparent(agent2));
    }
}
