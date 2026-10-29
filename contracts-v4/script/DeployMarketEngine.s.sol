// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import { IMarketAdapterBinding } from "../src/vaults/IMarketAdapterBinding.sol";
import { MintwareMarketEngine } from "../src/vaults/MintwareMarketEngine.sol";
import { MintwareMarketEngineCore } from "../src/vaults/MintwareMarketEngineCore.sol";
import { MintwareMarketLifecycleModule } from "../src/vaults/MintwareMarketLifecycleModule.sol";
import { MarketEngineAdapterDeployment } from "./lib/MarketEngineAdapterDeployment.sol";

/// @notice Canonical Foundry installer for one eligible, hookless V4 market pool.
/// @dev Creates one engine and two token-specific adapters. Existing product claim owners remain untouched.
///      Robinhood mainnet is excluded until its chain-specific preflight and install runbook are defined.
contract DeployMarketEngine is Script {
    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint256 private constant ROBINHOOD_TESTNET_CHAIN_ID = 46630;
    address private constant BASE_SEPOLIA_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address private constant ROBINHOOD_TESTNET_POOL_MANAGER =
        0x8366a39CC670B4001A1121B8F6A443A643e40951;

    error MainnetRequiresDedicatedPreflight();
    error EnvValueOutOfRange(string name);
    error InvalidOwner();
    error InvalidConfiguration();
    error UnsupportedChain(uint256 chainId);
    error InvalidAdapterSource(address asset, address source);

    function _uint24(string memory name) private view returns (uint24 value) {
        uint256 raw = vm.envUint(name);
        if (raw > type(uint24).max) revert EnvValueOutOfRange(name);
        value = uint24(raw);
    }

    function _int24(string memory name) private view returns (int24 value) {
        int256 raw = vm.envInt(name);
        if (raw < type(int24).min || raw > type(int24).max) revert EnvValueOutOfRange(name);
        value = int24(raw);
    }

    function _uint16(string memory name) private view returns (uint16 value) {
        uint256 raw = vm.envUint(name);
        if (raw > type(uint16).max) revert EnvValueOutOfRange(name);
        value = uint16(raw);
    }

    function _uint64(string memory name) private view returns (uint64 value) {
        uint256 raw = vm.envUint(name);
        if (raw > type(uint64).max) revert EnvValueOutOfRange(name);
        value = uint64(raw);
    }

    function run() external {
        if (block.chainid == ROBINHOOD_MAINNET_CHAIN_ID) {
            revert MainnetRequiresDedicatedPreflight();
        }
        address poolManager = vm.envAddress("MARKET_POOL_MANAGER");
        bool testOnly = vm.envOr("MARKET_TEST_ONLY", false);
        if (block.chainid == BASE_SEPOLIA_CHAIN_ID) {
            if (!testOnly || poolManager != BASE_SEPOLIA_POOL_MANAGER) {
                revert InvalidConfiguration();
            }
        } else if (block.chainid == ROBINHOOD_TESTNET_CHAIN_ID) {
            if (!testOnly || poolManager != ROBINHOOD_TESTNET_POOL_MANAGER) {
                revert InvalidConfiguration();
            }
        } else {
            revert UnsupportedChain(block.chainid);
        }

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envAddress("MARKET_OWNER");
        address guardian = vm.envAddress("MARKET_GUARDIAN");
        if (owner == address(0) || guardian == address(0)) revert InvalidOwner();

        address currency0 = vm.envAddress("MARKET_CURRENCY0");
        address currency1 = vm.envAddress("MARKET_CURRENCY1");
        address quoteAsset = vm.envAddress("MARKET_QUOTE_ASSET");
        address mark = vm.envAddress("MARKET_NONQUOTE_MARK");
        address lifecycleModule = vm.envAddress("MARKET_LIFECYCLE_MODULE");
        address source0 = vm.envAddress("MARKET_CURRENCY0_ERC4626"); // zero explicitly selects idle custody
        address source1 = vm.envAddress("MARKET_CURRENCY1_ERC4626"); // zero explicitly selects idle custody
        int24 tickSpacing = _int24("MARKET_TICK_SPACING");
        int24 tickLower = _int24("MARKET_TICK_LOWER");
        int24 tickUpper = _int24("MARKET_TICK_UPPER");
        uint24 fee = _uint24("MARKET_POOL_FEE");
        uint256 principalCap = vm.envUint("MARKET_PRINCIPAL_CAP");
        uint256 minimumInitial = vm.envUint("MARKET_MIN_INITIAL_CONTRIBUTION");
        uint64 maxMarkAge = _uint64("MARKET_MAX_MARK_AGE");
        uint16 maxSpotMarkDeviationBps = _uint16("MARKET_MAX_SPOT_MARK_DEVIATION_BPS");
        uint16 maxPositionBps = _uint16("MARKET_MAX_POSITION_BPS");
        int24 recenterEdgeTicks = _int24("MARKET_RECENTER_EDGE_TICKS");
        int24 maxRecenterTickMove = _int24("MARKET_MAX_RECENTER_TICK_MOVE");
        uint64 recenterCooldown = _uint64("MARKET_RECENTER_COOLDOWN");

        if (
            poolManager.code.length == 0 || currency0 >= currency1 || currency0 == address(0)
                || currency1 == address(0) || quoteAsset == address(0) || mark.code.length == 0
                || lifecycleModule.code.length == 0 || tickSpacing <= 0 || fee > 1_000_000
                || maxMarkAge == 0 || maxSpotMarkDeviationBps == 0
                || maxSpotMarkDeviationBps > 10_000 || maxPositionBps == 0
                || maxPositionBps > 10_000 || recenterEdgeTicks <= 0 || maxRecenterTickMove <= 0
                || recenterCooldown == 0 || (source0 != address(0) && source0.code.length == 0)
                || (source1 != address(0) && source1.code.length == 0)
        ) revert InvalidConfiguration();

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });

        vm.startBroadcast(deployerKey);
        MintwareMarketEngineCore.MarketConfig memory marketConfig =
            MintwareMarketEngineCore.MarketConfig({
                poolManager: poolManager,
                poolKey: key,
                quoteAsset: quoteAsset,
                nonQuoteMark: mark,
                lifecycleModule: lifecycleModule,
                initialOwner: deployer,
                tickLower: tickLower,
                tickUpper: tickUpper,
                maxMarkAge: maxMarkAge,
                maxSpotMarkDeviationBps: maxSpotMarkDeviationBps,
                minInitialContribution: minimumInitial,
                principalCap: principalCap,
                maxPositionBps: maxPositionBps,
                recenterEdgeTicks: recenterEdgeTicks,
                maxRecenterTickMove: maxRecenterTickMove,
                recenterCooldown: recenterCooldown
            });
        MintwareMarketEngine engine = new MintwareMarketEngine(marketConfig);

        IMarketAdapterBinding adapter0 =
            MarketEngineAdapterDeployment.deploy(currency0, source0, address(engine), owner);
        IMarketAdapterBinding adapter1 =
            MarketEngineAdapterDeployment.deploy(currency1, source1, address(engine), owner);
        require(
            adapter0.asset() == engine.token0() && adapter1.asset() == engine.token1(),
            "adapter asset mismatch"
        );
        require(
            adapter0.vault() == address(engine) && adapter1.vault() == address(engine),
            "adapter vault mismatch"
        );

        engine.configureAdapters(address(adapter0), address(adapter1));
        engine.setGuardian(guardian);
        if (owner != deployer) engine.transferOwnership(owner);
        vm.stopBroadcast();

        console2.log("MintwareMarketEngine", address(engine));
        console2.log("adapter0", address(adapter0));
        console2.log("adapter1", address(adapter1));
        console2.log("poolManager", poolManager);
        console2.log("quoteAsset", quoteAsset);
        console2.log("lifecycleModule", address(MintwareMarketLifecycleModule(lifecycleModule)));
        console2.log("maxSpotMarkDeviationBps", maxSpotMarkDeviationBps);
        console2.log("recenterEdgeTicks", uint256(uint24(recenterEdgeTicks)));
        console2.log("maxRecenterTickMove", uint256(uint24(maxRecenterTickMove)));
        console2.log("recenterCooldown", recenterCooldown);
        console2.log("owner", owner);
        console2.log("guardian", guardian);
        console2.log(
            "Engine is deployed inactive; verify the market, mark, adapters, and exit policy before activation."
        );
    }
}
