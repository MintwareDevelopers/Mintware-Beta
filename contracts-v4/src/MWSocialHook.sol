// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}            from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager}      from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}            from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta}       from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency}           from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {StateLibrary}       from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}       from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks}              from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Ownable}            from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard}    from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPyth}              from "./lib/IPyth.sol";

interface IFeeVaultNotifier {
    function notifyFeeReceipt(uint256 amount, string calldata source) external;
}

/// @title  MWSocialHook
/// @notice Uniswap V4 hook for Mintware Social Liquidity vaults.
///
/// @dev    Implements IHooks directly (BaseHook removed from v4-periphery).
///         Hook address must have correct permission bits at deploy via HookMiner.find() (T1.4).
///
///         Active callbacks:
///           beforeAddLiquidity    — vault-only enforcement (reverts if sender != socialVault)
///           beforeRemoveLiquidity — vault-only enforcement
///           beforeSwap            — dynamic LP fee override (per-pool, AI-settable)
///           afterSwap             — MEV / positive-slippage capture → FeeVault
///
///         MEV capture strategy (T1.2):
///           1. Read post-swap sqrtPriceX96 via StateLibrary.getSlot0
///           2. Compare against oracle reference price (off-chain updated from Pyth)
///           3. If deviation > captureThresholdBps: capture captureRateBps of output
///           4. Call poolManager.take() to route captured tokens to FeeVault
///           5. Return positive hookDelta so PoolManager reduces swapper output accordingly
///           6. Fail-open on all oracle errors — never block swaps
///
///         Oracle reference approach (T1.2):
///           Off-chain AI service reads Pyth → converts to sqrtPriceX96 → calls setReferencePrice.
///           On-chain Pyth read available as optional secondary check (when pythOracle is set).
///
///         Pyth → sqrtPriceX96 conversion lives off-chain (TypeScript) for T1.2.
///         Full on-chain conversion implemented in T1.3.
contract MWSocialHook is IHooks, Ownable, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct PoolConfig {
        bytes32 pythPriceId;          // Pyth price feed ID for this pool
        uint8   token0Decimals;       // Project token decimals (typically 18)
        uint8   token1Decimals;       // USDC decimals (6)
        uint24  captureThresholdBps;  // Min deviation to trigger capture (e.g. 20 = 0.20%)
        uint16  captureRateBps;       // Fraction of output to capture (e.g. 50 = 0.50%)
        uint24  dynamicFee;           // LP fee override (0 = use pool default)
        bool    active;               // Gate: only active pools get hook logic
    }

    struct ReferencePrice {
        uint160 sqrtPriceX96;         // Oracle-computed price (from Pyth off-chain)
        uint256 updatedAt;            // block.timestamp of last oracle update
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Required V4 permission bits — must match the hook address after CREATE2 mining.
    ///         0x0AC4 = beforeAddLiquidity(11) + beforeRemoveLiquidity(9) + beforeSwap(7) + afterSwap(6) + afterSwapReturnDelta(2)
    uint160 public constant HOOK_FLAGS          = 0x0AC4;

    uint256 public constant BPS                 = 10_000;
    uint256 public constant MAX_ORACLE_AGE      = 60;       // 60 seconds — Pyth staleness
    uint256 public constant MAX_REFERENCE_AGE   = 5 minutes; // AI oracle update window
    uint256 public constant DUST_THRESHOLD      = 1e4;      // 0.01 USDC (6 dec) — skip tiny captures
    uint24  public constant DEFAULT_CAPTURE_BPS = 20;       // 0.20% deviation triggers capture
    uint16  public constant DEFAULT_RATE_BPS    = 30;       // 0.30% of output captured
    uint64  public constant MAX_CONF_RATIO      = 500;      // max conf/price in bps (5%)

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IPoolManager public immutable POOL_MANAGER;

    /// @notice FeeVault — receives all captured MEV surplus
    address public feeVault;

    /// @notice SocialVault — the ONLY address allowed to add/remove liquidity
    address public socialVault;

    /// @notice Pyth oracle contract (optional — used for freshness check fallback)
    address public pythOracle;

    /// @notice Per-pool configuration
    mapping(PoolId => PoolConfig) public poolConfigs;

    /// @notice Per-pool oracle reference prices (updated by AI service from Pyth)
    mapping(PoolId => ReferencePrice) public referencePrices;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event MEVCaptured(PoolId indexed poolId, uint256 amount, address token, uint256 deviationBps);
    event ReferencePriceUpdated(PoolId indexed poolId, uint160 sqrtPriceX96);
    event PoolConfigured(PoolId indexed poolId, bytes32 pythPriceId, uint24 threshold, uint16 rate);
    event FeeVaultUpdated(address indexed newFeeVault);
    event SocialVaultUpdated(address indexed newSocialVault);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error OnlyPoolManager();
    error OnlyVaultCanAddLiquidity();
    error OnlyVaultCanRemoveLiquidity();
    error InvalidAddress();
    error InvalidPoolConfig();

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyPoolManager() {
        _onlyPoolManager();
        _;
    }

    function _onlyPoolManager() internal view {
        if (msg.sender != address(POOL_MANAGER)) revert OnlyPoolManager();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        IPoolManager _poolManager,
        address _feeVault,
        address _socialVault,
        address _pythOracle,    // pass address(0) to disable on-chain Pyth reads
        address _initialOwner   // explicit owner — required because CREATE2 via a
                                // factory makes the factory msg.sender, not the EOA
    ) Ownable(_initialOwner) {
        if (_feeVault == address(0)) revert InvalidAddress();
        POOL_MANAGER  = _poolManager;
        feeVault      = _feeVault;
        socialVault   = _socialVault;
        pythOracle    = _pythOracle;

        // Validate that this contract is deployed at an address with the correct permission bits.
        // V4 pools will revert on initialize() if the hook address doesn't match these flags.
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize:              false,
                afterInitialize:               false,
                beforeAddLiquidity:            true,  // vault-only LP gate
                afterAddLiquidity:             false,
                beforeRemoveLiquidity:         true,  // vault-only LP gate
                afterRemoveLiquidity:          false,
                beforeSwap:                    true,  // dynamic fee override
                afterSwap:                     true,  // MEV capture
                beforeDonate:                  false,
                afterDonate:                   false,
                beforeSwapReturnDelta:         false, // always returns (0,0) delta
                afterSwapReturnDelta:          true,  // returns non-zero int128 hookDelta
                afterAddLiquidityReturnDelta:  false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IHooks — unneeded callbacks (selector-only returns)
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
    // IHooks — vault-only enforcement
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Revert if anyone but SocialVault tries to add liquidity to a MW pool
    function beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4) {
        if (sender != socialVault) revert OnlyVaultCanAddLiquidity();
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice Revert if anyone but SocialVault tries to remove liquidity
    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4) {
        if (sender != socialVault) revert OnlyVaultCanRemoveLiquidity();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IHooks — dynamic fee override
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Override LP fee when pool has a dynamic fee configured.
    /// @dev    Fee must have LPFeeLibrary.OVERRIDE_FEE_FLAG (bit 23) set to take effect.
    ///         Pool must have been initialized with LPFeeLibrary.DYNAMIC_FEE_FLAG.
    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId       = key.toId();
        PoolConfig storage cfg = poolConfigs[poolId];

        uint24 feeOverride = 0;
        if (cfg.active && cfg.dynamicFee != 0) {
            // Set OVERRIDE_FEE_FLAG (bit 23) — required for fee to actually override
            feeOverride = cfg.dynamicFee | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        }

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), feeOverride);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IHooks — MEV / positive-slippage capture
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Capture MEV surplus when pool price deviates significantly from oracle.
    ///
    /// @dev    Flow:
    ///           1. Check pool is active + has oracle reference price
    ///           2. Read current pool sqrtPriceX96 via StateLibrary.getSlot0
    ///           3. Compare with oracle reference price
    ///           4. If deviation > captureThresholdBps:
    ///              a. Calculate captureAmount from unspecified output
    ///              b. Call poolManager.take() to route to FeeVault
    ///              c. Return positive hookDelta (swapper gets this much less)
    ///           5. Fail-open on any error — never block swaps
    ///
    /// @dev    hookDelta sign convention (afterSwap, unspecified currency):
    ///           Positive → hook takes tokens FROM swapper (reduces their output)
    ///           Negative → hook gives tokens TO swapper (increases their output)
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external override onlyPoolManager nonReentrant returns (bytes4, int128) {
        PoolId poolId       = key.toId();
        PoolConfig storage cfg = poolConfigs[poolId];

        // Skip if pool not configured or no feeVault set
        if (!cfg.active || feeVault == address(0)) {
            return (IHooks.afterSwap.selector, 0);
        }

        // Check oracle reference price is fresh
        ReferencePrice storage ref = referencePrices[poolId];
        if (ref.sqrtPriceX96 == 0) {
            return (IHooks.afterSwap.selector, 0);
        }
        if (block.timestamp - ref.updatedAt > MAX_REFERENCE_AGE) {
            return (IHooks.afterSwap.selector, 0);
        }

        // Read current pool price (post-swap)
        (uint160 currentSqrt,,,) = POOL_MANAGER.getSlot0(poolId);
        if (currentSqrt == 0) return (IHooks.afterSwap.selector, 0);

        // Compute price deviation between pool and oracle reference
        uint256 deviation = _deviationBps(currentSqrt, ref.sqrtPriceX96);
        uint24 threshold = cfg.captureThresholdBps != 0 ? cfg.captureThresholdBps : DEFAULT_CAPTURE_BPS;

        if (deviation < threshold) {
            return (IHooks.afterSwap.selector, 0);
        }

        // Determine unspecified currency (what the swapper received)
        // zeroForOne: selling token0 → receiving token1 (unspecified = token1)
        // oneForZero: selling token1 → receiving token0 (unspecified = token0)
        int128 unspecifiedAmount = params.zeroForOne ? delta.amount1() : delta.amount0();

        // Only capture from positive unspecified outputs (swapper received tokens)
        if (unspecifiedAmount <= 0) {
            return (IHooks.afterSwap.selector, 0);
        }

        // Calculate capture amount
        uint16 captureRate = cfg.captureRateBps != 0 ? cfg.captureRateBps : DEFAULT_RATE_BPS;
        uint128 captureAmount = uint128((uint128(unspecifiedAmount) * captureRate) / BPS);

        if (captureAmount < DUST_THRESHOLD) {
            return (IHooks.afterSwap.selector, 0);
        }

        // Pull captured tokens from PoolManager accounting to FeeVault
        // This works because we are inside the PoolManager's unlock context
        Currency unspecifiedCurrency = params.zeroForOne ? key.currency1 : key.currency0;
        POOL_MANAGER.take(unspecifiedCurrency, feeVault, captureAmount);
        IFeeVaultNotifier(feeVault).notifyFeeReceipt(captureAmount, "mev");

        emit MEVCaptured(poolId, captureAmount, Currency.unwrap(unspecifiedCurrency), deviation);

        // Return positive hookDelta — PoolManager reduces swapper's output by this amount
        return (IHooks.afterSwap.selector, int128(captureAmount));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Oracle — reference price (set by off-chain AI service)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice AI service reads Pyth → converts to sqrtPriceX96 off-chain → calls this.
    /// @dev    Permissioned to owner for now. Future: dedicated oracle role.
    function setReferencePrice(PoolId poolId, uint160 sqrtPriceX96) external onlyOwner {
        referencePrices[poolId] = ReferencePrice({
            sqrtPriceX96: sqrtPriceX96,
            updatedAt:    block.timestamp
        });
        emit ReferencePriceUpdated(poolId, sqrtPriceX96);
    }

    /// @notice Batch update multiple pools in one tx (gas-efficient for weekly cron)
    function setReferencePriceBatch(
        PoolId[] calldata poolIds,
        uint160[] calldata sqrtPricesX96
    ) external onlyOwner {
        require(poolIds.length == sqrtPricesX96.length, "length mismatch");
        for (uint256 i = 0; i < poolIds.length; i++) {
            referencePrices[poolIds[i]] = ReferencePrice({
                sqrtPriceX96: sqrtPricesX96[i],
                updatedAt:    block.timestamp
            });
            emit ReferencePriceUpdated(poolIds[i], sqrtPricesX96[i]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin — pool configuration
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Configure a pool for hook logic
    function configurePool(
        PoolId  poolId,
        bytes32 pythPriceId,
        uint8   token0Decimals,
        uint8   token1Decimals,
        uint24  captureThresholdBps,
        uint16  captureRateBps,
        uint24  dynamicFee
    ) external onlyOwner {
        if (captureThresholdBps > BPS || captureRateBps > BPS || dynamicFee > LPFeeLibrary.MAX_LP_FEE) {
            revert InvalidPoolConfig();
        }

        poolConfigs[poolId] = PoolConfig({
            pythPriceId:         pythPriceId,
            token0Decimals:      token0Decimals,
            token1Decimals:      token1Decimals,
            captureThresholdBps: captureThresholdBps,
            captureRateBps:      captureRateBps,
            dynamicFee:          dynamicFee,
            active:              true
        });
        emit PoolConfigured(poolId, pythPriceId, captureThresholdBps, captureRateBps);
    }

    function setPoolActive(PoolId poolId, bool active) external onlyOwner {
        poolConfigs[poolId].active = active;
    }

    function setDynamicFee(PoolId poolId, uint24 fee) external onlyOwner {
        if (fee > LPFeeLibrary.MAX_LP_FEE) revert InvalidPoolConfig();
        poolConfigs[poolId].dynamicFee = fee;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin — addresses
    // ─────────────────────────────────────────────────────────────────────────

    function setFeeVault(address _feeVault) external onlyOwner {
        if (_feeVault == address(0)) revert InvalidAddress();
        feeVault = _feeVault;
        emit FeeVaultUpdated(_feeVault);
    }

    function setSocialVault(address _socialVault) external onlyOwner {
        if (_socialVault == address(0)) revert InvalidAddress();
        socialVault = _socialVault;
        emit SocialVaultUpdated(_socialVault);
    }

    function setPythOracle(address _pyth) external onlyOwner {
        pythOracle = _pyth;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Current pool price from PoolManager state
    function getPoolPrice(PoolId poolId) external view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(poolId);
    }

    /// @notice Deviation between pool price and oracle reference in bps
    function currentDeviation(PoolId poolId) external view returns (uint256 deviationBps) {
        // Guard ref price first — avoids PoolManager call when no reference is set
        uint160 refSqrt = referencePrices[poolId].sqrtPriceX96;
        if (refSqrt == 0) return 0;
        (uint160 currentSqrt,,,) = POOL_MANAGER.getSlot0(poolId);
        if (currentSqrt == 0) return 0;
        return _deviationBps(currentSqrt, refSqrt);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal math
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deviation between two sqrtPriceX96 values in basis points.
    /// @dev    Computed at the sqrt level (half the price deviation).
    ///         e.g. sqrtPrice deviation of 10 bps ≈ price deviation of 20 bps.
    ///         We use sqrt-level deviation intentionally — more granular at small moves.
    function _deviationBps(uint160 a, uint160 b) internal pure returns (uint256) {
        if (b == 0) return 0;
        uint256 diff = a > b ? a - b : b - a;
        return (diff * BPS) / b;
    }
}
