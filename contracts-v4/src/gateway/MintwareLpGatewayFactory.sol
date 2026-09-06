// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IYieldAdapter} from "../vaults/IYieldAdapter.sol";
import {MintwareLpGatewayStaging} from "./MintwareLpGatewayStaging.sol";
import {MintwareLpGatewayPositionManager, IPermit2Minimal} from "./MintwareLpGatewayPositionManager.sol";

/// @title  MintwareLpGatewayFactory
/// @notice CURATED (onlyOwner) factory for the multi-pool LP gateway: spins up an isolated
///         (staging + position manager) pair for a given pool. Each pool is a separate, ring-fenced
///         instance — depositors share only that pool, and a blowup in one can never touch another.
///         Curation is a human decision (the owner approves + calls createGateway), deliberately NOT an
///         automated TVL gate. Both child creation codes fit here (11.5KB + 2KB), so no deployer split.
contract MintwareLpGatewayFactory is Ownable {
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IPermit2Minimal public immutable permit2;

    struct Instance {
        address staging;
        address positionManager;
        bool active;
    }

    mapping(bytes32 => Instance) public instanceForPool; // poolId → instance
    bytes32[] public poolIds;

    error AlreadyExists();
    error NotFound();
    error ZeroAddress();

    event GatewayCreated(
        bytes32 indexed poolId, address staging, address positionManager, address quoteAsset, address gatewayOwner
    );
    event GatewayDeactivated(bytes32 indexed poolId);

    constructor(IPoolManager pm_, IPositionManager posm_, IPermit2Minimal permit2_, address owner_) Ownable(owner_) {
        if (address(pm_) == address(0) || address(posm_) == address(0) || address(permit2_) == address(0)) {
            revert ZeroAddress();
        }
        poolManager = pm_;
        positionManager = posm_;
        permit2 = permit2_;
    }

    /// @notice Curated: deploy an isolated gateway for `key`. Reverts if one already exists for the pool.
    function createGateway(
        PoolKey calldata key,
        IERC20 quoteAsset,
        IYieldAdapter adapter,
        int24 tickLower,
        int24 tickUpper,
        address gatewayOwner,
        address harvestRecipient
    ) external onlyOwner returns (address stagingAddr, address pmAddr) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (instanceForPool[poolId].positionManager != address(0)) revert AlreadyExists();

        MintwareLpGatewayStaging staging = new MintwareLpGatewayStaging(quoteAsset, adapter);
        MintwareLpGatewayPositionManager pm = new MintwareLpGatewayPositionManager(
            poolManager, positionManager, permit2, key, quoteAsset, tickLower, tickUpper, staging, gatewayOwner, harvestRecipient
        );
        staging.setController(address(pm));

        instanceForPool[poolId] = Instance({staging: address(staging), positionManager: address(pm), active: true});
        poolIds.push(poolId);
        emit GatewayCreated(poolId, address(staging), address(pm), address(quoteAsset), gatewayOwner);
        return (address(staging), address(pm));
    }

    /// @notice Retire a pool's gateway from the active set (deposits/harvest curated off at the app layer).
    function deactivate(bytes32 poolId) external onlyOwner {
        if (instanceForPool[poolId].positionManager == address(0)) revert NotFound();
        instanceForPool[poolId].active = false;
        emit GatewayDeactivated(poolId);
    }

    function poolCount() external view returns (uint256) {
        return poolIds.length;
    }
}
