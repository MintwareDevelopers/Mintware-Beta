// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {MintwareMarketEngineCore} from "../../src/vaults/MintwareMarketEngineCore.sol";
import {MintwareMarketLifecycleModule} from "../../src/vaults/MintwareMarketLifecycleModule.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";
import {MWV4PositionMath} from "../../src/lib/MWV4PositionMath.sol";
import {EngineTestAdapter, EngineTestMark} from "../market-engine/MarketEngineTestMocks.sol";

contract MarketEngineBaseHarness is MintwareMarketEngineCore {
    constructor(MarketConfig memory config, bytes32 moduleHash)
        MintwareMarketEngineCore(config, false, moduleHash)
    {}
}

/// @notice Base mainnet fork proof using the live Uniswap v4 ETH/USDC pool and Morpho Steakhouse USDC.
/// @dev Run: forge test --match-path 'contracts-v4/test/fork/MarketEngineBaseNeverIdleFork.t.sol' -vv
contract MarketEngineBaseNeverIdleForkTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 internal constant FORK_BLOCK = 53_000_000;
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant STEAKHOUSE_USDC = 0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183;

    IPoolManager internal manager;
    IERC20 internal weth;
    IERC20 internal usdc;
    IERC4626 internal source;
    MintwareERC4626YieldAdapter internal usdcAdapter;
    EngineTestAdapter internal wethAdapter;
    MarketEngineBaseHarness internal engine;
    EngineTestMark internal mark;
    PoolSwapTest internal swapper;
    PoolKey internal key;
    address internal alice = makeAddr("fork-alice");
    address internal bob = makeAddr("fork-bob");

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, "BASE_RPC_URL is unset");
        }
        // Foundry's `base` alias maps to BASE_RPC_URL; the literal RPC value is never emitted.
        vm.createSelectFork("base", FORK_BLOCK);
        assertEq(block.chainid, 8453, "Base chain");

        manager = IPoolManager(POOL_MANAGER);
        weth = IERC20(WETH);
        usdc = IERC20(USDC);
        source = IERC4626(STEAKHOUSE_USDC);
        assertGt(POOL_MANAGER.code.length, 0, "real Base v4 PoolManager code");
        assertGt(STEAKHOUSE_USDC.code.length, 0, "real Base ERC4626 code");
        assertGt(WETH.code.length, 0, "Base WETH code");
        assertGt(USDC.code.length, 0, "Base USDC code");
        assertEq(source.asset(), USDC, "vault underlying is Base USDC");
        assertEq(IERC20Metadata(address(source)).decimals(), 18, "Morpho vault shares use 18 decimals");

        key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        assertEq(
            PoolId.unwrap(key.toId()),
            0x1d8c55f347727c0fb4f5e1b65cdb93639e0c7102580a7d345e1144cd5a718f54,
            "known Base ETH/USDC 0.3% pool id"
        );
        (uint160 sqrtPriceX96, int24 tick,,) = manager.getSlot0(key.toId());
        assertGt(sqrtPriceX96, 0, "real pool is initialized");
        assertGt(manager.getLiquidity(key.toId()), 0, "real pool has active liquidity");

        MintwareMarketLifecycleModule module = new MintwareMarketLifecycleModule();
        int24 lower = (tick / 60) * 60 - 600;
        // Solidity truncates negative division toward zero; align the lower bound down explicitly.
        if (tick < 0 && tick % 60 != 0) lower -= 60;
        int24 upper = lower + 1200;
        mark = new EngineTestMark(WETH, USDC);
        mark.set(_wethPriceWad(sqrtPriceX96), uint64(block.timestamp));

        MintwareMarketEngineCore.MarketConfig memory config;
        config.poolManager = POOL_MANAGER;
        config.poolKey = key;
        config.quoteAsset = USDC;
        config.nonQuoteMark = address(mark);
        config.lifecycleModule = address(module);
        config.initialOwner = address(this);
        config.tickLower = lower;
        config.tickUpper = upper;
        config.maxMarkAge = 30 days;
        config.maxSpotMarkDeviationBps = 300;
        config.minInitialContribution = 1e6;
        config.principalCap = 1_000_000e6;
        config.maxPositionBps = 8000;
        config.recenterEdgeTicks = 120;
        config.maxRecenterTickMove = 600;
        config.recenterCooldown = 1 hours;
        engine = new MarketEngineBaseHarness(config, address(module).codehash);

        usdcAdapter = new MintwareERC4626YieldAdapter(USDC, STEAKHOUSE_USDC, address(engine), address(this));
        wethAdapter = new EngineTestAdapter(weth);
        wethAdapter.bind(address(engine));
        engine.configureAdapters(address(wethAdapter), address(usdcAdapter));
        engine.activate();
        swapper = new PoolSwapTest(manager);

        // Fork-only balance setup for two depositors; token code and all pool/vault calls remain real.
        deal(WETH, alice, 2e18);
        deal(WETH, bob, 2e18);
        deal(USDC, alice, 5_000e6);
        deal(USDC, bob, 5_000e6);
        vm.startPrank(alice);
        weth.approve(address(engine), type(uint256).max);
        usdc.approve(address(engine), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        weth.approve(address(engine), type(uint256).max);
        usdc.approve(address(engine), type(uint256).max);
        vm.stopPrank();
    }

    function test_fork_never_idle_real_v4_and_real_erc4626_yield_fee_exit() public {
        uint160 initialSqrt = _spot();
        uint256 aliceDepositValue = _wethValue(1e18, initialSqrt) + 2_000e6;
        vm.prank(alice);
        uint256 aliceShares = engine.deposit(1e18, 2_000e6, 1);
        vm.prank(bob);
        engine.deposit(1e18, 2_000e6, 1);
        assertGt(source.balanceOf(address(usdcAdapter)), 0, "stable side supplied to real vault");

        // Deploy the engine's capped band allocation, then return the residual idle composition to adapters.
        engine.deployLiquidity(0.5e18, 1_000e6, false, 0, 0, 0, 1);
        uint256 idleWeth = weth.balanceOf(address(engine));
        uint256 idleUsdc = usdc.balanceOf(address(engine));
        if (idleWeth != 0 || idleUsdc != 0) engine.allocateIdle(idleWeth, idleUsdc);
        assertGt(engine.positionLiquidity(), 0, "engine owns live v4 liquidity");
        assertGt(usdcAdapter.totalAssets(), 0, "stable idle balance remains in real vault");

        uint256 vaultAssetsBefore = usdcAdapter.totalAssets();
        uint256 navBefore = engine.totalNav();
        uint256 bobShares = engine.balanceOf(bob);
        uint256 supplyBefore = engine.totalSupply();

        // Swap against the real Base v4 pool in both directions, then harvest the engine's accrued LP fees.
        deal(WETH, address(this), 5e18);
        deal(USDC, address(this), 10_000e6);
        weth.approve(address(swapper), type(uint256).max);
        usdc.approve(address(swapper), type(uint256).max);
        vm.warp(block.timestamp + 30 days);
        _swap(true, 1e17);
        _swap(false, 100e6);
        uint256 vaultAssetsAfter = usdcAdapter.totalAssets();
        uint256 vaultYield = vaultAssetsAfter > vaultAssetsBefore ? vaultAssetsAfter - vaultAssetsBefore : 0;

        (uint256 feeWeth, uint256 feeUsdc) = engine.harvest();
        uint256 feesInUsdc = _wethValue(feeWeth, _spot()) + feeUsdc;
        assertGt(vaultYield, 0, "time accrual increased real Morpho 4626 claim");
        assertGt(feesInUsdc, 0, "real v4 swaps produced collectible position fees");
        uint160 exitSqrt = _spot();
        mark.set(_wethPriceWad(exitSqrt), uint64(block.timestamp));

        uint256 aliceWethBefore = weth.balanceOf(alice);
        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 burned, uint256 out0, uint256 out1) = engine.withdraw(aliceShares, alice, 0, 0);
        assertEq(burned, aliceShares, "full pro-rata exit delivered");
        assertGt(out0 + out1, 0, "in-kind exit delivered both portfolio assets");
        uint256 exitValue = _wethValue(weth.balanceOf(alice) - aliceWethBefore, _spot())
            + (usdc.balanceOf(alice) - aliceUsdcBefore);
        assertGt(exitValue, aliceDepositValue, "exit value exceeds deposited value");
        assertEq(engine.balanceOf(bob), bobShares, "other holder shares remain intact");
        uint256 navAfter = engine.totalNav();
        assertGe(navAfter * supplyBefore + 1, navBefore * engine.totalSupply(), "remaining holder claim preserved");

        emit log_named_uint("deposit value (USDC raw)", aliceDepositValue);
        emit log_named_uint("vault yield (USDC raw)", vaultYield);
        emit log_named_uint("swap fees (USDC raw value)", feesInUsdc);
        emit log_named_uint("exit value (USDC raw)", exitValue);
    }

    function _swap(bool zeroForOne, uint256 amountIn) internal {
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        swapper.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            bytes("")
        );
    }

    function _spot() internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = manager.getSlot0(key.toId());
    }

    function _wethValue(uint256 amountWeth, uint160 sqrtPriceX96) internal pure returns (uint256) {
        return MWV4PositionMath.quoteValue(amountWeth, sqrtPriceX96, false);
    }

    function _wethPriceWad(uint160 sqrtPriceX96) internal pure returns (uint256) {
        return _wethValue(1e18, sqrtPriceX96) * 1e12;
    }
}
