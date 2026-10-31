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
        0x8dc8c9b181f9dc54d50a53e9cbe3d68cda78f54ffe3add11e9ea6113166b8d5d;

    constructor(MarketConfig memory config)
        MintwareMarketEngineCore(config, false, EXPECTED_LIFECYCLE_MODULE_CODEHASH)
    {}
}
