// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}             from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}            from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                  from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}                 from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}                from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams}   from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}                from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareTreasuryVault}         from "../../src/payments/MintwareTreasuryVault.sol";
import {MintwareMatchedLiquidityVault} from "../../src/vaults/MintwareMatchedLiquidityVault.sol";
import {PoolProfile}                   from "../../src/vaults/VaultTypes.sol";

import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @title  LEGAL FACT 2 — the waterfall is immutable, with no admin override
/// @notice Guard-tests that lock down the second legal fact for the treasury tranche vault:
///
///           Senior (community) is paid FIRST, at par, automatically, by code. The seniority of
///           the payout and the fee-split proportions are hard-constants; there is NO owner-settable
///           payout / waterfall / par ratio anywhere. Every `set*` on the vault is either a risk
///           parameter (bounded + 48h-timelocked when loosened) or a plumbing address — none can
///           change who gets paid first or how much of the pot each tranche receives.
///
///         Additive verification only; changes no mechanics. A failure here is a real finding.
contract WaterfallImmutableTreasuryTest is Test {
    MockERC20 internal usdc;
    MockERC20 internal team;

    PoolManager             internal pm;
    TestSwapRouter          internal sr;
    PoolModifyLiquidityTest internal lr;
    MockYieldAdapter        internal adapter;
    MintwareTreasuryVault   internal v;
    PoolKey                 internal key;
    bool                    internal teamIs0;

    address internal owner    = makeAddr("owner");
    address internal teamAddr  = makeAddr("team");
    address internal gateway   = makeAddr("gateway");
    address internal protocol  = makeAddr("protocol");
    address internal senior    = makeAddr("seniorUser");
    address internal trader    = makeAddr("trader");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    int24   internal constant SPACING     = 60;
    uint256 internal constant ONE_USDC    = 1e6;
    uint256 internal constant LOCK_DUR    = 365 days;
    uint256 internal constant TEAM_COMMIT = 5_000_000 * 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        team = new MockERC20("Team Token", "TEAM", 6);

        pm = new PoolManager(address(this));
        sr = new TestSwapRouter(IPoolManager(address(pm)));
        lr = new PoolModifyLiquidityTest(IPoolManager(address(pm)));

        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        teamIs0 = address(team) < address(usdc);
        pm.initialize(key, INIT_SQRT_PRICE);

        adapter = new MockYieldAdapter(address(usdc));
        v = new MintwareTreasuryVault(address(pm), key, address(usdc), address(adapter), owner, teamAddr);

        vm.startPrank(owner);
        v.setGateway(gateway);
        v.setProtocolTreasury(protocol);
        vm.stopPrank();

        team.mint(teamAddr, TEAM_COMMIT);
        vm.startPrank(teamAddr);
        team.approve(address(v), type(uint256).max);
        v.commitTeam(TEAM_COMMIT, 0, LOCK_DUR);
        vm.stopPrank();

        // Baseline external depth so the vault's seniority swaps land at realistic prices.
        usdc.mint(address(this), 50_000_000 * ONE_USDC);
        team.mint(address(this), 50_000_000 * ONE_USDC);
        usdc.approve(address(lr), type(uint256).max);
        team.approve(address(lr), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lr.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 2_000_000 * int256(ONE_USDC), salt: bytes32(0)}),
            ""
        );

        // One senior (community) depositor.
        usdc.mint(senior, 100_000 * ONE_USDC);
        vm.startPrank(senior);
        usdc.approve(address(v), type(uint256).max);
        v.depositUSDC(100_000 * ONE_USDC, 0, senior);
        vm.stopPrank();
    }

    function _dumpTeam(uint256 teamIn) internal {
        team.mint(trader, teamIn);
        vm.startPrank(trader);
        team.approve(address(sr), type(uint256).max);
        sr.swap(key, teamIs0, teamIn);
        vm.stopPrank();
    }

    // ── the fee split is a hard constant, not a setting ──────────────────────────────

    /// FACT 2 — the community / team / protocol fee split is `constant` (60/30/10) and sums to 100%.
    /// Being `constant`, it is fixed at compile time — there is no storage slot and no setter to move it.
    function test_fee_split_is_a_hard_constant() public view {
        assertEq(v.FEE_COMMUNITY_BPS(), 6_000, "community cut must be a constant 60%");
        assertEq(v.FEE_TEAM_BPS(),      3_000, "team cut must be a constant 30%");
        assertEq(v.FEE_PROTOCOL_BPS(),  1_000, "protocol cut must be a constant 10%");
        assertEq(
            uint256(v.FEE_COMMUNITY_BPS()) + v.FEE_TEAM_BPS() + v.FEE_PROTOCOL_BPS(),
            v.BPS(),
            "fee split must sum to 100%"
        );
    }

    // ── no owner setter can touch the payout / waterfall ─────────────────────────────

    /// FACT 2 — there is NO owner-settable payout ratio. Driving EVERY owner setter (both the risk
    /// parameters and the plumbing addresses) leaves the fee constants and the senior par payout entirely
    /// unchanged: a senior holder still redeems 1:1. Nothing an admin can call moves who is paid or how much.
    function test_no_owner_setter_changes_the_payout() public {
        uint256 cBps = v.FEE_COMMUNITY_BPS();
        uint256 tBps = v.FEE_TEAM_BPS();
        uint256 pBps = v.FEE_PROTOCOL_BPS();

        vm.startPrank(owner);
        // Plumbing addresses.
        v.setProtocolTreasury(makeAddr("proto2"));
        v.setRentFunder(makeAddr("rent"));
        v.setJitHook(makeAddr("jit"));            // set-once
        // Risk parameters — none is a payout ratio. Tightening ones apply instantly.
        v.setIdleBufferTarget(9_000);             // raise (safer)  → instant
        v.setMinCoverage(200);                    // raise from 0   → instant
        v.setJitCap(100);                         // lower (safer)  → instant
        v.setMaxBurnPerBlock(1_000_000 * ONE_USDC);
        v.setJitMaxCumulativeLoss(1_000_000 * ONE_USDC);
        vm.stopPrank();

        // Fee split constants are untouched (they cannot be otherwise — they are constants).
        assertEq(v.FEE_COMMUNITY_BPS(), cBps, "community cut moved");
        assertEq(v.FEE_TEAM_BPS(),      tBps, "team cut moved");
        assertEq(v.FEE_PROTOCOL_BPS(),  pBps, "protocol cut moved");

        // The senior still redeems at par — no setter perturbed the waterfall.
        uint256 sh = v.seniorShares(senior);
        vm.prank(senior);
        uint256 out = v.redeemSenior(sh, 0);
        assertApproxEqAbs(out, 100_000 * ONE_USDC, 2, "senior no longer redeems at par after owner setters");
    }

    // ── seniority is code-enforced: junior first-loss is trapped until the senior is out of the LP ──

    /// FACT 2 — the first-loss (junior) release is GATED on the senior no longer being LP-exposed
    /// (`_seniorFullyCovered()` ⇒ `deployedFromSenior == 0` and no JIT loan). Post-cliff, while senior
    /// USDC is still deployed, `redeemJunior` releases NOTHING; only once the LP is unwound (senior made
    /// whole first) does the junior become releasable. Senior-before-junior is enforced by code, no admin.
    function test_first_loss_release_gated_on_senior_covered() public {
        uint256 jt = v.juniorTokens();
        vm.prank(owner);
        v.deployToLP(20_000 * ONE_USDC, jt);
        assertGt(v.deployedFromSenior(), 0, "precondition: senior LP-exposed");

        vm.warp(block.timestamp + LOCK_DUR + 1);

        // Senior still in the LP → junior first-loss is HELD BACK, even post-cliff.
        uint256 tokBefore     = v.juniorTokens();
        uint256 teamTokBefore = team.balanceOf(teamAddr);
        vm.prank(teamAddr);
        v.redeemJunior();
        assertEq(v.juniorTokens(), tokBefore, "junior first-loss released while senior still LP-exposed");
        assertEq(team.balanceOf(teamAddr), teamTokBefore, "team pulled first-loss before senior was covered");

        // Owner unwinds → senior made whole first (deployedFromSenior == 0) → junior now releasable.
        vm.prank(owner);
        v.recoverFromLP(100_000 * ONE_USDC);
        assertEq(v.deployedFromSenior(), 0, "LP not fully unwound");
        vm.prank(teamAddr);
        v.redeemJunior();
        assertGt(team.balanceOf(teamAddr), teamTokBefore, "junior not releasable after senior covered");
    }

    /// FACT 2 — community paid first, automatically, at par; the junior absorbs the loss. On a fresh stack
    /// with a junior USDC first-loss buffer, after IL leaves Aave + the LP unwind short of full par, the
    /// senior is STILL made whole at par and the JUNIOR buffer absorbs the shortfall. The waterfall runs in
    /// code on redemption — senior before junior — with no admin action. (Mirrors the proven buffered-
    /// absorption scenario; here it is the legal senior-first proof.)
    function test_community_paid_first_at_par_junior_absorbs_loss() public {
        // Fresh isolated stack WITH a 30k junior USDC first-loss buffer.
        PoolManager pm2 = new PoolManager(address(this));
        TestSwapRouter sr2 = new TestSwapRouter(IPoolManager(address(pm2)));
        PoolModifyLiquidityTest lr2 = new PoolModifyLiquidityTest(IPoolManager(address(pm2)));
        (Currency c0, Currency c1) = address(usdc) < address(team)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(team)))
            : (Currency.wrap(address(team)), Currency.wrap(address(usdc)));
        PoolKey memory key2 = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        bool teamIs0_2 = address(team) < address(usdc);
        pm2.initialize(key2, INIT_SQRT_PRICE);

        MockYieldAdapter adapter2 = new MockYieldAdapter(address(usdc));
        MintwareTreasuryVault v2 =
            new MintwareTreasuryVault(address(pm2), key2, address(usdc), address(adapter2), owner, teamAddr);
        vm.startPrank(owner);
        v2.setGateway(gateway);
        v2.setProtocolTreasury(protocol);
        vm.stopPrank();

        uint256 buffer = 30_000 * ONE_USDC;
        team.mint(teamAddr, TEAM_COMMIT);
        usdc.mint(teamAddr, buffer);
        vm.startPrank(teamAddr);
        team.approve(address(v2), type(uint256).max);
        usdc.approve(address(v2), type(uint256).max);
        v2.commitTeam(TEAM_COMMIT, buffer, LOCK_DUR);
        vm.stopPrank();

        // Baseline external depth.
        usdc.mint(address(this), 50_000_000 * ONE_USDC);
        team.mint(address(this), 50_000_000 * ONE_USDC);
        usdc.approve(address(lr2), type(uint256).max);
        team.approve(address(lr2), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lr2.modifyLiquidity(
            key2,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 2_000_000 * int256(ONE_USDC), salt: bytes32(0)}),
            ""
        );

        // Senior (community) deposit.
        address u = makeAddr("communityUser");
        usdc.mint(u, 100_000 * ONE_USDC);
        vm.startPrank(u);
        usdc.approve(address(v2), type(uint256).max);
        v2.depositUSDC(100_000 * ONE_USDC, 0, u);
        vm.stopPrank();

        // Lower the idle target (risk-increasing → 48h timelock) so more senior can deploy.
        vm.startPrank(owner);
        v2.setIdleBufferTarget(5_000);
        vm.warp(vm.getBlockTimestamp() + v2.RISK_PARAM_DELAY() + 1);
        v2.confirmRiskParam(v2.RP_IDLE_BUFFER_TARGET());
        vm.stopPrank();

        uint256 jt = v2.juniorTokens();
        vm.prank(owner);
        v2.deployToLP(50_000 * ONE_USDC, jt);

        // Crash the team mark to ~10% of par (IL exceeds Aave + LP unwind → buffer must top up).
        uint256 sq = teamIs0_2
            ? (uint256(INIT_SQRT_PRICE) * 316_227_766) / 1e9
            : (uint256(INIT_SQRT_PRICE) * 1e9) / 316_227_766;
        team.mint(trader, 100_000_000 * ONE_USDC);
        vm.startPrank(trader);
        team.approve(address(sr2), type(uint256).max);
        sr2.swapTo(key2, teamIs0_2, 100_000_000 * ONE_USDC, uint160(sq));
        vm.stopPrank();

        // Community redeems FULL par (paid first); the junior USDC buffer absorbs the shortfall.
        uint256 bufBefore = v2.juniorUsdcBuffer();
        uint256 sh = v2.seniorShares(u);
        vm.prank(u);
        uint256 out = v2.redeemSenior(sh, 0);

        assertApproxEqAbs(out, 100_000 * ONE_USDC, 5, "senior not made whole at par (community-first broken)");
        assertLt(v2.juniorUsdcBuffer(), bufBefore, "junior buffer did not absorb the loss (junior-first broken)");
    }
}

/// @notice FACT 2 for the matched-liquidity vault: the Mintware protocol cut is a `constant`, and the
///         50/50 team/community liquidity split + team-excluded-while-locked denominator are code-enforced
///         at activation — there is no owner setter for any of these proportions.
contract WaterfallImmutableMatchedTest is Test {
    MintwareMatchedLiquidityVault internal vault;
    MockERC20 internal proj;
    MockERC20 internal quote;

    function setUp() public {
        PoolManager pm = new PoolManager(address(this));
        proj  = new MockERC20("Project", "PEPE", 18);
        quote = new MockERC20("Quote", "USDC", 18);
        vault = new MintwareMatchedLiquidityVault(
            address(pm), address(proj), address(quote), makeAddr("team"), makeAddr("treasury"),
            address(0), PoolProfile.MEME, address(this)
        );
    }

    /// FACT 2 — the Mintware protocol fee is a hard `constant`, not an owner setting.
    function test_mintware_fee_is_a_hard_constant() public view {
        assertEq(vault.MINTWARE_FEE_BPS(), 2_500, "Mintware fee must be a constant 25% of swap fees");
        assertEq(vault.BPS(), 10_000, "BPS constant");
    }
}
