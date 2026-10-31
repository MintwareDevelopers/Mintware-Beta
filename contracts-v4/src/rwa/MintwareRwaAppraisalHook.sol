// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks}                from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams}       from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks}                 from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary}          from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";

import {IMarketAssetMark} from "../vaults/IMarketAssetMark.sol";
import {MWV4PositionMath} from "../lib/MWV4PositionMath.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPermissionsAdapter} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IPermissionsAdapterFactory} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";
import {PermissionFlags, PermissionFlag} from "@uniswap/v4-periphery-permissioned/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {IMsgSender} from "@uniswap/v4-periphery-permissioned/src/interfaces/IMsgSender.sol";

interface IOwnedMarketBinding {
    function poolManager() external view returns (address);
    function nonQuoteMark() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @dev The bound liquidity actor's public `poolKey` struct getter.
interface IVaultPoolKey {
    function poolKey() external view returns (Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, IHooks hooks);
}

/// @title MintwareRwaAppraisalHook
/// @notice One-pool appraisal band with a mandatory, one-shot official permissioned-pool binding.
/// @dev Owned mode pins adapter/quote before initialization, exposes a dated IMarketAssetMark,
/// checks issuer permissions on new risk, and never gates removal or collection on freshness.
/// Swaps ending outside the speculative band must close the gap on the same side of appraisal.
/// Fees use the pre-swap band. Keeper moves retain step, cadence and rolling absolute drift limits;
/// keeper/config changes retain the 48-hour timelock. Owned age/grace are frozen at pinning.
/// Ticks are in virtual PoolKey space; marks account for underlying decimals and quote orientation.
contract MintwareRwaAppraisalHook is IHooks, Ownable2Step, IMarketAssetMark {
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    // ── constants ─────────────────────────────────────────────────────────────

    uint256 public constant TIMELOCK          = 48 hours;
    uint24  public constant MAX_SPEC_BAND     = 7_000;   // ≈ ±100% — sanity ceiling, not a policy
    uint24  public constant MAX_FEE_PIPS      = 50_000;  // 5%
    uint32  public constant MAX_APPRAISAL_AGE = 400 days;

    /// @dev Transient slots for the pre-swap tick (EIP-1153), read back in `afterSwap`.
    bytes32 private constant _PRE_TICK_SLOT = keccak256("mintware.rwa.appraisalHook.preTick");
    bytes32 private constant _PRE_SET_SLOT  = keccak256("mintware.rwa.appraisalHook.preSet");

    // ── types ─────────────────────────────────────────────────────────────────

    struct Config {
        uint24 coreBandTicks;     // low-fee zone, e.g. 500 ≈ ±5%
        uint24 specBandTicks;     // hard band, e.g. 1500 ≈ ±16%
        uint24 maxStepTicks;      // max appraisal move per update, e.g. 1000 ≈ 10%
        uint32 minUpdateInterval; // seconds between appraisal updates
        uint32 maxAppraisalAge;   // seconds an appraisal stays fresh
        uint24 coreFeePips;       // LP fee inside the core band (1e6 = 100%)
        uint24 specFeePips;       // LP fee in the spec band
        uint24 maxDriftTicksPerDay; // aggregate appraisal move allowed per rolling 24 h window
        uint32 oracleGraceSecs;   // exit window: oracle stays ready this long after trading goes stale
    }

    // ── immutables / bound state ──────────────────────────────────────────────

    IPoolManager public immutable poolManager;

    address public vault;          // the bound liquidity actor (set once)
    PoolId  public expectedPoolId; // pinned at setVault from the vault's own pool key
    PoolId  public poolId;         // the one pool this hook serves (bound at initialize)
    bool    public poolBound;

    // One-shot owned-pool binding.
    IPermissionsAdapterFactory public permissionsFactory;
    IPermissionsAdapter public permissionsAdapter;
    address public override asset;
    address public override quoteAsset;
    bool public quoteIsCurrency0;
    uint8 private assetDecimals;
    uint8 private quoteDecimals;
    uint64 public observedAt;

    error Unauthorized();
    error SwappingDisabled();
    error UnverifiedAdapter();
    error InvalidObservation();
    event ObservationRecorded(uint64 observedAt, bytes32 reportHash);

    // ── appraisal ─────────────────────────────────────────────────────────────

    int24   public appraisalTick;
    uint64  public appraisedAt;
    bool    public hasAppraisal;
    address public keeper;

    int24   public driftAnchorTick;   // appraisal at the last update outside the rolling 24 h window
    uint64  public driftWindowStart;

    // Cumulative absolute movement, searched by timestamp: no window-boundary reset,
    // no linear pruning loop when many updates expire after a keeper outage.
    struct DriftCheckpoint { uint64 at; int24 tick; uint128 movement; }
    DriftCheckpoint[] private _driftHistory;

    Config  public config;

    // ── governance ────────────────────────────────────────────────────────────

    address public guardian;
    bool    public tradingPaused;

    Config  public pendingConfig;
    uint64  public pendingConfigEta;
    address public pendingKeeper;
    uint64  public pendingKeeperEta;

    // ── events / errors ───────────────────────────────────────────────────────

    event VaultSet(address indexed vault);
    event PoolBound(PoolId indexed poolId, int24 initTick);
    event AppraisalPosted(int24 tick, int24 previousTick, uint64 at, address indexed by);
    event ConfigProposed(Config config, uint64 eta);
    event ConfigApplied(Config config);
    event KeeperProposed(address indexed keeper, uint64 eta);
    event KeeperSet(address indexed keeper);
    event GuardianSet(address indexed guardian);
    event TradingPaused(address indexed by);
    event TradingResumed(address indexed by);

    error OnlyPoolManager();
    error OnlyKeeper();
    error OnlyGuardian();
    error OnlyVault();
    error AlreadySet();
    error ZeroAddress();
    error BadConfig();
    error BadTick();
    error NoAppraisal();
    error AppraisalAlreadyInitialised();
    error AppraisalStale();
    error UpdateTooSoon();
    error StepTooLarge();
    error DailyDriftExceeded();
    error VaultNotSet();
    error PoolAlreadyBound();
    error WrongPool();
    error NotDynamicFee();
    error InitOutsideCoreBand();
    error PriceOutOfBand(int24 tick, int24 appraisal);
    error TradingIsPaused();
    error NothingPending();
    error TimelockActive();

    // ── construction ──────────────────────────────────────────────────────────

    constructor(IPoolManager poolManager_, address owner_, address keeper_, address guardian_, Config memory config_)
        Ownable(owner_)
    {
        if (address(poolManager_) == address(0) || keeper_ == address(0) || guardian_ == address(0)) revert ZeroAddress();
        _validate(config_);
        poolManager = poolManager_;
        keeper      = keeper_;
        guardian    = guardian_;
        config      = config_;

        Hooks.validateHookPermissions(this, getHookPermissions());
        emit KeeperSet(keeper_);
        emit GuardianSet(guardian_);
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    // ── wiring ────────────────────────────────────────────────────────────────

    /// @notice Pin the verified adapter/quote pool before initialization, breaking the engine deployment cycle.
    function pinPoolKey(PoolKey calldata key, IPermissionsAdapterFactory factory, address quote) external onlyOwner {
        if (address(permissionsFactory) != address(0) || vault != address(0) || poolBound) revert AlreadySet();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 == address(0) || c0 >= c1 || address(key.hooks) != address(this)
            || (quote != c0 && quote != c1) || key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG) revert WrongPool();
        address adapter = quote == c0 ? c1 : c0;
        address underlying = factory.verifiedPermissionsAdapterOf(adapter);
        if (underlying == address(0) || factory.permissionsAdapterOf(quote) != address(0)) revert UnverifiedAdapter();
        IPermissionsAdapter candidate = IPermissionsAdapter(adapter);
        if (candidate.POOL_MANAGER() != address(poolManager) || address(candidate.PERMISSIONED_TOKEN()) != underlying
            || underlying == quote) revert WrongPool();
        uint8 ad = IERC20Metadata(underlying).decimals();
        uint8 qd = IERC20Metadata(quote).decimals();
        if (ad > 18 || qd > 18 || IERC20Metadata(adapter).decimals() != ad) revert BadConfig();
        // A legacy heartbeat cannot be reused as a dated owned-market observation.
        if (hasAppraisal) revert AppraisalAlreadyInitialised();
        permissionsFactory = factory;
        permissionsAdapter = candidate;
        asset = underlying;
        quoteAsset = quote;
        quoteIsCurrency0 = quote == c0;
        assetDecimals = ad;
        quoteDecimals = qd;
        expectedPoolId = key.toId();
    }

    /// @notice Bind the only engine once, checking its pinned pool, assets and mark.
    function setVault(address vault_) external onlyOwner {
        if (vault != address(0)) revert AlreadySet();
        if (vault_ == address(0)) revert ZeroAddress();
        (Currency c0, Currency c1, uint24 fee, int24 spacing, IHooks hooks) = IVaultPoolKey(vault_).poolKey();
        if (address(hooks) != address(this)) revert WrongPool();
        if (address(permissionsFactory) == address(0)) revert UnverifiedAdapter();
        {
            PoolKey memory key = PoolKey(c0, c1, fee, spacing, hooks);
            IOwnedMarketBinding engine = IOwnedMarketBinding(vault_);
            if (!poolBound || PoolId.unwrap(key.toId()) != PoolId.unwrap(expectedPoolId)
                || engine.poolManager() != address(poolManager) || engine.nonQuoteMark() != address(this)
                || engine.token0() != (quoteIsCurrency0 ? quoteAsset : asset)
                || engine.token1() != (quoteIsCurrency0 ? asset : quoteAsset)) revert WrongPool();
        }
        vault          = vault_;
        expectedPoolId = PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: spacing, hooks: hooks}).toId();
        emit VaultSet(vault_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    // ── appraisal ─────────────────────────────────────────────────────────────

    /// @notice The first appraisal, posted before the pool exists. Not step-bounded (there is no prior).
    function initAppraisal(int24 tick, uint64 observation, bytes32 reportHash) external {
        _recordObservation(tick, observation, reportHash);
        _initAppraisal(tick);
    }

    function _initAppraisal(int24 tick) private {
        if (msg.sender != keeper && msg.sender != owner()) revert OnlyKeeper();
        if (hasAppraisal) revert AppraisalAlreadyInitialised();
        _checkTick(tick);
        hasAppraisal     = true;
        appraisalTick    = tick;
        appraisedAt      = uint64(block.timestamp);
        driftAnchorTick  = tick;
        driftWindowStart = uint64(block.timestamp);
        _driftHistory.push(DriftCheckpoint(uint64(block.timestamp), tick, 0));
        emit AppraisalPosted(tick, tick, uint64(block.timestamp), msg.sender);
    }

    /// @notice Post a new appraisal. Bounded per step, rate-limited, and capped in aggregate per rolling 24 h
    ///         window — the keeper's total walk per day is bounded and every step is public.
    function postAppraisal(int24 tick, uint64 observation, bytes32 reportHash) external {
        _recordObservation(tick, observation, reportHash);
        _postAppraisal(tick);
    }

    function _recordObservation(int24 tick, uint64 observation, bytes32 reportHash) private {
        if (address(permissionsFactory) == address(0) || observation == 0 || observation > block.timestamp
            || observation <= observedAt || reportHash == bytes32(0) || _priceWad(tick) == 0) revert InvalidObservation();
        observedAt = observation;
        emit ObservationRecorded(observation, reportHash);
    }

    function _priceWad(int24 tick) private view returns (uint256) {
        return MWV4PositionMath.quoteValue(10 ** (18 + uint256(assetDecimals) - quoteDecimals),
            TickMath.getSqrtPriceAtTick(tick), quoteIsCurrency0);
    }

    function latestMark() external view override returns (uint256 priceWad, uint64 updatedAt) {
        if (vault == address(0) || !hasAppraisal || address(permissionsFactory) == address(0)) revert NoAppraisal();
        return (_priceWad(appraisalTick), observedAt);
    }

    function maxExitMarkAge() external view returns (uint256) {
        return uint256(config.maxAppraisalAge) + config.oracleGraceSecs;
    }

    function _postAppraisal(int24 tick) private {
        if (msg.sender != keeper) revert OnlyKeeper();
        if (!hasAppraisal) revert NoAppraisal();
        _checkTick(tick);
        Config memory c = config;
        if (block.timestamp < uint256(appraisedAt) + c.minUpdateInterval) revert UpdateTooSoon();
        if (_absDiff(tick, appraisalTick) > c.maxStepTicks) revert StepTooLarge();
        uint256 cutoff = block.timestamp > 1 days ? block.timestamp - 1 days : 0;
        uint256 low;
        uint256 high = _driftHistory.length;
        // Upper bound: the last checkpoint at or before the window start supplies
        // the cumulative movement to subtract. Moves at the start have expired.
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (_driftHistory[mid].at <= cutoff) low = mid + 1;
            else high = mid;
        }
        DriftCheckpoint memory anchor = _driftHistory[low == 0 ? 0 : low - 1];
        uint128 movement = _driftHistory[_driftHistory.length - 1].movement
            + uint128(_absDiff(tick, appraisalTick));
        if (movement - anchor.movement > c.maxDriftTicksPerDay) revert DailyDriftExceeded();
        driftAnchorTick = anchor.tick;
        driftWindowStart = uint64(cutoff);
        _driftHistory.push(DriftCheckpoint(uint64(block.timestamp), tick, movement));
        int24 prev    = appraisalTick;
        appraisalTick = tick;
        appraisedAt   = uint64(block.timestamp);
        emit AppraisalPosted(tick, prev, uint64(block.timestamp), msg.sender);
    }

