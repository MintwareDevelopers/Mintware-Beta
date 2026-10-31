// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MintwareMarketEngine } from "../src/vaults/MintwareMarketEngine.sol";
import { MintwareMarketEngineCore } from "../src/vaults/MintwareMarketEngineCore.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";

/// @notice Read-only PASS/FAIL installation check. Use a fresh endpoint at the same chain.
contract VerifyMarketEngine is Script {
    using PoolIdLibrary for PoolKey;
    bytes32 constant EXPECTED_MODULE_HASH =
        0x8dc8c9b181f9dc54d50a53e9cbe3d68cda78f54ffe3add11e9ea6113166b8d5d;

    function run() external {
        address engineAddress = vm.envAddress("MARKET_ENGINE");
        address expected0 = vm.envAddress("MARKET_CURRENCY0");
        address expected1 = vm.envAddress("MARKET_CURRENCY1");
        address expectedQuote = vm.envAddress("MARKET_QUOTE_ASSET");
        address expectedMark = vm.envAddress("MARKET_NONQUOTE_MARK");
        address expectedModule = vm.envAddress("MARKET_LIFECYCLE_MODULE");
        address expectedAdapter0 = vm.envAddress("MARKET_ADAPTER0");
        address expectedAdapter1 = vm.envAddress("MARKET_ADAPTER1");
        uint256 expectedCap = vm.envUint("MARKET_PRINCIPAL_CAP");
        uint256 withdrawBurned = vm.envUint("MARKET_WITHDRAW_BURNED");
        uint256 withdraw0 = vm.envUint("MARKET_WITHDRAW_TOKEN0");
        uint256 withdraw1 = vm.envUint("MARKET_WITHDRAW_TOKEN1");

        MintwareMarketEngine engine = MintwareMarketEngine(engineAddress);
        uint24 fee = uint24(vm.envUint("MARKET_POOL_FEE"));
        int24 spacing = int24(vm.envInt("MARKET_TICK_SPACING"));
        PoolKey memory key = PoolKey(
            Currency.wrap(expected0), Currency.wrap(expected1), fee, spacing, IHooks(address(0))
        );
        PoolId id = key.toId();
        MintwareMarketEngineCore.MarketConfig memory c;
        c.poolManager = vm.envAddress("MARKET_POOL_MANAGER");
        c.poolKey = key;
        c.quoteAsset = expectedQuote;
        c.nonQuoteMark = expectedMark;
        c.lifecycleModule = expectedModule;
        c.initialOwner = vm.envAddress("MARKET_DEPLOYER");
        c.tickLower = _int24("MARKET_TICK_LOWER");
        c.tickUpper = _int24("MARKET_TICK_UPPER");
        c.maxMarkAge = uint64(vm.envUint("MARKET_MAX_MARK_AGE"));
        c.maxSpotMarkDeviationBps = uint16(vm.envUint("MARKET_MAX_SPOT_MARK_DEVIATION_BPS"));
        c.minInitialContribution = vm.envUint("MARKET_MIN_INITIAL_CONTRIBUTION");
        c.principalCap = expectedCap;
        c.maxPositionBps = uint16(vm.envUint("MARKET_MAX_POSITION_BPS"));
        c.recenterEdgeTicks = _int24("MARKET_RECENTER_EDGE_TICKS");
        c.maxRecenterTickMove = _int24("MARKET_MAX_RECENTER_TICK_MOVE");
        c.recenterCooldown = uint64(vm.envUint("MARKET_RECENTER_COOLDOWN"));
        MintwareMarketEngine expectedRuntime = new MintwareMarketEngine(c);

        _check(
            address(engine).code.length != 0
                && address(engine).codehash == address(expectedRuntime).codehash,
            "engine runtime code hash"
        );
        _check(address(engine.poolManager()) == c.poolManager, "pool manager");
        _check(
            address(engine.token0()) == expected0 && address(engine.token1()) == expected1, "tokens"
        );
        (
            Currency actual0,
            Currency actual1,
            uint24 actualFee,
            int24 actualSpacing,
            IHooks actualHooks
        ) = IPoolKeyReader(engineAddress).poolKey();
        _check(
            Currency.unwrap(actual0) == expected0 && Currency.unwrap(actual1) == expected1,
            "pool currencies"
        );
        _check(
            actualFee == fee && actualSpacing == spacing && address(actualHooks) == address(0),
            "pool fee/spacing/hooks"
        );
        _check(address(engine.quoteAsset()) == expectedQuote, "quote asset");
        _check(address(engine.nonQuoteMark()) == expectedMark, "mark");
        _check(address(engine.lifecycleModule()) == expectedModule, "lifecycle module");
        _check(expectedModule.codehash == EXPECTED_MODULE_HASH, "lifecycle module runtime hash");
        _check(
            address(engine.adapter0()) == expectedAdapter0
                && address(engine.adapter1()) == expectedAdapter1,
            "adapters"
        );
        _check(
            c.principalCap == expectedCap && c.principalCap >= c.minInitialContribution,
            "principal cap"
        );
        _check(engine.activated(), "activated");
        _check(engine.positionLiquidity() > 0, "position liquidity");
        _check(engine.totalSupply() > 0, "total supply");
        _check(engine.totalNav() > 0, "NAV");
        _check(withdrawBurned > 0 && (withdraw0 > 0 || withdraw1 > 0), "withdraw result");

        console2.log("PASS engine runtime code hash");
        console2.logBytes32(address(engine).codehash);
        console2.log("PASS branch compiled expected runtime hash");
        console2.logBytes32(address(expectedRuntime).codehash);
        console2.log("PASS config poolId");
        console2.logBytes32(PoolId.unwrap(id));
        console2.log("PASS config pool manager", c.poolManager);
        console2.log("PASS config token0", expected0);
        console2.log("PASS config token1", expected1);
        console2.log("PASS config quote", expectedQuote);
        console2.log("PASS config mark", expectedMark);
        console2.log("PASS config lifecycle module", expectedModule);
        console2.log("PASS lifecycle module runtime hash");
        console2.logBytes32(expectedModule.codehash);
        console2.log("PASS config adapter0", expectedAdapter0);
        console2.log("PASS config adapter1", expectedAdapter1);
        console2.log("PASS config principal cap", expectedCap);
        console2.log("PASS positionLiquidity", uint256(engine.positionLiquidity()));
        console2.log("PASS totalSupply", engine.totalSupply());
        console2.log("PASS NAV", engine.totalNav());
        console2.log("PASS withdraw burned", withdrawBurned);
        console2.log("PASS withdraw token0", withdraw0);
        console2.log("PASS withdraw token1", withdraw1);
    }

    function _check(bool condition, string memory label) private pure {
        if (!condition) {
            console2.log("FAIL", label);
            revert(label);
        }
    }

    function _int24(string memory name) private view returns (int24 value) {
        int256 raw = vm.envInt(name);
        require(raw >= type(int24).min && raw <= type(int24).max);
        value = int24(raw);
    }
}

interface IPoolKeyReader {
    function poolKey()
        external
        view
        returns (
            Currency currency0,
            Currency currency1,
            uint24 fee,
            int24 tickSpacing,
            IHooks hooks
        );
}
