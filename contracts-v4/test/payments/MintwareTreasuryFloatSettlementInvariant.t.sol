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
import {MockLidoRate}     from "../mocks/MockLidoRate.sol";
import {MockYieldAdapter} from "../mocks/MockYieldAdapter.sol";
import {TestSwapRouter}   from "../helpers/TestSwapRouter.sol";

contract InvOracle is IOracleTickSource {
    int24 public tick; bool public ready;
    function set(int24 t, bool r) external { tick = t; ready = r; }
    function oracleTick() external view returns (int24, bool) { return (tick, ready); }
}

/// @notice Bounded fuzz handler. Prices are held at 1:1 (both pools + Lido rate all 1e18) so senior claimable
///         has an unambiguous par value: 1 wstETH backs 1 USDC. Every op keeps the ghost `seniorPar` (senior
///         claimable at par) in lock-step with real coverage — a fund adds equal backing + claim, a withdraw
///         removes both, a settlement discharges both, a rebalance conserves total (backing→float). The junior
///         cushion (funded, NOT counted as senior) absorbs the small ETH/USDC-leg swap slippage on rebalances.
contract FloatSettlementHandler is Test {
    MintwareTreasuryFloatSettlement public fs;
    MockERC20 public wstEth; MockERC20 public weth; MockERC20 public usdc;
    address public relayer; address public keeper; address public rail;
    TestSwapRouter public swapRouter;
    PoolKey public stakeKey; PoolKey public ethKey;
    bool public wstIs0Stake; bool public wethIs0Eth;

    uint256 public seniorPar; // ghost: senior claimable at par (USDC 1e18)

    constructor(
        MintwareTreasuryFloatSettlement _fs, MockERC20 _wst, MockERC20 _weth, MockERC20 _usdc,
        address _relayer, address _keeper, address _rail,
        TestSwapRouter _swapRouter, PoolKey memory _stakeKey, PoolKey memory _ethKey,
        bool _wstIs0Stake, bool _wethIs0Eth
    ) {
        fs = _fs; wstEth = _wst; weth = _weth; usdc = _usdc; relayer = _relayer; keeper = _keeper; rail = _rail;
        swapRouter = _swapRouter; stakeKey = _stakeKey; ethKey = _ethKey;
        wstIs0Stake = _wstIs0Stake; wethIs0Eth = _wethIs0Eth;
    }

    function fundFloat(uint256 a) external {
        a = bound(a, 1e18, 10_000e18);
        usdc.mint(address(this), a);
        usdc.approve(address(fs), a);
        fs.fundFloat(a);
        seniorPar += a;
    }

    function fundBacking(uint256 w) external {
        w = bound(w, 1e18, 10_000e18);
        wstEth.mint(address(this), w);
        wstEth.approve(address(fs), w);
        fs.fundWstEthBacking(w);
        seniorPar += w; // 1:1 par
    }

    function fundJunior(uint256 a) external {
        a = bound(a, 1e18, 5_000e18);
        usdc.mint(address(this), a);
        usdc.approve(address(fs), a);
        fs.fundJuniorBuffer(a); // pure cushion — NOT senior
    }

    function withdrawFloat(uint256 a) external {
        uint256 onHand = fs.usdcFloat();
        if (onHand == 0 || seniorPar == 0) return;
        a = bound(a, 1, onHand < seniorPar ? onHand : seniorPar);
        vm.prank(fs.owner());
        try fs.withdrawFloat(address(this), a) { seniorPar -= a; } catch {}
    }

    function withdrawBacking(uint256 w) external {
        uint256 onHand = fs.wstEthBacking();
        if (onHand == 0 || seniorPar == 0) return;
        w = bound(w, 1, onHand < seniorPar ? onHand : seniorPar);
        vm.prank(fs.owner());
        try fs.withdrawWstEthBacking(address(this), w) { seniorPar -= w; } catch {}
    }

    function settle(uint256 x) external {
        if (seniorPar == 0) return;
        x = bound(x, 1, seniorPar);
        vm.prank(relayer);
        try fs.batchSettle(x, rail) { seniorPar -= x; } catch {}
    }

    function rebalance(uint256 w) external {
        uint256 onHand = fs.wstEthBacking();
        if (onHand == 0) return;
        w = bound(w, 1e18, onHand < 1_000e18 ? onHand : 1_000e18);
        // Sane keeper: require ≥99% out, so a successful rebalance loses ≤1% (absorbed by junior); else no-op.
        uint256 minOut = w * 9900 / 10000;
        vm.prank(keeper);
        try fs.rebalanceFloat(w, minOut) {} catch {}
    }

    /// AUDIT R4-Info: exercise the EMERGENCY VALVE (2-hop bounded swap) — discharges senior par like a settle,
    /// sourcing USDC from wstETH backing. Junior (funded, not senior) absorbs any bounded shortfall.
    function emergencySettle(uint256 x) external {
        if (seniorPar == 0 || fs.wstEthBacking() == 0) return;
        x = bound(x, 1e18, seniorPar < 1_000e18 ? seniorPar : 1_000e18);
        vm.prank(relayer);
        try fs.batchSettleViaSwap(x, 0, rail) { seniorPar -= x; } catch {}
    }

    /// AUDIT R4-Info: exercise the DOUBLE-STACK — sweep idle balances into the lending adapters (value is still
    /// counted via the adapters' totalAssets, so senior par is untouched).
    function sweepFloat(uint256 a) external {
        if (address(fs.usdcFloatAdapter()) == address(0)) return;
        uint256 onHand = fs.usdcFloat();
        uint256 minKeep = fs.floatMinUsdc();
        if (onHand <= minKeep) return;
        a = bound(a, 1, onHand - minKeep);
        vm.prank(keeper);
        try fs.sweepFloatToAdapter(a) {} catch {}
    }

    function sweepWst(uint256 a) external {
        if (address(fs.wstEthAdapter()) == address(0)) return;
        uint256 onHand = fs.wstEthBacking();
        if (onHand == 0) return;
        a = bound(a, 1, onHand);
        vm.prank(keeper);
        try fs.sweepWstEthToAdapter(a) {} catch {}
    }

    /// AUDIT R4-Info: a PRICE-MANIPULATING actor slams the raw stake / eth pool spot around. Solvency must hold
    /// regardless — R4-L3 means the raw stake spot never feeds valuation, and the eth-leg band bounds swaps.
    function manipulate(uint256 amt, bool stake, bool up) external {
        amt = bound(amt, 1e18, 2_000_000e18);
        PoolKey memory key = stake ? stakeKey : ethKey;
        MockERC20 sellTok = stake
            ? (up ? weth : wstEth)
            : (up ? usdc : weth);
        bool zeroForOne = stake
            ? (up ? !wstIs0Stake : wstIs0Stake)
            : (up ? !wethIs0Eth  : wethIs0Eth);
        sellTok.mint(address(this), amt);
        sellTok.approve(address(swapRouter), type(uint256).max);
        try swapRouter.swap(key, zeroForOne, amt) {} catch {}
    }
}

