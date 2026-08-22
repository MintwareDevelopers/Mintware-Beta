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

import {MintwareTreasuryFloatSettlement, IOracleTickSource} from "../../src/payments/MintwareTreasuryFloatSettlement.sol";
import {MockERC20}        from "../mocks/MockERC20.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {MockLidoRate}     from "../mocks/MockLidoRate.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

/// @notice Settable truncated-oracle stand-in for the ETH/USDC leg (mirrors the JIT hook's `oracleTick()`).
contract MockTruncOracle is IOracleTickSource {
    int24 public tick;
    bool  public ready;
    function set(int24 t, bool r) external { tick = t; ready = r; }
    function oracleTick() external view returns (int24, bool) { return (tick, ready); }
}

/// @title Forge proof for `MintwareTreasuryFloatSettlement` — the operating-float settlement.
/// @dev   Two 18-dp v4 pools, both 1:1 @ tick 0: wstETH/WETH (the near-1:1 rate hop) and WETH/USDC (the
///        oracle-bounded leg). At 1:1 with Lido rate 1e18, wstETH≈WETH≈USDC so the value assertions are exact;
///        the depeg tests move the wstETH/WETH pool spot below the Lido rate, and the manipulation tests move
///        the WETH/USDC spot off the oracle so the band binds.
contract MintwareTreasuryFloatSettlementTest is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;
    MockTruncOracle         internal oracle;
    MockLidoRate            internal lido;
    MintwareTreasuryFloatSettlement internal fs;

    MockERC20 internal wstEth;
    MockERC20 internal weth;
    MockERC20 internal usdc;

    PoolKey internal stakeKey; // wstETH/WETH
    PoolKey internal ethKey;   // WETH/USDC
    bool    internal wstIs0Stake;
    bool    internal wethIs0Eth;

    address internal owner    = makeAddr("owner");
    address internal relayer  = makeAddr("relayer");
    address internal keeper   = makeAddr("keeper");
    address internal rail     = makeAddr("cardRail");
    address internal team     = makeAddr("team");   // funds junior + float
    address internal lp       = makeAddr("lp");     // funds wstETH backing
    address internal attacker = makeAddr("attacker");

    uint160 internal constant INIT_SQRT = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        oracle     = new MockTruncOracle();
        lido       = new MockLidoRate(1e18); // 1 WETH per wstETH (kept 1:1 for clean math)

        wstEth = new MockERC20("Wrapped stETH", "wstETH", 18);
        weth   = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc   = new MockERC20("USD Coin", "USDC", 18);

        stakeKey = _poolKey(address(wstEth), address(weth));
        ethKey   = _poolKey(address(weth), address(usdc));
        pm.initialize(stakeKey, INIT_SQRT);
        pm.initialize(ethKey, INIT_SQRT);
        wstIs0Stake = address(wstEth) < address(weth);
        wethIs0Eth  = address(weth) < address(usdc);

        fs = new MintwareTreasuryFloatSettlement(
            IPoolManager(address(pm)), stakeKey, ethKey,
            address(wstEth), address(weth), address(usdc),
            owner, relayer, keeper
        );

        vm.startPrank(owner);
        fs.setOracleSource(address(oracle));
        fs.setLidoRateSource(address(lido));
        fs.setSettlementRail(rail);
        vm.stopPrank();
        oracle.set(0, true); // fresh oracle at spot

        // Deep 1:1 liquidity in both pools.
        _seedPool(stakeKey);
        _seedPool(ethKey);
    }

    // ── harness helpers ────────────────────────────────────────────────────────────────

    function _poolKey(address a, address b) internal pure returns (PoolKey memory) {
        (Currency c0, Currency c1) = a < b
            ? (Currency.wrap(a), Currency.wrap(b))
            : (Currency.wrap(b), Currency.wrap(a));
        return PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
    }

    function _seedPool(PoolKey memory key) internal {
        MockERC20 t0 = MockERC20(Currency.unwrap(key.currency0));
        MockERC20 t1 = MockERC20(Currency.unwrap(key.currency1));
        t0.mint(address(this), 50_000_000e18);
        t1.mint(address(this), 50_000_000e18);
        t0.approve(address(lpRouter), type(uint256).max);
        t1.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 20_000_000e18, salt: bytes32(0)}),
            ""
        );
    }

    function _fundBacking(uint256 amount) internal {
        wstEth.mint(lp, amount);
        vm.startPrank(lp);
        wstEth.approve(address(fs), type(uint256).max);
        fs.fundWstEthBacking(amount);
        vm.stopPrank();
    }

    function _fundFloat(uint256 amount) internal {
        usdc.mint(team, amount);
        vm.startPrank(team);
        usdc.approve(address(fs), type(uint256).max);
        fs.fundFloat(amount);
        vm.stopPrank();
    }

    function _fundJunior(uint256 amount) internal {
        usdc.mint(team, amount);
        vm.startPrank(team);
        usdc.approve(address(fs), type(uint256).max);
        fs.fundJuniorBuffer(amount);
        vm.stopPrank();
    }

    function _manipulateEthDown() internal {
        uint256 amt = 6_000_000e18;
        weth.mint(attacker, amt);
        vm.startPrank(attacker);
        weth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(ethKey, wethIs0Eth, amt); // sell WETH -> USDC price of WETH falls
        vm.stopPrank();
    }

    function _manipulateStakeDown() internal {
        uint256 amt = 6_000_000e18;
        wstEth.mint(attacker, amt);
        vm.startPrank(attacker);
        wstEth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(stakeKey, wstIs0Stake, amt); // sell wstETH -> its WETH price falls (depeg)
        vm.stopPrank();
    }

    // ── HOT PATH: settle from float, no swap ─────────────────────────────────────────────

    function test_HotPath_SettleFromFloat_NoSwap() public {
        _fundBacking(1_000e18);
        _fundFloat(500e18);
        uint256 backingBefore = fs.wstEthBacking();

        vm.prank(relayer);
        (uint256 fromFloat, uint256 fromAdapter, uint256 juniorDrawn) = fs.batchSettle(100e18, rail);

        assertEq(usdc.balanceOf(rail), 100e18, "rail paid exactly");
        assertEq(fromFloat, 100e18, "all from on-hand float");
        assertEq(fromAdapter, 0, "no adapter");
        assertEq(juniorDrawn, 0, "no junior");
        assertEq(fs.usdcFloat(), 400e18, "float reduced by exactly 100");
        assertEq(fs.wstEthBacking(), backingBefore, "backing UNTOUCHED - no wstETH swap on hot path");
    }

    /// Float short -> junior top-up -> then a demand beyond float+junior reverts (rail never underpaid).
    function test_HotPath_FloatShort_JuniorTopUp_ThenRevert() public {
        _fundFloat(60e18);
        _fundJunior(30e18);

        // 80 owed: 60 float + 20 junior.
        vm.prank(relayer);
        (uint256 fromFloat,, uint256 juniorDrawn) = fs.batchSettle(80e18, rail);
        assertEq(fromFloat, 60e18, "drained on-hand float");
        assertEq(juniorDrawn, 20e18, "junior covered the 20 shortfall");
        assertEq(usdc.balanceOf(rail), 80e18, "rail paid in full");
        assertEq(fs.usdcFloat(), 0, "float exhausted");
        assertEq(fs.juniorUsdcBuffer(), 10e18, "junior reduced by 20");

        // Now only 10 junior left, no float: a 50 settle can't be covered -> revert-and-retry.
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(MintwareTreasuryFloatSettlement.FloatExhausted.selector, uint256(10e18), uint256(50e18)));
        fs.batchSettle(50e18, rail);
        assertEq(fs.juniorUsdcBuffer(), 10e18, "junior untouched on revert");
        assertEq(usdc.balanceOf(rail), 80e18, "rail unchanged on revert");
    }

    /// Float on-hand short but the float adapter covers it (best-effort unwind on the hot path).
    function test_HotPath_UnwindsFloatAdapter() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vm.prank(owner);
        fs.setUsdcFloatAdapter(address(adapter));
        vm.prank(owner);
        fs.setFloatParams(0, 20e18); // floatMin 20

        _fundFloat(100e18);
        // Sweep 80 into the adapter, leaving 20 on-hand (== floatMin).
        vm.prank(keeper);
        fs.sweepFloatToAdapter(80e18);
        assertEq(fs.usdcFloat(), 20e18, "on-hand at floatMin");
        assertEq(adapter.totalAssets(), 80e18, "80 lent");

        // Settle 50: 20 on-hand + 30 unwound from the adapter.
        vm.prank(relayer);
        (uint256 fromFloat, uint256 fromAdapter,) = fs.batchSettle(50e18, rail);
        assertEq(fromFloat, 20e18, "on-hand portion");
        assertEq(fromAdapter, 30e18, "unwound from adapter");
        assertEq(usdc.balanceOf(rail), 50e18, "rail paid");
        assertEq(adapter.totalAssets(), 50e18, "adapter reduced by 30");
    }

    // ── KEEPER REBALANCE: 2-hop tops up the float ────────────────────────────────────────

    function test_Keeper_RebalanceFloat_TopsUpFloat() public {
        _fundBacking(1_000e18);
        uint256 floatBefore = fs.usdcFloat();

        vm.prank(keeper);
        uint256 out = fs.rebalanceFloat(100e18, 95e18); // convert 100 wstETH -> >=95 USDC

        assertGt(out, 0, "produced USDC");
        assertEq(fs.usdcFloat(), floatBefore + out, "float credited by swap output");
        assertEq(fs.wstEthBacking(), 900e18, "backing reduced by exactly 100 wstETH");
        assertEq(usdc.balanceOf(rail), 0, "keeper never pays the rail (additive only)");
    }

    /// Keeper is bounded: cannot exceed the per-call / windowed cap, and cannot settle (role separation).
    function test_Keeper_Bounded_CannotChurnOrPayOut() public {
        _fundBacking(10_000e18);
        vm.prank(owner);
        fs.setRebalanceCaps(100e18, 150e18, 1 days);

        // Over the per-call cap -> revert.
        vm.prank(keeper);
        vm.expectRevert(MintwareTreasuryFloatSettlement.RebalanceCapExceeded.selector);
        fs.rebalanceFloat(101e18, 0);

        // First 100 ok; a second 100 breaches the 150 window cap.
        vm.prank(keeper);
        fs.rebalanceFloat(100e18, 90e18);
        vm.prank(keeper);
        vm.expectRevert(MintwareTreasuryFloatSettlement.RebalanceWindowCapExceeded.selector);
        fs.rebalanceFloat(100e18, 90e18);

        // Window rolls -> budget resets.
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(keeper);
        fs.rebalanceFloat(100e18, 90e18);

        // A keeper cannot call the settlement entrypoints (role separation).
        vm.prank(keeper);
        vm.expectRevert(MintwareTreasuryFloatSettlement.OnlyRelayer.selector);
        fs.batchSettle(1e18, rail);
        vm.prank(keeper);
        vm.expectRevert(MintwareTreasuryFloatSettlement.OnlyRelayer.selector);
        fs.batchSettleViaSwap(1e18, 0, rail);

        // A relayer cannot rebalance.
        vm.prank(relayer);
        vm.expectRevert(MintwareTreasuryFloatSettlement.OnlyKeeper.selector);
        fs.rebalanceFloat(1e18, 0);
    }

    /// The Lido-rate floor rejects a depegged/sandwiched wstETH/ETH leg (realized rate below the floor).
    function test_Keeper_LidoFloor_RejectsDepeg() public {
        _fundBacking(10_000e18);
        _manipulateStakeDown(); // wstETH pool spot far below the Lido rate

        vm.prank(keeper);
        vm.expectRevert(); // LidoRateFloorBreached
        fs.rebalanceFloat(1_000e18, 0);
        assertEq(fs.wstEthBacking(), 10_000e18, "backing untouched on revert");
    }

    // ── EMERGENCY VALVE: 2-hop swap when the float is exhausted ───────────────────────────

    function test_Emergency_SettleViaSwap_WhenFloatEmpty() public {
        _fundBacking(1_000e18);
        // float is empty by construction.
        assertEq(fs.usdcFloat(), 0, "float empty");

        vm.prank(relayer);
        (uint256 usdcFromSwap, uint256 wstSpent, uint256 juniorDrawn) = fs.batchSettleViaSwap(100e18, 95e18, rail);

        assertEq(usdc.balanceOf(rail), 100e18, "rail paid exactly via swap");
        assertGe(usdcFromSwap, 100e18, "deep pools -> swap covers the owed amount (headroom overshoot)");
        assertEq(juniorDrawn, 0, "no junior needed on a healthy market");
        assertGt(wstSpent, 0, "wstETH consumed");
        assertEq(fs.wstEthBacking(), 1_000e18 - wstSpent, "backing reduced by exactly wstSpent");
        // Any headroom overshoot refills the float (additive, never a payout).
        assertEq(fs.usdcFloat(), usdcFromSwap - 100e18, "swap overshoot lands back in the float");
    }

    /// Emergency with a manipulated ETH/USDC spot -> band binds -> junior tops up the shortfall.
    function test_Emergency_BandBinds_JuniorTopUp() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);
        _manipulateEthDown(); // spot far below oracle -> band binds on the ETH/USDC leg

        uint256 juniorBefore = fs.juniorUsdcBuffer();
        vm.prank(relayer);
        (uint256 usdcFromSwap,, uint256 juniorDrawn) = fs.batchSettleViaSwap(100e18, 0, rail);

        assertEq(usdc.balanceOf(rail), 100e18, "rail STILL paid exactly");
        assertLt(usdcFromSwap, 100e18, "band bound the swap");
        assertEq(juniorDrawn, 100e18 - usdcFromSwap, "junior covered the exact shortfall");
        assertEq(fs.juniorUsdcBuffer(), juniorBefore - juniorDrawn, "junior drawn");
    }

    /// Emergency below the minUsdcOut catastrophe floor reverts BEFORE any junior draw.
    function test_Emergency_BelowMinOut_RevertsBeforeJunior() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);
        _manipulateEthDown();

        uint256 juniorBefore = fs.juniorUsdcBuffer();
        vm.prank(relayer);
        vm.expectRevert(); // SettlementSlippageExceeded(produced, minUsdcOut)
        fs.batchSettleViaSwap(100e18, 90e18, rail);
        assertEq(fs.juniorUsdcBuffer(), juniorBefore, "junior not drawn below the floor");
        assertEq(usdc.balanceOf(rail), 0, "rail unpaid");
    }

    // ── DOUBLE-STACK: both sides earning + unwind ────────────────────────────────────────

    function test_DoubleStack_FloatLending_EarnsAndUnwinds() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(usdc));
        vm.prank(owner);
        fs.setUsdcFloatAdapter(address(adapter));
        vm.prank(owner);
        fs.setFloatParams(0, 0);

        _fundFloat(1_000e18);
        vm.prank(keeper);
        fs.sweepFloatToAdapter(1_000e18);

        uint256 backingBefore = fs.totalBackingUsd();
        // Simulate USDC lending yield accruing in the adapter (rebasing via mint).
        usdc.mint(address(adapter), 50e18);
        assertEq(fs.totalBackingUsd(), backingBefore + 50e18, "float lending yield lifts total backing");

        // The lent float is still fully spendable: settle unwinds it.
        vm.prank(relayer);
        (, uint256 fromAdapter,) = fs.batchSettle(600e18, rail);
        assertEq(fromAdapter, 600e18, "settle unwound the lent float");
        assertEq(usdc.balanceOf(rail), 600e18, "rail paid from lent float");
    }

    function test_DoubleStack_WstEthLending_Earns() public {
        MockYieldAdapter adapter = new MockYieldAdapter(address(wstEth));
        vm.prank(owner);
        fs.setWstEthAdapter(address(adapter));

        _fundBacking(1_000e18);
        vm.prank(keeper);
        fs.sweepWstEthToAdapter(1_000e18);
        assertEq(fs.wstEthBacking(), 0, "backing moved into adapter");

        uint256 before = fs.totalBackingUsd();
        // wstETH staking/lending appreciation accrues in the adapter.
        wstEth.mint(address(adapter), 40e18);
        assertEq(fs.totalBackingUsd(), before + 40e18, "wstETH double-stack yield lifts total backing (at 1:1)");
    }

    // ── VALUATION: depeg lowers totalBackingUsd, never overstates ─────────────────────────

    function test_Valuation_DepegLowersBacking_NeverOverstates() public {
        _fundBacking(1_000e18);
        // At 1:1, 1000 wstETH is worth 1000 USDC.
        assertEq(fs.totalBackingUsd(), 1_000e18, "fair value at peg");

        _manipulateStakeDown(); // pool spot for wstETH/WETH drops below the Lido rate
        uint256 depegged = fs.totalBackingUsd();
        assertLt(depegged, 1_000e18, "depeg LOWERS reported backing");
        // And it never exceeds what the conservative min(rate, spot) implies.
        assertGt(depegged, 0, "still positive");
    }

    /// When the pool spot rises ABOVE the Lido rate, valuation stays pinned to the (lower) Lido rate — never
    /// overstates on the upside either.
    function test_Valuation_UsesMinOfLidoAndSpot() public {
        _fundBacking(1_000e18);
        // Raise the wstETH/WETH pool spot (buy wstETH) so spot > lido(=1.0). min() should keep value at ~1:1.
        uint256 amt = 4_000_000e18;
        weth.mint(attacker, amt);
        vm.startPrank(attacker);
        weth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(stakeKey, !wstIs0Stake, amt); // buy wstETH -> its price rises
        vm.stopPrank();

        assertApproxEqAbs(fs.totalBackingUsd(), 1_000e18, 1e15, "value pinned to the conservative Lido rate, not the richer spot");
    }

    // ── SAFE-DEFAULT: both adapters unset -> pure float + hold, no lending ─────────────────

    function test_SafeDefault_NoAdapters_PureFloatAndHold() public {
        assertEq(address(fs.usdcFloatAdapter()), address(0), "float adapter unset by default");
        assertEq(address(fs.wstEthAdapter()), address(0), "wstETH adapter unset by default");

        _fundFloat(500e18);
        _fundBacking(1_000e18);
        // totalBacking = float(500) + wstETH value(1000) with NO adapter contribution.
        assertEq(fs.totalBackingUsd(), 1_500e18, "pure on-hand float + held wstETH");

        // Sweeping to an unset adapter reverts (nothing to lend into).
        vm.prank(keeper);
        vm.expectRevert(MintwareTreasuryFloatSettlement.ZeroAddress.selector);
        fs.sweepFloatToAdapter(100e18);

        // Settlement still works purely from the float.
        vm.prank(relayer);
        fs.batchSettle(200e18, rail);
        assertEq(usdc.balanceOf(rail), 200e18, "settles from held float with no lending wired");
    }

    // ── carried-over guards: rail pin + caps + oracle fail-closed ─────────────────────────

    function test_Guards_RailPinnedAndCapped() public {
        // Fresh instance with no rail cannot settle.
        MintwareTreasuryFloatSettlement fresh = new MintwareTreasuryFloatSettlement(
            IPoolManager(address(pm)), stakeKey, ethKey,
            address(wstEth), address(weth), address(usdc), owner, relayer, keeper
        );
        vm.prank(relayer);
        vm.expectRevert(MintwareTreasuryFloatSettlement.RailNotSet.selector);
        fresh.batchSettle(1e18, rail);

        // Wrong rail rejected.
        _fundFloat(500e18);
        vm.prank(relayer);
        vm.expectRevert(MintwareTreasuryFloatSettlement.RailMismatch.selector);
        fs.batchSettle(100e18, attacker);

        // Per-call cap.
        vm.prank(owner);
        fs.setMaxSettlePerCall(50e18);
        vm.prank(relayer);
        vm.expectRevert(MintwareTreasuryFloatSettlement.SettlementCapExceeded.selector);
        fs.batchSettle(100e18, rail);
    }

    function test_Guards_WindowedCap_BoundsCumulative() public {
        _fundFloat(10_000e18);
        vm.prank(owner);
        fs.setSettlementWindowCap(150e18, 1 days);

        vm.prank(relayer);
        fs.batchSettle(100e18, rail);
        vm.prank(relayer);
        vm.expectRevert(MintwareTreasuryFloatSettlement.SettlementWindowCapExceeded.selector);
        fs.batchSettle(60e18, rail); // 160 > 150

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(relayer);
        fs.batchSettle(120e18, rail);
        assertEq(usdc.balanceOf(rail), 220e18, "cumulative bounded across windows");
    }

    function test_Guards_EmergencyOracleFailClosed() public {
        _fundBacking(1_000e18);
        oracle.set(0, false); // not ready
        vm.prank(relayer);
        vm.expectRevert(MintwareTreasuryFloatSettlement.OracleNotReady.selector);
        fs.batchSettleViaSwap(100e18, 0, rail);
    }

    function test_Guards_GuardianPauseBlocksSettlement() public {
        _fundFloat(500e18);
        vm.prank(owner);
        fs.setGuardian(makeAddr("guardian"));
        vm.prank(makeAddr("guardian"));
        fs.pause();
        vm.prank(relayer);
        vm.expectRevert(); // EnforcedPause
        fs.batchSettle(100e18, rail);
    }

    function test_Constructor_RejectsWrongPools() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        PoolKey memory badStake = _poolKey(address(other), address(weth));
        vm.expectRevert(MintwareTreasuryFloatSettlement.NotWstEthWethPool.selector);
        new MintwareTreasuryFloatSettlement(
            IPoolManager(address(pm)), badStake, ethKey,
            address(wstEth), address(weth), address(usdc), owner, relayer, keeper
        );

        PoolKey memory badEth = _poolKey(address(other), address(usdc));
        vm.expectRevert(MintwareTreasuryFloatSettlement.NotWethUsdcPool.selector);
        new MintwareTreasuryFloatSettlement(
            IPoolManager(address(pm)), stakeKey, badEth,
            address(wstEth), address(weth), address(usdc), owner, relayer, keeper
        );
    }
}
