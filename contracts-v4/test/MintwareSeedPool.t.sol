// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MintwareSeedPool, ISeedTarget} from "../src/MintwareSeedPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// Records what the seed pool hands off. Tokens are transferred to it before each call.
contract MockSeedTarget is ISeedTarget {
    uint256 public tokenReceived;
    uint256 public quoteReceived;
    uint160 public lastSqrt;
    bytes32 public lastPoolInit;
    uint256 public seedCalls;
    uint256 public growthCalls;

    function receiveSeed(bytes32 poolInit, address, uint256 tokenAmount, address, uint256 quoteAmount, uint160 sqrtPriceX96) external {
        tokenReceived += tokenAmount;
        quoteReceived += quoteAmount;
        lastSqrt = sqrtPriceX96;
        lastPoolInit = poolInit;
        seedCalls++;
    }

    function receiveGrowth(bytes32 poolInit, uint256 tokenAmount, uint256 quoteAmount) external {
        tokenReceived += tokenAmount;
        quoteReceived += quoteAmount;
        lastPoolInit = poolInit;
        growthCalls++;
    }
}

contract MintwareSeedPoolTest is Test {
    MintwareSeedPool pool;
    MockERC20 shib; // project token, 18dp
    MockERC20 usdc; // quote token, 6dp
    MockSeedTarget target;

    address team;
    address alice;
    address bob;

    bytes32 constant SEED = keccak256("seed-1");
    uint256 constant RESERVE = 10_000e18; // $10k SHIB
    uint256 constant TEAM_QUOTE = 4_000e6; // $4k USDC
    uint256 constant PUBLIC_TARGET = 6_000e6; // $6k USDC
    // quoteTarget = 10_000e6 ; threshold @ 50% = 5_000e6
    uint160 constant SQRT = uint160(1) << 96;
    bytes32 constant POOL_INIT = bytes32("vault-1");

    function setUp() public {
        team = makeAddr("team");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        pool = new MintwareSeedPool();
        shib = new MockERC20("Shiba", "SHIB", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        target = new MockSeedTarget();

        shib.mint(team, RESERVE);
        usdc.mint(team, TEAM_QUOTE);
        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
    }

    function _open() internal {
        vm.startPrank(team);
        shib.approve(address(pool), RESERVE);
        usdc.approve(address(pool), TEAM_QUOTE);
        pool.openSeed(
            SEED,
            MintwareSeedPool.OpenParams({
                projectToken: address(shib),
                quoteToken: address(usdc),
                target: address(target),
                tokenReserve: RESERVE,
                teamQuote: TEAM_QUOTE,
                publicQuoteTarget: PUBLIC_TARGET,
                deployThresholdBps: 5_000,
                raiseDeadline: uint64(block.timestamp + 14 days),
                sqrtPriceX96: SQRT,
                poolInit: POOL_INIT
            })
        );
        vm.stopPrank();
    }

    function _contribute(address who, uint256 amt) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), amt);
        pool.contributeQuote(SEED, amt);
        vm.stopPrank();
    }

    function _quoteRaised() internal view returns (uint256 raised) {
        (, raised, , , ) = pool.getState(SEED);
    }

    function _phase() internal view returns (MintwareSeedPool.Phase p) {
        (p, , , , ) = pool.getState(SEED);
    }

    function _deployed() internal view returns (uint256 token, uint256 quote) {
        (, , , token, quote) = pool.getState(SEED);
    }

    // ─── open ─────────────────────────────────────────────────────────────────
    function test_openSeed_escrows() public {
        _open();
        assertEq(shib.balanceOf(address(pool)), RESERVE, "reserve escrowed");
        assertEq(usdc.balanceOf(address(pool)), TEAM_QUOTE, "team quote escrowed");
        assertEq(_quoteRaised(), TEAM_QUOTE, "raised starts at team quote");
        assertEq(uint256(_phase()), uint256(MintwareSeedPool.Phase.Seeding));
        assertEq(pool.fillBps(SEED), 4_000, "40% filled by team quote");
        assertFalse(pool.thresholdMet(SEED));
    }

    function test_openSeed_duplicate_reverts() public {
        _open();
        vm.expectRevert(MintwareSeedPool.SeedExists.selector);
        pool.openSeed(
            SEED,
            MintwareSeedPool.OpenParams(address(shib), address(usdc), address(target), RESERVE, TEAM_QUOTE, PUBLIC_TARGET, 5_000, uint64(block.timestamp + 1 days), SQRT, POOL_INIT)
        );
    }

    function test_openSeed_badConfig_reverts() public {
        vm.expectRevert(MintwareSeedPool.BadConfig.selector);
        pool.openSeed(
            SEED,
            MintwareSeedPool.OpenParams(address(shib), address(shib), address(target), RESERVE, TEAM_QUOTE, PUBLIC_TARGET, 5_000, uint64(block.timestamp + 1 days), SQRT, POOL_INIT)
        );
    }

    // ─── contribute ─────────────────────────────────────────────────────────────
    function test_contribute_and_clamp() public {
        _open();
        _contribute(alice, 1_000e6); // → raised 5_000e6, threshold met
        assertEq(_quoteRaised(), 5_000e6);
        assertTrue(pool.thresholdMet(SEED));
        assertEq(pool.contributions(SEED, alice), 1_000e6);

        // bob tries to over-fill: target remaining is 5_000e6, he sends 9_000e6 → clamped
        _contribute(bob, 9_000e6);
        assertEq(_quoteRaised(), 10_000e6, "clamped at quote target");
        assertEq(pool.contributions(SEED, bob), 5_000e6, "only remaining taken");
        assertEq(usdc.balanceOf(bob), 10_000e6 - 5_000e6, "excess not pulled");

        // Fully subscribed → further contribution reverts (expectRevert must
        // immediately precede the contract call, not the approve in the helper).
        vm.startPrank(alice);
        usdc.approve(address(pool), 1e6);
        vm.expectRevert(MintwareSeedPool.Full.selector);
        pool.contributeQuote(SEED, 1e6);
        vm.stopPrank();
    }

    // ─── finalize ───────────────────────────────────────────────────────────────
    function test_finalize_belowThreshold_reverts() public {
        _open(); // raised 4_000e6 < 5_000e6 threshold
        vm.expectRevert(MintwareSeedPool.BelowThreshold.selector);
        pool.finalizeSeed(SEED);
    }

    function test_finalize_atThreshold_deploysBalanced() public {
        _open();
        _contribute(alice, 1_000e6); // raised 5_000e6 == threshold
        pool.finalizeSeed(SEED);

        assertEq(uint256(_phase()), uint256(MintwareSeedPool.Phase.Live));
        (uint256 dToken, uint256 dQuote) = _deployed();
        // matched: 5_000e6 * 10_000e18 / 10_000e6 = 5_000e18
        assertEq(dToken, 5_000e18, "half the reserve deployed");
        assertEq(dQuote, 5_000e6, "all raised quote deployed");
        assertEq(target.tokenReceived(), 5_000e18);
        assertEq(target.quoteReceived(), 5_000e6);
        assertEq(target.seedCalls(), 1);
        assertEq(target.lastSqrt(), SQRT);
        assertEq(target.lastPoolInit(), POOL_INIT);
        // remainder still escrowed
        assertEq(shib.balanceOf(address(pool)), RESERVE - 5_000e18);
    }

    // ─── proportional growth → Grown, reserve consumed exactly ───────────────────
    function test_grow_toGrown_reserveConsumedExactly() public {
        _open();
        _contribute(alice, 1_000e6); // raised 5_000e6
        pool.finalizeSeed(SEED); // Live, 5_000e18 deployed
        _contribute(bob, 5_000e6); // raised 10_000e6 (full target)

        assertEq(pool.pendingQuote(SEED), 5_000e6);
        pool.growLiquidity(SEED);

        (uint256 dToken, uint256 dQuote) = _deployed();
        assertEq(dToken, RESERVE, "reserve consumed EXACTLY at full raise");
        assertEq(dQuote, 10_000e6);
        assertEq(uint256(_phase()), uint256(MintwareSeedPool.Phase.Grown));
        assertEq(target.tokenReceived(), RESERVE);
        assertEq(target.quoteReceived(), 10_000e6);
        assertEq(target.growthCalls(), 1);
        assertEq(shib.balanceOf(address(pool)), 0, "no reserve stranded");

        vm.expectRevert(MintwareSeedPool.WrongPhase.selector);
        pool.growLiquidity(SEED);
    }

    function test_grow_nothingPending_reverts() public {
        _open();
        _contribute(alice, 1_000e6);
        pool.finalizeSeed(SEED);
        vm.expectRevert(MintwareSeedPool.NothingToDo.selector);
        pool.growLiquidity(SEED);
    }

    // ─── team close ──────────────────────────────────────────────────────────────
    function test_closeSeed_returnsUndeployedReserve() public {
        _open();
        _contribute(alice, 1_000e6);
        pool.finalizeSeed(SEED); // 5_000e18 deployed, 5_000e18 reserve left

        uint256 before = shib.balanceOf(team);
        vm.prank(team);
        pool.closeSeed(SEED);

        assertEq(uint256(_phase()), uint256(MintwareSeedPool.Phase.Grown));
        assertEq(shib.balanceOf(team), before + 5_000e18, "leftover reserve returned");
        assertEq(shib.balanceOf(address(pool)), 0);
    }

    function test_closeSeed_notTeam_reverts() public {
        _open();
        _contribute(alice, 1_000e6);
        pool.finalizeSeed(SEED);
        vm.prank(alice);
        vm.expectRevert(MintwareSeedPool.NotTeam.selector);
        pool.closeSeed(SEED);
    }

    // ─── refund path ─────────────────────────────────────────────────────────────
    function test_refund_deadlineMiss() public {
        _open();
        _contribute(alice, 500e6); // raised 4_500e6 < 5_000e6 threshold

        // before deadline: cannot refund
        vm.expectRevert(MintwareSeedPool.NotExpired.selector);
        pool.markRefunding(SEED);

        vm.warp(block.timestamp + 15 days);
        pool.markRefunding(SEED);
        assertEq(uint256(_phase()), uint256(MintwareSeedPool.Phase.Refunding));

        // alice reclaims her contribution
        uint256 aBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.claimRefund(SEED);
        assertEq(usdc.balanceOf(alice), aBefore + 500e6);

        vm.prank(alice);
        vm.expectRevert(MintwareSeedPool.AlreadyClaimed.selector);
        pool.claimRefund(SEED);

        // team reclaims reserve + pre-funded quote
        vm.prank(team);
        pool.teamReclaim(SEED);
        assertEq(shib.balanceOf(team), RESERVE, "reserve back");
        assertEq(usdc.balanceOf(team), TEAM_QUOTE, "team quote back");
        assertEq(shib.balanceOf(address(pool)), 0);
        assertEq(usdc.balanceOf(address(pool)), 0, "all quote refunded out");
    }

    function test_refund_afterThreshold_reverts() public {
        _open();
        _contribute(alice, 1_000e6); // threshold met
        vm.warp(block.timestamp + 15 days);
        vm.expectRevert(MintwareSeedPool.ThresholdMet.selector);
        pool.markRefunding(SEED);
    }
}
