// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MintwareAttributionToken, IERC5192} from "../src/attribution/MintwareAttributionToken.sol";

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
}
