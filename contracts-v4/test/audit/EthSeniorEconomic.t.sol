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

import {MintwareEthSettlement, IOracleTickSource} from "../../src/payments/MintwareEthSettlement.sol";
import {MockERC20}      from "../mocks/MockERC20.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";

contract EconOracle is IOracleTickSource {
    int24 public tick; bool public ready;
    function set(int24 t, bool r) external { tick = t; ready = r; }
    function oracleTick() external view returns (int24, bool) { return (tick, ready); }
}

/// @title  EthSeniorEconomic — Layer-5 economic / oracle-manipulation coverage for MintwareEthSettlement.
/// @notice Extends the spot/oracle-manipulation angle beyond the existing happy-path junior-backstop test:
///         (a) a single-tx flash-style sandwich that craters spot CANNOT force the settlement swap to
///         realize WETH at the manipulated cheap price — the truncated-oracle band + minUsdcOut floor bind,
///         so the tx reverts with the WETH backing fully conserved (no cheap-WETH drain); (b) a stale/
///         not-ready oracle fails closed (no unbounded swap ever fires); (c) an attacker who sandwiches a
///         settlement extracts nothing FROM the settlement contract. Result: guards hold, no value extracted.
contract EthSeniorEconomicTest is Test {
    PoolManager pm;
    PoolModifyLiquidityTest lpRouter;
    TestSwapRouter swapRouter;
    EconOracle oracle;
    MintwareEthSettlement settle;

    MockERC20 usdc;
    MockERC20 weth;
    PoolKey key;
    bool wethIs0;

    address owner    = makeAddr("owner");
    address relayer  = makeAddr("relayer");
    address rail     = makeAddr("rail");
    address lp       = makeAddr("lp");
    address team     = makeAddr("team");
    address attacker = makeAddr("attacker");

    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        oracle     = new EconOracle();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);
        wethIs0 = address(weth) < address(usdc);

        settle = new MintwareEthSettlement(IPoolManager(address(pm)), key, address(usdc), address(weth), owner, relayer);
        vm.startPrank(owner);
        settle.setOracleSource(address(oracle));
        settle.setSettlementRail(rail);
        vm.stopPrank();
        oracle.set(0, true); // fresh oracle pinned at spot

        // Moderate-depth 1:1 liquidity so a manipulation genuinely moves spot far off the oracle.
        usdc.mint(address(this), 10_000_000e18);
        weth.mint(address(this), 10_000_000e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        weth.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 500_000e18, salt: bytes32(0)}), ""
        );
    }

    function _fundBacking(uint256 a) internal {
        weth.mint(lp, a);
        vm.startPrank(lp);
        weth.approve(address(settle), type(uint256).max);
        settle.fundWethBacking(a);
        vm.stopPrank();
    }

    function _fundJunior(uint256 a) internal {
        usdc.mint(team, a);
        vm.startPrank(team);
        usdc.approve(address(settle), type(uint256).max);
        settle.fundJuniorBuffer(a);
        vm.stopPrank();
    }

    /// Attacker dumps a large amount of WETH, cratering spot far BELOW the (fresh) oracle. A WETH→USDC
    /// settlement can then only execute down to the oracle band, producing very little USDC → the minOut
    /// floor / junior cap bind and the tx REVERTS. Crucially: the settlement contract's WETH backing is
    /// FULLY conserved (no cheap-WETH sold to the attacker's manipulated pool), and the attacker gains
    /// nothing from the settlement contract.
    function test_flashSandwich_cannotDrainCheapWeth() public {
        _fundBacking(10_000e18);
        // No junior buffer: the only way to pay the rail is the swap, which the band chokes.
        uint256 backingBefore = settle.wethBacking();
        uint256 settleWethBefore = weth.balanceOf(address(settle));

        // Sandwich front-run: crater spot (sell a large slug of WETH into the pool).
        uint256 dump = 3_000_000e18;
        weth.mint(attacker, dump);
        vm.startPrank(attacker);
        weth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, wethIs0, dump); // WETH price collapses
        vm.stopPrank();

        // Relayer attempts a large settlement with a realistic minUsdcOut (edge's conservative price).
        // The band binds → swap under-delivers → below minOut → revert BEFORE any junior draw.
        vm.prank(relayer);
        vm.expectRevert(); // SettlementSlippageExceeded (or ZeroAmount-class) — never a cheap fill
        settle.batchSettleEth(5_000e18, 4_900e18, rail);

        // Backing fully conserved: the settlement contract did NOT sell WETH into the manipulated pool.
        assertEq(settle.wethBacking(), backingBefore, "tracked backing unchanged after failed settle");
        assertEq(weth.balanceOf(address(settle)), settleWethBefore, "real WETH unchanged");
        assertEq(usdc.balanceOf(rail), 0, "rail unpaid on the reverted settle");
    }

    /// A stale / not-ready oracle FAILS CLOSED: with `requireReadyOracle` (default true), no settlement
    /// swap fires at all — even with minUsdcOut = 0, so an attacker cannot combine a spot manipulation with
    /// a stale oracle to force an unbounded (sandwichable) swap.
    function test_staleOracle_failsClosed_noUnboundedSwap() public {
        _fundBacking(10_000e18);
        oracle.set(0, false); // oracle goes stale/not-ready
        vm.prank(relayer);
        vm.expectRevert(MintwareEthSettlement.OracleNotReady.selector);
        settle.batchSettleEth(1_000e18, 0, rail);
        // Backing untouched.
        assertEq(settle.wethBacking(), 10_000e18, "no swap fired under a stale oracle");
    }

    /// When the pool is fresh (spot == oracle) the settlement fills honestly: the rail is paid EXACTLY,
    /// and the attacker who does nothing gains nothing — establishes the baseline the manipulation cases
    /// deviate from only by REVERTING, never by paying out cheaply.
    function test_freshPrice_paysRailExactly_noLeak() public {
        _fundBacking(10_000e18);
        vm.prank(relayer);
        (uint256 fromSwap,, uint256 juniorDrawn) = settle.batchSettleEth(1_000e18, 950e18, rail);
        assertEq(usdc.balanceOf(rail), 1_000e18, "rail paid exactly");
        assertEq(juniorDrawn, 0, "no junior draw at fair price");
        assertGe(fromSwap, 950e18, "swap cleared the minOut floor");
        assertEq(settle.wethBacking(), weth.balanceOf(address(settle)), "backing conserved");
    }

    /// Fuzz the sandwich size: for ANY downward manipulation, a settlement with a tight minUsdcOut either
    /// pays the rail EXACTLY totalUsdc or reverts with WETH backing conserved. The settlement never realizes
    /// WETH below the oracle band, so no manipulation size extracts cheap WETH from the contract.
    function testFuzz_sandwich_paysExactOrConservesBacking(uint256 dump, uint256 totalUsdc) public {
        _fundBacking(50_000e18);
        _fundJunior(1_000e18); // small buffer: cannot rescue a big band-choked shortfall
        dump      = bound(dump, 1e18, 5_000_000e18);
        totalUsdc = bound(totalUsdc, 100e18, 5_000e18);

        weth.mint(attacker, dump);
        vm.startPrank(attacker);
        weth.approve(address(swapRouter), type(uint256).max);
        try swapRouter.swap(key, wethIs0, dump) {} catch {}
        vm.stopPrank();

        uint256 backingBefore = settle.wethBacking();
        uint256 railBefore = usdc.balanceOf(rail);
        // Tight floor at 98% of owed — a band-choked swap can't clear it.
        uint256 minOut = (totalUsdc * 98) / 100;

        vm.prank(relayer);
        try settle.batchSettleEth(totalUsdc, minOut, rail) returns (uint256, uint256, uint256) {
            // Success ⇒ rail paid EXACTLY, backing still equals the real balance (conservation).
            assertEq(usdc.balanceOf(rail) - railBefore, totalUsdc, "paid exactly on success");
            assertEq(settle.wethBacking(), weth.balanceOf(address(settle)), "backing == real WETH");
        } catch {
            // Revert ⇒ nothing moved: no cheap-WETH drain, rail unpaid.
            assertEq(settle.wethBacking(), backingBefore, "backing conserved on revert");
            assertEq(usdc.balanceOf(rail), railBefore, "rail unchanged on revert");
        }
    }
}
