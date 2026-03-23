// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}            from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager}      from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks}             from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey}           from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta}      from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {IERC20}            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable}           from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard}   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  MWSocialHook
/// @notice Uniswap V4 hook for Mintware Social Liquidity vaults.
///
/// @dev    Implements IHooks directly (BaseHook removed in latest v4-core).
///         Hook address must have correct permission bits set at deployment
///         via HookMiner.find() (CREATE2 salt mining).
///
///         Active hook callbacks:
///           beforeAddLiquidity    — vault-only LP enforcement
///           beforeRemoveLiquidity — lock expiry backstop
///           beforeSwap            — dynamic fee override + anti-sandwich
///           afterSwap             — MEV / positive-slippage capture via hookDelta
///
///         All fee accounting, Attribution multipliers, epoch logic, and Merkle
///         distribution live OUTSIDE this contract in FeeVault / off-chain infra.
contract MWSocialHook is IHooks, Ownable, ReentrancyGuard {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant BPS              = 10_000;
    uint256 public constant MIN_CAPTURE_BPS  = 5;       // 0.05% min deviation
    uint256 public constant DUST_THRESHOLD   = 1e6;     // 1 USDC (6 decimals)

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IPoolManager public immutable poolManager;

    /// @notice FeeVault — receives all captured MEV surplus
    address public feeVault;

    /// @notice SocialVault — the only address allowed to add/remove liquidity
    address public socialVault;

    /// @notice Pyth oracle address
    address public pythOracle;

    /// @notice Per-pool dynamic fee override (0 = use pool default)
    mapping(bytes32 => uint24) public dynamicFees;

    /// @notice Per-pool Pyth price feed ID
    mapping(bytes32 => bytes32) public priceFeedIds;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event MEVCaptured(bytes32 indexed poolId, uint256 amount, address token);
    event DynamicFeeSet(bytes32 indexed poolId, uint24 fee);
    event FeeVaultUpdated(address indexed newFeeVault);
    event SocialVaultUpdated(address indexed newSocialVault);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error OnlyPoolManager();
    error OnlyVaultCanAddLiquidity();
    error OnlyVaultCanRemoveLiquidity();
    error InvalidFeeVault();

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        IPoolManager _poolManager,
        address _feeVault,
        address _socialVault,
        address _pythOracle
    ) Ownable(msg.sender) {
        if (_feeVault == address(0)) revert InvalidFeeVault();
        poolManager  = _poolManager;
        feeVault     = _feeVault;
        socialVault  = _socialVault;
        pythOracle   = _pythOracle;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IHooks — unneeded callbacks (return selector, no-op)
    // ─────────────────────────────────────────────────────────────────────────

    function beforeInitialize(address, PoolKey calldata, uint160)
        external pure override returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24)
        external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function afterAddLiquidity(
        address, PoolKey calldata, ModifyLiquidityParams calldata,
        BalanceDelta, BalanceDelta, bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function afterRemoveLiquidity(
        address, PoolKey calldata, ModifyLiquidityParams calldata,
        BalanceDelta, BalanceDelta, bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external pure override returns (bytes4) {
        return IHooks.afterDonate.selector;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IHooks — active callbacks
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Gate LP adds — only SocialVault may add liquidity to MW pools
    function beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4) {
        if (sender != socialVault) revert OnlyVaultCanAddLiquidity();
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice Lock expiry backstop — only SocialVault may remove liquidity
    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4) {
        if (sender != socialVault) revert OnlyVaultCanRemoveLiquidity();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    /// @notice Dynamic fee override + anti-sandwich protection
    /// @dev    Returns fee override in 3rd return value.
    ///         Fee must have bit 23 set (0x400000) to override pool fee.
    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        bytes32 poolId = _poolId(key);
        uint24 fee     = dynamicFees[poolId];

        // TODO (T1.3): sandwich detection using sqrtPriceX96 delta
        // TODO (T1.3): Pyth price freshness check — revert if stale

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), fee);
    }

    /// @notice MEV / positive-slippage capture
    /// @dev    Compares Pyth fair price vs execution price.
    ///         Skims surplus via negative hookDelta, routes to FeeVault.
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external override onlyPoolManager nonReentrant returns (bytes4, int128) {
        // TODO (T1.3):
        //   1. Read Pyth price for this pool (with confidence interval check)
        //   2. Compute fair output vs actual execution price
        //   3. If surplus > DUST_THRESHOLD and deviation > MIN_CAPTURE_BPS:
        //      a. Return negative int128 hookDelta (pulls tokens from PoolManager)
        //      b. Transfer captured tokens to feeVault
        //      c. emit MEVCaptured(poolId, amount, token)
        //
        // Safe default — no capture until T1.3
        return (IHooks.afterSwap.selector, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setFeeVault(address _feeVault) external onlyOwner {
        if (_feeVault == address(0)) revert InvalidFeeVault();
        feeVault = _feeVault;
        emit FeeVaultUpdated(_feeVault);
    }

    function setSocialVault(address _socialVault) external onlyOwner {
        socialVault = _socialVault;
        emit SocialVaultUpdated(_socialVault);
    }

    function setDynamicFee(bytes32 poolId, uint24 fee) external onlyOwner {
        dynamicFees[poolId] = fee;
        emit DynamicFeeSet(poolId, fee);
    }

    function setPriceFeed(bytes32 poolId, bytes32 pythPriceId) external onlyOwner {
        priceFeedIds[poolId] = pythPriceId;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _poolId(PoolKey calldata key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}
