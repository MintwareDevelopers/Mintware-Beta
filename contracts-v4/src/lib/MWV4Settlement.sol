// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPermissionsAdapter} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";

/// @notice Shared PoolManager settlement for V4 liquidity deltas.
/// @dev Internal functions inline into each caller; this creates no linked-library deployment or
///      new runtime authority. Token payments use the same SafeERC20 transfer semantics as the
///      original caller paths; rails that measure actual token consumption keep their own wrapper.
library MWV4Settlement {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;

    function settleDelta(IPoolManager poolManager, PoolKey memory key, BalanceDelta delta) internal {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        if (amount0 < 0) pay(poolManager, key.currency0, uint256(uint128(-amount0)));
        else if (amount0 > 0) poolManager.take(key.currency0, address(this), uint256(uint128(amount0)));

        if (amount1 < 0) pay(poolManager, key.currency1, uint256(uint128(-amount1)));
        else if (amount1 > 0) poolManager.take(key.currency1, address(this), uint256(uint128(amount1)));
    }

    error InexactAdapterFunding();

    /// @dev Assets are in PoolKey order, validated by the owned engine at construction.
    function settleAssetDelta(
        IPoolManager manager, PoolKey memory key, BalanceDelta delta, IERC20 asset0, IERC20 asset1
    ) internal {
        _settleAsset(manager, key.currency0, delta.amount0(), asset0);
        _settleAsset(manager, key.currency1, delta.amount1(), asset1);
    }

    function _settleAsset(IPoolManager manager, Currency currency, int128 delta, IERC20 asset) private {
        if (delta > 0) manager.take(currency, address(this), uint256(uint128(delta)));
        else if (delta < 0) {
            uint256 amount = uint256(uint128(-delta));
            address adapter = Currency.unwrap(currency);
            if (address(asset) == adapter) { pay(manager, currency, amount); return; }
            manager.sync(currency);
            uint256 beforeSelf = asset.balanceOf(address(this));
            uint256 beforeAdapter = asset.balanceOf(adapter);
            asset.safeTransfer(adapter, amount);
            if (beforeSelf - asset.balanceOf(address(this)) != amount
                || asset.balanceOf(adapter) - beforeAdapter != amount) revert InexactAdapterFunding();
            IPermissionsAdapter(adapter).wrapToPoolManager(amount);
            manager.settle();
        }
    }

    /// @notice Settle a swap delta and report the output asset actually received.
    /// @dev Shared by swap paths that use ordinary SafeERC20 input payment and require exact output
    ///      receipt before crediting the swap. The caller retains its own failure selector and
    ///      operation accounting. Exact-debit rails must keep their specialized payment path.
    function settleSwapDeltaExactOutput(
        IPoolManager poolManager,
        PoolKey memory key,
        BalanceDelta delta,
        bool zeroForOne
    ) internal returns (uint256 amountOut, bool exactOutputReceived) {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        if (amount0 < 0) pay(poolManager, key.currency0, uint256(uint128(-amount0)));
        else if (amount0 > 0 && !takeExactOutput(poolManager, key.currency0, uint256(uint128(amount0)))) {
            return (0, false);
        }

        if (amount1 < 0) pay(poolManager, key.currency1, uint256(uint128(-amount1)));
        else if (amount1 > 0 && !takeExactOutput(poolManager, key.currency1, uint256(uint128(amount1)))) {
            return (0, false);
        }

        amountOut = zeroForOne
            ? (amount1 > 0 ? uint256(uint128(amount1)) : 0)
            : (amount0 > 0 ? uint256(uint128(amount0)) : 0);
        exactOutputReceived = true;
    }

    /// @notice Execute a swap during the caller's active PoolManager unlock and settle its full delta.
    /// @dev Use only when the caller accepts the ordinary `take` receipt semantics. Paths that need
    ///      measured output delivery must keep their local delta handling and exact-receipt checks.
    function swapAndSettle(
        IPoolManager poolManager,
        PoolKey memory key,
        SwapParams memory params,
        bytes memory hookData
    ) internal {
        BalanceDelta delta = poolManager.swap(key, params, hookData);
        settleDelta(poolManager, key, delta);
    }

    function pay(IPoolManager poolManager, Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    /// @notice Take swap output only when the receiving contract gets the full nominal amount.
    /// @dev Callers retain their own error and subsequent accounting so a shared transfer invariant
    ///      does not merge otherwise distinct swap or claim lifecycles.
    function takeExactOutput(IPoolManager poolManager, Currency currency, uint256 amount) internal returns (bool) {
        return takeExactOutputTo(poolManager, currency, address(this), amount);
    }

    /// @notice Take output to a named recipient only when it receives the full nominal amount.
    /// @dev The caller retains its own failure selector and claim accounting.
    function takeExactOutputTo(IPoolManager poolManager, Currency currency, address recipient, uint256 amount)
        internal
        returns (bool)
    {
        uint256 beforeBalance = currency.balanceOf(recipient);
        poolManager.take(currency, recipient, amount);
        uint256 afterBalance = currency.balanceOf(recipient);
        return afterBalance >= beforeBalance && afterBalance - beforeBalance == amount;
    }
}
