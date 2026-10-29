// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IMarketAssetMark } from "../src/vaults/IMarketAssetMark.sol";

/// @notice Deploy a timestamped, fixed-price mark for valueless Base Sepolia mechanics only.
contract FreshTestMark is IMarketAssetMark {
    address public immutable asset;
    address public immutable quoteAsset;
    uint256 public immutable priceWad;
    uint64 public immutable updatedAt;

    constructor(address asset_, address quote_, uint256 priceWad_) {
        require(asset_ != address(0) && quote_ != address(0) && asset_ != quote_ && priceWad_ != 0);
        asset = asset_;
        quoteAsset = quote_;
        priceWad = priceWad_;
        updatedAt = uint64(block.timestamp);
    }

    function latestMark() external view override returns (uint256, uint64) {
        return (priceWad, updatedAt);
    }
}

contract DeployMarketTestMark is Script {
    function run() external {
        require(
            (block.chainid == 84532
                    && vm.envAddress("MARKET_POOL_MANAGER")
                        == 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408)
                || (block.chainid == 46630
                    && vm.envAddress("MARKET_POOL_MANAGER")
                        == 0x8366a39CC670B4001A1121B8F6A443A643e40951),
            "unsupported testnet"
        );
        require(vm.envBool("MARKET_TEST_ONLY"), "testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address asset = vm.envAddress("MARKET_NONQUOTE_ASSET");
        address quote = vm.envAddress("MARKET_QUOTE_ASSET");
        uint256 price = vm.envUint("MARKET_TEST_PRICE_WAD");
        vm.startBroadcast(pk);
        FreshTestMark mark = new FreshTestMark(asset, quote, price);
        vm.stopBroadcast();
        console2.log("FreshTestMark", address(mark));
        console2.log("PriceWad", price);
        console2.log("UpdatedAt", uint256(mark.updatedAt()));
        console2.log("TEST ONLY. Fixed mark; never use for a value-bearing or production market.");
    }
}
