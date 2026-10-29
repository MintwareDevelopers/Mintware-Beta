// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";

/// @notice Deploy the shared MarketEngine V2 lifecycle module on supported testnets.
contract DeployMarketLifecycleModule is Script {
    bytes32 private constant ENGINE_LIFECYCLE_MODULE_HASH =
        0x166985aa111748ed70d00e8956c48fe285b5ba59f50555ca71ec8487139871f9;
    string private constant CREATION_CODE_PATH =
        "contracts-v4/script/data/MintwareMarketLifecycleModuleV2.creation.hex";
    address private constant BASE_SEPOLIA_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address private constant ROBINHOOD_TESTNET_POOL_MANAGER =
        0x8366a39CC670B4001A1121B8F6A443A643e40951;

    function run() external {
        address pm = vm.envAddress("MARKET_POOL_MANAGER");
        require(
            (block.chainid == 84532 && pm == BASE_SEPOLIA_POOL_MANAGER)
                || (block.chainid == 46630 && pm == ROBINHOOD_TESTNET_POOL_MANAGER),
            "unsupported testnet"
        );
        require(vm.envBool("MARKET_TEST_ONLY"), "testnet only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        bytes memory creationText = bytes(vm.readFile(CREATION_CODE_PATH));
        uint256 textLength = creationText.length;
        while (
            textLength > 2
                && (creationText[textLength - 1] == 0x0a || creationText[textLength - 1] == 0x0d)
        ) {
            textLength--;
        }
        bytes memory normalizedCreationText = new bytes(textLength);
        for (uint256 i; i < textLength; i++) {
            normalizedCreationText[i] = creationText[i];
        }
        bytes memory creationCode = vm.parseBytes(string(normalizedCreationText));
        require(creationCode.length != 0, "empty lifecycle creation code");
        vm.startBroadcast(key);
        address module;
        assembly ("memory-safe") {
            module := create(0, add(creationCode, 0x20), mload(creationCode))
        }
        vm.stopBroadcast();
        require(module != address(0), "lifecycle module create failed");
        require(
            module.codehash == ENGINE_LIFECYCLE_MODULE_HASH,
            "lifecycle module hash differs from engine pin"
        );
        console2.log("MintwareMarketLifecycleModule", module);
        console2.log("Runtime code hash");
        console2.logBytes32(module.codehash);
    }
}
