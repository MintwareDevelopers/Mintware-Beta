// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MintwareAttributionToken, IERC5192} from "../src/attribution/MintwareAttributionToken.sol";
import {MWTimelockedOracleSigner} from "../src/lib/MWTimelockedOracleSigner.sol";

contract MintwareAttributionTokenTest is Test {
    MintwareAttributionToken internal tok;

    uint256 internal oraclePk = 0xA11CE;
    address internal oracle;
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    function setUp() public {
        oracle = vm.addr(oraclePk);
        tok = new MintwareAttributionToken(address(this), oracle);
    }

    function _sign(uint256 pk, address wallet, uint256 total, uint256 e, uint256 n, uint256 t, uint256 deadline)
        internal view returns (bytes memory)
    {
        bytes32 digest = tok.attestationDigest(wallet, total, e, n, t, tok.nonces(wallet), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _attest(uint256 total) internal {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(oraclePk, alice, total, total / 2, total / 4, total / 4, dl);
        tok.attest(alice, total, total / 2, total / 4, total / 4, dl, sig);
    }

    function test_attest_mints_soulbound() public {
        _attest(500);
        assertEq(tok.ownerOf(1), alice, "minted to alice");
        assertEq(tok.tokenOf(alice), 1);
        assertTrue(tok.locked(1), "soulbound");

        MintwareAttributionToken.Score memory s = tok.scoreOf(alice);
        assertEq(s.total, 500);
        assertEq(s.economic, 250);
    }

    function test_soulbound_transfer_reverts() public {
        _attest(500);
        vm.prank(alice);
        vm.expectRevert(MintwareAttributionToken.Soulbound.selector);
        tok.transferFrom(alice, bob, 1);
    }

    function test_attest_updates_without_new_mint() public {
        _attest(500);
        _attest(700); // nonce advanced, same token
        assertEq(tok.tokenOf(alice), 1, "same token");
        assertEq(tok.nextTokenId(), 2, "no second mint");
        assertEq(tok.scoreOf(alice).total, 700, "score updated");
    }

    function test_attest_bad_signature_reverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(0xBEEF, alice, 500, 250, 125, 125, dl); // wrong key
        vm.expectRevert(MintwareAttributionToken.InvalidSignature.selector);
        tok.attest(alice, 500, 250, 125, 125, dl, sig);
    }

    function test_replay_reverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(oraclePk, alice, 500, 250, 125, 125, dl);
        tok.attest(alice, 500, 250, 125, 125, dl, sig); // nonce 0 -> 1
        // reuse the same signature: nonce is now 1, digest differs -> invalid
        vm.expectRevert(MintwareAttributionToken.InvalidSignature.selector);
        tok.attest(alice, 500, 250, 125, 125, dl, sig);
    }

    function test_expired_deadline_reverts() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(oraclePk, alice, 500, 250, 125, 125, dl);
        vm.warp(dl + 1);
        vm.expectRevert(MintwareAttributionToken.DeadlinePassed.selector);
        tok.attest(alice, 500, 250, 125, 125, dl, sig);
    }

    function test_verifyAttributionThreshold() public {
        _attest(500);
        assertTrue(tok.verifyAttributionThreshold(alice, 400));
        assertFalse(tok.verifyAttributionThreshold(alice, 600));
    }

    function test_supportsInterface_5192() public view {
        assertTrue(tok.supportsInterface(type(IERC5192).interfaceId), "IERC5192");
        assertTrue(tok.supportsInterface(0x80ac58cd), "ERC721");
    }

    // ── C7: timelocked oracle-signer rotation (via MWTimelockedOracleSigner) ────

    function test_setOracleSigner_is_one_time_only() public {
        // constructor already initialized it; a second instant set must revert —
        // rotation now goes through the 48h timelock, not an instant setter.
        vm.expectRevert(MWTimelockedOracleSigner.OracleSignerAlreadyInitialized.selector);
        tok.setOracleSigner(makeAddr("other"));
    }

    function test_rotation_timelock_and_cutover() public {
        uint256 newPk = 0xC0FFEE;
        address newSigner = vm.addr(newPk);
        tok.proposeOracleSigner(newSigner);

        // cannot confirm before the 48h delay
        vm.expectRevert(MWTimelockedOracleSigner.RotationDelayNotElapsed.selector);
        tok.confirmOracleSigner();

        vm.warp(block.timestamp + 48 hours);
        tok.confirmOracleSigner();
        assertEq(tok.oracleSigner(), newSigner);

        // old key rejected, new key accepted
        uint256 dl = block.timestamp + 1 hours;
        bytes memory oldSig = _sign(oraclePk, alice, 500, 250, 125, 125, dl);
        vm.expectRevert(MintwareAttributionToken.InvalidSignature.selector);
        tok.attest(alice, 500, 250, 125, 125, dl, oldSig);

        bytes memory newSig = _sign(newPk, alice, 500, 250, 125, 125, dl);
        tok.attest(alice, 500, 250, 125, 125, dl, newSig);
        assertEq(tok.scoreOf(alice).total, 500);
    }

    function test_rotation_cancel() public {
        tok.proposeOracleSigner(makeAddr("newSigner"));
        tok.cancelOracleRotation();
        assertEq(tok.pendingOracleSigner(), address(0));
    }

    function test_rotation_zero_signer_reverts() public {
        vm.expectRevert(MWTimelockedOracleSigner.ZeroOracleSigner.selector);
        tok.proposeOracleSigner(address(0));
    }

    function test_rotation_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable: caller is not the owner
        tok.proposeOracleSigner(makeAddr("x"));
    }
}