    /// @notice Trading is allowed only while the appraisal is fresh.
    function isFresh() public view returns (bool) {
        return hasAppraisal && block.timestamp <= uint256(observedAt) + config.maxAppraisalAge;
    }

    /// @notice The vault may value its position while fresh OR inside the exit window that follows.
    function oracleReady() public view returns (bool) {
        Config memory c = config;
        return hasAppraisal && block.timestamp <= uint256(observedAt) + c.maxAppraisalAge + c.oracleGraceSecs;
    }

    /// @notice UI/keeper helper: live pool tick, its distance from the appraisal, and which band it sits in.
    function bandStatus() external view returns (int24 spotTick, int24 appraisal, uint256 deviationTicks, bool inCore, bool inSpec, bool fresh) {
        if (poolBound) (, spotTick,,) = poolManager.getSlot0(poolId);
        appraisal      = appraisalTick;
        deviationTicks = _absDiff(spotTick, appraisal);
        inCore         = deviationTicks <= config.coreBandTicks;
        inSpec         = deviationTicks <= config.specBandTicks;
        fresh          = isFresh();
    }

    // ── keeper rotation (48 h) ────────────────────────────────────────────────

    function proposeKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert ZeroAddress();
        pendingKeeper    = keeper_;
        pendingKeeperEta = uint64(block.timestamp + TIMELOCK);
        emit KeeperProposed(keeper_, pendingKeeperEta);
    }

    function confirmKeeper() external onlyOwner {
        if (pendingKeeper == address(0)) revert NothingPending();
        if (block.timestamp < pendingKeeperEta) revert TimelockActive();
        keeper           = pendingKeeper;
        pendingKeeper    = address(0);
        pendingKeeperEta = 0;
        emit KeeperSet(keeper);
    }

    // ── config (instant pre-launch, then 48 h) ────────────────────────────────

    function proposeConfig(Config calldata c) external onlyOwner {
        _validate(c);
        if (address(permissionsFactory) != address(0)
            && (c.maxAppraisalAge != config.maxAppraisalAge || c.oracleGraceSecs != config.oracleGraceSecs)) revert BadConfig();
        if (!poolBound) {
            config = c;
            emit ConfigApplied(c);
            return;
        }
        pendingConfig    = c;
        pendingConfigEta = uint64(block.timestamp + TIMELOCK);
        emit ConfigProposed(c, pendingConfigEta);
    }

    function confirmConfig() external onlyOwner {
        if (pendingConfigEta == 0) revert NothingPending();
        if (block.timestamp < pendingConfigEta) revert TimelockActive();
        config           = pendingConfig;
        pendingConfigEta = 0;
        emit ConfigApplied(config);
    }

    // ── emergency ─────────────────────────────────────────────────────────────

    /// @notice Instantly halt trading, never removal/collection. All swaps require current permission.
    function pauseTrading() external {
        if (msg.sender != guardian && msg.sender != owner()) revert OnlyGuardian();
        tradingPaused = true;
        emit TradingPaused(msg.sender);
    }

    function resumeTrading() external onlyOwner {
        tradingPaused = false;
        emit TradingResumed(msg.sender);
    }

    // ── IHooks: initialize ────────────────────────────────────────────────────

    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        external override onlyPoolManager returns (bytes4)
    {
        if (poolBound) revert PoolAlreadyBound();
        if (address(permissionsFactory) == address(0)) revert UnverifiedAdapter();
        if (sender != owner()) revert Unauthorized();
        if (permissionsFactory.verifiedPermissionsAdapterOf(address(permissionsAdapter)) != asset) revert UnverifiedAdapter();
        if (address(key.hooks) != address(this) || PoolId.unwrap(key.toId()) != PoolId.unwrap(expectedPoolId)) revert WrongPool();
        if (!LPFeeLibrary.isDynamicFee(key.fee)) revert NotDynamicFee();
        if (!isFresh()) revert NoAppraisal();
        int24 initTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        if (_absDiff(initTick, appraisalTick) > config.coreBandTicks) revert InitOutsideCoreBand();
        poolId    = key.toId();
        poolBound = true;
        emit PoolBound(poolId, initTick);
        return IHooks.beforeInitialize.selector;
    }

    // ── IHooks: liquidity gate ────────────────────────────────────────────────

    function beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        external view override onlyPoolManager returns (bytes4)
    {
        _checkPool(key);
        if (sender != vault || sender == address(0)) revert OnlyVault();
        _verifyPermission(sender, PermissionFlags.LIQUIDITY_ALLOWED);
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        external view override onlyPoolManager returns (bytes4)
    {
        _checkPool(key);
        if (sender != vault || sender == address(0)) revert OnlyVault();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    // ── IHooks: swap — band + fee ─────────────────────────────────────────────

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        _checkPool(key);
        Config memory c = config;
        if (vault == address(0)) revert VaultNotSet();
        if (!permissionsAdapter.swappingEnabled()) revert SwappingDisabled();
        _verifyPermission(sender, PermissionFlags.SWAP_ALLOWED);
        if (tradingPaused) revert TradingIsPaused();
        if (!isFresh()) revert AppraisalStale();

        (, int24 pre,,) = poolManager.getSlot0(poolId);
        bytes32 tickSlot = _PRE_TICK_SLOT;
        bytes32 setSlot  = _PRE_SET_SLOT;
        assembly ("memory-safe") {
            tstore(tickSlot, pre)
            tstore(setSlot, 1)
        }
        uint24 fee = _absDiff(pre, appraisalTick) <= c.coreBandTicks ? c.coreFeePips : c.specFeePips;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        _checkPool(key);

        int24 pre;
        uint256 set;
        bytes32 tickSlot = _PRE_TICK_SLOT;
        bytes32 setSlot  = _PRE_SET_SLOT;
        assembly ("memory-safe") {
            pre := signextend(2, tload(tickSlot))
            set := tload(setSlot)
            tstore(setSlot, 0)
        }
        (, int24 post,,) = poolManager.getSlot0(poolId);
        int24 a = appraisalTick;
        uint256 postDev = _absDiff(post, a);
        if (postDev <= config.specBandTicks) return (IHooks.afterSwap.selector, 0);

        // Outside the band: allowed only if it ended on the same side as it started AND closer to the
        // appraisal (the gap-closing trade after an appraisal move). Anything else reverts.
        bool towardAppraisal = set == 1
            && ((pre > a && post > a) || (pre < a && post < a))
            && postDev < _absDiff(pre, a);
        if (!towardAppraisal) revert PriceOutOfBand(post, a);
        return (IHooks.afterSwap.selector, 0);
    }

    // ── IHooks: unused (permission bits off; never called by the PoolManager) ─

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }
    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta)
    {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }
    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external pure override returns (bytes4, BalanceDelta)
    {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IHooks.afterDonate.selector;
    }

    // ── internals ─────────────────────────────────────────────────────────────

    /// @dev PermissionedHooks f2aa843 permission kernel, specialized to the single verified adapter.
    /// Check wrapper trust before asking it to report the principal; no permission checks on exits.
    function _verifyPermission(address sender, PermissionFlag permission) private view {
        if (!permissionsAdapter.allowedWrappers(sender)
            || !permissionsAdapter.isAllowed(IMsgSender(sender).msgSender(), permission)) revert Unauthorized();
    }

    function _checkPool(PoolKey calldata key) private view {
        if (!poolBound || PoolId.unwrap(key.toId()) != PoolId.unwrap(poolId)) revert WrongPool();
    }

    function _checkTick(int24 tick) private pure {
        if (tick <= TickMath.MIN_TICK || tick >= TickMath.MAX_TICK) revert BadTick();
    }

    function _validate(Config memory c) private pure {
        if (
            c.coreBandTicks == 0 || c.coreBandTicks > c.specBandTicks || c.specBandTicks > MAX_SPEC_BAND ||
            c.maxStepTicks == 0 || c.maxStepTicks > c.specBandTicks ||
            c.maxAppraisalAge == 0 || c.maxAppraisalAge > MAX_APPRAISAL_AGE ||
            c.coreFeePips > MAX_FEE_PIPS || c.specFeePips > MAX_FEE_PIPS || c.coreFeePips > c.specFeePips ||
            c.maxDriftTicksPerDay < c.maxStepTicks || c.maxDriftTicksPerDay > MAX_SPEC_BAND ||
            c.oracleGraceSecs > MAX_APPRAISAL_AGE
        ) revert BadConfig();
    }

    function _absDiff(int24 x, int24 y) private pure returns (uint256) {
        return x >= y ? uint256(int256(x) - int256(y)) : uint256(int256(y) - int256(x));
    }
}
