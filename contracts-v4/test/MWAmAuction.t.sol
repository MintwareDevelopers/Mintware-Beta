// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {MWAmAuction, IAmAmmRentSink} from "../src/hooks/MWAmAuction.sol";
import {AmParams} from "../src/hooks/MWAmAuctionLib.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Minimal LP that pulls rent (stands in for MintwareDeFiPairVault.fundRent).
contract MockRentSink is IAmAmmRentSink {
    mapping(address => uint256) public received;
    function fundRent(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        received[token] += amount;
    }
}

/// @notice Integration tests for the stateful am-AMM auction, driven as the hook
///         (coordinator) would drive it: escrow, rent → LP, promotion after the
///         K-block notice, eviction on depletion, refunds, and access control.
contract MWAmAuctionTest is Test {
    MWAmAuction   internal auction;
    MockRentSink  internal sink;
    MockERC20     internal bidToken;

    address internal owner = makeAddr("owner");
    address internal coord = makeAddr("coordinator");
    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    PoolId internal id = PoolId.wrap(keccak256("pool-1"));

    // params: K=10 blocks, minRent=100, 1.1x, cap 0.30%, default 0.05%
    function _params() internal view returns (AmParams memory) {
        return AmParams({
            enabled: true, bidToken: address(bidToken), feeMaxPips: 3000,
            defaultFeePips: 500, minRent: 100, K: 10, minBidMultBps: 11_000, withdrawFeeBps: 2
        });
    }

    function setUp() public {
        bidToken = new MockERC20("Bid", "BID", 18);
        sink      = new MockRentSink();

        vm.startPrank(owner);
        auction = new MWAmAuction(owner);
        auction.setCoordinator(coord);
        auction.configurePool(id, address(sink), _params());
        vm.stopPrank();

        bidToken.mint(alice, 1_000_000);
        bidToken.mint(bob,   1_000_000);
        vm.roll(100);
    }

    function _bid(address who, uint128 rent, uint128 deposit, uint24 fee) internal {
        vm.startPrank(who);
        bidToken.approve(address(auction), deposit);
        auction.bid(id, fee, rent, deposit);
        vm.stopPrank();
    }

    function _poke() internal returns (address m, uint24 f) {
        vm.prank(coord);
        return auction.poke(id);
    }

    // ── bidding + escrow ───────────────────────────────────────────────────────

    function test_bid_escrows_and_sets_next() public {
        _bid(alice, 100, 1000, 1200);
        (address m,,,, uint128 dep) = _nextBid();
        assertEq(m, alice, "alice is challenger");
        assertEq(dep, 1000, "deposit escrowed");
        assertEq(bidToken.balanceOf(address(auction)), 1000, "auction holds escrow");
    }

    function test_bid_below_reserve_reverts() public {
        vm.startPrank(alice);
        bidToken.approve(address(auction), 1000);
        vm.expectRevert(MWAmAuction.InvalidBid.selector);
        auction.bid(id, 1200, 100, 900); // 900 < 100*10
        vm.stopPrank();
    }

    function test_bid_fee_over_cap_reverts() public {
        vm.startPrank(alice);
        bidToken.approve(address(auction), 1000);
        vm.expectRevert(MWAmAuction.InvalidBid.selector);
        auction.bid(id, 3001, 100, 1000);
        vm.stopPrank();
    }

    function test_outbid_refunds_displaced_via_ledger() public {
        _bid(alice, 100, 1000, 1200);
        // bob out-bids: rent 111 > 110, deposit 1110 = 111*10
        _bid(bob, 111, 1110, 1200);

        (address m,,,,) = _nextBid();
        assertEq(m, bob, "bob is now challenger");
        assertEq(auction.owed(alice, address(bidToken)), 1000, "alice refunded to ledger");

        uint256 before = bidToken.balanceOf(alice);
        vm.prank(alice);
        auction.claim(address(bidToken));
        assertEq(bidToken.balanceOf(alice) - before, 1000, "alice claimed refund");
    }

    function test_weak_outbid_reverts() public {
        _bid(alice, 100, 1000, 1200);
        vm.startPrank(bob);
        bidToken.approve(address(auction), 1100);
        vm.expectRevert(MWAmAuction.InvalidBid.selector);
        auction.bid(id, 1200, 110, 1100); // 110 == 1.1x, not strictly greater
        vm.stopPrank();
    }

    // ── promotion after K-block notice ─────────────────────────────────────────

    function test_no_manager_returns_default_fee() public {
        (address m, uint24 f) = _poke();
        assertEq(m, address(0), "no manager yet");
        assertEq(f, 500, "default fee");
    }

    function test_promotion_requires_notice() public {
        _bid(alice, 100, 1000, 1200);        // placed @ block 100
        vm.roll(105);
        (address m,) = _poke();
        assertEq(m, address(0), "not promoted before K");

        vm.roll(110);                         // 100 + K
        (address m2, uint24 f2) = _poke();
        assertEq(m2, alice, "promoted after K");
        assertEq(f2, 1200, "manager fee applies");
    }

    // ── rent flows to the LP ────────────────────────────────────────────────────

    function test_rent_charged_and_pushed_to_lp() public {
        _bid(alice, 100, 1000, 1200);
        vm.roll(110); _poke();               // promote; lastCharged = 110
        vm.roll(115); _poke();               // 5 blocks * 100 = 500 rent

        assertEq(sink.received(address(bidToken)), 500, "rent pushed to LP");
        (,,,, uint128 dep) = _topBid();
        assertEq(dep, 500, "deposit drained by rent");
    }

    function test_eviction_on_depletion_falls_back_to_default() public {
        _bid(alice, 100, 1000, 1200);
        vm.roll(110); _poke();               // promote
        vm.roll(120);                        // 10 blocks * 100 = 1000 == deposit
        (address m, uint24 f) = _poke();
        assertEq(m, address(0), "evicted");
        assertEq(f, 500, "back to default fee");
        assertEq(sink.received(address(bidToken)), 1000, "all deposit became LP rent");
    }

    // ── withdraw + reserve ──────────────────────────────────────────────────────

    function test_top_bid_cannot_withdraw_below_reserve() public {
        _bid(alice, 100, 2000, 1200);
        vm.roll(110); _poke();               // alice promoted, deposit 2000
        vm.prank(alice);
        vm.expectRevert(MWAmAuction.ReserveBreach.selector);
        auction.withdrawFromBid(id, 1100);   // would leave 900 < 1000 reserve
    }

    function test_top_bid_withdraw_within_reserve_ok() public {
        _bid(alice, 100, 2000, 1200);
        vm.roll(110); _poke();
        uint256 before = bidToken.balanceOf(alice);
        vm.prank(alice);
        auction.withdrawFromBid(id, 1000);   // leaves 1000 == reserve
        assertEq(bidToken.balanceOf(alice) - before, 1000, "withdrew to reserve floor");
    }

    function test_challenger_can_cancel_fully() public {
        _bid(alice, 100, 1000, 1200);        // challenger, not yet manager
        uint256 before = bidToken.balanceOf(alice);
        vm.prank(alice);
        auction.withdrawFromBid(id, 1000);   // full exit allowed for challenger
        assertEq(bidToken.balanceOf(alice) - before, 1000);
        (address m,,,,) = _nextBid();
        assertEq(m, address(0), "challenger slot cleared");
    }

    // ── manager fees ────────────────────────────────────────────────────────────

    function test_recordManagerFee_credits_current_manager() public {
        _bid(alice, 100, 1000, 1200);
        vm.roll(110); _poke();               // alice is manager
        // simulate the hook: push fee tokens in, then record
        bidToken.mint(address(auction), 777);
        vm.prank(coord);
        auction.recordManagerFee(id, address(bidToken), 777);
        assertEq(auction.owed(alice, address(bidToken)), 777, "credited to manager");
    }

    function test_recordManagerFee_no_manager_reverts() public {
        bidToken.mint(address(auction), 100);
        vm.prank(coord);
        vm.expectRevert(MWAmAuction.NoManager.selector);
        auction.recordManagerFee(id, address(bidToken), 100); // nobody to credit
    }

    // ── access control ──────────────────────────────────────────────────────────

    function test_poke_only_coordinator() public {
        vm.expectRevert(MWAmAuction.OnlyCoordinator.selector);
        auction.poke(id);
    }

    function test_recordManagerFee_only_coordinator() public {
        vm.expectRevert(MWAmAuction.OnlyCoordinator.selector);
        auction.recordManagerFee(id, address(bidToken), 1);
    }

    function test_configurePool_only_owner() public {
        vm.expectRevert();
        auction.configurePool(id, address(sink), _params());
    }

    function test_coordinator_set_once() public {
        vm.prank(owner);
        vm.expectRevert(MWAmAuction.CoordinatorAlreadySet.selector);
        auction.setCoordinator(bob);
    }

    // ── helpers to read packed bids ─────────────────────────────────────────────

    function _topBid() internal view returns (address, uint40, uint24, uint128, uint128) {
        return auction.topBid(id);
    }
    function _nextBid() internal view returns (address, uint40, uint24, uint128, uint128) {
        return auction.nextBid(id);
    }
}
