// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}    from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey}         from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency}        from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}    from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams}      from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}        from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title  DemoSwapRouter
/// @notice TESTNET ONLY — the minimal exact-input router the V2-RWAs demo trades through (stands in for the
///         issuer's licensed front end). Output is delivered STRAIGHT from the PoolManager to the caller, so
///         the property token's transfer gate checks the actual buyer. Has a `minOut` slippage floor.
/// @dev    The router must be an enrolled permitted holder (a seller's tokens pass through it on the way in).
contract DemoSwapRouter is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    struct CallbackData {
        PoolKey    key;
        SwapParams params;
        address    caller;
        uint256    minOut;
    }

    event DemoSwap(address indexed trader, bool zeroForOne, uint256 amountIn, uint256 amountOut);

    error OnlyPoolManager();
    error SlippageExceeded(uint256 out, uint256 minOut);

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minOut)
        external
        returns (uint256 amountOut)
    {
        Currency cin = zeroForOne ? key.currency0 : key.currency1;
        IERC20(Currency.unwrap(cin)).safeTransferFrom(msg.sender, address(this), amountIn);

        SwapParams memory p = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        bytes memory r = poolManager.unlock(abi.encode(CallbackData(key, p, msg.sender, minOut)));
        amountOut = abi.decode(r, (uint256));
        emit DemoSwap(msg.sender, zeroForOne, amountIn, amountOut);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        CallbackData memory d = abi.decode(data, (CallbackData));
        BalanceDelta delta = poolManager.swap(d.key, d.params, "");

        int128 a0 = delta.amount0();
        int128 a1 = delta.amount1();
        uint256 out = uint256(uint128(d.params.zeroForOne ? a1 : a0));
        if (out < d.minOut) revert SlippageExceeded(out, d.minOut);

        _settle(d.key.currency0, a0, d.caller);
        _settle(d.key.currency1, a1, d.caller);
        return abi.encode(out);
    }

    function _settle(Currency c, int128 amount, address recipient) private {
        if (amount < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), uint256(uint128(-amount)));
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(c, recipient, uint256(uint128(amount)));
        }
    }
}
