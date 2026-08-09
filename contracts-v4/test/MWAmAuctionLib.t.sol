// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MWAmAuctionLib, Bid, AmParams} from "../src/hooks/MWAmAuctionLib.sol";

/// @notice Boundary tests for the am-AMM state-machine core. This library is the
///         money-correctness heart of the auction, so every branch is pinned:
///         rent accrual + depletion, the 1.1x out-bid boundary, the K-block reserve
///         and notice, bid validity, safe withdrawal, and effective-fee clamping.
contract MWAmAuctionLibTest is Test {
    function _params() internal pure returns (AmParams memory p) {
        p = AmParams({
            enabled:        true,
            bidToken:       address(0xBEEF),
            feeMaxPips:     3000,      // 0.30% cap (blue-chip)
            defaultFeePips: 500,       // 0.05% when unmanaged
            minRent:        100,
            K:              10,
            minBidMultBps:  11_000,    // 1.1x
            withdrawFeeBps: 2
        });
    }

    function _bid(address m, uint40 epoch, uint24 fee, uint128 rent, uint128 dep)
        internal pure returns (Bid memory)
    {
        return Bid({manager: m, epoch: epoch, feePips: fee, rent: rent, deposit: dep});
    }

    // ── rentOwed ─────────────────────────────────────────────────────────────

    function test_rentOwed_normal() public pure {
        Bid memory b = _bid(address(1), 0, 500, 10, 1000);
        (uint256 owed, bool depleted) = MWAmAuctionLib.rentOwed(b, 5, 0);
        assertEq(owed, 50, "5 blocks * 10 rent");
        assertFalse(depleted);
    }

    function test_rentOwed_caps_at_deposit_and_depletes() public pure {
        Bid memory b = _bid(address(1), 0, 500, 10, 30);
        (uint256 owed, bool depleted) = MWAmAuctionLib.rentOwed(b, 5, 0); // wants 50, has 30
        assertEq(owed, 30, "capped at deposit");
        assertTrue(depleted, "depleted");
    }

    function test_rentOwed_exact_deposit_boundary_depletes() public pure {
        Bid memory b = _bid(address(1), 0, 500, 10, 50);
        (uint256 owed, bool depleted) = MWAmAuctionLib.rentOwed(b, 5, 0); // wants exactly 50
        assertEq(owed, 50);
        assertTrue(depleted, "owed == deposit still depletes");
    }

    function test_rentOwed_no_manager_zero() public pure {
        Bid memory b = _bid(address(0), 0, 0, 10, 1000);
        (uint256 owed, bool depleted) = MWAmAuctionLib.rentOwed(b, 5, 0);
        assertEq(owed, 0);
        assertFalse(depleted);
    }

    function test_rentOwed_zero_elapsed() public pure {
        Bid memory b = _bid(address(1), 0, 500, 10, 1000);
        (uint256 owed,) = MWAmAuctionLib.rentOwed(b, 7, 7);
        assertEq(owed, 0, "same block, nothing owed");
    }

    // ── outbids (the 1.1x boundary) ──────────────────────────────────────────

    function test_outbids_zero_challenger_false() public pure {
        assertFalse(MWAmAuctionLib.outbids(0, 100, 11_000));
    }

    function test_outbids_empty_incumbent_true() public pure {
        assertTrue(MWAmAuctionLib.outbids(1, 0, 11_000), "any positive rent takes an empty slot");
    }

    function test_outbids_exactly_at_multiplier_is_false() public pure {
        // incumbent 100 @ 1.1x => must strictly exceed 110
        assertFalse(MWAmAuctionLib.outbids(110, 100, 11_000), "equal to 1.1x is NOT enough");
    }

    function test_outbids_one_above_multiplier_is_true() public pure {
        assertTrue(MWAmAuctionLib.outbids(111, 100, 11_000), "just over 1.1x wins");
    }

    // ── meetsReserve ─────────────────────────────────────────────────────────

    function test_meetsReserve_rent_zero_false() public pure {
        assertFalse(MWAmAuctionLib.meetsReserve(1000, 0, 10));
    }

    function test_meetsReserve_non_multiple_false() public pure {
        assertFalse(MWAmAuctionLib.meetsReserve(105, 10, 10), "deposit not a multiple of rent");
    }

    function test_meetsReserve_exact_K_true() public pure {
        assertTrue(MWAmAuctionLib.meetsReserve(100, 10, 10), "exactly K*rent, exact multiple");
    }

    function test_meetsReserve_below_K_false() public pure {
        assertFalse(MWAmAuctionLib.meetsReserve(90, 10, 10), "prepays only 9 blocks < K");
    }

    function test_meetsReserve_above_K_true() public pure {
        assertTrue(MWAmAuctionLib.meetsReserve(200, 10, 10));
    }

    // ── noticeElapsed ────────────────────────────────────────────────────────

    function test_noticeElapsed_before_false() public pure {
        assertFalse(MWAmAuctionLib.noticeElapsed(100, 109, 10));
    }

    function test_noticeElapsed_exactly_true() public pure {
        assertTrue(MWAmAuctionLib.noticeElapsed(100, 110, 10), "K blocks elapsed exactly");
    }

    function test_noticeElapsed_after_true() public pure {
        assertTrue(MWAmAuctionLib.noticeElapsed(100, 111, 10));
    }

    // ── shouldPromote ────────────────────────────────────────────────────────

    function test_shouldPromote_empty_next_false() public pure {
        AmParams memory p = _params();
        Bid memory top  = _bid(address(1), 0, 500, 100, 2000);
        Bid memory next = _bid(address(0), 0, 0, 0, 0);
        assertFalse(MWAmAuctionLib.shouldPromote(top, next, 1000, p));
    }

    function test_shouldPromote_notice_not_elapsed_false() public pure {
        AmParams memory p = _params(); // K = 10
        Bid memory top  = _bid(address(1), 0, 500, 100, 2000);
        Bid memory next = _bid(address(2), 100, 500, 200, 2000); // placed @100
        assertFalse(MWAmAuctionLib.shouldPromote(top, next, 105, p), "only 5 of 10 blocks");
    }

    function test_shouldPromote_elapsed_but_not_outbidding_false() public pure {
        AmParams memory p = _params();
        Bid memory top  = _bid(address(1), 0, 500, 100, 2000);
        Bid memory next = _bid(address(2), 100, 500, 105, 2000); // 105 < 110 (1.1x)
        assertFalse(MWAmAuctionLib.shouldPromote(top, next, 200, p), "elapsed but under 1.1x");
    }

    function test_shouldPromote_elapsed_and_outbids_true() public pure {
        AmParams memory p = _params();
        Bid memory top  = _bid(address(1), 0, 500, 100, 2000);
        Bid memory next = _bid(address(2), 100, 500, 111, 2000); // > 110
        assertTrue(MWAmAuctionLib.shouldPromote(top, next, 200, p));
    }

    function test_shouldPromote_into_empty_top_true() public pure {
        AmParams memory p = _params();
        Bid memory top  = _bid(address(0), 0, 0, 0, 0); // empty
        Bid memory next = _bid(address(2), 100, 500, 100, 2000);
        assertTrue(MWAmAuctionLib.shouldPromote(top, next, 200, p), "promote into empty slot");
    }

    // ── validBid ─────────────────────────────────────────────────────────────

    function test_validBid_disabled_false() public pure {
        AmParams memory p = _params();
        p.enabled = false;
        Bid memory none = _bid(address(0), 0, 0, 0, 0);
        assertFalse(MWAmAuctionLib.validBid(200, 2000, 1000, none, p));
    }

    function test_validBid_below_minRent_false() public pure {
        AmParams memory p = _params(); // minRent 100
        Bid memory none = _bid(address(0), 0, 0, 0, 0);
        assertFalse(MWAmAuctionLib.validBid(99, 990, 1000, none, p));
    }

    function test_validBid_fee_over_cap_false() public pure {
        AmParams memory p = _params(); // cap 3000
        Bid memory none = _bid(address(0), 0, 0, 0, 0);
        assertFalse(MWAmAuctionLib.validBid(200, 2000, 3001, none, p));
    }

    function test_validBid_bad_reserve_false() public pure {
        AmParams memory p = _params(); // K 10
        Bid memory none = _bid(address(0), 0, 0, 0, 0);
        assertFalse(MWAmAuctionLib.validBid(200, 1000, 1000, none, p), "1000 < 200*10");
    }

    function test_validBid_does_not_beat_standing_false() public pure {
        AmParams memory p = _params();
        Bid memory standing = _bid(address(9), 0, 500, 200, 2000);
        // 210 < 220 (1.1x of 200)
        assertFalse(MWAmAuctionLib.validBid(210, 2100, 1000, standing, p));
    }

    function test_validBid_no_standing_valid_true() public pure {
        AmParams memory p = _params();
        Bid memory none = _bid(address(0), 0, 0, 0, 0);
        assertTrue(MWAmAuctionLib.validBid(200, 2000, 1000, none, p));
    }

    function test_validBid_beats_standing_true() public pure {
        AmParams memory p = _params();
        Bid memory standing = _bid(address(9), 0, 500, 200, 2000);
        assertTrue(MWAmAuctionLib.validBid(221, 2210, 1000, standing, p), "221 > 220");
    }

    // ── canWithdraw ──────────────────────────────────────────────────────────

    function test_canWithdraw_over_deposit_false() public pure {
        assertFalse(MWAmAuctionLib.canWithdraw(1000, 10, 1001, 10));
    }

    function test_canWithdraw_full_exit_true() public pure {
        assertTrue(MWAmAuctionLib.canWithdraw(1000, 10, 1000, 10), "full exit allowed");
    }

    function test_canWithdraw_breaks_reserve_false() public pure {
        // remaining 90 < K*rent (100)
        assertFalse(MWAmAuctionLib.canWithdraw(1000, 10, 910, 10));
    }

    function test_canWithdraw_preserves_reserve_true() public pure {
        // remaining 200 >= 100 and multiple of 10
        assertTrue(MWAmAuctionLib.canWithdraw(1000, 10, 800, 10));
    }

    // ── effectiveFee ─────────────────────────────────────────────────────────

    function test_effectiveFee_no_manager_uses_default() public pure {
        AmParams memory p = _params();
        Bid memory top = _bid(address(0), 0, 0, 0, 0);
        assertEq(MWAmAuctionLib.effectiveFee(top, p), 500);
    }

    function test_effectiveFee_manager_uses_their_fee() public pure {
        AmParams memory p = _params();
        Bid memory top = _bid(address(1), 0, 1200, 100, 2000);
        assertEq(MWAmAuctionLib.effectiveFee(top, p), 1200);
    }

    function test_effectiveFee_clamps_to_cap() public pure {
        AmParams memory p = _params(); // cap 3000
        Bid memory top = _bid(address(1), 0, 9999, 100, 2000); // somehow over cap
        assertEq(MWAmAuctionLib.effectiveFee(top, p), 3000, "clamped to cap as defense-in-depth");
    }
}
