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

/// @notice A settable stand-in for the pool hook's truncated-oracle view (`oracleTick()`), so the tests
///         can pin the reference the settlement swap bounds against — exactly what a live hook supplies.
contract MockOracleSource is IOracleTickSource {
    int24  public tick;
    bool   public ready;

    function set(int24 t, bool r) external { tick = t; ready = r; }
    function oracleTick() external view returns (int24, bool) { return (tick, ready); }
}

/// @notice Forge proof for `MintwareEthSettlement` — the on-chain ETH->USDC batch settlement swap — driven
///         against an ACTUAL V4 pool. Proves the four properties the spec pins down:
///           • fresh price (spot == oracle) -> the bounded swap produces the owed USDC in full, no junior draw;
///           • the rail is paid EXACTLY `totalUsdc` or the tx reverts — never a partial/short payment (senior price-free);
///           • a manipulated spot (stale oracle -> band binds) makes the swap under-deliver -> the junior
///             first-loss buffer tops it up; beyond the cap, or below the `minUsdcOut` floor, it reverts;
///           • WETH backing decreases by EXACTLY the WETH each swap consumes (conservation).
///
/// @dev  Both tokens are 18dp and the pool inits at 1:1 (tick 0); the settlement mechanic is price-agnostic
///       (it swaps exact-output USDC and books the rail a fixed amount), so a clean 1:1 pool makes the
///       happy-path equality assertions exact while the manipulation tests move spot off the oracle.
contract MintwareEthSettlementTest is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;
    MockOracleSource        internal oracle;
    MintwareEthSettlement   internal settle;

    MockERC20 internal usdc;
    MockERC20 internal weth;
    PoolKey   internal key;
    bool      internal wethIs0;

    address internal owner   = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal rail    = makeAddr("cardRail");
    address internal team    = makeAddr("team");   // funds junior first-loss
    address internal lp      = makeAddr("lp");      // funds WETH backing
    address internal attacker = makeAddr("attacker");

    uint160 internal constant INIT_SQRT_PRICE = 79228162514264337593543950336; // 1:1 @ tick 0
    int24   internal constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        oracle     = new MockOracleSource();

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
        vm.prank(owner);
        settle.setOracleSource(address(oracle));
        // Fresh oracle pinned at spot (tick 0) -> the band brackets the current price.
        oracle.set(0, true);

        // Deep 1:1 baseline liquidity so a settlement-sized swap has realistic depth.
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

    /// Push spot far below the oracle (attacker dumps WETH) so the oracle band sits ABOVE where a
    /// WETH->USDC sell can execute — the classic sandwich that strands the sweep.
    function _manipulateSpotDown() internal {
        uint256 amt = 6_000_000e18;
        weth.mint(attacker, amt);
        vm.startPrank(attacker);
        weth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, wethIs0, amt); // selling WETH pushes its price down
        vm.stopPrank();
    }

    // ── tests ────────────────────────────────────────────────────────────────────

    /// Fresh price: the bounded swap fills the full owed USDC, no junior draw, rail paid exactly.
    function test_HappyPath_FullSwapNoJunior() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);

        uint256 totalUsdc = 100e18;
        uint256 backingBefore = settle.wethBacking();
        uint256 juniorBefore  = settle.juniorUsdcBuffer();

        vm.prank(relayer);
        (uint256 usdcFromSwap, uint256 wethSpent, uint256 juniorDrawn) =
            settle.batchSettleEth(totalUsdc, 95e18, rail);

        assertEq(usdc.balanceOf(rail), totalUsdc, "rail paid exactly totalUsdc");
        assertEq(usdcFromSwap, totalUsdc, "swap produced full owed (deep 1:1 pool)");
        assertEq(juniorDrawn, 0, "no junior draw needed");
        assertEq(settle.juniorUsdcBuffer(), juniorBefore, "junior buffer untouched");
        assertGt(wethSpent, 0, "WETH consumed");
        assertEq(settle.wethBacking(), backingBefore - wethSpent, "backing reduced by exactly wethSpent");
        assertEq(weth.balanceOf(address(settle)), settle.wethBacking(), "physical WETH == tracked backing");
    }

    /// The rail receives EXACTLY totalUsdc — never a price-marked amount. Senior/rail is price-free.
    function test_RailPaidInFull_JuniorBackstopOnManipulation() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);

        _manipulateSpotDown(); // stale oracle at 0, spot far below -> band binds, swap strands

        uint256 totalUsdc = 100e18;
        uint256 juniorBefore = settle.juniorUsdcBuffer();

        vm.prank(relayer);
        (uint256 usdcFromSwap,, uint256 juniorDrawn) = settle.batchSettleEth(totalUsdc, 0, rail);

        assertEq(usdc.balanceOf(rail), totalUsdc, "rail STILL paid exactly totalUsdc");
        assertLt(usdcFromSwap, totalUsdc, "band bound the swap - under-delivered");
        assertEq(juniorDrawn, totalUsdc - usdcFromSwap, "junior covered the exact shortfall");
        assertEq(settle.juniorUsdcBuffer(), juniorBefore - juniorDrawn, "junior buffer drawn by shortfall");
    }

    /// A shortfall beyond the per-call junior cap reverts (retry next window) — first-loss isn't drained.
    function test_BeyondJuniorCap_Reverts_StateRolledBack() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18);
        vm.prank(owner);
        settle.setJuniorTopUpCapPerCall(1e18); // tiny cap

        _manipulateSpotDown();

        uint256 backingBefore = settle.wethBacking();
        uint256 juniorBefore  = settle.juniorUsdcBuffer();

        vm.prank(relayer);
        vm.expectRevert(); // SettlementSlippageExceeded — shortfall > cap
        settle.batchSettleEth(100e18, 0, rail);

        assertEq(usdc.balanceOf(rail), 0, "rail unpaid");
        assertEq(settle.wethBacking(), backingBefore, "backing untouched (reverted)");
        assertEq(settle.juniorUsdcBuffer(), juniorBefore, "junior untouched (reverted)");
    }

    /// A swap below the `minUsdcOut` catastrophe floor reverts BEFORE any junior draw — don't burn
    /// first-loss on a print worse than the edge's modeled minimum.
    function test_BelowMinOut_RevertsBeforeJuniorDraw() public {
        _fundBacking(1_000e18);
        _fundJunior(500e18); // buffer COULD cover, but minOut floor trips first

        _manipulateSpotDown();

        uint256 juniorBefore = settle.juniorUsdcBuffer();

        vm.prank(relayer);
        vm.expectRevert(); // SettlementSlippageExceeded(produced, minUsdcOut)
        settle.batchSettleEth(100e18, 90e18, rail); // require >=90 out; manipulation yields ~0

        assertEq(settle.juniorUsdcBuffer(), juniorBefore, "junior NOT drawn below the floor");
        assertEq(usdc.balanceOf(rail), 0, "rail unpaid");
    }

    /// AUDIT: by default a settlement REVERTS when the oracle isn't ready (never an unbounded swap).
    function test_RevertsWhenOracleNotReady_ThenOwnerCanBootstrap() public {
        _fundBacking(1_000e18);
        oracle.set(0, false); // oracle present but NOT ready

        vm.prank(relayer);
        vm.expectRevert(MintwareEthSettlement.OracleNotReady.selector);
        settle.batchSettleEth(100e18, 0, rail);

        // Owner may disable the guard for a pre-oracle bootstrap; then it proceeds (min-out bounded).
        vm.prank(owner);
        settle.setRequireReadyOracle(false);
        vm.prank(relayer);
        settle.batchSettleEth(100e18, 95e18, rail);
        assertEq(usdc.balanceOf(rail), 100e18, "settles once the guard is disabled");
    }

    /// Only the relayer can settle.
    function test_OnlyRelayer() public {
        _fundBacking(1_000e18);
        vm.prank(attacker);
        vm.expectRevert(MintwareEthSettlement.OnlyRelayer.selector);
        settle.batchSettleEth(100e18, 0, rail);
    }

    function test_ZeroChecks() public {
        _fundBacking(1_000e18);
        vm.startPrank(relayer);
        vm.expectRevert(MintwareEthSettlement.ZeroAmount.selector);
        settle.batchSettleEth(0, 0, rail);
        vm.expectRevert(MintwareEthSettlement.ZeroAddress.selector);
        settle.batchSettleEth(100e18, 0, address(0));
        vm.stopPrank();
    }

    /// Constructor rejects a pool that isn't the {weth, usdc} pair.
    function test_Constructor_RejectsWrongPool() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        (Currency c0, Currency c1) = address(usdc) < address(other)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(other)))
            : (Currency.wrap(address(other)), Currency.wrap(address(usdc)));
        PoolKey memory badKey =
            PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
        vm.expectRevert(MintwareEthSettlement.NotWethUsdcPool.selector);
        new MintwareEthSettlement(IPoolManager(address(pm)), badKey, address(usdc), address(weth), owner, relayer);
    }

    /// Fuzz the core invariant: for any owed amount within backing capacity, the rail is paid EXACTLY
    /// `totalUsdc` or the call reverts — it is never left partially/short paid.
    function testFuzz_RailFullyPaidOrReverts(uint256 totalUsdc, uint256 juniorFund) public {
        totalUsdc  = bound(totalUsdc, 1e18, 5_000e18);
        juniorFund = bound(juniorFund, 0, 10_000e18);
        _fundBacking(50_000e18); // ample backing so WETH is never the binding constraint
        if (juniorFund > 0) _fundJunior(juniorFund);

        uint256 railBefore = usdc.balanceOf(rail);
        vm.prank(relayer);
        try settle.batchSettleEth(totalUsdc, 0, rail) returns (uint256, uint256, uint256) {
            assertEq(usdc.balanceOf(rail) - railBefore, totalUsdc, "paid exactly the owed amount");
            assertEq(weth.balanceOf(address(settle)), settle.wethBacking(), "backing conserved");
        } catch {
            assertEq(usdc.balanceOf(rail), railBefore, "revert -> rail unchanged");
        }
    }
}
