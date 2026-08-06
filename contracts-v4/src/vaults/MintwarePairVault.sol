// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MWGuardianPausable} from "../lib/MWGuardianPausable.sol";

/// @title  MintwarePairVault
/// @notice Shared abstract base for Mintware's dual-sided (token0/token1) V4 pair vaults —
///         currently MintwareDeFiPairVault (general balanced LP) and
///         MintwareMatchedLiquidityVault (team-locked launch liquidity).
///
///         Owns ONLY the machinery that is genuinely identical across both: the immutable
///         pool-manager / treasury handles, the pool identity + range state, the Stage-1.4
///         guardian kill-switch (via MWGuardianPausable), and the Uniswap V4 settlement
///         plumbing (`_settleDelta` / `_pay` / `_initializePool`) — the trickiest V4 code to
///         get right, so it lives in exactly one audited copy.
///
/// @dev    Deliberately does NOT unify the fee-accumulator or the unlock dispatch: the two
///         vaults distribute fees over different denominators (all-liquidity vs a
///         team-excluded community set) and use different unlock action sets, so forcing
///         those into the base would be a leaky abstraction. Subclasses implement
///         `IUnlockCallback` themselves and call these settlement helpers from within it.
abstract contract MintwarePairVault is MWGuardianPausable, ReentrancyGuard {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    address      public immutable treasury; // Mintware protocol-fee recipient

    PoolKey public poolKey;
    bool    public poolInitialized;
    int24   public tickLower;
    int24   public tickUpper;

    event PoolInitialized(bytes32 indexed poolId, uint160 sqrtPriceX96);

    error PoolAlreadyInitialized();
    error OnlyPoolManager();

    constructor(address _poolManager, address _treasury, address _initialOwner)
        MWGuardianPausable(_initialOwner)
    {
        poolManager = IPoolManager(_poolManager);
        treasury    = _treasury;
    }

    /// @dev Guard for the subclass's `unlockCallback` — only the PoolManager may call it.
    function _onlyPoolManager() internal view {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
    }

    /// @dev Initialize this vault's V4 pool once (poolKey must already be set).
    function _initializePool(uint160 sqrtPriceX96) internal {
        if (poolInitialized) revert PoolAlreadyInitialized();
        poolInitialized = true;
        poolManager.initialize(poolKey, sqrtPriceX96);
        emit PoolInitialized(PoolId.unwrap(poolKey.toId()), sqrtPriceX96);
    }

    /// @dev Settle a modifyLiquidity delta: negative = we owe the pool, positive = pool owes us.
    function _settleDelta(BalanceDelta delta) internal {
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0)      _pay(poolKey.currency0, uint256(uint128(-d0)));
        else if (d0 > 0) poolManager.take(poolKey.currency0, address(this), uint256(uint128(d0)));
        if (d1 < 0)      _pay(poolKey.currency1, uint256(uint128(-d1)));
        else if (d1 > 0) poolManager.take(poolKey.currency1, address(this), uint256(uint128(d1)));
    }

    /// @dev sync → transfer → settle (ERC-20 pull-then-settle).
    function _pay(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }
}
