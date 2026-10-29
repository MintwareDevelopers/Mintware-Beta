// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MWGuardianPausable} from "../lib/MWGuardianPausable.sol";

/// @title MintwareV4PoolVault
/// @notice Shared V4 pool identity and control base for Mintware position owners.
/// @dev Owns the shared PoolManager, pool identity/range, guardian pause, and reentrancy guard. It
///      deliberately owns no position shares, fee accounting, protocol-fee recipient, initialization
///      policy, settlement helper, or product-specific unlock dispatch.
abstract contract MintwareV4PoolVault is MWGuardianPausable, ReentrancyGuard {
    IPoolManager public immutable poolManager;

    PoolKey public poolKey;
    bool public poolInitialized;
    int24 public tickLower;
    int24 public tickUpper;

    event PoolInitialized(bytes32 indexed poolId, uint160 sqrtPriceX96);

    error PoolAlreadyInitialized();
    error OnlyPoolManager();
    error PoolManagerHasNoCode();

    constructor(address poolManager_, address initialOwner) MWGuardianPausable(initialOwner) {
        if (poolManager_.code.length == 0) revert PoolManagerHasNoCode();
        poolManager = IPoolManager(poolManager_);
    }

    /// @dev Guard for a subclass's `unlockCallback` — only the PoolManager may call it.
    function _onlyPoolManager() internal view {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
    }
}
