// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareTreasuryVault} from "../../src/payments/MintwareTreasuryVault.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @title  MintwareTreasuryVault unit tests (self-held V4 position)
/// @notice Focused (non-fuzz) coverage of the tranche accounting after Phase-2 convergence — the vault
///         HOLDS its V4 position directly (the retired `MintwareV4LiquidityModule` is now the
///         `MWTreasuryPositionLib` delegatecall library). Price moves are REAL V4 swaps (no settable
///         mock price): senior mint-down / redeem round-trip, inflation defense, the price-free senior
///         NAV under a crash, junior first-loss absorption, the "revert-rather-than-underpay" senior
///         guard, access control, the 90-day cliff, and the locked-vs-post-lock fee routing.
///
/// @dev    Both tokens are 6dp so each pool inits cleanly at 1:1 (tick 0). Each `_spawn` builds an
///         ISOLATED stack (its own PoolManager + pool) so crash tests can move price freely without
///         touching other tests. Hookless pools → `recoverableUSDC()` uses spot (no JIT oracle) — the
///         correct conservative MTM here.
contract MintwareTreasuryVaultTest is Test {
    MockERC20 internal usdc; // 6dp senior asset (shared across stacks for a stable token ordering)
    MockERC20 internal team; // 6dp junior asset

    struct Stack {
        PoolManager             pm;
        TestSwapRouter          sr;
        PoolModifyLiquidityTest lr;
        MintwareTreasuryVault   v;
        MockYieldAdapter        a;
        PoolKey                 key;
        bool                    teamIs0;
    }

    Stack internal S; // the primary stack (alice = $100k senior)

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");
    address internal gateway   = makeAddr("gateway");
    address internal receiver  = makeAddr("cardRail");
    address internal protocol  = makeAddr("protocol");
    address internal alice     = makeAddr("alice");
    address internal trader    = makeAddr("trader");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;
    uint256 internal constant ONE_USDC   = 1e6;
    uint256 internal constant LOCK_DUR   = 365 days;
    uint256 internal constant TEAM_COMMIT = 5_000_000 * 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);

        S = _spawn(0, 2_000_000 * int256(ONE_USDC));

        // fund + deposit alice ($100k senior) on the primary stack.
        _deposit(S, alice, 100_000 * ONE_USDC);
    }

    // ── stack helpers ───────────────────────────────────────────────────────────────

    /// @dev Spin up a fully-wired, team-committed vault on its OWN pool, with `baselineLiq` full-range
    ///      baseline liquidity so the vault's seniority swaps have depth (and price is crashable).
    function _spawn(uint256 juniorUsdc, int256 baselineLiq) internal returns (Stack memory s) {
        s.pm = new PoolManager(address(this));
        s.sr = new TestSwapRouter(IPoolManager(address(s.pm)));
        s.lr = new PoolModifyLiquidityTest(IPoolManager(address(s.pm)));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        s.key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        s.teamIs0 = address(team) < address(usdc);
        s.pm.initialize(s.key, INIT_SQRT_PRICE);

        s.a = new MockYieldAdapter(address(usdc));
        s.v = new MintwareTreasuryVault(address(s.pm), s.key, address(usdc), address(s.a), owner, teamAddr);

        vm.startPrank(owner);
        s.v.setGateway(gateway);
        s.v.setProtocolTreasury(protocol);
        vm.stopPrank();

        team.mint(teamAddr, TEAM_COMMIT);
        if (juniorUsdc > 0) usdc.mint(teamAddr, juniorUsdc);
        vm.startPrank(teamAddr);
        team.approve(address(s.v), type(uint256).max);
        usdc.approve(address(s.v), type(uint256).max);
        s.v.commitTeam(TEAM_COMMIT, juniorUsdc, LOCK_DUR);
        vm.stopPrank();

        // Baseline external liquidity so the vault's team→USDC seniority swaps have realistic depth.
        if (baselineLiq > 0) {
            usdc.mint(address(this), 50_000_000 * ONE_USDC);
            team.mint(address(this), 50_000_000 * ONE_USDC);
            usdc.approve(address(s.lr), type(uint256).max);
            team.approve(address(s.lr), type(uint256).max);
            int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
            int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
            s.lr.modifyLiquidity(
                s.key,
                ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: baselineLiq, salt: bytes32(0)}),
                ""
            );
        }
    }

    function _deposit(Stack memory s, address who, uint256 amt) internal returns (uint256 shares) {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(s.v), type(uint256).max);
        shares = s.v.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    /// @dev Trader dumps `teamIn` team → the pool price of team FALLS (impermanent loss on the vault LP).
    function _dumpTeam(Stack memory s, uint256 teamIn) internal {
        team.mint(trader, teamIn);
        vm.startPrank(trader);
        team.approve(address(s.sr), type(uint256).max);
        s.sr.swap(s.key, s.teamIs0, teamIn); // selling team (team is currency0 iff teamIs0)
        vm.stopPrank();
    }

    /// @dev Crash the team mark to a CONTROLLED fraction of par: `sqrtFracE9` = sqrt(targetTeamPrice) × 1e9
    ///      (e.g. 316227766 → team price ~10%). Dumps a huge notional CLAMPED to the target pool sqrtPrice,
    ///      so the crash lands exactly at the intended mark regardless of baseline depth.
    function _crashTeamTo(Stack memory s, uint256 sqrtFracE9) internal {
        uint256 sq = s.teamIs0
            ? (uint256(INIT_SQRT_PRICE) * sqrtFracE9) / 1e9  // team=c0: spot = INIT·sqrt(tp)
            : (uint256(INIT_SQRT_PRICE) * 1e9) / sqrtFracE9; // team=c1: spot = INIT/sqrt(tp)
        team.mint(trader, 100_000_000 * ONE_USDC);
        vm.startPrank(trader);
        team.approve(address(s.sr), type(uint256).max);
        s.sr.swapTo(s.key, s.teamIs0, 100_000_000 * ONE_USDC, uint160(sq));
        vm.stopPrank();
    }

    // ── deposit mints DOWN, redeem round-trips (no more than contributed) ───────────

    function test_deposit_mints_down_and_redeem_round_trips() public {
        address bob = makeAddr("bob");
        usdc.mint(bob, 50_000 * ONE_USDC);
        vm.startPrank(bob);
        usdc.approve(address(S.v), type(uint256).max);
        uint256 minted = S.v.depositUSDC(50_000 * ONE_USDC, 0, bob);
        assertLe(minted, 50_000 * ONE_USDC, "mint minted MORE shares than assets");
        uint256 out = S.v.redeemSenior(minted, 0);
        vm.stopPrank();
        assertLe(out, 50_000 * ONE_USDC, "round-trip returned MORE than contributed");
        assertApproxEqAbs(out, 50_000 * ONE_USDC, 2, "round-trip lost more than dust");
    }

    // ── first-depositor inflation attack is resisted (symmetric virtual offset) ─────

    function test_inflation_attack_resisted() public {
        Stack memory s = _spawn(0, 0);

        address attacker = makeAddr("attacker");
        address victim   = makeAddr("victim");
        usdc.mint(attacker, 1_000_000 * ONE_USDC);
        usdc.mint(victim, 10_000 * ONE_USDC);

        vm.startPrank(attacker);
        usdc.approve(address(s.v), type(uint256).max);
        s.v.depositUSDC(1, 0, attacker);
        vm.stopPrank();
        usdc.mint(address(s.v), 15_000 * ONE_USDC); // donation lands in the free senior buffer

        vm.startPrank(victim);
        usdc.approve(address(s.v), type(uint256).max);
        uint256 minted = s.v.depositUSDC(10_000 * ONE_USDC, 0, victim);
        uint256 out = s.v.redeemSenior(minted, 0);
        vm.stopPrank();

        assertGt(minted, 0, "victim minted zero shares (inflation succeeded)");
        assertGe(out, 9_500 * ONE_USDC, "victim lost more than dust to inflation");
    }

    // ── THE selling point: senior NAV ignores a pool-price crash ────────────────────

    function test_senior_price_free_under_crash() public {
        uint256 jt = S.v.juniorTokens();
        vm.prank(owner);
        S.v.deployToLP(20_000 * ONE_USDC, jt);

        uint256 aliceShares = S.v.seniorShares(alice);
        uint256 navBefore = S.v.convertToAssets(aliceShares);
        uint256 pvBefore  = S.v.previewWithdraw(1_000 * ONE_USDC);

        // Crash the ONLY price in the system with a real team dump.
        _dumpTeam(S, 600_000 * ONE_USDC);

        assertEq(S.v.convertToAssets(aliceShares), navBefore, "senior NAV moved with the pool price");
        assertEq(S.v.previewWithdraw(1_000 * ONE_USDC), pvBefore, "previewWithdraw moved with the price");
        assertEq(S.v.totalSeniorAssets(), 100_000 * ONE_USDC, "senior par not preserved at deposit value");
    }

    // ── junior is first-loss: after a crash the team recovers LESS than committed ────

    function test_junior_absorbs_il_first() public {
        uint256 committed = S.v.juniorTokens();
        vm.prank(owner);
        S.v.deployToLP(20_000 * ONE_USDC, committed);
        uint256 teamInLp = committed - S.v.juniorTokens(); // team tokens now backing the senior
        assertGt(teamInLp, 0, "test did not actually deploy junior tokens into the LP");

        // Crash the pool ~50% — impermanent loss on the paired position.
        _dumpTeam(S, 600_000 * ONE_USDC);

        // Owner unwinds the LP: the team leg is SOLD to make the senior whole (seniority). NAV is flat
        // (M4: deployedFromSenior drops by the USDC recovered), so the senior never lost par.
        uint256 navBefore = S.v.totalSeniorAssets();
        uint256 deployedBefore = S.v.deployedFromSenior();
        vm.prank(owner);
        S.v.recoverFromLP(20_000 * ONE_USDC);
        assertLt(S.v.deployedFromSenior(), deployedBefore, "LP not unwound");
        assertApproxEqRel(S.v.totalSeniorAssets(), navBefore, 0.001e18, "senior NAV moved on unwind");

        // JUNIOR eats it: post-cliff the team recovers strictly fewer tokens than it committed.
        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1);
        uint256 teamBefore = team.balanceOf(teamAddr);
        vm.prank(teamAddr);
        S.v.redeemJunior();
        uint256 tokensBack = team.balanceOf(teamAddr) - teamBefore;
        assertLt(tokensBack, committed, "junior recovered its full commit (did not absorb loss)");
    }

    // ── AUDIT H1: under impairment (junior wiped), redemptions HAIRCUT pro-rata — no first-redeemer run ──
    function test_H1_impaired_redemptions_haircut_prorata_no_run() public {
        // Fresh stack, NO junior USDC buffer — the only backstop is the team token, which we then wipe.
        Stack memory s = _spawn(0, 2_000_000 * int256(ONE_USDC));
        address bob = makeAddr("bob");
        _deposit(s, alice, 100_000 * ONE_USDC);
        _deposit(s, bob,   100_000 * ONE_USDC); // two EQUAL senior holders

        // Deploy a senior slice into the LP with junior token, then wipe the team mark to ~1% of par.
        uint256 jt = s.v.juniorTokens();
        vm.prank(owner);
        s.v.deployToLP(20_000 * ONE_USDC, jt);
        _crashTeamTo(s, 100_000_000); // sqrtFracE9 = 1e8 → team price ~1%; the LP leg's recoverable collapses

        // With no junior USDC buffer, the senior is now UNDER-COVERED: realizable < par.
        assertLt(s.v.seniorRealizableAssets(), s.v.totalSeniorAssets(), "vault should be under-covered");

        uint256 aliceShares = s.v.seniorShares(alice);
        uint256 bobShares   = s.v.seniorShares(bob);
        assertEq(aliceShares, bobShares, "precondition: equal holders");

        // The per-share value is now HAIRCUT (below par) — the key fix: a first redeemer can no longer
        // extract PAR from the liquid buffer while later holders eat the whole loss.
        assertLt(s.v.convertToAssets(aliceShares), 100_000 * ONE_USDC, "shares still valued at par when impaired");
        assertEq(s.v.convertToAssets(aliceShares), s.v.convertToAssets(bobShares), "value depends on redemption order");

        // Both holders redeem half (well within the liquid Aave buffer). The OLD behavior paid the FIRST
        // redeemer par and disadvantaged the second; now they receive the SAME pro-rata haircut.
        vm.prank(alice);
        uint256 aliceOut = s.v.redeemSenior(aliceShares / 2, 0);
        vm.prank(bob);
        uint256 bobOut = s.v.redeemSenior(bobShares / 2, 0); // MUST NOT revert

        assertGt(bobOut, 0, "second redeemer got nothing (first-redeemer run not fixed)");
        assertApproxEqRel(aliceOut, bobOut, 0.01e18, "unequal payout: first redeemer advantaged");
        assertLt(aliceOut, 50_000 * ONE_USDC, "haircut not applied: paid par on an under-covered vault");
    }

    // ── AUDIT M1: only the constructor-bound team may commit + activate (no front-run hijack) ──
    function test_commitTeam_onlyBoundTeam() public {
        Stack memory s;
        s.pm = new PoolManager(address(this));
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        s.key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        MockYieldAdapter a = new MockYieldAdapter(address(usdc));
        MintwareTreasuryVault v =
            new MintwareTreasuryVault(address(s.pm), s.key, address(usdc), address(a), owner, teamAddr);

        address stranger = makeAddr("stranger");
        team.mint(stranger, TEAM_COMMIT);
        vm.startPrank(stranger);
        team.approve(address(v), type(uint256).max);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        v.commitTeam(TEAM_COMMIT, 0, LOCK_DUR);
        vm.stopPrank();

        team.mint(teamAddr, TEAM_COMMIT);
        vm.startPrank(teamAddr);
        team.approve(address(v), type(uint256).max);
        v.commitTeam(TEAM_COMMIT, 0, LOCK_DUR);
        vm.stopPrank();
        assertTrue(v.activated(), "bound team could not activate");
        assertEq(v.team(), teamAddr, "team is not the bound address");
    }

    // ── AUDIT H3: while the senior is underwater, redeemJunior HOLDS BACK the first-loss capital ──
    function test_redeemJunior_holds_firstLoss_while_senior_underwater() public {
        uint256 buffer = 5_000 * ONE_USDC;
        Stack memory s = _spawn(buffer, 200_000 * int256(ONE_USDC));
        _deposit(s, makeAddr("h3user"), 100_000 * ONE_USDC);

        vm.prank(owner);
        s.v.setIdleBufferTarget(5_000);
        uint256 jt = s.v.juniorTokens();
        vm.prank(owner);
        s.v.deployToLP(50_000 * ONE_USDC, jt);

        // Crash HARD so recoverableUSDC() << deployedFromSenior — senior underwater, LP not yet unwound.
        _dumpTeam(s, 5_000_000 * ONE_USDC);
        assertLt(s.v.recoverableUSDC(), s.v.deployedFromSenior(), "test did not put the senior underwater");

        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1);

        uint256 bufBefore  = s.v.juniorUsdcBuffer();
        uint256 tokBefore  = s.v.juniorTokens();
        uint256 teamTokBefore = team.balanceOf(teamAddr);
        vm.prank(teamAddr);
        s.v.redeemJunior();

        assertEq(s.v.juniorUsdcBuffer(), bufBefore, "junior USDC buffer released while senior underwater");
        assertEq(s.v.juniorTokens(), tokBefore, "junior ETH released while senior underwater");
        assertEq(team.balanceOf(teamAddr), teamTokBefore, "team pulled first-loss ETH while senior underwater");
    }

    // ── the senior is NEVER settled below par: burnForPayment reverts rather than underpay ─
    function test_burnForPayment_reverts_not_underpays_when_junior_wiped() public {
        Stack memory s = _spawn(0, 200_000 * int256(ONE_USDC));
        _deposit(s, makeAddr("payUser"), 100_000 * ONE_USDC);
        address u = makeAddr("payUser");

        vm.prank(owner);
        s.v.setIdleBufferTarget(5_000);
        uint256 jt = s.v.juniorTokens();
        vm.prank(owner);
        s.v.deployToLP(50_000 * ONE_USDC, jt);
        _dumpTeam(s, 8_000_000 * ONE_USDC); // crash the pool to ~0 (junior wiped)

        // Drain the Aave adapter so the senior claim cannot be honored from any source.
        uint256 adapterBal = usdc.balanceOf(address(s.a));
        vm.prank(address(s.a));
        usdc.transfer(address(0xdead), adapterBal);

        uint256 shares = s.v.seniorShares(u);
        uint256 rcvBefore = usdc.balanceOf(receiver);
        vm.prank(gateway);
        vm.expectRevert();
        s.v.burnForPayment(u, shares, receiver);
        assertEq(usdc.balanceOf(receiver), rcvBefore, "receiver was paid despite exhausted backing");
    }

    // ── junior USDC buffer (Case B): stable first-loss coverage ─────────────────────

    function test_junior_usdc_excluded_from_senior_nav() public {
        Stack memory s = _spawn(40_000 * ONE_USDC, 0);
        address u = makeAddr("junU1");
        uint256 sh = _deposit(s, u, 100_000 * ONE_USDC);

        assertEq(s.v.juniorUsdcBuffer(), 40_000 * ONE_USDC, "buffer not held");
        assertEq(s.v.totalSeniorAssets(), 100_000 * ONE_USDC, "buffer leaked into senior NAV");

        vm.prank(u);
        uint256 out = s.v.redeemSenior(sh, 0);
        assertApproxEqAbs(out, 100_000 * ONE_USDC, 2, "senior redeemed more/less than par");
        assertEq(s.v.juniorUsdcBuffer(), 40_000 * ONE_USDC, "senior touched the junior buffer");
    }

    /// The buffer ABSORBS a senior shortfall: after IL leaves Aave + LP short, the stable buffer tops up.
    function test_junior_usdc_absorbs_senior_shortfall() public {
        Stack memory s = _spawn(30_000 * ONE_USDC, 2_000_000 * int256(ONE_USDC));
        address u = makeAddr("junU2");
        _deposit(s, u, 100_000 * ONE_USDC);

        vm.prank(owner);
        s.v.setIdleBufferTarget(5_000);
        uint256 jt = s.v.juniorTokens();
        vm.prank(owner);
        s.v.deployToLP(50_000 * ONE_USDC, jt);
        // Crash to ~10% mark: the LP's recoverable value (~$31.6k) falls BELOW the $50k deployed par, so
        // Aave ($50k) + the IL-reduced LP unwind fall short of full par and the buffer must cover the gap.
        _crashTeamTo(s, 316_227_766); // sqrt(0.10) × 1e9

        uint256 bufBefore = s.v.juniorUsdcBuffer();
        uint256 shares = s.v.seniorShares(u);

        vm.prank(u);
        uint256 out = s.v.redeemSenior(shares, 0);

        assertApproxEqAbs(out, 100_000 * ONE_USDC, 5, "senior not made whole at par");
        assertLt(s.v.juniorUsdcBuffer(), bufBefore, "buffer did not absorb the shortfall");
        assertLe(
            s.v.deployedFromSenior(),
            s.v.recoverableUSDC() + s.v.juniorUsdcBuffer() + 1_000,
            "solvency invariant broke after the draw"
        );
    }

    /// Past the WHOLE junior stack (LP + USDC buffer) the senior is STILL never underpaid — it reverts.
    function test_senior_reverts_when_buffer_also_exhausted() public {
        Stack memory s = _spawn(1_000 * ONE_USDC, 200_000 * int256(ONE_USDC));
        address u = makeAddr("junU3");
        _deposit(s, u, 100_000 * ONE_USDC);

        vm.prank(owner);
        s.v.setIdleBufferTarget(5_000);
        uint256 jt = s.v.juniorTokens();
        vm.prank(owner);
        s.v.deployToLP(50_000 * ONE_USDC, jt);
        _dumpTeam(s, 8_000_000 * ONE_USDC); // wipe the LP

        // Drain Aave so nothing but the tiny $1k buffer is left — still not enough for full par.
        uint256 adapterBal = usdc.balanceOf(address(s.a));
        vm.prank(address(s.a));
        usdc.transfer(address(0xdead), adapterBal);

        uint256 shares = s.v.seniorShares(u);
        uint256 rcvBefore = usdc.balanceOf(receiver);
        vm.prank(gateway);
        vm.expectRevert();
        s.v.burnForPayment(u, shares, receiver);
        assertEq(usdc.balanceOf(receiver), rcvBefore, "receiver paid despite exhausted junior stack");
        assertEq(s.v.juniorUsdcBuffer(), 1_000 * ONE_USDC, "buffer not restored on revert");
    }

    /// Unused buffer is returned to the team at unlock (first-loss payoff: team keeps what it didn't lose).
    function test_junior_usdc_returned_at_unlock_if_unused() public {
        Stack memory s = _spawn(25_000 * ONE_USDC, 0);
        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1);
        uint256 teamUsdcBefore = usdc.balanceOf(teamAddr);
        vm.prank(teamAddr);
        s.v.redeemJunior();
        assertEq(usdc.balanceOf(teamAddr) - teamUsdcBefore, 25_000 * ONE_USDC, "unused buffer not returned");
        assertEq(s.v.juniorUsdcBuffer(), 0, "buffer not cleared");
    }

    // ── access control ─────────────────────────────────────────────────────────────

    function test_only_gateway_burns() public {
        vm.expectRevert(MintwareTreasuryVault.OnlyGateway.selector);
        S.v.burnForPayment(alice, 1, receiver); // caller is the test, not the gateway
    }

    function test_only_team_redeems_junior() public {
        vm.warp(vm.getBlockTimestamp() + LOCK_DUR + 1);
        vm.expectRevert(MintwareTreasuryVault.OnlyTeam.selector);
        vm.prank(alice);
        S.v.redeemJunior();
    }

    function test_lock_cliff_enforced() public {
        vm.prank(teamAddr);
        vm.expectRevert(MintwareTreasuryVault.StillLocked.selector);
        S.v.redeemJunior();

        vm.warp(S.v.lockExpiry() - 1);
        vm.prank(teamAddr);
        vm.expectRevert(MintwareTreasuryVault.StillLocked.selector);
        S.v.redeemJunior();

        vm.warp(S.v.lockExpiry());
        vm.prank(teamAddr);
        S.v.redeemJunior();
    }

    // ── fee routing: 100% to senior during the lock ────────────────────────────────

    function test_fees_100pct_to_senior_during_lock() public {
        uint256 jt = S.v.juniorTokens();
        vm.prank(owner);
        S.v.deployToLP(20_000 * ONE_USDC, jt);

        _genFees(S);

        uint256 seniorBefore = S.v.totalSeniorAssets();
        assertTrue(S.v.teamFeesRedirected(), "expected fees redirected while locked");

        vm.prank(owner);
        uint256 collected = S.v.accrueFees();
        assertGt(collected, 0, "no fees collected");

        assertEq(S.v.reservedJuniorUSDC(), 0, "junior reserved cash during lock (should be 0)");
        assertEq(
            S.v.totalSeniorAssets() - seniorBefore,
            collected,
            "100% of fees did not lift the senior NAV during lock"
        );
    }

    // ── fee routing: 60/30/10 once the junior tranche is released ───────────────────

    function test_fees_split_60_30_10_post_lock() public {
        uint256 jt = S.v.juniorTokens();
        vm.prank(owner);
        S.v.deployToLP(20_000 * ONE_USDC, jt);

        // Release the junior post-cliff → flips `teamFeesRedirected` false, activating the split.
        vm.warp(S.v.lockExpiry() + 1);
        vm.prank(teamAddr);
        S.v.redeemJunior();
        assertFalse(S.v.teamFeesRedirected(), "fees still redirected after junior release");

        _genFees(S);

        uint256 seniorBefore  = S.v.totalSeniorAssets();
        uint256 protoBefore   = usdc.balanceOf(protocol);
        uint256 reservedBefore = S.v.reservedJuniorUSDC();

        vm.prank(owner);
        uint256 collected = S.v.accrueFees();
        assertGt(collected, 0, "no fees collected");

        uint256 expTeam  = (collected * 3000) / 10000;
        uint256 expProto = (collected * 1000) / 10000;
        assertEq(S.v.reservedJuniorUSDC() - reservedBefore, expTeam, "team cut != 30%");
        assertEq(usdc.balanceOf(protocol) - protoBefore, expProto, "protocol cut != 10%");
        assertEq(S.v.totalSeniorAssets() - seniorBefore, collected - expTeam - expProto, "community cut != 60%");
    }

    // ── am-AMM rent routing (Phase 3): rent is the LP-fee replacement → same tranche split as fees ──

    /// During the lock, 100% of pushed rent lifts the price-free senior NAV (no junior earmark).
    function test_fundRent_100pct_senior_during_lock() public {
        vm.prank(owner);
        S.v.setRentFunder(address(this));
        assertTrue(S.v.teamFeesRedirected(), "expected lock active");

        uint256 seniorBefore = S.v.totalSeniorAssets();
        uint256 rent = 100_000 * ONE_USDC;
        usdc.mint(address(this), rent);
        usdc.approve(address(S.v), rent);
        S.v.fundRent(address(usdc), rent);

        assertEq(S.v.reservedJuniorUSDC(), 0, "junior reserved during lock (should be 0)");
        assertEq(S.v.totalSeniorAssets() - seniorBefore, rent, "100% of rent did not lift senior NAV during lock");
    }

    /// Post-cliff, rent splits 60/30/10 senior/junior/protocol — identical to `accrueFees`.
    function test_fundRent_split_60_30_10_post_lock() public {
        vm.warp(S.v.lockExpiry() + 1);
        vm.prank(teamAddr);
        S.v.redeemJunior();
        assertFalse(S.v.teamFeesRedirected(), "fees still redirected after junior release");

        vm.prank(owner);
        S.v.setRentFunder(address(this));

        uint256 seniorBefore   = S.v.totalSeniorAssets();
        uint256 protoBefore    = usdc.balanceOf(protocol);
        uint256 reservedBefore = S.v.reservedJuniorUSDC();

        uint256 rent = 100_000 * ONE_USDC;
        usdc.mint(address(this), rent);
        usdc.approve(address(S.v), rent);
        S.v.fundRent(address(usdc), rent);

        uint256 expTeam  = (rent * 3000) / 10000;
        uint256 expProto = (rent * 1000) / 10000;
        assertEq(S.v.reservedJuniorUSDC() - reservedBefore, expTeam, "team cut != 30%");
        // Protocol cut is EARMARKED off the swap hot path (not transferred during fundRent).
        assertEq(S.v.reservedProtocolUSDC(), expProto, "protocol cut not earmarked");
        assertEq(usdc.balanceOf(protocol) - protoBefore, 0, "protocol paid on the hot path (should be earmarked)");
        assertEq(S.v.totalSeniorAssets() - seniorBefore, rent - expTeam - expProto, "community cut != 60%");
        // flushProtocol pays it out off-path.
        S.v.flushProtocol();
        assertEq(usdc.balanceOf(protocol) - protoBefore, expProto, "protocol cut != 10% after flush");
        assertEq(S.v.reservedProtocolUSDC(), 0, "protocol earmark not cleared after flush");
    }

    /// fundRent is funder-gated + USDC-only; setRentFunder is owner-gated.
    function test_fundRent_access_and_token_guards() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(); // Ownable
        S.v.setRentFunder(address(this));

        vm.prank(owner);
        S.v.setRentFunder(address(this));

        vm.prank(makeAddr("notFunder"));
        vm.expectRevert(MintwareTreasuryVault.OnlyRentFunder.selector);
        S.v.fundRent(address(usdc), 1);

        usdc.mint(address(this), 1_000 * ONE_USDC);
        usdc.approve(address(S.v), type(uint256).max);
        vm.expectRevert(MintwareTreasuryVault.RentTokenMismatch.selector);
        S.v.fundRent(address(team), 1_000 * ONE_USDC);
    }

    /// @dev Generate swap fees on the vault's position (both directions so both legs accrue fees).
    function _genFees(Stack memory s) internal {
        usdc.mint(trader, 2_000_000 * ONE_USDC);
        team.mint(trader, 2_000_000 * ONE_USDC);
        vm.startPrank(trader);
        usdc.approve(address(s.sr), type(uint256).max);
        team.approve(address(s.sr), type(uint256).max);
        s.sr.swap(s.key, !s.teamIs0, 50_000 * ONE_USDC); // buy team (usdc→team)
        s.sr.swap(s.key, s.teamIs0, 48_000 * ONE_USDC);  // sell team back (team→usdc)
        vm.stopPrank();
    }

    // ── governance bounds on the idle-buffer target ────────────────────────────────

    function test_idle_target_bounds() public {
        vm.startPrank(owner);

        vm.expectRevert(MintwareTreasuryVault.BadParam.selector);
        S.v.setIdleBufferTarget(4_999); // < MIN 5000

        vm.expectRevert(MintwareTreasuryVault.BadParam.selector);
        S.v.setIdleBufferTarget(9_501); // > MAX 9500

        S.v.setIdleBufferTarget(5_000);
        assertEq(S.v.idleBufferTargetBps(), 5_000);
        S.v.setIdleBufferTarget(9_500);
        assertEq(S.v.idleBufferTargetBps(), 9_500);
        S.v.setIdleBufferTarget(7_000);
        assertEq(S.v.idleBufferTargetBps(), 7_000);

        vm.stopPrank();
    }
}
