// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareMarketEngineCore} from "./MintwareMarketEngineCore.sol";

/// @title MintwareMarketEngine
/// @notice Version 2 of the shared market claim, restricted to hookless pools.
/// @dev The implementation lives in `MintwareMarketEngineCore` so later generations can add
///      execution modes without cloning the market deposit, NAV, adapter, and exit lifecycle.
contract MintwareMarketEngine is MintwareMarketEngineCore {
    uint16 public constant ENGINE_VERSION = 2;

    bytes32 private constant EXPECTED_LIFECYCLE_MODULE_CODEHASH =
        0x166985aa111748ed70d00e8956c48fe285b5ba59f50555ca71ec8487139871f9;

    constructor(MarketConfig memory config)
        MintwareMarketEngineCore(config, false, EXPECTED_LIFECYCLE_MODULE_CODEHASH)
    {}
}