/// @title Solvency invariant: totalBackingUsd() + junior ≥ Σ senior claimable at par, across fuzzed
///        fund / withdraw / settle / rebalance sequences.
contract MintwareTreasuryFloatSettlementInvariant is Test {
    PoolManager             internal pm;
    PoolModifyLiquidityTest internal lpRouter;
    TestSwapRouter          internal swapRouter;
    InvOracle               internal oracle;
    MockLidoRate            internal lido;
    MintwareTreasuryFloatSettlement internal fs;
    FloatSettlementHandler  internal handler;
    MockYieldAdapter        internal usdcAdapter;
    MockYieldAdapter        internal wstAdapter;

    MockERC20 internal wstEth; MockERC20 internal weth; MockERC20 internal usdc;
    PoolKey internal stakeKey; PoolKey internal ethKey;
    bool internal wstIs0Stake; bool internal wethIs0Eth;

    address internal owner   = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal keeper  = makeAddr("keeper");
    address internal rail    = makeAddr("rail");

    uint160 internal constant INIT_SQRT = 79228162514264337593543950336;
    int24   internal constant SPACING = 60;

    function setUp() public {
        pm         = new PoolManager(address(this));
        lpRouter   = new PoolModifyLiquidityTest(IPoolManager(address(pm)));
        swapRouter = new TestSwapRouter(IPoolManager(address(pm)));
        oracle     = new InvOracle();
        lido       = new MockLidoRate(1e18);

        wstEth = new MockERC20("wstETH", "wstETH", 18);
        weth   = new MockERC20("WETH", "WETH", 18);
        usdc   = new MockERC20("USDC", "USDC", 18);

        stakeKey = _poolKey(address(wstEth), address(weth));
        ethKey   = _poolKey(address(weth), address(usdc));
        pm.initialize(stakeKey, INIT_SQRT);
        pm.initialize(ethKey, INIT_SQRT);
        wstIs0Stake = address(wstEth) < address(weth);
        wethIs0Eth  = address(weth) < address(usdc);

        fs = new MintwareTreasuryFloatSettlement(
            IPoolManager(address(pm)), stakeKey, ethKey,
            address(wstEth), address(weth), address(usdc), owner, relayer, keeper
        );
        usdcAdapter = new MockYieldAdapter(address(usdc));
        wstAdapter  = new MockYieldAdapter(address(wstEth));
        vm.startPrank(owner);
        fs.setOracleSource(address(oracle));
        fs.setLidoRateSource(address(lido));
        // Wire the double-stack + arm the keeper churn cap BEFORE the rail (pre-arming ⇒ instant). This
        // exercises the adapters + keeps `rebalanceFloat` open (R4-M1 fails it closed without a window cap).
        fs.setUsdcFloatAdapter(address(usdcAdapter));
        fs.setWstEthAdapter(address(wstAdapter));
        fs.setFloatParams(0, 0);
        fs.setRebalanceCaps(0, type(uint128).max, 365 days);
        fs.setSettlementRail(rail);
        vm.stopPrank();
        oracle.set(0, true);

        _seedPool(stakeKey);
        _seedPool(ethKey);

        handler = new FloatSettlementHandler(
            fs, wstEth, weth, usdc, relayer, keeper, rail,
            swapRouter, stakeKey, ethKey, wstIs0Stake, wethIs0Eth
        );

        // A standing junior cushion (NOT senior) to absorb bounded rebalance slippage.
        usdc.mint(address(handler), 5_000_000e18);
        vm.prank(address(handler));
        usdc.approve(address(fs), type(uint256).max);
        vm.prank(address(handler));
        fs.fundJuniorBuffer(2_000_000e18);

        targetContract(address(handler));
    }

    function _poolKey(address a, address b) internal pure returns (PoolKey memory) {
        (Currency c0, Currency c1) = a < b ? (Currency.wrap(a), Currency.wrap(b)) : (Currency.wrap(b), Currency.wrap(a));
        return PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: SPACING, hooks: IHooks(address(0))});
    }

    function _seedPool(PoolKey memory key) internal {
        MockERC20 t0 = MockERC20(Currency.unwrap(key.currency0));
        MockERC20 t1 = MockERC20(Currency.unwrap(key.currency1));
        t0.mint(address(this), 100_000_000e18);
        t1.mint(address(this), 100_000_000e18);
        t0.approve(address(lpRouter), type(uint256).max);
        t1.approve(address(lpRouter), type(uint256).max);
        int24 lo = (TickMath.MIN_TICK / SPACING) * SPACING;
        int24 hi = (TickMath.MAX_TICK / SPACING) * SPACING;
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: 50_000_000e18, salt: bytes32(0)}), "");
    }

    /// The one that matters: coverage never drops below senior claimable at par.
    function invariant_solvency_coverageCoversSeniorPar() public view {
        assertGe(fs.totalBackingUsd() + fs.juniorUsdcBuffer(), handler.seniorPar(), "coverage >= senior claimable");
    }

    /// The rail is only ever the pinned rail — no funds leak elsewhere.
    function invariant_railPinned() public view {
        assertEq(fs.settlementRail(), rail, "rail stays pinned");
    }

    /// totalBackingUsd never overstates: physical on-hand USDC float + junior are actual balances.
    function invariant_physicalUsdcBacksTrackedFloat() public view {
        // On-hand USDC held by the contract must be >= tracked on-hand float + junior (adapters hold the rest).
        assertGe(usdc.balanceOf(address(fs)), fs.usdcFloat() + fs.juniorUsdcBuffer(), "physical USDC >= tracked on-hand");
    }
}
