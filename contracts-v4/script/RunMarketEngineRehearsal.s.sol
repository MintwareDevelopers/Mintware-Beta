// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MintwareMarketEngineCore } from "../src/vaults/MintwareMarketEngineCore.sol";
import { TestSwapRouter } from "../test/helpers/TestSwapRouter.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @notice Ordered live transaction sequence after deploy and pool initialization.
contract RunMarketEngineRehearsal is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    address constant BASE_SEPOLIA_PM = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant ROBINHOOD_TESTNET_PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    function run() external {
        address pm = vm.envAddress("MARKET_POOL_MANAGER");
        require(
            (block.chainid == 84532 && pm == BASE_SEPOLIA_PM)
                || (block.chainid == 46630 && pm == ROBINHOOD_TESTNET_PM),
            "unsupported testnet"
        );
        require(vm.envBool("MARKET_TEST_ONLY"), "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address engineAddress = vm.envAddress("MARKET_ENGINE");
        address token0 = vm.envAddress("MARKET_CURRENCY0");
        address token1 = vm.envAddress("MARKET_CURRENCY1");
        uint256 amount0 = vm.envUint("MARKET_DEPOSIT_USDG");
        uint256 postDeploySwapAmount = vm.envUint("MARKET_SWAP_AMOUNT");
        MintwareMarketEngineCore engine = MintwareMarketEngineCore(engineAddress);
        vm.startBroadcast(pk);
        if (!engine.activated()) engine.activate();
        IERC20(token0).approve(engineAddress, amount0);
        uint256 shares = engine.deposit(amount0, 0, 1);
        console2.log("Deposit shares", shares);
        // Convert a portion of the single-sided USDG deposit against the existing V1 pool depth,
        // then deploy the paired assets into the configured band.
        (uint160 sqrtPriceX96,,,) = IPoolManager(pm).getSlot0(_poolKey(token0, token1).toId());
        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        uint160 sqrtLimit =
            TickMath.getSqrtPriceAtTick(currentTick - int24(vm.envInt("MARKET_SWAP_LIMIT_TICKS")));
        (uint128 liquidity,,) = engine.deployLiquidity(
            engine.adapter0().totalAssets(), 0, true, amount0 / 2, 1, sqrtLimit, 1
        );
        console2.log("Liquidity deployed", uint256(liquidity));
        TestSwapRouter router = new TestSwapRouter(IPoolManager(pm));
        PoolKey memory poolKey = _poolKey(token0, token1);
        IERC20(token0).approve(address(router), postDeploySwapAmount);
        router.swap(poolKey, true, postDeploySwapAmount);
        uint256 exitShares = shares / 4;
        (uint256 burned, uint256 out0, uint256 out1) =
            engine.withdraw(exitShares, vm.addr(pk), 0, 0);
        require(burned != 0 && (out0 != 0 || out1 != 0), "withdraw returned nothing");
        vm.stopBroadcast();
        console2.log("Deposit USDG", amount0);
        console2.log("Swap input", postDeploySwapAmount);
        console2.log("Swap router", address(router));
        console2.log("Withdraw burned", burned);
        console2.log("Withdraw token0", out0);
        console2.log("Withdraw token1", out1);
    }

    function _poolKey(address token0, address token1) private view returns (PoolKey memory) {
        return PoolKey(
            Currency.wrap(token0),
            Currency.wrap(token1),
            uint24(vm.envUint("MARKET_POOL_FEE")),
            int24(vm.envInt("MARKET_TICK_SPACING")),
            IHooks(address(0))
        );
    }
}

