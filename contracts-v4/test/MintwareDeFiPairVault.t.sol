// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager}         from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary}        from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {Pausable}               from "@openzeppelin/contracts/utils/Pausable.sol";
import {MWGuardianPausable}     from "../src/lib/MWGuardianPausable.sol";
import {MintwareDeFiPairVault}  from "../src/vaults/MintwareDeFiPairVault.sol";
import {MintwareWeightedDistributor} from "../src/MintwareWeightedDistributor.sol";
import {PoolProfile, LockTier}  from "../src/vaults/VaultTypes.sol";

import {MockERC20}      from "./mocks/MockERC20.sol";
import {TestSwapRouter} from "./helpers/TestSwapRouter.sol";

/// @notice Tests for the dual-sided pair vault: balanced deposit → liquidity-unit shares,
///         async lock redeem with penalties, on-chain two-token fee accrual, rebalance, kill-switch.
contract MintwareDeFiPairVaultTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    address internal deployer = address(this); // owner + provider
    address internal treasury = makeAddr("treasury");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal trader   = makeAddr("trader");

    PoolManager    internal pm;
    TestSwapRouter internal swapRouter;
    MintwareDeFiPairVault internal vault;

    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    PoolKey   internal poolKey;

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0

    function setUp() public {
        pm         = new PoolManager(deployer);
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));

        tokenA = new MockERC20("Token A", "AAA", 18);
        tokenB = new MockERC20("Token B", "BBB", 18);
        (Currency c0, Currency c1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));
        poolKey = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});

        vault = new MintwareDeFiPairVault(
            address(pm), poolKey, PoolProfile.EMERGING, treasury, deployer, deployer
        );

        for (uint256 i; i < 3; i++) {
            address who = [alice, bob, trader][i];
            tokenA.mint(who, 10_000_000e18);
            tokenB.mint(who, 10_000_000e18);
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    function _t0() internal view returns (MockERC20) { return MockERC20(Currency.unwrap(poolKey.currency0)); }
    function _t1() internal view returns (MockERC20) { return MockERC20(Currency.unwrap(poolKey.currency1)); }

    function _init() internal { vault.initializePool(INIT_SQRT_PRICE); }

    function _deposit(address who, uint256 a0, uint256 a1, LockTier tier) internal returns (uint256 s) {
        vm.startPrank(who);
        _t0().approve(address(vault), a0);
        _t1().approve(address(vault), a1);
        s = vault.deposit(a0, a1, 0, tier);
        vm.stopPrank();
    }

    function _genFees() internal {
        vm.startPrank(trader);
        _t0().approve(address(swapRouter), type(uint256).max);
        _t1().approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(poolKey, true, 20_000e18);   // t0 -> t1
        swapRouter.swap(poolKey, false, 18_000e18);  // t1 -> t0
        vm.stopPrank();
    }

    // ── deposit ──────────────────────────────────────────────────────────────

    function test_deposit_mints_liquidity_shares_and_pulls_both_tokens() public {
        _init();
        uint256 s = _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        assertGt(s, 0, "shares minted");
        assertEq(vault.shares(alice), s, "share balance");
        assertEq(vault.totalLiquidity(), s, "total liquidity == shares");
        assertGt(vault.totalLiquidity(), 0, "liquidity deployed");
    }

    function test_deposit_refunds_unused_dust() public {
        _init();
        // Provide lopsided amounts — only the balanced portion is consumed, the rest refunded.
        uint256 a0Before = _t0().balanceOf(alice);
        uint256 a1Before = _t1().balanceOf(alice);
        _deposit(alice, 100_000e18, 50_000e18, LockTier.Flex);
        uint256 used0 = a0Before - _t0().balanceOf(alice);
        uint256 used1 = a1Before - _t1().balanceOf(alice);
        assertLe(used0, 100_000e18, "t0 within provided");
        assertLe(used1, 50_000e18, "t1 within provided");
        assertGt(used0, 0, "t0 used");
        assertGt(used1, 0, "t1 used");
    }

    function test_two_lps_get_proportional_shares() public {
        _init();
        uint256 sa = _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        uint256 sb = _deposit(bob, 50_000e18, 50_000e18, LockTier.Flex);
        assertApproxEqRel(sa, sb * 2, 0.01e18, "alice ~2x bob shares");
    }

    // ── redemption + lock ──────────────────────────────────────────────────

    function test_flex_redeem_returns_both_tokens() public {
        _init();
        uint256 s = _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);

        vm.warp(block.timestamp + 25 hours);
        vm.startPrank(alice);
        vault.requestRedeem(s);
        vm.warp(block.timestamp + 7 days + 1);
        (uint256 out0, uint256 out1) = vault.executeRedeem();
        vm.stopPrank();

        assertGt(out0, 0, "t0 returned");
        assertGt(out1, 0, "t1 returned");
        assertEq(vault.shares(alice), 0, "shares burned");
    }

    function test_early_exit_penalty_routes_to_treasury() public {
        _init();
        uint256 s = _deposit(alice, 100_000e18, 100_000e18, LockTier.Committed); // 30-day lock

        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(s);
        vm.warp(block.timestamp + 7 days + 1); // ~8 days elapsed → 20–50% band → 1%

        uint256 t0Before = _t0().balanceOf(treasury);
        uint256 t1Before = _t1().balanceOf(treasury);
        vm.prank(alice);
        vault.executeRedeem();
        assertGt(_t0().balanceOf(treasury) - t0Before, 0, "t0 penalty to treasury");
        assertGt(_t1().balanceOf(treasury) - t1Before, 0, "t1 penalty to treasury");
    }

    function test_min_hold_enforced() public {
        _init();
        uint256 s = _deposit(alice, 10_000e18, 10_000e18, LockTier.Flex);
        vm.prank(alice);
        vm.expectRevert(MintwareDeFiPairVault.MinHoldNotMet.selector);
        vault.requestRedeem(s);
    }

    function test_lock_tier_change_blocked() public {
        _init();
        _deposit(alice, 10_000e18, 10_000e18, LockTier.Core);
        vm.startPrank(alice);
        _t0().approve(address(vault), 1e18);
        _t1().approve(address(vault), 1e18);
        vm.expectRevert(MintwareDeFiPairVault.LockTierChangeNotAllowed.selector);
        vault.deposit(1e18, 1e18, 0, LockTier.Flex);
        vm.stopPrank();
    }

    // ── on-chain two-token fees ──────────────────────────────────────────────

    function test_fees_accrue_both_tokens_and_split_by_share() public {
        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        _deposit(bob, 200_000e18, 200_000e18, LockTier.Flex);

        _genFees();
        uint256 treas0Before = _t0().balanceOf(treasury);
        (uint256 f0, uint256 f1) = vault.collectFees();
        assertTrue(f0 > 0 || f1 > 0, "fees realized");
        assertGt(_t0().balanceOf(treasury) - treas0Before, 0, "mintware cut taken on t0");

        // Alice and Bob deposited equally → equal pending fees.
        (uint256 ap0, uint256 ap1) = vault.pendingFees(alice);
        (uint256 bp0, uint256 bp1) = vault.pendingFees(bob);
        assertApproxEqRel(ap0, bp0, 0.01e18, "equal t0 fee share");
        assertApproxEqRel(ap1, bp1, 0.01e18, "equal t1 fee share");
        assertTrue(ap0 > 0 || ap1 > 0, "alice has fees");

        uint256 aliceT0 = _t0().balanceOf(alice);
        vm.prank(alice);
        vault.claimFees();
        assertGe(_t0().balanceOf(alice), aliceT0, "alice claimed (t0 >= before)");
    }

    // ── slice 4: oracle-weighted fee routing ─────────────────────────────────

    function test_fees_route_to_weighted_distributor_when_wired() public {
        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);

        MintwareWeightedDistributor dist =
            new MintwareWeightedDistributor(makeAddr("oracle"), deployer);
        bytes32 vid = keccak256("defi-pair");
        dist.setAuthorizedRegistrar(address(vault), true); // front-run guard (audit MED)
        vault.setWeightedDistributor(address(dist), vid);

        _genFees();
        (uint256 f0, uint256 f1) = vault.collectFees();
        assertTrue(f0 > 0 || f1 > 0, "fees realized");

        // LP portion (fee minus the combined non-LP three-way cut) landed in the distributor's pot.
        uint256 lp0 = f0 - (f0 * vault.treasuryFeeBps()) / vault.BPS() - (f0 * vault.buybackFeeBps()) / vault.BPS();
        uint256 lp1 = f1 - (f1 * vault.treasuryFeeBps()) / vault.BPS() - (f1 * vault.buybackFeeBps()) / vault.BPS();
        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(vid, 1);
        assertEq(e.pot0, lp0, "t0 LP fees routed to distributor");
        assertEq(e.pot1, lp1, "t1 LP fees routed to distributor");

        // Accumulator untouched — LPs claim their weighted share from the distributor.
        assertEq(vault.accFee0PerShare(), 0, "accumulator not credited");
        (uint256 ap0, uint256 ap1) = vault.pendingFees(alice);
        assertEq(ap0, 0, "no pending accumulator fees");
        assertEq(ap1, 0, "no pending accumulator fees");
    }

    function test_setWeightedDistributor_is_one_time() public {
        MintwareWeightedDistributor dist =
            new MintwareWeightedDistributor(makeAddr("oracle"), deployer);
        dist.setAuthorizedRegistrar(address(vault), true); // front-run guard (audit MED)
        vault.setWeightedDistributor(address(dist), keccak256("v"));
        vm.expectRevert(MintwareDeFiPairVault.WeightedDistributorAlreadySet.selector);
        vault.setWeightedDistributor(address(dist), keccak256("v2"));
    }

    function test_setWeightedDistributor_only_owner() public {
        MintwareWeightedDistributor dist =
            new MintwareWeightedDistributor(makeAddr("oracle"), deployer);
        vm.prank(alice);
        vm.expectRevert(); // Ownable: caller is not the owner
        vault.setWeightedDistributor(address(dist), keccak256("v"));
    }

    // ── ULV increment 3: configurable three-way value-capture split ──────────

    function test_default_split_is_60_30_10() public view {
        assertEq(vault.treasuryFeeBps(), 3_000, "default treasury 30%");
        assertEq(vault.buybackFeeBps(),  1_000, "default buyback 10%");
        assertEq(vault.MAX_NON_LP_FEE_BPS(), 4_000, "max non-LP 40%");
        assertEq(vault.buybackSink(), address(0), "buyback sink unset by default");
    }

    // (a) known fee splits exactly 60/30/10 and cuts + lp == fee (conservation), both tokens.
    function test_realizeFees_splits_60_30_10_and_conserves() public {
        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        _genFees();

        uint256 tre0Before = _t0().balanceOf(treasury);
        uint256 tre1Before = _t1().balanceOf(treasury);
        uint256 res0Before = vault.feeReserve0();
        uint256 res1Before = vault.feeReserve1();

        (uint256 f0, uint256 f1) = vault.collectFees();
        assertTrue(f0 > 0 && f1 > 0, "both tokens earned fees");

        // No sink wired → treasury receives treasury+buyback (40%), LP takes the remainder (60%).
        uint256 tre0 = (f0 * 3_000) / 10_000;
        uint256 buy0 = (f0 * 1_000) / 10_000;
        uint256 lp0  = f0 - tre0 - buy0;
        uint256 tre1 = (f1 * 3_000) / 10_000;
        uint256 buy1 = (f1 * 1_000) / 10_000;
        uint256 lp1  = f1 - tre1 - buy1;

        // conservation: every wei of realized fee is accounted for (both tokens).
        assertEq(tre0 + buy0 + lp0, f0, "t0 conservation");
        assertEq(tre1 + buy1 + lp1, f1, "t1 conservation");

        // routing: treasury got exactly 40% (folded); LP reserve got exactly the 60% remainder.
        assertEq(_t0().balanceOf(treasury) - tre0Before, tre0 + buy0, "t0 treasury 40%");
        assertEq(_t1().balanceOf(treasury) - tre1Before, tre1 + buy1, "t1 treasury 40%");
        assertEq(vault.feeReserve0() - res0Before, lp0, "t0 LP reserve 60%");
        assertEq(vault.feeReserve1() - res1Before, lp1, "t1 LP reserve 60%");
    }

    // (b) buybackSink set → the buyback portion lands there (treasury gets only its 30%).
    function test_buyback_cut_lands_at_sink_when_set() public {
        address sink = makeAddr("buybackSink");
        vault.setBuybackSink(sink);

        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        _genFees();

        uint256 tre0Before  = _t0().balanceOf(treasury);
        uint256 sink0Before = _t0().balanceOf(sink);
        (uint256 f0,) = vault.collectFees();

        uint256 tre0 = (f0 * 3_000) / 10_000;
        uint256 buy0 = (f0 * 1_000) / 10_000;
        assertEq(_t0().balanceOf(treasury) - tre0Before, tre0, "treasury exactly 30%");
        assertEq(_t0().balanceOf(sink) - sink0Before, buy0, "sink exactly 10%");
    }

    // (c) buybackSink == 0 → buyback folds into treasury (40%); nothing stranded.
    function test_buyback_folds_into_treasury_when_sink_unset() public {
        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        _genFees();

        uint256 tre0Before = _t0().balanceOf(treasury);
        uint256 res0Before = vault.feeReserve0();
        (uint256 f0,) = vault.collectFees();

        uint256 nonLp0 = (f0 * 3_000) / 10_000 + (f0 * 1_000) / 10_000; // 40% folded
        uint256 lp0    = f0 - nonLp0;
        uint256 treDelta = _t0().balanceOf(treasury) - tre0Before;
        uint256 resDelta = vault.feeReserve0() - res0Before;

        assertEq(treDelta, nonLp0, "treasury gets folded 40%");
        assertEq(resDelta, lp0, "LP gets 60% remainder");
        assertEq(treDelta + resDelta, f0, "conservation: nothing stranded");
    }

    // (d) setFeeSplit reverts above the bound; boundary is allowed.
    function test_setFeeSplit_reverts_above_bound() public {
        vm.expectRevert(MintwareDeFiPairVault.BadFeeSplit.selector);
        vault.setFeeSplit(3_000, 1_001); // 4001 > 4000

        vault.setFeeSplit(4_000, 0); // exactly at the bound → LP = 60%
        assertEq(vault.treasuryFeeBps(), 4_000);
        assertEq(vault.buybackFeeBps(), 0);
    }

    function test_setFeeSplit_only_owner() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable
        vault.setFeeSplit(1_000, 1_000);
    }

    function test_setBuybackSink_only_owner() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable
        vault.setBuybackSink(makeAddr("x"));
    }

    // (e) a custom split (20% treasury / 10% buyback / 70% LP) routes correctly to sink + reserve.
    function test_custom_split_routes_correctly() public {
        vault.setFeeSplit(2_000, 1_000);
        address sink = makeAddr("sink2");
        vault.setBuybackSink(sink);

        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        _genFees();

        uint256 treBefore  = _t0().balanceOf(treasury);
        uint256 sinkBefore = _t0().balanceOf(sink);
        uint256 resBefore  = vault.feeReserve0();
        (uint256 f0,) = vault.collectFees();

        uint256 tre = (f0 * 2_000) / 10_000;
        uint256 buy = (f0 * 1_000) / 10_000;
        uint256 lp  = f0 - tre - buy;
        assertEq(_t0().balanceOf(treasury) - treBefore, tre, "20% treasury");
        assertEq(_t0().balanceOf(sink) - sinkBefore, buy, "10% buyback");
        assertEq(vault.feeReserve0() - resBefore, lp, "70% LP");
        assertEq(tre + buy + lp, f0, "conservation");
    }

    // (f) LP portion routes to the weighted distributor when wired (with a custom split).
    function test_lp_leg_routes_to_distributor_under_custom_split() public {
        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);

        MintwareWeightedDistributor dist =
            new MintwareWeightedDistributor(makeAddr("oracle"), deployer);
        bytes32 vid = keccak256("defi-pair-custom");
        dist.setAuthorizedRegistrar(address(vault), true);
        vault.setWeightedDistributor(address(dist), vid);
        vault.setFeeSplit(2_500, 500); // 25% / 5% / 70% LP

        _genFees();
        (uint256 f0, uint256 f1) = vault.collectFees();

        uint256 lp0 = f0 - (f0 * 2_500) / 10_000 - (f0 * 500) / 10_000;
        uint256 lp1 = f1 - (f1 * 2_500) / 10_000 - (f1 * 500) / 10_000;
        MintwareWeightedDistributor.Epoch memory e = dist.getEpoch(vid, 1);
        assertEq(e.pot0, lp0, "t0 LP remainder routed to distributor");
        assertEq(e.pot1, lp1, "t1 LP remainder routed to distributor");
        // accumulator untouched on the distributor path
        assertEq(vault.accFee0PerShare(), 0, "accumulator not credited when distributor wired");
    }

    // (g) rounding: a non-round split leaves the exact remainder to LPs; protocol cuts never exceed
    //     their nominal bps share (rounding always favors LPs).
    function test_rounding_leaves_remainder_to_lp() public {
        vault.setFeeSplit(2_777, 1_111); // deliberately non-round bps (non-LP = 3888, LP = 6112, within the 4000 bound)
        _init();
        _deposit(alice, 200_000e18, 200_000e18, LockTier.Flex);
        _genFees();

        uint256 treBefore = _t0().balanceOf(treasury);
        uint256 resBefore = vault.feeReserve0();
        (uint256 f0,) = vault.collectFees();

        uint256 tre = (f0 * 2_777) / 10_000;
        uint256 buy = (f0 * 1_111) / 10_000;
        uint256 lp  = f0 - tre - buy;

        // actual routing == floor-cuts + exact remainder (no sink → non-LP folded to treasury).
        assertEq(_t0().balanceOf(treasury) - treBefore, tre + buy, "non-LP = floored cuts");
        assertEq(vault.feeReserve0() - resBefore, lp, "LP = exact remainder");
        // rounding favors LP: LP >= nominal LP share; combined protocol cut <= nominal non-LP share.
        assertGe(lp, (f0 * (10_000 - 2_777 - 1_111)) / 10_000, "LP >= nominal 61.12% share");
        assertLe(tre + buy, (f0 * (2_777 + 1_111)) / 10_000, "non-LP <= nominal 38.88% share");
        assertEq(tre + buy + lp, f0, "conservation");
    }

    // ── rebalance ────────────────────────────────────────────────────────────

    function test_rebalance_to_profile_moves_range() public {
        _init();
        _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);

        vault.rebalanceToProfile(PoolProfile.MEME);
        assertEq(vault.tickLower(), -2400, "MEME lower");
        assertEq(vault.tickUpper(), 2400, "MEME upper");
        assertEq(uint256(vault.profile()), uint256(PoolProfile.MEME), "profile stored");
    }

    function test_rebalance_only_provider() public {
        _init();
        vm.prank(alice);
        vm.expectRevert(MintwareDeFiPairVault.OnlyProvider.selector);
        vault.rebalanceToProfile(PoolProfile.MEME);
    }

    // ── kill-switch ────────────────────────────────────────────────────────

    function test_pause_blocks_deposit() public {
        _init();
        vault.pause();
        vm.startPrank(alice);
        _t0().approve(address(vault), 1e18);
        _t1().approve(address(vault), 1e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1e18, 1e18, 0, LockTier.Flex);
        vm.stopPrank();
    }

    function test_guardian_pause_owner_unpause() public {
        address guardian = makeAddr("guardian");
        vault.setGuardian(guardian);
        vm.prank(guardian);
        vault.pause();
        assertTrue(vault.paused(), "guardian paused");
        vm.prank(guardian);
        vm.expectRevert();
        vault.unpause();
        vault.unpause();
        assertFalse(vault.paused(), "owner unpaused");
    }

    function test_init_only_provider() public {
        vm.prank(alice);
        vm.expectRevert(MintwareDeFiPairVault.OnlyProvider.selector);
        vault.initializePool(INIT_SQRT_PRICE);
    }

    // ── fundRent (am-AMM rent sink) ──────────────────────────────────────────

    function test_fundRent_token0_accrues_to_lp() public {
        _init();
        vault.setRentFunder(address(this));
        _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        _t0().mint(address(this), 1000e18);
        _t0().approve(address(vault), 1000e18);
        vault.fundRent(address(_t0()), 1000e18);
        (uint256 f0, uint256 f1) = vault.pendingFees(alice);
        assertApproxEqAbs(f0, 1000e18, 1e9, "sole LP accrues the rent as token0");
        assertEq(f1, 0, "no token1 rent");
    }

    function test_fundRent_token1_accrues_to_lp() public {
        _init();
        vault.setRentFunder(address(this));
        _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        _t1().mint(address(this), 300e18);
        _t1().approve(address(vault), 300e18);
        vault.fundRent(address(_t1()), 300e18);
        (uint256 f0, uint256 f1) = vault.pendingFees(alice);
        assertEq(f0, 0);
        assertApproxEqAbs(f1, 300e18, 1e9, "sole LP accrues the rent as token1");
    }

    function test_fundRent_no_lp_forwards_to_treasury() public {
        _init(); // no deposits → totalLiquidity 0
        vault.setRentFunder(address(this));
        _t0().mint(address(this), 500e18);
        _t0().approve(address(vault), 500e18);
        uint256 before = _t0().balanceOf(treasury);
        vault.fundRent(address(_t0()), 500e18);
        assertEq(_t0().balanceOf(treasury) - before, 500e18, "rent to treasury when no LPs");
    }

    function test_fundRent_bad_token_reverts() public {
        _init();
        vault.setRentFunder(address(this));
        MockERC20 rogue = new MockERC20("Rogue", "RGE", 18);
        rogue.mint(address(this), 100e18);
        rogue.approve(address(vault), 100e18);
        vm.expectRevert(MintwareDeFiPairVault.BadConfig.selector);
        vault.fundRent(address(rogue), 100e18);
    }

    function test_fundRent_only_rent_funder() public {
        _init();
        vault.setRentFunder(address(this));
        _t0().mint(bob, 100e18);
        vm.startPrank(bob);
        _t0().approve(address(vault), 100e18);
        vm.expectRevert(MintwareDeFiPairVault.OnlyRentFunder.selector);
        vault.fundRent(address(_t0()), 100e18); // bob is not the rent funder
        vm.stopPrank();
    }

    function test_fundRent_reverts_when_paused() public {
        _init();
        vault.setRentFunder(address(this));
        vault.setGuardian(address(this));
        vault.pause();
        _t0().mint(address(this), 100e18);
        _t0().approve(address(vault), 100e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.fundRent(address(_t0()), 100e18);
    }

    /// Audit HIGH #4: after a rebalance the raw V4 position liquidity diverges from the share
    /// supply. Redemption must map shares to a PRO-RATA slice of the live position, not remove
    /// `s` raw units 1:1 — otherwise the sum of all shares exceeds the position and the LAST
    /// redeemer is locked out (their removal underflows the pool position and reverts).
    function test_rebalance_then_every_lp_can_fully_redeem() public {
        _init();
        uint256 sa = _deposit(alice, 120_000e18, 120_000e18, LockTier.Flex);
        uint256 sb = _deposit(bob,    60_000e18,  60_000e18, LockTier.Flex);

        // Rebalance to a different range: the vault re-derives the raw V4 liquidity for the same
        // tokens, so positionLiquidity moves away from totalLiquidity (the share supply).
        vault.rebalanceToProfile(PoolProfile.MEME);
        assertEq(vault.totalLiquidity(), sa + sb, "shares unchanged by rebalance");
        assertTrue(
            vault.positionLiquidity() != vault.totalLiquidity(),
            "precondition: position liquidity diverged from shares"
        );

        // Both LPs exit fully. Alice first, then bob LAST — pre-fix, bob's removal would revert.
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        vault.requestRedeem(sa);
        vm.prank(bob);
        vault.requestRedeem(sb);
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        (uint256 a0, uint256 a1) = vault.executeRedeem();
        vm.prank(bob);
        (uint256 b0, uint256 b1) = vault.executeRedeem(); // last redeemer must NOT be locked out

        assertTrue(a0 > 0 || a1 > 0, "alice got tokens");
        assertTrue(b0 > 0 || b1 > 0, "bob (last) got tokens");
        assertEq(vault.shares(alice), 0, "alice fully exited");
        assertEq(vault.shares(bob),   0, "bob fully exited");
        assertEq(vault.totalLiquidity(), 0, "share supply drained");
        // Alice put in ~2x bob, so she takes out ~2x (same range, same price) within rounding.
        assertApproxEqRel(a0, b0 * 2, 0.02e18, "payouts track share ratio");
    }

    /// Audit HIGH #4 (cont.): a depositor who arrives AFTER a rebalance is priced against the live
    /// position, so their share of the pool matches what they put in relative to sitting LPs.
    function test_deposit_after_rebalance_is_priced_fairly() public {
        _init();
        uint256 sa = _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);
        vault.rebalanceToProfile(PoolProfile.MEME);

        // Bob deposits the SAME amount alice did, now against the re-derived position.
        uint256 sb = _deposit(bob, 100_000e18, 100_000e18, LockTier.Flex);
        assertApproxEqRel(sb, sa, 0.02e18, "equal deposit at same price -> equal shares");
    }

    /// Audit (segregated reserve): a rebalance must NOT sweep unclaimed rent into the pool.
    function test_rebalance_preserves_unclaimed_rent() public {
        _init();
        vault.setRentFunder(address(this));
        _deposit(alice, 100_000e18, 100_000e18, LockTier.Flex);

        _t0().mint(address(this), 1000e18);
        _t0().approve(address(vault), 1000e18);
        vault.fundRent(address(_t0()), 1000e18);
        assertApproxEqAbs(vault.feeReserve0(), 1000e18, 1, "rent reserved");

        // Provider rebalances — previously this swept the rent into the LP position.
        vault.rebalanceToProfile(PoolProfile.EMERGING);

        // Alice's rent is still fully claimable from the vault (backed by the reserve).
        uint256 before = _t0().balanceOf(alice);
        vm.prank(alice);
        vault.claimFees();
        assertApproxEqAbs(_t0().balanceOf(alice) - before, 1000e18, 1e9, "rent survived the rebalance");
    }
}
