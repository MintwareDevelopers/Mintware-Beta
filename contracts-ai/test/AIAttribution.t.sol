// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {AIAttribution}  from "../src/AIAttribution.sol";
import {IERC8004Registry} from "../src/interfaces/IERC8004Registry.sol";

contract MockERC8004Registry is IERC8004Registry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => bool) public registryStatus;

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }

    function isRegistered(uint256 tokenId) external view returns (bool) {
        return registryStatus[tokenId];
    }

    function getAgentMetadata(uint256) external pure returns (string memory, string memory, address, bool) {
        return ("", "", address(0), true);
    }

    function setOwner(uint256 tokenId, address owner) external {
        owners[tokenId] = owner;
    }

    function setRegistered(uint256 tokenId, bool value) external {
        registryStatus[tokenId] = value;
    }
}

contract AIAttributionTest is Test {
    AIAttribution internal ai;
    MockERC8004Registry internal registry;

    // Oracle: use a known private key so we can sign EIP-712 messages in tests
    uint256 internal constant ORACLE_PRIV_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    address internal owner  = makeAddr("owner");
    address internal oracle;   // derived from ORACLE_PRIV_KEY
    address internal agent1 = makeAddr("agent1");
    address internal agent2 = makeAddr("agent2");
    address internal rando  = makeAddr("rando");

    // Mirrors ACTION_TYPEHASH in the contract
    bytes32 internal constant ACTION_TYPEHASH = keccak256(
        "RecordAction(address agent,uint256 volumeContributed,bytes32 mwpContextHash,uint256 campaignId,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        oracle = vm.addr(ORACLE_PRIV_KEY);
        registry = new MockERC8004Registry();
        vm.prank(owner);
        ai = new AIAttribution(oracle);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Build and sign an EIP-712 RecordAction digest using the oracle private key.
    function _signAction(
        address agent,
        uint256 volume,
        bytes32 mwpHash,
        uint256 campaignId,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        // Reconstruct domain separator from contract's eip712Domain()
        (
            ,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            ,
        ) = ai.eip712Domain();

        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name)),
            keccak256(bytes(version)),
            chainId,
            verifyingContract
        ));

        bytes32 structHash = keccak256(abi.encode(
            ACTION_TYPEHASH,
            agent, volume, mwpHash, campaignId, nonce, deadline
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_PRIV_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Helper: register agent1, sign an action, and call recordVerifiedAction.
    function _recordAction(
        address agent,
        uint256 volume,
        bytes32 mwpHash,
        uint256 campaignId
    ) internal {
        uint256 nonce    = ai.nonces(agent);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAction(agent, volume, mwpHash, campaignId, nonce, deadline);
        ai.recordVerifiedAction(agent, volume, mwpHash, campaignId, nonce, deadline, sig);
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
        vm.prank(rando);
        ai.registerAgent();
        assertTrue(ai.registered(rando));
    }

    function test_linkErc8004_clears_previous_reverse_mapping_on_relink() public {
        registry.setOwner(1, agent1);
        registry.setOwner(2, agent1);

        vm.prank(owner);
        ai.setErc8004Registry(address(registry), false);

        vm.startPrank(agent1);
        ai.linkErc8004(1);
        ai.linkErc8004(2);
        vm.stopPrank();

        assertEq(ai.agentTokenId(agent1), 2);
        assertEq(ai.tokenIdToAgent(1), address(0));
        assertEq(ai.tokenIdToAgent(2), agent1);
    }

    // ── recordVerifiedAction — gasless oracle pattern ─────────────────────────

    function test_recordVerifiedAction_incrementsBehavior() public {
        vm.prank(agent1);
        ai.registerAgent();

        uint256 volume = 5 ether; // 5e18 → behavior += 5
        _recordAction(agent1, volume, bytes32(0), 0);

        (, uint128 behavior,,,,,, ) = ai.getScore(agent1);
        assertEq(behavior, 5);
    }

    function test_recordVerifiedAction_calledByAnyone_agentPaysGas() public {
        // Anyone (not just oracle) can submit a valid oracle-signed action
        vm.prank(agent1);
        ai.registerAgent();

        uint256 nonce    = ai.nonces(agent1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAction(agent1, 1 ether, bytes32(0), 0, nonce, deadline);

        // rando submits on behalf of agent1 — agent1 could pay their own gas,
        // but any address can relay the signed payload
        vm.prank(rando);
        ai.recordVerifiedAction(agent1, 1 ether, bytes32(0), 0, nonce, deadline, sig);

        (, uint128 behavior,,,,,, ) = ai.getScore(agent1);
        assertEq(behavior, 1);
    }

    function test_recordVerifiedAction_revertsInvalidSignature() public {
        vm.prank(agent1);
        ai.registerAgent();

        uint256 nonce    = ai.nonces(agent1);
        uint256 deadline = block.timestamp + 1 hours;

        // Sign with wrong key (rando's key)
        uint256 wrongKey = 0x59c6995e998f97a5a0044966f094538f6f7b90a2f9a75b9aab4e9876543210a;
        bytes32 structHash = keccak256(abi.encode(
            ACTION_TYPEHASH, agent1, 1 ether, bytes32(0), uint256(0), nonce, deadline
        ));
        (, string memory name, string memory version, uint256 chainId, address vc, , ) = ai.eip712Domain();
        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name)), keccak256(bytes(version)), chainId, vc
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert("AIAttribution: invalid oracle signature");
        ai.recordVerifiedAction(agent1, 1 ether, bytes32(0), 0, nonce, deadline, badSig);
    }

    function test_recordVerifiedAction_revertsExpiredDeadline() public {
        vm.prank(agent1);
        ai.registerAgent();

        uint256 nonce    = ai.nonces(agent1);
        uint256 deadline = block.timestamp - 1; // already expired
        bytes memory sig = _signAction(agent1, 1 ether, bytes32(0), 0, nonce, deadline);

        vm.expectRevert("AIAttribution: signature expired");
        ai.recordVerifiedAction(agent1, 1 ether, bytes32(0), 0, nonce, deadline, sig);
    }

    function test_recordVerifiedAction_revertsReplayNonce() public {
        vm.prank(agent1);
        ai.registerAgent();

        // First call succeeds
        _recordAction(agent1, 1 ether, bytes32(0), 0);

        // Replay: nonce is now stale (still 0)
        uint256 staleNonce = 0;
        uint256 deadline   = block.timestamp + 1 hours;
        bytes memory sig   = _signAction(agent1, 1 ether, bytes32(0), 0, staleNonce, deadline);

        vm.expectRevert("AIAttribution: invalid nonce");
        ai.recordVerifiedAction(agent1, 1 ether, bytes32(0), 0, staleNonce, deadline, sig);
    }

    function test_recordVerifiedAction_revertsNotRegistered() public {
        uint256 nonce    = ai.nonces(agent1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAction(agent1, 1 ether, bytes32(0), 0, nonce, deadline);

        vm.expectRevert("AIAttribution: agent not registered");
        ai.recordVerifiedAction(agent1, 1 ether, bytes32(0), 0, nonce, deadline, sig);
    }

    function test_recordVerifiedAction_nonceIncrementsAfterSuccess() public {
        vm.prank(agent1);
        ai.registerAgent();

        assertEq(ai.nonces(agent1), 0);
        _recordAction(agent1, 1 ether, bytes32(0), 0);
        assertEq(ai.nonces(agent1), 1);
        _recordAction(agent1, 1 ether, bytes32(0), 0);
        assertEq(ai.nonces(agent1), 2);
    }

    function test_recordVerifiedAction_withMwpHash_setsTransparent() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 mwpHash = keccak256("mwp-snapshot-1");
        _recordAction(agent1, 1 ether, mwpHash, 0);

        (,,,, uint64 interp, bool isTransparent, bytes32 lastHash,) = ai.getScore(agent1);
        assertEq(interp, 50);
        assertTrue(isTransparent);
        assertEq(lastHash, mwpHash);
    }

    function test_recordVerifiedAction_sameHashNotDoubleCredited() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 mwpHash = keccak256("mwp-snapshot-1");
        _recordAction(agent1, 1 ether, mwpHash, 0);
        _recordAction(agent1, 1 ether, mwpHash, 0); // same hash — no bonus

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

        _recordAction(agent1, 100 ether, bytes32(0), campaignId);

        assertEq(ai.getAgentCampaignVolume(campaignId, agent1), 100 ether);
    }

    // ── Risk penalty ──────────────────────────────────────────────────────────

    function test_applyRiskPenalty_reducesTotal() public {
        vm.prank(agent1);
        ai.registerAgent();

        _recordAction(agent1, 100 ether, bytes32(0), 0);

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

        vm.prank(oracle);
        ai.applyRiskPenalty(agent1, 999, "test");

        (uint256 total,,,,,,, ) = ai.getScore(agent1);
        assertEq(total, 0);
    }

    // ── Oracle admin — timelocked rotation (H1 fix) ───────────────────────────

    function test_proposeOracle_onlyOwner() public {
        address newOracle = makeAddr("newOracle");
        vm.prank(owner);
        ai.proposeOracle(newOracle);
        assertEq(ai.pendingOracle(), newOracle);
        assertGt(ai.oracleRotationAvailableAt(), block.timestamp);
    }

    function test_proposeOracle_revertsNotOwner() public {
        vm.prank(rando);
        vm.expectRevert();
        ai.proposeOracle(makeAddr("newOracle"));
    }

    function test_proposeOracle_revertsZero() public {
        vm.prank(owner);
        vm.expectRevert("AIAttribution: zero oracle");
        ai.proposeOracle(address(0));
    }

    function test_proposeOracle_revertsAlreadyActive() public {
        address currentOracle = ai.oracle(); // read before prank — prank is consumed by next call
        vm.prank(owner);
        vm.expectRevert("AIAttribution: already active oracle");
        ai.proposeOracle(currentOracle);
    }

    function test_confirmOracle_afterDelay() public {
        address newOracle = makeAddr("newOracle");
        vm.prank(owner);
        ai.proposeOracle(newOracle);

        // Before delay elapses — should revert
        vm.prank(owner);
        vm.expectRevert("AIAttribution: rotation delay not elapsed");
        ai.confirmOracle();

        // After 48 hours — should succeed
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        ai.confirmOracle();
        assertEq(ai.oracle(), newOracle);
        assertEq(ai.pendingOracle(), address(0));
    }

    function test_cancelOracleRotation() public {
        address newOracle = makeAddr("newOracle");
        vm.prank(owner);
        ai.proposeOracle(newOracle);

        vm.prank(owner);
        ai.cancelOracleRotation();
        assertEq(ai.pendingOracle(), address(0));
        assertEq(ai.oracle(), oracle); // original oracle unchanged
    }

    function test_cancelOracleRotation_revertsNoPending() public {
        vm.prank(owner);
        vm.expectRevert("AIAttribution: no rotation pending");
        ai.cancelOracleRotation();
    }

    // ── getScore view ─────────────────────────────────────────────────────────

    function test_getScore_returnsAllFields() public {
        vm.prank(agent1);
        ai.registerAgent();

        bytes32 mwpHash = keccak256("mwp");
        _recordAction(agent1, 10 ether, mwpHash, 0);

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
        assertEq(tokenId,        0);
    }

    // ── Nonce view ────────────────────────────────────────────────────────────

    function test_nonce_startsAtZero() public view {
        assertEq(ai.nonces(agent1), 0);
    }

    function test_nonce_incrementsPerAgent() public {
        vm.prank(agent1);
        ai.registerAgent();
        vm.prank(agent2);
        ai.registerAgent();

        _recordAction(agent1, 1 ether, bytes32(0), 0);
        _recordAction(agent1, 1 ether, bytes32(0), 0);
        _recordAction(agent2, 1 ether, bytes32(0), 0);

        assertEq(ai.nonces(agent1), 2);
        assertEq(ai.nonces(agent2), 1);
    }

    // ── Multi-agent leaderboard scenario ─────────────────────────────────────

    function test_multiAgentScores() public {
        vm.prank(agent1);
        ai.registerAgent();
        _recordAction(agent1, 500 ether, keccak256("mwp-a1"), 0);

        vm.prank(agent2);
        ai.registerAgent();
        _recordAction(agent2, 200 ether, bytes32(0), 0);

        (uint256 score1,,,,,,,) = ai.getScore(agent1);
        (uint256 score2,,,,,,,) = ai.getScore(agent2);

        assertGt(score1, score2);
        assertTrue(ai.isAgentTransparent(agent1));
        assertFalse(ai.isAgentTransparent(agent2));
    }
}
