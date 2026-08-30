// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}      from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @title  MockReadyOracle
/// @notice Minimal `IJitOracle` stand-in for the treasury-vault tests. It satisfies the
///         `MintwareTreasuryVault.deployToLP` structural gate (which requires a READY oracle before senior
///         is exposed to the LP) and the `recoverableUSDC()` belt-and-suspenders (which refuses to value a
///         live position without a ready oracle) WITHOUT changing valuation: `oracleTick()` returns the
///         pool's LIVE tick, so the vault's `min(spot, oracle)` mark equals pure spot — exactly the
///         pre-fix behavior these suites were written against.
///
/// @dev    A production deployment uses the real `MintwareTreasuryJitHook`'s TRUNCATED (lagging) oracle,
///         which is what actually resists a single-block spot pump (proven by the JIT-leak PoC). This mock
///         deliberately does NOT lag — its only job is to make the deploy/redeem paths exercisable in
///         hookless test rigs. Never wire it as an actual V4 pool hook (it carries no permission bits and
///         is never routed through by swaps); the vault reads it purely via `setJitHook` + `_oracleTick()`.
contract MockReadyOracle {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    IPoolManager public immutable pm;
    PoolId       public immutable poolId;

    constructor(IPoolManager pm_, PoolKey memory key_) {
        pm     = pm_;
        poolId = key_.toId();
    }

    /// @notice Live pool tick, always "ready". Mirrors the JIT hook's `oracleTick()` selector/shape.
    function oracleTick() external view returns (int24 tick, bool ready) {
        (, tick,,) = pm.getSlot0(poolId);
        ready = true;
    }
}
