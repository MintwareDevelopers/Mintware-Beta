// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback}     from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}            from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams}          from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}            from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}           from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal Uniswap V4 swap router for integration tests.
///         Implements the unlock → swap → settle pattern required by the V4 PoolManager.
contract TestSwapRouter is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    error OnlyPoolManager();

    struct SwapCallbackData {
        PoolKey   key;
        SwapParams params;
        address   caller;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // External — initiate swap
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Swap tokenIn → tokenOut via the V4 PoolManager.
    /// @param key          Pool key (includes hook address)
    /// @param zeroForOne   true = sell currency0, buy currency1
    /// @param amountIn     Exact input amount (token must be pre-approved to this router)
    /// @return delta       BalanceDelta (caller's net change; accounts for hook deltas)
    function swap(
        PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn
    ) external returns (BalanceDelta delta) {
        // Pull tokenIn from caller
        Currency tokenIn = zeroForOne ? key.currency0 : key.currency1;
        IERC20(Currency.unwrap(tokenIn)).safeTransferFrom(msg.sender, address(this), amountIn);

        // Build V4 swap params
        // amountSpecified < 0 = exact input in V4 (negative = exact input side)
        SwapParams memory params = SwapParams({
            zeroForOne:        zeroForOne,
            amountSpecified:   -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne
                ? TickMath.MIN_SQRT_PRICE + 1  // allow full range for zeroForOne
                : TickMath.MAX_SQRT_PRICE - 1  // allow full range for oneForZero
        });

        bytes memory result = poolManager.unlock(
            abi.encode(SwapCallbackData({key: key, params: params, caller: msg.sender}))
        );
        delta = abi.decode(result, (BalanceDelta));
    }

    /// @notice Exact-input swap with an explicit `sqrtPriceLimitX96` — the swap consumes input only until
    ///         the price limit is reached, then stops. Any unused input is refunded to the caller (so a
    ///         clamped swap strands nothing). Used by the treasury-vault invariant to move price WITHIN a
    ///         solvent band regardless of how deep the baseline pool is.
    function swapTo(
        PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external returns (BalanceDelta delta) {
        Currency tokenIn = zeroForOne ? key.currency0 : key.currency1;
        IERC20 tin = IERC20(Currency.unwrap(tokenIn));
        tin.safeTransferFrom(msg.sender, address(this), amountIn);

        SwapParams memory params = SwapParams({
            zeroForOne:        zeroForOne,
            amountSpecified:   -int256(amountIn),
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        bytes memory result = poolManager.unlock(
            abi.encode(SwapCallbackData({key: key, params: params, caller: msg.sender}))
        );
        delta = abi.decode(result, (BalanceDelta));

        // Refund the unused input left in the router after a clamped (partial) swap.
        uint256 leftover = tin.balanceOf(address(this));
        if (leftover > 0) tin.safeTransfer(msg.sender, leftover);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IUnlockCallback
    // ─────────────────────────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        SwapCallbackData memory d = abi.decode(data, (SwapCallbackData));

        // Execute swap inside the unlock context
        BalanceDelta delta = poolManager.swap(d.key, d.params, "");

        // Settle deltas:
        // negative amount = we owe that currency to the PoolManager (pay in)
        // positive amount = PoolManager owes us (take out, send to caller)
        _settle(d.key.currency0, delta.amount0(), d.caller);
        _settle(d.key.currency1, delta.amount1(), d.caller);

        return abi.encode(delta);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _settle(Currency currency, int128 amount, address recipient) internal {
        if (amount < 0) {
            // We owe this currency to the PoolManager
            uint256 owed = uint256(uint128(-amount));
            poolManager.sync(currency);
            SafeERC20.safeTransfer(IERC20(Currency.unwrap(currency)), address(poolManager), owed);
            poolManager.settle();
        } else if (amount > 0) {
            // PoolManager owes us this currency — take and forward to caller
            poolManager.take(currency, recipient, uint256(uint128(amount)));
        }
    }
}
