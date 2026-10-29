// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Seed counterparty depth for the valueless local Robinhood fork rehearsal only.
contract SeedMarketTestPoolLiquidity is Script {
    address private constant BASE_SEPOLIA_PM = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address private constant ROBINHOOD_TESTNET_PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    function run() external {
        address pm = vm.envAddress("MARKET_POOL_MANAGER");
        require(
            (block.chainid == 84532 && pm == BASE_SEPOLIA_PM)
                || (block.chainid == 46630 && pm == ROBINHOOD_TESTNET_PM),
            "unsupported testnet"
        );
        require(vm.envBool("MARKET_TEST_ONLY"), "testnet only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address token0 = vm.envAddress("MARKET_CURRENCY0");
        address token1 = vm.envAddress("MARKET_CURRENCY1");
        uint24 fee = uint24(vm.envUint("MARKET_POOL_FEE"));
        int24 spacing = int24(vm.envInt("MARKET_TICK_SPACING"));
        uint128 liquidity = uint128(vm.envUint("MARKET_TEST_SEED_LIQUIDITY"));
        require(token0 < token1 && liquidity != 0, "invalid seed configuration");

        PoolKey memory poolKey = PoolKey(
            Currency.wrap(token0), Currency.wrap(token1), fee, spacing, IHooks(address(0))
        );
        vm.startBroadcast(key);
        PoolModifyLiquidityTest router = new PoolModifyLiquidityTest(IPoolManager(pm));
        IERC20(token0).approve(address(router), type(uint256).max);
        IERC20(token1).approve(address(router), type(uint256).max);
        router.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            bytes("")
        );
        vm.stopBroadcast();
        console2.log("Test liquidity router", address(router));
        console2.log("Test seed liquidity", uint256(liquidity));
        console2.log("TEST ONLY. This counterparty seed is for local fork mechanics.");
    }
}
