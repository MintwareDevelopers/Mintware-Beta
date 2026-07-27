// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}              from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager}        from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}             from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta}        from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {StateLibrary}        from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}        from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {FullMath}            from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Hooks}               from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Ownable}             from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  MintwareOracleHook
/// @notice RWA-surface V4 hook (Track B). Enforces oracle-anchored price bands and sets a
///         band-based dynamic fee: within the ±core band a low fee, within the ±spec band a
///         higher fee, and OUTSIDE the spec band swaps revert. Also gates LP to the vault.
///
/// @dev    Deviation is computed in true price space. The pool price (token1/token0, Q96) is
///         priceX96 = sqrtPriceX96^2 / 2^96; the keeper's appraisal is stored in the same Q96
///         units, so `coreBandBps`/`specBandBps` are genuine ±% price bands (1500 = ±15%).
///         Permission bits: beforeAddLiquidity(11)+beforeRemoveLiquidity(9)+beforeSwap(7)=0xA80.
contract MintwareOracleHook is IHooks, Ownable {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    uint160 public constant HOOK_FLAGS = 0xA80;
    uint256 public constant BPS        = 10_000;
    uint256 internal constant TWO_96   = 1 << 96;

    uint24 public constant CORE_FEE_PIPS = 7_500;  // 0.75%
    uint24 public constant SPEC_FEE_PIPS = 20_000; // 2.00%

    struct BandConfig {
        uint256 appraisalX96; // keeper-set appraisal price (token1/token0), Q96
        uint16  coreBandBps;  // e.g. 1500 = ±15%
        uint16  specBandBps;  // e.g. 4500 = ±45%
        bool    configured;
    }

    IPoolManager public immutable POOL_MANAGER;
    address public vault;    // only LP
    address public keeper;   // sets appraisals

    mapping(PoolId => BandConfig) public bands;

    event VaultSet(address indexed vault);
    event KeeperSet(address indexed keeper);
    event PoolConfigured(PoolId indexed poolId, uint16 coreBandBps, uint16 specBandBps);
    event AppraisalSet(PoolId indexed poolId, uint256 appraisalX96);

    error OnlyPoolManager();
    error OnlyKeeper();
    error OnlyVaultCanModifyLiquidity();
    error PriceOutOfBands();

    modifier onlyPoolManager() {
        if (msg.sender != address(POOL_MANAGER)) revert OnlyPoolManager();
        _;
    }

    constructor(IPoolManager _poolManager, address _vault, address _keeper, address _initialOwner)
        Ownable(_initialOwner)
    {
        POOL_MANAGER = _poolManager;
        vault        = _vault;
        keeper       = _keeper;

        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize:              false,
                afterInitialize:               false,
                beforeAddLiquidity:            true,
                afterAddLiquidity:             false,
                beforeRemoveLiquidity:         true,
                afterRemoveLiquidity:          false,
                beforeSwap:                    true,
                afterSwap:                     false,
                beforeDonate:                  false,
                afterDonate:                   false,
                beforeSwapReturnDelta:         false,
                afterSwapReturnDelta:          false,
                afterAddLiquidityReturnDelta:  false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    // ── admin ────────────────────────────────────────────────────────────────

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
        emit VaultSet(_vault);
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    function configurePool(PoolId poolId, uint16 coreBandBps, uint16 specBandBps) external onlyOwner {
        BandConfig storage b = bands[poolId];
        b.coreBandBps = coreBandBps;
        b.specBandBps = specBandBps;
        b.configured  = true;
        emit PoolConfigured(poolId, coreBandBps, specBandBps);
    }

    /// @notice Keeper posts the appraisal price (Q96, token1/token0).
    function setAppraisal(PoolId poolId, uint256 appraisalX96) external {
        if (msg.sender != keeper) revert OnlyKeeper();
        bands[poolId].appraisalX96 = appraisalX96;
        emit AppraisalSet(poolId, appraisalX96);
    }

    // ── views ──────────────────────────────────────────────────────────────

    /// @notice Core price band bounds (Q96): [appraisal·(1-core), appraisal·(1+core)].
    function getActiveBands(PoolId poolId) external view returns (uint256 lower, uint256 upper) {
        BandConfig storage b = bands[poolId];
        lower = (b.appraisalX96 * (BPS - b.coreBandBps)) / BPS;
        upper = (b.appraisalX96 * (BPS + b.coreBandBps)) / BPS;
    }

    /// @notice True if `priceX96` is within the spec band (i.e. a swap there is allowed).
    function isPriceValid(PoolId poolId, uint256 priceX96) public view returns (bool) {
        BandConfig storage b = bands[poolId];
        if (!b.configured || b.appraisalX96 == 0) return true; // unconfigured = no enforcement
        return _deviationBps(priceX96, b.appraisalX96) <= b.specBandBps;
    }

    /// @notice Band fee for a price (view mirror of the swap-time logic). Reverts out of band.
    function previewFee(PoolId poolId, uint256 priceX96) external view returns (uint24) {
        return _bandFee(poolId, priceX96);
    }

    /// @notice Convert a pool sqrtPriceX96 to a Q96 price (token1/token0).
    function priceX96FromSqrt(uint160 sqrtPriceX96) public pure returns (uint256) {
        return FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), TWO_96);
    }

    // ── IHooks: liquidity gate ───────────────────────────────────────────────

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external view override onlyPoolManager returns (bytes4)
    {
        if (sender != vault) revert OnlyVaultCanModifyLiquidity();
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external view override onlyPoolManager returns (bytes4)
    {
        if (sender != vault) revert OnlyVaultCanModifyLiquidity();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    // ── IHooks: swap — band enforcement + band fee ────────────────────────────

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external view override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        (uint160 sqrtP,,,) = POOL_MANAGER.getSlot0(id);
        uint24 fee = _bandFee(id, priceX96FromSqrt(sqrtP));
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    // ── internal band logic ───────────────────────────────────────────────────

    /// @dev Fee by band; reverts if `priceX96` is outside the spec band.
    function _bandFee(PoolId poolId, uint256 priceX96) internal view returns (uint24) {
        BandConfig storage b = bands[poolId];
        if (!b.configured || b.appraisalX96 == 0) return 0; // unconfigured: no override

        uint256 dev = _deviationBps(priceX96, b.appraisalX96);
        if (dev > b.specBandBps) revert PriceOutOfBands();
        return dev <= b.coreBandBps ? CORE_FEE_PIPS : SPEC_FEE_PIPS;
    }

    function _deviationBps(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) return 0;
        uint256 diff = a > b ? a - b : b - a;
        return (diff * BPS) / b;
    }

    // ── IHooks: unused callbacks ──────────────────────────────────────────────

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }
    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }
    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, int128) {
        return (IHooks.afterSwap.selector, 0);
    }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IHooks.afterDonate.selector;
    }
}
