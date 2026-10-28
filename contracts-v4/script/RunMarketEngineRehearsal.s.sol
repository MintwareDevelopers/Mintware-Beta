// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MintwareMarketEngineCore} from "../src/vaults/MintwareMarketEngineCore.sol";
import {TestSwapRouter} from "../test/helpers/TestSwapRouter.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @notice Ordered live transaction sequence after deploy and pool initialization.
contract RunMarketEngineRehearsal is Script {
    address constant PM = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    function run() external {
        require(block.chainid == 84532 && vm.envBool("MARKET_TEST_ONLY"), "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address engineAddress = vm.envAddress("MARKET_ENGINE");
        address token0 = vm.envAddress("MARKET_CURRENCY0");
        address token1 = vm.envAddress("MARKET_CURRENCY1");
        uint256 amount0 = vm.envUint("MARKET_DEPOSIT0");
        uint256 amount1 = vm.envUint("MARKET_DEPOSIT1");
        MintwareMarketEngineCore engine = MintwareMarketEngineCore(engineAddress);
        vm.startBroadcast(pk);
        if (!engine.activated()) engine.activate();
        IERC20(token0).approve(engineAddress, amount0);
        IERC20(token1).approve(engineAddress, amount1);
        uint256 shares = engine.deposit(amount0, amount1, 1);
        console2.log("Deposit shares", shares);
        engine.recallIdle(engine.adapter0().totalAssets(), engine.adapter1().totalAssets());
        (uint128 liquidity,,) = engine.deployLiquidity(0, 0, false, 0, 0, 0, 1);
        console2.log("Liquidity deployed", uint256(liquidity));
        uint256 exitShares = shares / 4;
        (uint256 burned, uint256 out0, uint256 out1) = engine.withdraw(exitShares, vm.addr(pk), 0, 0);
        require(burned != 0 && (out0 != 0 || out1 != 0), "withdraw returned nothing");
        console2.log("Withdraw burned", burned);
        console2.log("Withdraw token0", out0);
        console2.log("Withdraw token1", out1);
        TestSwapRouter router = new TestSwapRouter(IPoolManager(PM));
        PoolKey memory poolKey = PoolKey(Currency.wrap(token0), Currency.wrap(token1), uint24(vm.envUint("MARKET_POOL_FEE")), int24(vm.envInt("MARKET_TICK_SPACING")), IHooks(address(0)));
        // Trade a small amount of the returned quote token through the now-funded band.
        uint256 swapAmount = out0 / 20;
        require(swapAmount != 0, "withdraw quote too small for swap");
        IERC20(token0).approve(address(router), swapAmount);
        router.swap(poolKey, true, swapAmount);
        vm.stopBroadcast();
        console2.log("Swap input", swapAmount);
        console2.log("Swap router", address(router));
    }
}

