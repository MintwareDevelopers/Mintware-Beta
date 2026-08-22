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
import {MockERC20}           from "../mocks/MockERC20.sol";
import {MockLendingAdapter}  from "../mocks/MockLendingAdapter.sol";
import {TestSwapRouter}      from "../helpers/TestSwapRouter.sol";

/// @notice Settable stand-in for the pool hook's truncated-oracle view (`oracleTick()`).
contract MockOracleSource2 is IOracleTickSource {
    int24 public tick;
    bool  public ready;
    function set(int24 t, bool r) external { tick = t; ready = r; }
    function oracleTick() external view returns (int24, bool) { return (tick, ready); }
}

/// @notice Forge proof for the "never idle" wiring of `MintwareEthSettlement` - the WETH settlement backing
///         earns lending (Aave/Morpho) yield through the `IYieldAdapter` seam while staying settlement-liquid.
///         Proves:
///           * SAFE DEFAULT: with `wethAdapter == 0`, behaviour is byte-for-byte today's (no-op) - the whole
///             legacy suite (MintwareEthSettlement.t.sol) already runs green against that default; here we add
///             an explicit no-op assertion.
///           * fund -> auto-lends everything above the liquid buffer;
///           * settle -> unwinds enough from the adapter to feed the swap, rail paid in full;
///           * large settle vs a utilization crunch -> partial unwind -> junior top-up or a clean revert
///             (never a brick, never underpaid);
///           * `totalWethBacking()` conservation across fund -> lend -> settle -> unwind, and it is never
///             overstated (it counts accrued yield at redeemable value);
///           * a broken adapter degrades to "stays liquid," never bricks settlement;
///           * withdraw pulls from the adapter when on-hand is short.
///
/// @dev Both tokens 18dp, pool at 1:1 (tick 0) - same clean harness as the base suite, so the price estimate
///      (`_estimateWethNeed`) resolves to ~`totalUsdc` x margin and the equality assertions stay exact.
contract MintwareEthSettlementNeverIdleTest is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;
    MockOracleSource2       internal oracle;
    MintwareEthSettlement   internal settle;
    MockLendingAdapter      internal adapter;

    MockERC20 internal usdc;
    MockERC20 internal weth;
    PoolKey   internal key;
    bool      internal wethIs0;

    address internal owner    = makeAddr("owner");
    address internal relayer  = makeAddr("relayer");
    address internal rail     = makeAddr("cardRail");
    address internal team     = makeAddr("team");
    address internal lp       = makeAddr("lp");
    address internal attacker = makeAddr("attacker");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        oracle     = new MockOracleSource2();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        (Currency c0, Currency c1) = address(usdc) < address(weth)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(usdc)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        pm.initialize(key, INIT_SQRT_PRICE);
        wethIs0 = address(weth) < address(usdc);

        settle = new MintwareEthSettlement(
            IPoolManager(address(pm)), key, address(usdc), address(weth), owner, relayer
        );
        adapter = new MockLendingAdapter(address(weth));

        vm.startPrank(owner);
        settle.setOracleSource(address(oracle));
        settle.setSettlementRail(rail);
        // NEVER IDLE: wire the WETH lending adapter (default buffer 30% liquid / 70% lent).
        settle.setWethAdapter(address(adapter));
        vm.stopPrank();
        oracle.set(0, true);

        // Deep 1:1 baseline liquidity.
        usdc.mint(address(this), 50_000_000e18);
        weth.mint(address(this), 50_000_000e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        weth.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 20_000_000e18, salt: bytes32(0)}),
            ""
        );
    }

    // ── helpers ────────────────────────────────────────────────────────────────────

    function _fundBacking(uint256 amount) internal {
        weth.mint(lp, amount);
        vm.startPrank(lp);
        weth.approve(address(settle), type(uint256).max);
        settle.fundWethBacking(amount);
        vm.stopPrank();
    }

    function _fundJunior(uint256 amount) internal {
        usdc.mint(team, amount);
        vm.startPrank(team);
        usdc.approve(address(settle), type(uint256).max);
        settle.fundJuniorBuffer(amount);
        vm.stopPrank();
    }

    function _manipulateSpotDown() internal {
        uint256 amt = 6_000_000e18;
        weth.mint(attacker, amt);
        vm.startPrank(attacker);
        weth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, wethIs0, amt);
        vm.stopPrank();
    }

    // ── safe default (adapter unset) ───────────────────────────────────────────────

    /// With NO adapter wired, fund/settle behave byte-for-byte as before: all WETH stays on-hand,
    /// `totalWethBacking()` == on-hand == `wethBacking`, nothing is ever lent.
    function test_SafeDefault_NoAdapter_NoOp() public {
        MintwareEthSettlement bare = new MintwareEthSettlement(
            IPoolManager(address(pm)), key, address(usdc), address(weth), owner, relayer
        );
        vm.startPrank(owner);
        bare.setOracleSource(address(oracle));
        bare.setSettlementRail(rail);
        vm.stopPrank();

        assertEq(address(bare.wethAdapter()), address(0), "no adapter by default");

        weth.mint(lp, 1_000e18);
        vm.startPrank(lp);
        weth.approve(address(bare), type(uint256).max);
        bare.fundWethBacking(1_000e18);
        vm.stopPrank();

        // Everything stays on-hand - no lending happened.
        assertEq(weth.balanceOf(address(bare)), 1_000e18, "all WETH on-hand");
        assertEq(bare.wethBacking(), 1_000e18, "backing tracked");
        assertEq(bare.totalWethBacking(), 1_000e18, "totalWethBacking == on-hand when unset");

        vm.prank(relayer);
        bare.batchSettleEth(100e18, 95e18, rail);
        assertEq(usdc.balanceOf(rail), 100e18, "rail paid exactly");
        assertEq(weth.balanceOf(address(bare)), bare.wethBacking(), "physical == tracked (legacy invariant)");
    }

    // ── fund -> auto-lend ────────────────────────────────────────────────────────────

    /// Funding backing auto-lends everything above the 30% liquid buffer.
    function test_Fund_AutoLends_KeepsBuffer() public {
        _fundBacking(1_000e18);

        // 30% liquid on-hand, 70% lent into the adapter.
        assertEq(weth.balanceOf(address(settle)), 300e18, "30% kept liquid");
        assertEq(adapter.totalAssets(), 700e18, "70% lent");
        assertEq(settle.wethBacking(), 1_000e18, "backing tracks the full principal");
        assertEq(settle.totalWethBacking(), 1_000e18, "totalWethBacking = on-hand + lent");
    }

    /// `totalWethBacking` reflects accrued lending yield (never overstated: it is the redeemable amount).
    function test_TotalWethBacking_IncludesYield() public {
        _fundBacking(1_000e18);
        // Simulate lending interest: mint extra WETH into the adapter (rebasing-style).
        weth.mint(address(adapter), 50e18);
        assertEq(adapter.totalAssets(), 750e18, "adapter grew by yield");
        assertEq(settle.totalWethBacking(), 1_050e18, "yield surfaces in totalWethBacking");
    }

    // ── settle pulls from adapter ────────────────────────────────────────────────────

    /// A settlement larger than the on-hand buffer unwinds from the adapter, then the swap fills in full.
    function test_Settle_PullsFromAdapter_RailPaidFull() public {
        _fundBacking(1_000e18);       // 300 on-hand, 700 lent
        _fundJunior(100e18);

        uint256 adapterBefore = adapter.totalAssets();
        uint256 totalBefore   = settle.totalWethBacking();

        // Settle 400 USDC - more than the 300 on-hand buffer, so the pre-swap unwind must pull from the adapter.
        vm.prank(relayer);
        (uint256 usdcFromSwap, uint256 wethSpent, uint256 juniorDrawn) =
            settle.batchSettleEth(400e18, 390e18, rail);

        assertEq(usdc.balanceOf(rail), 400e18, "rail paid exactly");
        assertEq(usdcFromSwap, 400e18, "swap filled in full (deep pool + unwind)");
        assertEq(juniorDrawn, 0, "no junior draw");
        assertLt(adapter.totalAssets(), adapterBefore, "adapter was unwound to feed the swap");
        // Conservation: totalWethBacking decreased by EXACTLY the WETH the swap consumed.
        assertEq(settle.totalWethBacking(), totalBefore - wethSpent, "totalWethBacking conserved");
    }

    // ── conservation across the full lifecycle ────────────────────────────────────────

    function test_Conservation_FundLendSettleUnwind() public {
        _fundBacking(2_000e18);
        _fundJunior(200e18);

        uint256 totalBefore = settle.totalWethBacking();
        assertEq(totalBefore, 2_000e18, "starts at principal");

        vm.prank(relayer);
        (, uint256 wethSpent,) = settle.batchSettleEth(500e18, 480e18, rail);

        assertEq(settle.totalWethBacking(), totalBefore - wethSpent, "decreases by exactly wethSpent");
        // And tracked backing follows the same conservation.
        assertEq(settle.wethBacking(), 2_000e18 - wethSpent, "wethBacking conserved too");
    }

    // ── utilization crunch (adapter can't unwind) ────────────────────────────────────

    /// Utilization crunch + STALE oracle: the adapter can't unwind, so the swap runs off the on-hand buffer
    /// only; the band binds -> it under-delivers -> the junior buffer tops up. Never a brick, rail paid in full.
    function test_UtilizationCrunch_PartialUnwind_JuniorCovers() public {
        _fundBacking(1_000e18);         // 300 on-hand, 700 lent
        _fundJunior(500e18);
        adapter.setAvailableLiquidity(0); // FULL crunch - nothing withdrawable

        _manipulateSpotDown();          // stale oracle -> band binds -> swap strands (consumes only on-hand)

        uint256 totalBefore  = settle.totalWethBacking();
        uint256 juniorBefore = settle.juniorUsdcBuffer();

        vm.prank(relayer);
        (uint256 usdcFromSwap, uint256 wethSpent, uint256 juniorDrawn) =
            settle.batchSettleEth(100e18, 0, rail);

        assertEq(usdc.balanceOf(rail), 100e18, "rail STILL paid exactly");
        assertLt(usdcFromSwap, 100e18, "band bound the swap - under-delivered");
        assertEq(juniorDrawn, 100e18 - usdcFromSwap, "junior covered the exact shortfall");
        assertEq(settle.juniorUsdcBuffer(), juniorBefore - juniorDrawn, "junior drawn");
        assertEq(settle.totalWethBacking(), totalBefore - wethSpent, "conserved even through the crunch");
    }

    /// Utilization crunch + FRESH oracle + a settlement larger than the on-hand buffer can back:
    /// the adapter can't unwind, the band doesn't bind, so the swap can't source enough WETH -> CLEAN REVERT
    /// (retry next window). Never a brick; backing + junior untouched.
    function test_UtilizationCrunch_TooLargeToBack_CleanRevert() public {
        _fundBacking(1_000e18);         // 300 on-hand, 700 lent
        _fundJunior(500e18);
        adapter.setAvailableLiquidity(0); // crunch

        uint256 backingBefore = settle.wethBacking();
        uint256 juniorBefore  = settle.juniorUsdcBuffer();
        uint256 totalBefore   = settle.totalWethBacking();

        // 400 USDC needs ~400 WETH input, but only 300 is on-hand and the adapter is frozen -> revert.
        vm.prank(relayer);
        vm.expectRevert();
        settle.batchSettleEth(400e18, 380e18, rail);

        assertEq(usdc.balanceOf(rail), 0, "rail unpaid");
        assertEq(settle.wethBacking(), backingBefore, "backing untouched (reverted)");
        assertEq(settle.juniorUsdcBuffer(), juniorBefore, "junior untouched (reverted)");
        assertEq(settle.totalWethBacking(), totalBefore, "nothing consumed");
    }

    /// The crunch clears (liquidity returns) -> the same settlement now succeeds. Proves it was a retry, not a brick.
    function test_UtilizationCrunch_ClearsThenSettles() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);
        adapter.setAvailableLiquidity(0);

        vm.prank(relayer);
        vm.expectRevert();
        settle.batchSettleEth(400e18, 380e18, rail);

        // Liquidity returns - the retry goes through.
        adapter.setAvailableLiquidity(type(uint256).max);
        vm.prank(relayer);
        settle.batchSettleEth(400e18, 390e18, rail);
        assertEq(usdc.balanceOf(rail), 400e18, "settles once liquidity returns");
    }

    // ── broken adapter degrades to liquid ───────────────────────────────────────────

    /// A broken adapter (supply reverts) makes fund keep WETH fully liquid - settlement then works entirely
    /// off on-hand WETH. The lending layer never bricks settlement.
    function test_BrokenAdapter_DegradesToLiquid() public {
        adapter.setBroken(true);
        _fundBacking(1_000e18);

        // Deposit reverted inside the try/catch -> all WETH stayed on-hand.
        assertEq(weth.balanceOf(address(settle)), 1_000e18, "WETH stayed liquid");
        assertEq(adapter.totalAssets(), 0, "nothing lent");
        assertEq(settle.totalWethBacking(), 1_000e18, "backing intact and liquid");

        // Settlement still works (broken adapter -> maxWithdrawable 0 -> pull skipped, swap off on-hand).
        vm.prank(relayer);
        settle.batchSettleEth(100e18, 95e18, rail);
        assertEq(usdc.balanceOf(rail), 100e18, "rail paid despite the broken adapter");
    }

    /// An adapter that breaks AFTER lending: on-hand buffer + junior still service settlement; no brick.
    function test_AdapterBreaksAfterLending_StillServiced() public {
        _fundBacking(1_000e18);         // 300 on-hand, 700 lent
        _fundJunior(500e18);
        adapter.setBroken(true);        // now the lent 700 is unreachable via the adapter

        _manipulateSpotDown();          // band binds -> small WETH consumption within on-hand, junior covers USDC

        vm.prank(relayer);
        settle.batchSettleEth(100e18, 0, rail);
        assertEq(usdc.balanceOf(rail), 100e18, "rail paid off the on-hand buffer + junior");
    }

    // ── withdraw pulls from the adapter ─────────────────────────────────────────────

    /// `withdrawWethBacking` unwinds from the adapter when on-hand is short of the requested amount.
    function test_WithdrawWethBacking_PullsFromAdapter() public {
        _fundBacking(1_000e18);         // 300 on-hand, 700 lent
        assertEq(weth.balanceOf(address(settle)), 300e18, "buffer on-hand");

        // Withdraw 800 - more than the 300 on-hand, so it must unwind 500 from the adapter.
        vm.prank(owner);
        settle.withdrawWethBacking(owner, 800e18);

        assertEq(weth.balanceOf(owner), 800e18, "owner received the full 800");
        assertEq(settle.wethBacking(), 200e18, "backing reduced");
        assertEq(settle.totalWethBacking(), 200e18, "on-hand + lent == remaining backing");
    }

    /// A wind-down beyond what can be unwound right now reverts rather than under-delivering.
    function test_WithdrawWethBacking_RevertsIfAdapterIlliquid() public {
        _fundBacking(1_000e18);
        adapter.setAvailableLiquidity(0); // can't unwind the lent 700

        vm.prank(owner);
        vm.expectRevert(MintwareEthSettlement.InsufficientWethBacking.selector);
        settle.withdrawWethBacking(owner, 800e18); // only 300 on-hand, adapter frozen
    }

    // ── admin guards ─────────────────────────────────────────────────────────────────

    /// The adapter is first-set-immediate then LOCKED - it can never be re-pointed from this layer.
    function test_AdapterSetOnceThenLocked() public {
        MockLendingAdapter other = new MockLendingAdapter(address(weth));
        vm.prank(owner);
        vm.expectRevert(MintwareEthSettlement.AdapterAlreadySet.selector);
        settle.setWethAdapter(address(other));
    }

    function test_BufferBps_Bounds() public {
        vm.startPrank(owner);
        vm.expectRevert(MintwareEthSettlement.BadParam.selector);
        settle.setWethIdleBufferBps(999);   // < MIN 1000
        vm.expectRevert(MintwareEthSettlement.BadParam.selector);
        settle.setWethIdleBufferBps(10_001); // > MAX 10000
        settle.setWethIdleBufferBps(5_000);  // ok
        assertEq(settle.wethIdleBufferBps(), 5_000);
        vm.stopPrank();
    }

    function test_MarginBps_Bounds() public {
        vm.startPrank(owner);
        vm.expectRevert(MintwareEthSettlement.BadParam.selector);
        settle.setSettleMarginBps(9_999);    // < 100%
        vm.expectRevert(MintwareEthSettlement.BadParam.selector);
        settle.setSettleMarginBps(30_001);   // > MAX
        settle.setSettleMarginBps(15_000);   // ok
        assertEq(settle.settleMarginBps(), 15_000);
        vm.stopPrank();
    }

    /// `sweepWethToAdapter` lends WETH that arrived above the buffer (e.g. a direct top-up before wiring cadence).
    function test_SweepWethToAdapter() public {
        // Wire a fresh instance with a HIGH buffer so fund leaves a lot on-hand, then lower it and sweep.
        _fundBacking(1_000e18); // 300 on-hand, 700 lent (buffer 30%)
        // Lower the buffer to 10% and sweep - should push another 200 into the adapter (target now 100).
        vm.startPrank(owner);
        settle.setWethIdleBufferBps(1_000);
        settle.sweepWethToAdapter();
        vm.stopPrank();
        assertEq(weth.balanceOf(address(settle)), 100e18, "swept down to the 10% buffer");
        assertEq(adapter.totalAssets(), 900e18, "excess lent");
    }

    // ── invariant-style fuzz: conservation + never-overstated ────────────────────────

    /// Fuzz: for any owed amount within capacity, the rail is paid EXACTLY `totalUsdc` or the call reverts,
    /// and `totalWethBacking()` decreases by EXACTLY the WETH the swap consumed (never more) - conservation
    /// holds through the lending layer.
    function testFuzz_Conservation_RailFullyPaidOrReverts(uint256 totalUsdc, uint256 juniorFund, uint16 bufBps)
        public
    {
        totalUsdc  = bound(totalUsdc, 1e18, 3_000e18);
        juniorFund = bound(juniorFund, 0, 10_000e18);
        bufBps     = uint16(bound(bufBps, 1_000, 10_000));

        vm.prank(owner);
        settle.setWethIdleBufferBps(bufBps);
        _fundBacking(50_000e18);            // ample backing; WETH is never the binding constraint (deep pool)
        if (juniorFund > 0) _fundJunior(juniorFund);

        uint256 totalBefore = settle.totalWethBacking();
        uint256 railBefore  = usdc.balanceOf(rail);

        vm.prank(relayer);
        try settle.batchSettleEth(totalUsdc, 0, rail) returns (uint256, uint256 wethSpent, uint256) {
            assertEq(usdc.balanceOf(rail) - railBefore, totalUsdc, "paid exactly the owed amount");
            assertEq(settle.totalWethBacking(), totalBefore - wethSpent, "totalWethBacking conserved");
        } catch {
            assertEq(usdc.balanceOf(rail), railBefore, "revert -> rail unchanged");
            assertEq(settle.totalWethBacking(), totalBefore, "revert -> backing unchanged");
        }
    }
}
