// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareMarketEngineCore} from "./MintwareMarketEngineCore.sol";
import {MintwareRwaAppraisalHook} from "../rwa/MintwareRwaAppraisalHook.sol";
import {MWMarketValuation} from "../lib/MWMarketValuation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPermissionsAdapter} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {PermissionFlags} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/libraries/PermissionFlags.sol";

/// @notice Direct PoolManager owner with underlying custody and non-transferable RWA claims.
contract MintwareOwnedPoolMarketEngine is MintwareMarketEngineCore {
    bytes32 private constant EXPECTED_LIFECYCLE_MODULE_CODEHASH =
        0x9fb68029d316c682a41b625177cc8a7431cd03df38ee5878e3c045edb634bc01;
    MintwareRwaAppraisalHook public immutable appraisalHook;
    IPermissionsAdapter public immutable permissionsAdapter;
    error SharesNonTransferable();
    error LiquidityNotAllowed();

    constructor(MarketConfig memory config)
        MintwareMarketEngineCore(config, true, EXPECTED_LIFECYCLE_MODULE_CODEHASH)
    {
        MintwareRwaAppraisalHook hook = MintwareRwaAppraisalHook(address(config.poolKey.hooks));
        address adapter = Currency.unwrap(quoteIsToken0 ? config.poolKey.currency1 : config.poolKey.currency0);
        if (config.nonQuoteMark != address(hook) || config.poolKey.fee != 0x800000
            || address(hook.poolManager()) != config.poolManager || hook.quoteAsset() != config.quoteAsset
            || address(hook.permissionsAdapter()) != adapter
            || hook.permissionsFactory().verifiedPermissionsAdapterOf(adapter) != hook.asset()
            || PoolId.unwrap(hook.expectedPoolId()) != PoolId.unwrap(PoolIdLibrary.toId(config.poolKey))) {
            revert InvalidConfiguration();
        }
        appraisalHook = hook;
        permissionsAdapter = IPermissionsAdapter(adapter);
    }

    /// @notice The engine acts for its pooled position, never for the keeper/recenter caller.
    function msgSender() external view returns (address) { return address(this); }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert SharesNonTransferable();
        if (from == address(0) && (!permissionsAdapter.allowedWrappers(address(this))
            || !permissionsAdapter.isAllowed(address(this), PermissionFlags.LIQUIDITY_ALLOWED)
            || !permissionsAdapter.isAllowed(to, PermissionFlags.LIQUIDITY_ALLOWED))) revert LiquidityNotAllowed();
        super._update(from, to, value);
    }

    function _swapIdleExactIn(bool, uint256, uint256, uint160)
        internal pure override returns (uint256, uint256)
    { revert InvalidSwap(); }

    function _readPrices() internal view override returns (uint256, uint256) {
        if (appraisalHook.vault() != address(this)) revert InvalidConfiguration();
        if (!appraisalHook.isFresh()) revert ExitMarkUnavailable();
        return super._readPrices();
    }

    function readPricesForExit() external view override returns (uint256, uint256) {
        if (msg.sender != address(this)) revert NotSelf();
        (uint256 price,) = MWMarketValuation.freshPriceWad(nonQuoteMark, appraisalHook.maxExitMarkAge());
        return quoteIsToken0 ? (uint256(1e18), price) : (price, uint256(1e18));
    }
}
