// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

import {MWAmAuction, IAmAmmRentSink} from "../src/hooks/MWAmAuction.sol";
import {AmParams} from "../src/hooks/MWAmAuctionLib.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract InvSink is IAmAmmRentSink {
    function fundRent(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}

/// @dev Fuzz actor. Drives every state-changing path with bounded-but-adversarial
///      inputs, catching reverts so invalid actions no-op (the machine must never
///      lose funds regardless of the action sequence).
contract AmAmmHandler is Test {
    MWAmAuction public auction;
    MockERC20   public bidToken;
    address      public coord;
    PoolId       public id;
    uint32       public K;
    uint128      public minRent;
    address[3]   public actors;

    constructor(MWAmAuction _a, MockERC20 _t, address _coord, PoolId _id, uint32 _K, uint128 _minRent) {
        auction = _a; bidToken = _t; coord = _coord; id = _id; K = _K; minRent = _minRent;
        actors = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2")];
        for (uint256 i; i < 3; i++) bidToken.mint(actors[i], type(uint96).max);
    }

    function _actor(uint256 s) internal view returns (address) { return actors[s % 3]; }

    function actBid(uint256 s, uint128 rent, uint16 mult, uint24 fee) public {
        address a = _actor(s);
        rent = uint128(bound(rent, minRent, minRent * 1_000));
        uint256 blocks = bound(mult, K, K + 50);          // deposit = rent * (K..K+50)
        uint128 deposit = uint128(uint256(rent) * blocks);
        fee = uint24(bound(fee, 0, 3000));
        vm.startPrank(a);
        bidToken.approve(address(auction), deposit);
        try auction.bid(id, fee, rent, deposit) {} catch {}
        vm.stopPrank();
    }

    function actDeposit(uint256 s, uint16 mult) public {
        address a = _actor(s);
        (address tm,,,uint128 tr,) = auction.topBid(id);
        (address nm,,,uint128 nr,) = auction.nextBid(id);
        uint128 rent = a == tm ? tr : (a == nm ? nr : 0);
        if (rent == 0) return;
        uint128 amount = uint128(uint256(rent) * bound(mult, 1, 20));
        vm.startPrank(a);
        bidToken.approve(address(auction), amount);
        try auction.depositIntoBid(id, amount) {} catch {}
        vm.stopPrank();
    }

    function actWithdraw(uint256 s, uint128 amount) public {
        address a = _actor(s);
        vm.prank(a);
        try auction.withdrawFromBid(id, amount) {} catch {}
    }

    function actClaim(uint256 s) public {
        address a = _actor(s);
        vm.prank(a);
        try auction.claim(address(bidToken)) {} catch {}
    }

    function actPoke(uint16 rollBy) public {
        vm.roll(block.number + bound(rollBy, 1, 100));
        vm.prank(coord);
        try auction.poke(id) {} catch {}
    }

    // Simulate the hook crediting a captured swap fee: tokens are pushed IN, then
    // booked. The hook only skims for a MANAGED pool, so mirror that here.
    function actRecordFee(uint128 amount) public {
        (address mgr,,,,) = auction.topBid(id);
        if (mgr == address(0)) return;
        amount = uint128(bound(amount, 1, 1e18));
        bidToken.mint(address(auction), amount);
        vm.prank(coord);
        auction.recordManagerFee(id, address(bidToken), amount);
    }

    function sumOwed() external view returns (uint256 s) {
        for (uint256 i; i < 3; i++) s += auction.owed(actors[i], address(bidToken));
    }
}

/// @notice Invariants for the am-AMM custody contract. The whole point of a
///         money-critical auction is that NO sequence of bids/rent/withdrawals/
///         claims can make it insolvent, break the continuity reserve, or apply a
///         fee above the cap. Fuzzed hard across all paths.
contract MWAmAuctionInvariantTest is StdInvariant, Test {
    MWAmAuction internal auction;
    MockERC20   internal bidToken;
    InvSink     internal sink;
    AmAmmHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal coord = makeAddr("coordinator");
    PoolId  internal id = PoolId.wrap(keccak256("inv-pool"));

    uint24  constant FEE_MAX = 3000;
    uint32  constant K = 10;
    uint128 constant MIN_RENT = 100;

    function setUp() public {
        bidToken = new MockERC20("Bid", "BID", 18);
        sink     = new InvSink();
        vm.startPrank(owner);
        auction = new MWAmAuction(owner);
        auction.setCoordinator(coord);
        auction.configurePool(id, address(sink), AmParams({
            enabled: true, bidToken: address(bidToken), feeMaxPips: FEE_MAX,
            defaultFeePips: 500, minRent: MIN_RENT, K: K, minBidMultBps: 11_000, withdrawFeeBps: 2
        }));
        vm.stopPrank();

        handler = new AmAmmHandler(auction, bidToken, coord, id, K, MIN_RENT);
        targetContract(address(handler));
    }

    /// Solvency: the contract always holds exactly the escrowed bids + the unclaimed
    /// pull-ledger. Rent that left for the LP is never double-counted; fees pushed in
    /// are always claimable. If this ever breaks, funds are lost or conjured.
    function invariant_solvency() public view {
        (,,,, uint128 topDep)  = auction.topBid(id);
        (,,,, uint128 nextDep) = auction.nextBid(id);
        uint256 expected = uint256(topDep) + uint256(nextDep) + handler.sumOwed();
        assertEq(bidToken.balanceOf(address(auction)), expected, "auction solvent");
    }

    /// Continuity reserve: an active manager's deposit is always an exact multiple of
    /// its rent (so it funds a whole number of blocks and can't strand dust).
    function invariant_reserve_is_exact_multiple() public view {
        (address m,,, uint128 rent, uint128 dep) = auction.topBid(id);
        if (m != address(0)) {
            assertTrue(rent > 0, "active bid has rent");
            assertEq(dep % rent, 0, "deposit is an exact multiple of rent");
        }
    }

    /// The applied fee can never exceed the configured cap.
    function invariant_fee_never_exceeds_cap() public view {
        (, uint24 fee) = auction.currentManagerAndFee(id);
        assertLe(fee, FEE_MAX, "fee within cap");
    }
}
