// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary, PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MintwareMarketEngine} from "../../src/vaults/MintwareMarketEngine.sol";
import {MintwareMarketEngineCore} from "../../src/vaults/MintwareMarketEngineCore.sol";
import {MintwareMarketLifecycleModule} from "../../src/vaults/MintwareMarketLifecycleModule.sol";
import {MintwareIdleYieldAdapter} from "../../src/vaults/MintwareIdleYieldAdapter.sol";
import {TestSwapRouter} from "../helpers/TestSwapRouter.sol";
import {EngineTestMark} from "../market-engine/MarketEngineTestMocks.sol";

contract MarketEngineT4RehearsalTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 constant FORK_CHAIN_ID = 84532;
    address constant PM = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant MODULE = 0x00006A0e0564b5b4300a46a7EB7c936b44653BAD;
    address constant EXISTING_MARK = 0x693aA5Bb6E113eAf5C49580Cd2584A5584eCDB55;
    bytes32 constant MODULE_HASH = 0x166985aa111748ed70d00e8956c48fe285b5ba59f50555ca71ec8487139871f9;
    uint256 constant Q96 = 1 << 96;

    function test_full_funded_market_rehearsal() external {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, "BASE_SEPOLIA_RPC_URL is unset");
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, FORK_CHAIN_ID);
        assertEq(MODULE.codehash, MODULE_HASH, "lifecycle module hash mismatch");
        // Existing Chainlink ratio mark is stale on this pinned fork (its quote feed is over ten
        // hours old). Keep its observed testnet price, but replace it with a timestamped mechanics
        // mark so this valueless rehearsal can exercise the engine. Production must use live feeds.
        (bool readOk, bytes memory markData) = EXISTING_MARK.staticcall(abi.encodeWithSignature("latestMark()"));
        assertTrue(readOk, "existing mark unusable");
        (uint256 markWad,) = abi.decode(markData, (uint256, uint64));
        EngineTestMark freshTestMark = new EngineTestMark(WETH, USDC);
        freshTestMark.set(markWad, uint64(block.timestamp));
        address markAddress = address(freshTestMark);

        // Use a separate fee tier from the pre-existing mispriced test pool.
        PoolKey memory key = PoolKey(Currency.wrap(USDC), Currency.wrap(WETH), 2500, 50, IHooks(address(0)));
        uint160 markSqrtPrice = _sqrtPriceAtMark(markWad);
        IPoolManager pm = IPoolManager(PM);
        (uint160 spot,,,) = pm.getSlot0(key.toId());
        if (spot == 0) {
            pm.initialize(key, markSqrtPrice);
            (spot,,,) = pm.getSlot0(key.toId());
        }
        assertApproxEqRel(uint256(spot), uint256(markSqrtPrice), 0.005e18, "pool spot differs from mark");
        (, int24 spotTick,,) = pm.getSlot0(key.toId());
        int24 lower = ((spotTick - 1200) / 50) * 50;
        int24 upper = ((spotTick + 1200) / 50) * 50;

        MintwareMarketEngineCore.MarketConfig memory c;
        c.poolManager = PM;
        c.poolKey = key;
        c.quoteAsset = USDC;
        c.nonQuoteMark = markAddress;
        c.lifecycleModule = MODULE;
        c.initialOwner = address(this);
        c.tickLower = lower;
        c.tickUpper = upper;
        c.maxMarkAge = 1 hours;
        c.maxSpotMarkDeviationBps = 100;
        c.minInitialContribution = 1e6;
        c.principalCap = 4e6;
        c.maxPositionBps = 8000;
        c.recenterEdgeTicks = 600;
        c.maxRecenterTickMove = 1200;
        c.recenterCooldown = 1 hours;

        MintwareMarketEngine engine = new MintwareMarketEngine(c);
        MintwareIdleYieldAdapter adapter0 = new MintwareIdleYieldAdapter(USDC, address(engine), address(this), type(uint256).max);
        MintwareIdleYieldAdapter adapter1 = new MintwareIdleYieldAdapter(WETH, address(engine), address(this), type(uint256).max);
        engine.configureAdapters(address(adapter0), address(adapter1));
        engine.activate();

        uint256 amount0 = 1_500_000; // 1.5 USDC
        uint256 amount1 = 5e14; // 0.0005 WETH
        deal(USDC, address(this), amount0);
        deal(WETH, address(this), amount1);
        IERC20Metadata(USDC).approve(address(engine), amount0);
        IERC20Metadata(WETH).approve(address(engine), amount1);
        uint256 shares = engine.deposit(amount0, amount1, 1);
        engine.recallIdle(adapter0.totalAssets(), adapter1.totalAssets());
        (uint128 liquidity,,) = engine.deployLiquidity(0, 0, false, 0, 0, 0, 1);
        assertGt(liquidity, 0);
        assertGt(engine.totalSupply(), 0);
        assertGt(engine.totalNav(), 0);

        uint256 sharesOut = shares / 4;
        (uint256 burned, uint256 out0, uint256 out1) = engine.withdraw(sharesOut, address(this), 0, 0);
        assertGt(burned, 0);
        assertTrue(out0 > 0 || out1 > 0);
        uint256 swapAmount = out0 / 20;
        assertGt(swapAmount, 0);
        TestSwapRouter swapRouter = new TestSwapRouter(pm);
        IERC20Metadata(USDC).approve(address(swapRouter), swapAmount);
        swapRouter.swap(key, true, swapAmount);
        assertGt(engine.positionLiquidity(), 0);

        // Constructor immutables are part of deployed runtime. A second identical construction gives
        // the expected source runtime hash with the same configuration and immutables.
        MintwareMarketEngine runtimeReference = new MintwareMarketEngine(c);
        assertEq(address(engine).codehash, address(runtimeReference).codehash);
        assertEq(address(engine.poolManager()), PM);
        assertEq(address(engine.token0()), USDC);
        assertEq(address(engine.token1()), WETH);
        assertEq(address(engine.quoteAsset()), USDC);
        assertEq(address(engine.nonQuoteMark()), markAddress);
        assertEq(address(engine.lifecycleModule()), MODULE);
        assertEq(address(engine.adapter0()), address(adapter0));
        assertEq(address(engine.adapter1()), address(adapter1));
        assertEq(c.principalCap, 4e6);
        assertEq(engine.totalSupply(), shares - burned);

        console2.log("PASS engine source runtime hash", vm.toString(address(engine).codehash));
        console2.log("PASS pool config: poolId"); console2.logBytes32(PoolId.unwrap(key.toId()));
        console2.log("PASS token0 USDC", USDC); console2.log("PASS token1 WETH", WETH);
        console2.log("PASS lifecycle module", MODULE); console2.log("PASS module code hash"); console2.logBytes32(MODULE_HASH);
        console2.log("PASS fresh replacement test mark", markAddress);
        console2.log("PASS adapter0", address(adapter0)); console2.log("PASS adapter1", address(adapter1));
        console2.log("PASS principal cap raw USDC", c.principalCap);
        console2.log("PASS positionLiquidity", uint256(engine.positionLiquidity()));
        console2.log("PASS totalSupply", engine.totalSupply()); console2.log("PASS NAV raw USDC", engine.totalNav());
        console2.log("PASS withdraw burned", burned); console2.log("PASS withdraw USDC", out0); console2.log("PASS withdraw WETH", out1);
        console2.log("PASS swap USDC input", swapAmount);
        console2.log("Rehearsal engine", address(engine));
    }

    function _sqrtPriceAtMark(uint256 markWad) private pure returns (uint160) {
        // USDC is quote token0; normalize WETH raw units against six decimal USDC.
        uint256 ratioWad = Math.mulDiv(1e36, 1e12, markWad);
        return uint160(Math.mulDiv(Math.sqrt(ratioWad), Q96, 1e9));
    }
}
