// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {IMarketAdapterBinding} from "../../src/vaults/IMarketAdapterBinding.sol";
import {MintwareIdleYieldAdapter} from "../../src/vaults/MintwareIdleYieldAdapter.sol";
import {MintwareERC4626YieldAdapter} from "../../src/vaults/MintwareERC4626YieldAdapter.sol";

/// @notice Shared adapter construction for the versioned MarketEngine installers.
/// @dev Internal-only script helper; it adds no onchain library deployment or claim behavior.
library MarketEngineAdapterDeployment {
    error InvalidAdapterSource(address asset, address source);

    function deploy(address asset, address source, address engine, address owner)
        internal
        returns (IMarketAdapterBinding adapter)
    {
        if (source == address(0)) {
            adapter = IMarketAdapterBinding(
                address(new MintwareIdleYieldAdapter(asset, engine, owner, type(uint256).max))
            );
        } else {
            if (source.code.length == 0 || IERC4626(source).asset() != asset) {
                revert InvalidAdapterSource(asset, source);
            }
            adapter = IMarketAdapterBinding(
                address(new MintwareERC4626YieldAdapter(asset, source, engine, owner))
            );
        }
    }
}
