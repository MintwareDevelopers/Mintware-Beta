// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IMarketAssetMark} from "../src/vaults/IMarketAssetMark.sol";

/// @notice Initialize the valueless Base Sepolia rehearsal pool at the existing fresh mark.
contract InitializeMarketTestPool is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    uint256 constant Q96 = 1 << 96;
    address constant PM = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    function run() external {
        require(block.chainid == 84532 && vm.envBool("MARKET_TEST_ONLY"), "testnet only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address token0 = vm.envAddress("MARKET_CURRENCY0");
        address token1 = vm.envAddress("MARKET_CURRENCY1");
        address mark = vm.envAddress("MARKET_NONQUOTE_MARK");
        uint256 fee = vm.envUint("MARKET_POOL_FEE");
        int256 spacing = vm.envInt("MARKET_TICK_SPACING");
        uint256 age = vm.envUint("MARKET_MAX_MARK_AGE");
        require(token0 < token1 && token0.code.length != 0 && token1.code.length != 0, "tokens");
        require(fee <= 1_000_000 && spacing > 0 && age > 0, "pool config");
        (uint256 markWad, uint64 updatedAt) = IMarketAssetMark(mark).latestMark();
        require(block.timestamp >= updatedAt && block.timestamp - updatedAt <= age, "stale mark");
        uint8 d0 = IERC20Metadata(token0).decimals();
        uint8 d1 = IERC20Metadata(token1).decimals();
        // Mark is quote tokens per non-quote asset. quote is token0 for the funded USDC/WETH pair.
        uint256 ratioWad = d1 >= d0
            ? Math.mulDiv(1e36, 10 ** (d1 - d0), markWad)
            : Math.mulDiv(1e36, 1, markWad * 10 ** (d0 - d1));
        uint160 sqrtPrice = uint160(Math.mulDiv(Math.sqrt(ratioWad), Q96, 1e9));
        int24 markTick = TickMath.getTickAtSqrtPrice(sqrtPrice);
        PoolKey memory poolKey = PoolKey(Currency.wrap(token0), Currency.wrap(token1), uint24(fee), int24(spacing), IHooks(address(0)));
        IPoolManager pm = IPoolManager(PM);
        (uint160 current,,,) = pm.getSlot0(poolKey.toId());
        if (current == 0) {
            vm.startBroadcast(key);
            int24 tick = pm.initialize(poolKey, sqrtPrice);
            vm.stopBroadcast();
            console2.log("Initialized tick", int256(tick));
        } else {
            (, int24 currentTick,,) = pm.getSlot0(poolKey.toId());
            uint256 tickDistance = currentTick >= markTick
                ? uint256(uint24(currentTick - markTick))
                : uint256(uint24(markTick - currentTick));
            uint256 maxTickDistance = vm.envUint("MARKET_MAX_SPOT_MARK_DEVIATION_BPS") * 2;
            require(tickDistance <= maxTickDistance, "initialized pool spot is outside mark band");
            console2.log("Pool already initialized; spot sqrt", uint256(current));
        }
        console2.log("PoolId"); console2.logBytes32(PoolId.unwrap(poolKey.toId()));
        console2.log("MarkWad", markWad);
    }
}

interface IERC20Metadata { function decimals() external view returns (uint8); }
