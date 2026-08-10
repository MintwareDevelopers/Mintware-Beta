// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MintwareWeightedDistributor} from "../src/MintwareWeightedDistributor.sol";
import {MWGuardianPausable}          from "../src/lib/MWGuardianPausable.sol";
import {MWTimelockedOracleSigner}    from "../src/lib/MWTimelockedOracleSigner.sol";
import {MockERC20}                   from "./mocks/MockERC20.sol";

/// @title  MintwareWeightedDistributor unit tests
/// @notice Covers the money-path and every Tier-0 guarantee from the oracle audit:
///           C1 — the oracle signature is actually verified at epoch close
///           C4 — guardian kill-switch freezes closeEpoch + claim
///           C5 — a signed root can never allocate more than the funded pot
///           C7 — oracle signer rotates only through the 48h timelock
contract MintwareWeightedDistributorTest is Test {
    MintwareWeightedDistributor internal dist;
    MockERC20 internal token0;
    MockERC20 internal token1;

    uint256 internal constant ORACLE_PK = 0xA11CE;
    address internal oracle;
    address internal owner    = address(0x01);
    address internal guardian = address(0x6A);
    address internal alice    = address(0xA1);
    address internal bob      = address(0xB0);

    bytes32 internal constant VAULT = keccak256("vault-1");

    function setUp() public {
        oracle = vm.addr(ORACLE_PK);

        vm.prank(owner);
        dist = new MintwareWeightedDistributor(oracle, owner);

        vm.prank(owner);
        dist.setGuardian(guardian);

        // Authorize this test contract as a registrar (front-run guard — audit MED).
        vm.prank(owner);
        dist.setAuthorizedRegistrar(address(this), true);

        token0 = new MockERC20("Token0", "PEPE", 18);
        token1 = new MockERC20("Token1", "USDC", 6);

        // Register the vault pair (funder = this test contract) and fund epoch 1.
        dist.registerVault(VAULT, address(token0), address(token1));
        _fund(1_000e18, 1_000e6);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _fund(uint256 a0, uint256 a1) internal {
        token0.mint(address(this), a0);
        token1.mint(address(this), a1);
        token0.approve(address(dist), a0);
        token1.approve(address(dist), a1);
        dist.fundFees(VAULT, a0, a1);
    }

    function _leaf(address w, uint256 a0, uint256 a1) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(w, a0, a1))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Close the current epoch with a single-leaf root for `who`.
    function _closeSingle(address who, uint256 a0, uint256 a1)
        internal
        returns (uint256 epochNumber, bytes32 root)
    {
        epochNumber = dist.currentEpoch(VAULT);
        root = _leaf(who, a0, a1); // single-leaf tree: root == leaf
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = dist.getEpochRootDigest(VAULT, epochNumber, root, a0, a1, deadline);
        bytes memory sig = _sign(ORACLE_PK, digest);
        dist.closeEpoch(VAULT, root, a0, a1, sig, deadline);
    }

    // ── registration ────────────────────────────────────────────────────────

    function test_Register_SetsPairAndOpensEpoch1() public {
        (address t0, address t1, address funder, bool reg) = dist.vaults(VAULT);
        assertEq(t0, address(token0));
        assertEq(t1, address(token1));
        assertEq(funder, address(this));
        assertTrue(reg);
        assertEq(dist.currentEpoch(VAULT), 1);
    }

    /// Audit CRIT: a claim AFTER sweep must revert — otherwise it drains other epochs/vaults
    /// from the shared token balance (the swept remainder already went to the funder).
    function test_claim_after_sweep_reverts() public {
        _fund(100e18, 200e6);
        vm.warp(block.timestamp + 7 days); // let the epoch duration elapse so it can close
        (uint256 ep,) = _closeSingle(alice, 10e18, 20e6);
        vm.warp(block.timestamp + 91 days); // past the 90-day claim window
        dist.sweep(VAULT, ep);
        bytes32[] memory emptyProof = new bytes32[](0); // single-leaf tree → root == leaf
        vm.prank(alice);
        vm.expectRevert(MintwareWeightedDistributor.AlreadySwept.selector);
        dist.claim(VAULT, ep, 10e18, 20e6, emptyProof);
    }

    function test_Register_RevertDouble() public {
        vm.expectRevert(MintwareWeightedDistributor.VaultAlreadyRegistered.selector);
        dist.registerVault(VAULT, address(token0), address(token1));
    }

    function test_Register_RevertZeroToken0() public {
        vm.expectRevert(MintwareWeightedDistributor.ZeroToken0.selector);
        dist.registerVault(keccak256("v2"), address(0), address(token1));
    }

    /// Audit MED: an unauthorized address cannot register (and thus cannot front-run to become
    /// funder-of-record and later steal swept remainders).
    function test_Register_RevertUnauthorized() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(MintwareWeightedDistributor.NotAuthorizedRegistrar.selector);
        dist.registerVault(keccak256("hijack"), address(token0), address(token1));
    }

    function test_Register_AuthorizedRegistrarSucceeds() public {
        address vaultLike = makeAddr("vaultLike");
        vm.prank(owner);
        dist.setAuthorizedRegistrar(vaultLike, true);
        vm.prank(vaultLike);
        dist.registerVault(keccak256("authz"), address(token0), address(token1));
        (,, address funder, bool registered) = dist.vaults(keccak256("authz"));
        assertTrue(registered, "registered");
        assertEq(funder, vaultLike, "authorized caller is funder-of-record");
    }

    // ── funding ───────────────────────────────────────────────────────────────

    function test_Fund_AccumulatesPot() public {
        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(VAULT, 1);
        assertEq(e.pot0, 1_000e18);
        assertEq(e.pot1, 1_000e6);
    }

    function test_Fund_RevertSingleSidedToken1() public {
        bytes32 v2 = keccak256("single");
        dist.registerVault(v2, address(token0), address(0));
        token1.mint(address(this), 1e6);
        token1.approve(address(dist), 1e6);
        vm.expectRevert(MintwareWeightedDistributor.ZeroToken0.selector);
        dist.fundFees(v2, 0, 1e6);
    }

    // ── closeEpoch: the C1 / C5 heart ─────────────────────────────────────────

    function test_Close_RevertBeforeDuration() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes32 root = _leaf(alice, 1e18, 1e6);
        bytes memory sig = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 1, root, 1e18, 1e6, dl));
        vm.expectRevert(MintwareWeightedDistributor.EpochStillActive.selector);
        dist.closeEpoch(VAULT, root, 1e18, 1e6, sig, dl);
    }

    function test_Close_RevertExpiredDeadline() public {
        vm.warp(block.timestamp + 7 days);
        uint256 dl = block.timestamp - 1; // already past
        bytes32 root = _leaf(alice, 1e18, 1e6);
        bytes memory sig = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 1, root, 1e18, 1e6, dl));
        vm.expectRevert(MintwareWeightedDistributor.SignatureExpired.selector);
        dist.closeEpoch(VAULT, root, 1e18, 1e6, sig, dl);
    }

    function test_Close_RevertBadSignature() public {
        vm.warp(block.timestamp + 7 days);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 root = _leaf(alice, 1e18, 1e6);
        // Sign with a NON-oracle key.
        bytes memory sig = _sign(0xBEEF, dist.getEpochRootDigest(VAULT, 1, root, 1e18, 1e6, dl));
        vm.expectRevert(MintwareWeightedDistributor.InvalidOracleSignature.selector);
        dist.closeEpoch(VAULT, root, 1e18, 1e6, sig, dl);
    }

    /// C5 — the signed totals may not exceed the funded pot.
    function test_Close_RevertOverAllocated() public {
        vm.warp(block.timestamp + 7 days);
        uint256 dl = block.timestamp + 1 hours;
        uint256 bad0 = 1_000e18 + 1; // pot0 is exactly 1_000e18
        bytes32 root = _leaf(alice, bad0, 1e6);
        bytes memory sig = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 1, root, bad0, 1e6, dl));
        vm.expectRevert(MintwareWeightedDistributor.OverAllocated.selector);
        dist.closeEpoch(VAULT, root, bad0, 1e6, sig, dl);
    }

    function test_Close_Success() public {
        vm.warp(block.timestamp + 7 days);
        (uint256 epochNumber, bytes32 root) = _closeSingle(alice, 10e18, 20e6);
        assertEq(epochNumber, 1);
        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(VAULT, 1);
        assertTrue(e.closed);
        assertEq(e.merkleRoot, root);
        assertEq(e.total0, 10e18);
        assertEq(e.total1, 20e6);
        // next epoch opened
        assertEq(dist.currentEpoch(VAULT), 2);
    }

    function test_Close_RevertDoubleClose() public {
        vm.warp(block.timestamp + 7 days);
        _closeSingle(alice, 10e18, 20e6);
        // currentEpoch is now 2; try to re-close epoch 1 by re-signing for epoch 1 —
        // closeEpoch always targets currentEpoch, so epoch 1 can't be reached again.
        // Instead prove epoch 2 (freshly opened) still-active guard fires immediately.
        uint256 dl = block.timestamp + 1 hours;
        bytes32 root = _leaf(alice, 1e18, 1e6);
        bytes memory sig = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 2, root, 1e18, 1e6, dl));
        vm.expectRevert(MintwareWeightedDistributor.EpochStillActive.selector);
        dist.closeEpoch(VAULT, root, 1e18, 1e6, sig, dl);
    }

    /// A root signed for epoch 1 cannot be replayed to close epoch 2 — the epoch
    /// number is in the digest, so the signature no longer recovers to the oracle.
    function test_Close_RevertReplayOntoWrongEpoch() public {
        vm.warp(block.timestamp + 7 days);
        // Build a signature for epoch 1 but don't use it yet.
        uint256 dl = block.timestamp + 365 days;
        bytes32 root = _leaf(alice, 1e18, 1e6);
        bytes memory sigForEpoch1 = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 1, root, 1e18, 1e6, dl));
        // Close epoch 1 legitimately, opening epoch 2.
        dist.closeEpoch(VAULT, root, 1e18, 1e6, sigForEpoch1, dl);
        _fund(10e18, 10e6);
        vm.warp(block.timestamp + 7 days + 1); // strictly past epoch 2's duration boundary
        // Replay the epoch-1 signature against epoch 2.
        vm.expectRevert(MintwareWeightedDistributor.InvalidOracleSignature.selector);
        dist.closeEpoch(VAULT, root, 1e18, 1e6, sigForEpoch1, dl);
    }

    /// C4 — guardian pause blocks epoch close.
    function test_Close_RevertWhenPaused() public {
        vm.warp(block.timestamp + 7 days);
        vm.prank(guardian);
        dist.pause();
        uint256 dl = block.timestamp + 1 hours;
        bytes32 root = _leaf(alice, 1e18, 1e6);
        bytes memory sig = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 1, root, 1e18, 1e6, dl));
        vm.expectRevert(); // OZ Pausable: EnforcedPause
        dist.closeEpoch(VAULT, root, 1e18, 1e6, sig, dl);
    }

    // ── claim ─────────────────────────────────────────────────────────────────

    function test_Claim_Success_PaysBothTokens() public {
        vm.warp(block.timestamp + 7 days);
        _closeSingle(alice, 10e18, 20e6);
        bytes32[] memory proof = new bytes32[](0); // single-leaf tree
        vm.prank(alice);
        dist.claim(VAULT, 1, 10e18, 20e6, proof);
        assertEq(token0.balanceOf(alice), 10e18);
        assertEq(token1.balanceOf(alice), 20e6);
        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(VAULT, 1);
        assertEq(e.claimed0, 10e18);
        assertEq(e.claimed1, 20e6);
    }

    function test_Claim_TwoLeaves_BothClaim() public {
        vm.warp(block.timestamp + 7 days);
        uint256 aA0 = 10e18; uint256 aA1 = 20e6;
        uint256 aB0 = 30e18; uint256 aB1 = 40e6;
        bytes32 leafA = _leaf(alice, aA0, aA1);
        bytes32 leafB = _leaf(bob,   aB0, aB1);
        bytes32 root  = _hashPair(leafA, leafB);
        uint256 total0 = aA0 + aB0; uint256 total1 = aA1 + aB1;
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 1, root, total0, total1, dl));
        dist.closeEpoch(VAULT, root, total0, total1, sig, dl);

        bytes32[] memory proofA = new bytes32[](1); proofA[0] = leafB;
        bytes32[] memory proofB = new bytes32[](1); proofB[0] = leafA;

        vm.prank(alice); dist.claim(VAULT, 1, aA0, aA1, proofA);
        vm.prank(bob);   dist.claim(VAULT, 1, aB0, aB1, proofB);

        assertEq(token0.balanceOf(alice), aA0);
        assertEq(token1.balanceOf(bob),   aB1);
    }

    function test_Claim_RevertDoubleClaim() public {
        vm.warp(block.timestamp + 7 days);
        _closeSingle(alice, 10e18, 20e6);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(alice); dist.claim(VAULT, 1, 10e18, 20e6, proof);
        vm.prank(alice);
        vm.expectRevert(MintwareWeightedDistributor.AlreadyClaimed.selector);
        dist.claim(VAULT, 1, 10e18, 20e6, proof);
    }

    function test_Claim_RevertBadProof() public {
        vm.warp(block.timestamp + 7 days);
        _closeSingle(alice, 10e18, 20e6);
        bytes32[] memory proof = new bytes32[](0);
        // Wrong amounts → leaf mismatch → invalid proof.
        vm.prank(alice);
        vm.expectRevert(MintwareWeightedDistributor.InvalidProof.selector);
        dist.claim(VAULT, 1, 99e18, 20e6, proof);
    }

    function test_Claim_RevertEpochNotClosed() public {
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(MintwareWeightedDistributor.EpochNotClosed.selector);
        dist.claim(VAULT, 1, 10e18, 20e6, proof);
    }

    function test_Claim_RevertWhenPaused() public {
        vm.warp(block.timestamp + 7 days);
        _closeSingle(alice, 10e18, 20e6);
        vm.prank(owner); dist.pause();
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(); // EnforcedPause
        dist.claim(VAULT, 1, 10e18, 20e6, proof);
    }

    // ── sweep ─────────────────────────────────────────────────────────────────

    function test_Sweep_ReturnsUnclaimedToFunder() public {
        vm.warp(block.timestamp + 7 days);
        // Allocate less than the pot; alice claims her part, surplus + her-unclaimed swept.
        _closeSingle(alice, 10e18, 20e6);
        // funder is this contract; record balances before sweep.
        uint256 before0 = token0.balanceOf(address(this));
        vm.warp(block.timestamp + 90 days + 1);
        dist.sweep(VAULT, 1);
        // pot0 was 1_000e18, nothing claimed → all 1_000e18 returned to funder.
        assertEq(token0.balanceOf(address(this)), before0 + 1_000e18);
        assertEq(token1.balanceOf(address(this)) >= 1_000e6, true);
    }

    function test_Sweep_RevertBeforeExpiry() public {
        vm.warp(block.timestamp + 7 days);
        _closeSingle(alice, 10e18, 20e6);
        vm.expectRevert(MintwareWeightedDistributor.EpochNotExpired.selector);
        dist.sweep(VAULT, 1);
    }

    function test_Sweep_RevertDoubleSweep() public {
        vm.warp(block.timestamp + 7 days);
        _closeSingle(alice, 10e18, 20e6);
        vm.warp(block.timestamp + 90 days + 1);
        dist.sweep(VAULT, 1);
        vm.expectRevert(MintwareWeightedDistributor.AlreadySwept.selector);
        dist.sweep(VAULT, 1);
    }

    // ── oracle rotation (C7) ────────────────────────────────────────────────

    function test_Rotation_TimelockFlow() public {
        address newSigner = vm.addr(0xC0FFEE);
        vm.prank(owner); dist.proposeOracleSigner(newSigner);
        assertEq(dist.pendingOracleSigner(), newSigner);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner); dist.confirmOracleSigner();
        assertEq(dist.oracleSigner(), newSigner);
        assertEq(dist.pendingOracleSigner(), address(0));
    }

    function test_Rotation_RevertConfirmEarly() public {
        vm.prank(owner); dist.proposeOracleSigner(vm.addr(0xC0FFEE));
        vm.prank(owner);
        vm.expectRevert(MWTimelockedOracleSigner.RotationDelayNotElapsed.selector);
        dist.confirmOracleSigner();
    }

    function test_Rotation_Cancel() public {
        vm.prank(owner); dist.proposeOracleSigner(vm.addr(0xC0FFEE));
        vm.prank(owner); dist.cancelOracleRotation();
        assertEq(dist.pendingOracleSigner(), address(0));
    }

    function test_Rotation_RevertNotOwner() public {
        vm.expectRevert();
        dist.proposeOracleSigner(vm.addr(0xC0FFEE));
    }

    /// After rotation, the NEW key signs valid closes and the OLD key is rejected.
    function test_Rotation_NewSignerClosesOldRejected() public {
        uint256 newPk = 0xC0FFEE;
        address newSigner = vm.addr(newPk);
        vm.prank(owner); dist.proposeOracleSigner(newSigner);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(owner); dist.confirmOracleSigner();

        vm.warp(block.timestamp + 7 days);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 root = _leaf(alice, 1e18, 1e6);
        // Old key now invalid.
        bytes memory oldSig = _sign(ORACLE_PK, dist.getEpochRootDigest(VAULT, 1, root, 1e18, 1e6, dl));
        vm.expectRevert(MintwareWeightedDistributor.InvalidOracleSignature.selector);
        dist.closeEpoch(VAULT, root, 1e18, 1e6, oldSig, dl);
        // New key valid.
        bytes memory newSig = _sign(newPk, dist.getEpochRootDigest(VAULT, 1, root, 1e18, 1e6, dl));
        dist.closeEpoch(VAULT, root, 1e18, 1e6, newSig, dl);
        assertTrue(dist.getEpoch(VAULT, 1).closed);
    }

    // ── guardian (C4) ─────────────────────────────────────────────────────────

    function test_Guardian_GuardianPausesOwnerUnpauses() public {
        vm.prank(guardian); dist.pause();
        assertTrue(dist.paused());
        vm.prank(owner); dist.unpause();
        assertFalse(dist.paused());
    }

    function test_Guardian_RevertNonGuardianPause() public {
        vm.prank(alice);
        vm.expectRevert(MWGuardianPausable.NotGuardianOrOwner.selector);
        dist.pause();
    }

    function test_Guardian_RevertGuardianUnpause() public {
        vm.prank(guardian); dist.pause();
        vm.prank(guardian);
        vm.expectRevert(); // only owner unpauses
        dist.unpause();
    }
}
