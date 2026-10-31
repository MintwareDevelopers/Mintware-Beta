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
        0x9fb68029d316c682a41b625177cc8a7431cd03df38ee5878e3c045edb634bc01;

    constructor(MarketConfig memory config)
        MintwareMarketEngineCore(config, false, EXPECTED_LIFECYCLE_MODULE_CODEHASH)
    {}
}
