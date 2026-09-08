// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
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
contract MintwareLpGatewayFactory is Ownable2Step {
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
    // An adapter instance is a single Morpho/4626 position; sharing one across two gateways would pool
    // their staged capital and cross-contaminate NAV (finding M2). Each gateway MUST get its own freshly
    // deployed adapter — this guard makes reuse through the factory impossible.
    mapping(address => bool) public adapterUsed;

    // Default clamped-follower step the factory hands the position manager: the max the reference price
    // may track spot PER BLOCK (500 bps = 5% sqrtPrice ≈ 10% price/block). Tightened from 2000 per the
    // firm-grade review (H-03) — nothing reverts on price now, so a tighter step is strictly more
    // manipulation-resistant, at only a fairness cost during sharp legit trends. Per-pool override via arg.
    uint16 public constant DEFAULT_MAX_DEVIATION_BPS = 500;

    error AlreadyExists();
    error NotFound();
    error ZeroAddress();
    error AdapterReused();
    error AdapterAssetMismatch(); // C-9b / F-07: adapter.asset() answered, but not with the pool's quote asset
    error AdapterUnreadable(); // C-9b / F-07: adapter answers neither asset() nor totalAssets() — not an IYieldAdapter
    error AdapterAlreadyBound(); // C-9b / F-07: adapter.vault() is already wired to some other sink

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
        address harvestRecipient,
        uint16 maxDeviationBps
    ) external onlyOwner returns (address stagingAddr, address pmAddr) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (instanceForPool[poolId].positionManager != address(0)) revert AlreadyExists();
        if (adapterUsed[address(adapter)]) revert AdapterReused();
        adapterUsed[address(adapter)] = true;
        _verifyAdapterBinding(adapter, quoteAsset);

        uint16 band = maxDeviationBps == 0 ? DEFAULT_MAX_DEVIATION_BPS : maxDeviationBps;
        MintwareLpGatewayStaging staging = new MintwareLpGatewayStaging(quoteAsset, adapter);
        MintwareLpGatewayPositionManager pm = new MintwareLpGatewayPositionManager(
            poolManager, positionManager, permit2, key, quoteAsset, tickLower, tickUpper, staging, gatewayOwner, harvestRecipient, band
        );
        staging.setController(address(pm));

        instanceForPool[poolId] = Instance({staging: address(staging), positionManager: address(pm), active: true});
        poolIds.push(poolId);
        emit GatewayCreated(poolId, address(staging), address(pm), address(quoteAsset), gatewayOwner);
        return (address(staging), address(pm));
    }

    /// @dev Audit C-9b / Hacken F-07: verify the adapter is actually bound to THIS pool's quote asset before wiring
    ///      it under a fresh staging, instead of discovering a mis-wire on the first `deposit` (`OnlyVault` /
    ///      transfer failure — a DOA instance). `IYieldAdapter` has no asset getter, so this is a low-level probe:
    ///        1. `asset()` (the production `MintwareERC4626YieldAdapter` exposes it). If the adapter ANSWERS, the
    ///           answer MUST equal `quoteAsset` → else `AdapterAssetMismatch`.
    ///        2. If it does not implement `asset()` (an older / third-party `IYieldAdapter`, e.g. the Aave adapter
    ///           whose getter is `underlying()`), fall back to a sanity call: `totalAssets()` must succeed and return
    ///           a word (its VALUE may be zero — a fresh adapter holds nothing). A contract that answers neither is
    ///           not an `IYieldAdapter` → `AdapterUnreadable`. An EOA / codeless address fails here too (empty
    ///           returndata on both probes).
    ///        3. Best-effort: if the adapter exposes `vault()` and it is ALREADY non-zero, the adapter's one-time
    ///           sink is wired elsewhere and can never point at the new staging → `AdapterAlreadyBound`.
    ///      All probes are `staticcall`s — a hostile adapter can't reenter or mutate through them. This is a
    ///      wiring guard, not a trust guard: the curator still vets the adapter/source (the factory is onlyOwner).
    function _verifyAdapterBinding(IYieldAdapter adapter, IERC20 quoteAsset) internal view {
        address a = address(adapter);
        (bool ok, bytes memory ret) = a.staticcall(abi.encodeWithSignature("asset()"));
        if (ok && ret.length >= 32) {
            if (abi.decode(ret, (address)) != address(quoteAsset)) revert AdapterAssetMismatch();
        } else {
            (bool ok2, bytes memory ret2) = a.staticcall(abi.encodeWithSelector(IYieldAdapter.totalAssets.selector));
            if (!ok2 || ret2.length < 32) revert AdapterUnreadable();
        }
        (bool ok3, bytes memory ret3) = a.staticcall(abi.encodeWithSignature("vault()"));
        if (ok3 && ret3.length >= 32 && abi.decode(ret3, (address)) != address(0)) revert AdapterAlreadyBound();
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
