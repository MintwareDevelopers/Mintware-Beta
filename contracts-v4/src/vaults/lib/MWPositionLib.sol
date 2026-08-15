// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title  MWPositionLib
/// @notice STATELESS, delegatecall-linked library holding the main-position V4 unlock handlers of
///         MintwareDeFiPairVault (`_deploy` / `_remove` / `_collect` / `_rebalance`), extracted verbatim
///         to keep the vault under the EIP-170 24,576-byte runtime limit. These run INSIDE the vault's
///         PoolManager unlock (dispatched from `unlockCallback`); delegatecalled, so `modifyLiquidity` /
///         `take` / `sync` / `settle` and every `token.balanceOf(address(this))` resolve AS the vault —
///         identical to the pre-extraction inline code.
///
/// @dev    Owns NO storage. `_deploy`/`_remove`/`_collect` are pure pool interactions returning ABI-
///         encoded amounts (the vault's callers do all state writes, exactly as before). `_rebalance`
///         mutates tickLower/tickUpper/positionLiquidity — the library performs the remove(old range)+
///         add(new range) and RETURNS the new liquidity; the vault wrapper persists the three fields
///         AFTER this returns (unobservable ordering vs the old mid-function writes: the pool hook's
///         liquidity callbacks never read the vault's tick storage, and `rebalanceToProfile` is
///         nonReentrant). Behavior — math, rounding, salt(0) main position, balance-diff accounting —
///         is byte-for-byte identical. Private `_settleDelta`/`_pay` copies mirror MintwarePairVault's
///         (the library cannot call the vault's internal ones).
library MWPositionLib {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    /// @dev Vault immutables + the live active range the library needs but cannot read under delegatecall.
    struct Ctx {
        IPoolManager pm;
        PoolKey      key;
        IERC20       t0;
        IERC20       t1;
        int24        tickLower;
        int24        tickUpper;
    }

    /// @notice Add the maximal balanced liquidity for (a0, a1) at the active range; salt 0 (main
    ///         position). Returns abi.encode(liquidity, used0, used1) — used* via balance diff (safe for
    ///         fee-on-transfer). Mirrors the old `_deploy`.
    function deploy(Ctx memory c, uint256 a0, uint256 a1) external returns (bytes memory) {
        (uint160 sqrtP,,,) = c.pm.getSlot0(c.key.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(c.tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(c.tickUpper);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtP, sqrtLower, sqrtUpper, a0, a1);
        if (liquidity == 0) return abi.encode(uint128(0), uint256(0), uint256(0));

        uint256 bal0Before = c.t0.balanceOf(address(this));
        uint256 bal1Before = c.t1.balanceOf(address(this));

        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: c.tickLower, tickUpper: c.tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(c, delta);

        uint256 used0 = bal0Before - c.t0.balanceOf(address(this));
        uint256 used1 = bal1Before - c.t1.balanceOf(address(this));
        return abi.encode(liquidity, used0, used1);
    }

    /// @notice Remove `liquidity` from the active range (salt 0); returns abi.encode(out0, out1) via
    ///         balance diff. Mirrors the old `_remove`.
    function remove(Ctx memory c, uint128 liquidity) external returns (bytes memory) {
        uint256 bal0Before = c.t0.balanceOf(address(this));
        uint256 bal1Before = c.t1.balanceOf(address(this));
        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: c.tickLower, tickUpper: c.tickUpper, liquidityDelta: -int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(c, delta);
        uint256 out0 = c.t0.balanceOf(address(this)) - bal0Before;
        uint256 out1 = c.t1.balanceOf(address(this)) - bal1Before;
        return abi.encode(out0, out1);
    }

    /// @notice Collect accrued fees on the active range (liquidityDelta 0, salt 0); returns
    ///         abi.encode(fee0, fee1). Mirrors the old `_collect`.
    function collect(Ctx memory c) external returns (bytes memory) {
        (BalanceDelta delta,) = c.pm.modifyLiquidity(
            c.key,
            ModifyLiquidityParams({tickLower: c.tickLower, tickUpper: c.tickUpper, liquidityDelta: 0, salt: bytes32(0)}),
            ""
        );
        _settleDelta(c, delta);
        uint256 fee0 = delta.amount0() > 0 ? uint256(uint128(delta.amount0())) : 0;
        uint256 fee1 = delta.amount1() > 0 ? uint256(uint128(delta.amount1())) : 0;
        return abi.encode(fee0, fee1);
    }

    /// @notice Move the whole main position from the OLD range (c.tickLower/c.tickUpper) to the NEW range
    ///         (newLower/newUpper), re-adding the maximal balanced liquidity from the vault's non-reserve
    ///         balance. Returns the new liquidity; the vault persists tickLower/tickUpper/positionLiquidity.
    ///         Mirrors the old `_rebalance` (the segregated feeReserve is excluded from the re-add).
    function rebalance(
        Ctx memory c,
        uint128 positionLiquidity,
        uint256 feeReserve0,
        uint256 feeReserve1,
        int24 newLower,
        int24 newUpper
    ) external returns (uint128 newLiquidity) {
        if (positionLiquidity > 0) {
            (BalanceDelta removeDelta,) = c.pm.modifyLiquidity(
                c.key,
                ModifyLiquidityParams({tickLower: c.tickLower, tickUpper: c.tickUpper, liquidityDelta: -int256(uint256(positionLiquidity)), salt: bytes32(0)}),
                ""
            );
            _settleDelta(c, removeDelta);
        }

        // Re-add the maximal balanced liquidity from the tokens now held by the vault, MINUS the
        // segregated fee/rent reserve — that balance backs LP claims and must never be deployed.
        uint256 a0 = c.t0.balanceOf(address(this)) - feeReserve0;
        uint256 a1 = c.t1.balanceOf(address(this)) - feeReserve1;
        (uint160 sqrtP,,,) = c.pm.getSlot0(c.key.toId());
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(newLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(newUpper);
        newLiquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtP, sqrtLower, sqrtUpper, a0, a1);
        if (newLiquidity > 0) {
            (BalanceDelta addDelta,) = c.pm.modifyLiquidity(
                c.key,
                ModifyLiquidityParams({tickLower: newLower, tickUpper: newUpper, liquidityDelta: int256(uint256(newLiquidity)), salt: bytes32(0)}),
                ""
            );
            _settleDelta(c, addDelta);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private settlement — copies of MintwarePairVault._settleDelta / _pay
    // ─────────────────────────────────────────────────────────────────────────

    function _settleDelta(Ctx memory c, BalanceDelta delta) private {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(c, c.key.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) c.pm.take(c.key.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(c, c.key.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) c.pm.take(c.key.currency1, address(this), uint256(uint128(d1)));
    }

    function _pay(Ctx memory c, Currency currency, uint256 amount) private {
        c.pm.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(c.pm), amount);
        c.pm.settle();
    }
}
