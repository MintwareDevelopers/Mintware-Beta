// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}        from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MintwareWeightedDistributor} from "../src/MintwareWeightedDistributor.sol";
import {MockERC20}                   from "./mocks/MockERC20.sol";

/// @notice Randomized fund/close/claim/sweep sequences against the distributor.
/// @dev    The load-bearing safety property for a reward distributor is SOLVENCY:
///         tokens can only leave via a claim (bounded by a signed root that is itself
///         bounded by the funded pot, C5) or a post-expiry sweep back to the funder.
///         So every token funded in must end up claimed, swept, or resident — never
///         over-paid. The handler drives only VALID flows; the invariants assert the
///         accounting holds regardless of order/interleaving.
contract MLDHandler is Test {
    MintwareWeightedDistributor public dist;
    MockERC20 public token0;
    MockERC20 public token1;

    uint256 internal constant ORACLE_PK = 0xA11CE;
    bytes32 public constant VAULT = keccak256("inv-vault");

    // Ghost accounting
    uint256 public gFunded0;
    uint256 public gFunded1;
    uint256 public gClaimed0;
    uint256 public gClaimed1;
    uint256 public gSwept0;
    uint256 public gSwept1;

    // Per-epoch single-leaf record so claims/sweeps can be replayed correctly.
    struct Leaf { address who; uint256 a0; uint256 a1; bool closed; bool claimed; bool swept; }
    mapping(uint256 => Leaf) public leafOf;      // epochNumber → leaf
    uint256[] public closedEpochs;

    address internal constant CLAIMANT = address(0xC1A1);

    constructor(MintwareWeightedDistributor _dist, MockERC20 _t0, MockERC20 _t1) {
        dist = _dist; token0 = _t0; token1 = _t1;
    }

    function _sign(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _leafHash(address w, uint256 a0, uint256 a1) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(w, a0, a1))));
    }

    /// Fund the currently-open epoch.
    function fund(uint256 a0, uint256 a1) public {
        a0 = bound(a0, 0, 1_000e18);
        a1 = bound(a1, 0, 1_000e18);
        if (a0 == 0 && a1 == 0) return;
        token0.mint(address(this), a0);
        token1.mint(address(this), a1);
        token0.approve(address(dist), a0);
        token1.approve(address(dist), a1);
        dist.fundFees(VAULT, a0, a1);
        gFunded0 += a0; gFunded1 += a1;
    }

    /// Close the current epoch, allocating a bounded fraction of the pot to one leaf.
    function close(uint256 frac) public {
        uint256 epochNumber = dist.currentEpoch(VAULT);
        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(VAULT, epochNumber);
        if (e.closed) return;
        // allocate frac/10000 of each pot (≤ pot ⇒ never over-allocates)
        frac = bound(frac, 0, 10_000);
        uint256 a0 = (e.pot0 * frac) / 10_000;
        uint256 a1 = (e.pot1 * frac) / 10_000;

        vm.warp(block.timestamp + 7 days + 1);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 root = _leafHash(CLAIMANT, a0, a1);
        bytes32 digest = dist.getEpochRootDigest(VAULT, epochNumber, root, a0, a1, dl);
        dist.closeEpoch(VAULT, root, a0, a1, _sign(digest), dl);

        leafOf[epochNumber] = Leaf({ who: CLAIMANT, a0: a0, a1: a1, closed: true, claimed: false, swept: false });
        closedEpochs.push(epochNumber);
    }

    /// Claim a random closed, unclaimed epoch.
    function claim(uint256 seed) public {
        uint256 n = closedEpochs.length;
        if (n == 0) return;
        uint256 ep = closedEpochs[seed % n];
        Leaf storage lf = leafOf[ep];
        if (!lf.closed || lf.claimed || lf.swept) return;
        if (lf.a0 == 0 && lf.a1 == 0) { lf.claimed = true; return; }

        bytes32[] memory proof = new bytes32[](0); // single-leaf tree
        vm.prank(lf.who);
        dist.claim(VAULT, ep, lf.a0, lf.a1, proof);
        lf.claimed = true;
        gClaimed0 += lf.a0; gClaimed1 += lf.a1;
    }

    /// Sweep a random closed, un-swept epoch after expiry.
    function sweep(uint256 seed) public {
        uint256 n = closedEpochs.length;
        if (n == 0) return;
        uint256 ep = closedEpochs[seed % n];
        Leaf storage lf = leafOf[ep];
        if (!lf.closed || lf.swept) return;

        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(VAULT, ep);
        vm.warp(e.expiry + 1);
        dist.sweep(VAULT, ep);
        lf.swept = true;
        // sweep returns pot - claimed to the funder (this handler)
        uint256 claimed0 = lf.claimed ? lf.a0 : 0;
        uint256 claimed1 = lf.claimed ? lf.a1 : 0;
        gSwept0 += e.pot0 - claimed0;
        gSwept1 += e.pot1 - claimed1;
    }
}

contract MintwareWeightedDistributorInvariant is StdInvariant, Test {
    MintwareWeightedDistributor internal dist;
    MockERC20 internal token0;
    MockERC20 internal token1;
    MLDHandler internal handler;

    address internal owner = address(0x01);

    function setUp() public {
        address oracle = vm.addr(0xA11CE);
        vm.prank(owner);
        dist = new MintwareWeightedDistributor(oracle, owner);

        token0 = new MockERC20("T0", "T0", 18);
        token1 = new MockERC20("T1", "T1", 18);

        handler = new MLDHandler(dist, token0, token1);
        // handler registers the vault (funder = handler, so sweeps return to it)
        vm.prank(address(handler));
        dist.registerVault(handler.VAULT(), address(token0), address(token1));

        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](4);
        sel[0] = MLDHandler.fund.selector;
        sel[1] = MLDHandler.close.selector;
        sel[2] = MLDHandler.claim.selector;
        sel[3] = MLDHandler.sweep.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: sel }));
    }

    /// Token conservation: everything funded is claimed, swept, or still resident.
    /// A failure here means the contract paid out more than it took in — insolvency.
    function invariant_Conservation0() public view {
        assertEq(
            handler.gFunded0(),
            handler.gClaimed0() + handler.gSwept0() + token0.balanceOf(address(dist))
        );
    }

    function invariant_Conservation1() public view {
        assertEq(
            handler.gFunded1(),
            handler.gClaimed1() + handler.gSwept1() + token1.balanceOf(address(dist))
        );
    }

    /// The distributor never holds a negative-implied balance: resident ≥ 0 is implicit,
    /// and claimed can never exceed funded.
    function invariant_ClaimsNeverExceedFunding() public view {
        assertLe(handler.gClaimed0(), handler.gFunded0());
        assertLe(handler.gClaimed1(), handler.gFunded1());
    }
}
