// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test}        from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolManager}           from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {MintwareEthSettlement, IOracleTickSource} from "../../src/payments/MintwareEthSettlement.sol";
import {MockERC20}        from "../mocks/MockERC20.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

contract InvOracle is IOracleTickSource {
    int24 public tick; bool public ready = true;
    function set(int24 t, bool r) external { tick = t; ready = r; }
    function oracleTick() external view returns (int24, bool) { return (tick, ready); }
}

/// @notice Handler for the settlement invariant. Randomly funds WETH backing + the junior USDC buffer,
///         nudges the pool spot (adversarial sandwich), and calls `batchSettleEth`. Tracks ghost totals so
///         the invariant contract can assert the rail is paid EXACTLY the sum of owed amounts and the
///         backing/junior conservation properties hold across ANY legit call sequence.
contract SettlementHandler is Test {
    MintwareEthSettlement public settle;
    PoolModifyLiquidityTest public lpRouter;
    TestSwapRouter public swapRouter;
    InvOracle public oracle;
    MockERC20 public usdc;
    MockERC20 public weth;
    PoolKey public key;
    address public rail;
    bool public wethIs0;

    uint256 public ghostTotalSettled;   // Σ totalUsdc of every SUCCESSFUL settle → must equal rail balance
    uint256 public ghostJuniorFunded;   // Σ junior USDC ever funded → buffer must never exceed this
    uint256 public ghostBackingFunded;  // Σ WETH backing ever funded

    constructor(
        MintwareEthSettlement _settle,
        PoolModifyLiquidityTest _lp,
        TestSwapRouter _swap,
        InvOracle _oracle,
        MockERC20 _usdc,
        MockERC20 _weth,
        PoolKey memory _key,
        address _rail,
        bool _wethIs0
    ) {
        settle = _settle; lpRouter = _lp; swapRouter = _swap; oracle = _oracle;
        usdc = _usdc; weth = _weth; key = _key; rail = _rail; wethIs0 = _wethIs0;
    }

    function fundBacking(uint256 amt) public {
        amt = bound(amt, 1e18, 100_000e18);
        weth.mint(address(this), amt);
        weth.approve(address(settle), type(uint256).max);
        settle.fundWethBacking(amt);
        ghostBackingFunded += amt;
    }

    function fundJunior(uint256 amt) public {
        amt = bound(amt, 1e18, 100_000e18);
        usdc.mint(address(this), amt);
        usdc.approve(address(settle), type(uint256).max);
        settle.fundJuniorBuffer(amt);
        ghostJuniorFunded += amt;
    }

    function nudgeSpot(uint256 amt, bool sellWeth) public {
        amt = bound(amt, 1e18, 2_000_000e18);
        if (sellWeth) {
            weth.mint(address(this), amt);
            weth.approve(address(swapRouter), type(uint256).max);
            try swapRouter.swap(key, wethIs0, amt) {} catch {}
        } else {
            usdc.mint(address(this), amt);
            usdc.approve(address(swapRouter), type(uint256).max);
            try swapRouter.swap(key, !wethIs0, amt) {} catch {}
        }
    }

    function settleBatch(uint256 totalUsdc) public {
        totalUsdc = bound(totalUsdc, 1e18, 10_000e18);
        vm.prank(settle.relayer());
        try settle.batchSettleEth(totalUsdc, 0, rail) returns (uint256, uint256, uint256) {
            ghostTotalSettled += totalUsdc; // only count a SUCCESSFUL settle
        } catch {}
    }
}

/// @title  EthSeniorInvariants — Layer-3 invariant battery for MintwareEthSettlement.
/// @notice The settlement contract had a single fuzz test but NO stateful invariant suite. This adds one:
///         across any sequence of fund/nudge/settle calls, (1) the rail is paid EXACTLY the sum of owed
///         amounts (never partial, never over — senior price-free), (2) tracked WETH backing never exceeds
///         the real WETH balance (conservation / the L4 donation clamp holds), (3) the junior buffer is
///         always backed by real USDC and never exceeds cumulative funded (monotonic-down under settles),
///         and (4) the contract never becomes insolvent (holds ≥ what it tracks it owes internally).
contract EthSeniorInvariantsTest is StdInvariant, Test {
    PoolManager pm;
    PoolModifyLiquidityTest lpRouter;
    TestSwapRouter swapRouter;
    InvOracle oracle;
    MintwareEthSettlement settle;
    SettlementHandler handler;

    MockERC20 usdc;
    MockERC20 weth;
    PoolKey key;
    bool wethIs0;

    address owner   = makeAddr("owner");
    address relayer = makeAddr("relayer");
    address rail    = makeAddr("rail");

    uint160 constant INIT_SQRT_PRICE = 79228162514264337593543950336;
    int24   constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        oracle     = new InvOracle();

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
        oracle.set(0, true);

        // Deep 1:1 baseline liquidity.
        usdc.mint(address(this), 100_000_000e18);
        weth.mint(address(this), 100_000_000e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        weth.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 40_000_000e18, salt: bytes32(0)}), ""
        );

        handler = new SettlementHandler(settle, lpRouter, swapRouter, oracle, usdc, weth, key, rail, wethIs0);
        targetContract(address(handler));
    }

    /// (1) The rail is paid EXACTLY the sum of owed amounts — never partial, never over, never redirected.
    function invariant_railPaidExactlyOwed() public view {
        assertEq(usdc.balanceOf(rail), handler.ghostTotalSettled(), "rail == sum owed");
    }

    /// (2) Tracked WETH backing never exceeds the real WETH balance (conservation; L4 clamp holds).
    function invariant_backingConserved() public view {
        assertLe(settle.wethBacking(), weth.balanceOf(address(settle)), "tracked backing <= real WETH");
    }

    /// (3a) The junior buffer is always backed by real USDC on hand.
    function invariant_juniorBufferBacked() public view {
        assertLe(settle.juniorUsdcBuffer(), usdc.balanceOf(address(settle)), "junior buffer <= real USDC");
    }

    /// (3b) The junior buffer never exceeds cumulative funded (only settles decrease it → monotonic down).
    function invariant_juniorMonotonicUnderSettle() public view {
        assertLe(settle.juniorUsdcBuffer(), handler.ghostJuniorFunded(), "junior buffer <= sum funded");
    }

    /// (4) No residual owed by the contract to itself: it holds ≥ the junior buffer it still tracks, and the
    ///     rail already holds everything settled — so the settlement contract is never insolvent.
    function invariant_settlementSolvent() public view {
        // Everything the contract still owes internally is the junior buffer; it must be covered by USDC held.
        assertGe(usdc.balanceOf(address(settle)), settle.juniorUsdcBuffer(), "USDC held covers junior owed");
    }
}
