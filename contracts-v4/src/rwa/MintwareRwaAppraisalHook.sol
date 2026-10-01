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

/// @title  MintwareRwaAppraisalHook
/// @notice V2-RWAs — the Uniswap v4 hook for ONE real-world-asset / USDC pool. It anchors trading to the
///         issuer's appraised NAV and doubles as the price oracle the `MintwareTreasuryVault` values its
///         position against (`oracleTick()`, the same selector the vault reads from its JIT hook).
///
///           • Band. Swaps that END outside ±`specBandTicks` of the appraisal revert — unless they move the
///             price TOWARD the appraisal (so a fresh appraisal never freezes the market: the arb that closes
///             the gap is always allowed). Inside ±`coreBandTicks` the low core fee applies, else the spec fee.
///           • Oracle. `oracleTick()` returns the appraisal tick, READY only while the appraisal is fresh
///             (≤ `maxAppraisalAge`). Stale ⇒ not ready ⇒ the vault fails closed on valuation and traders
///             cannot swap. The vault marks its LP at `min(spot, appraisal)`, so a high appraisal can never
///             inflate the senior claim.
///           • LP gate. Only the bound liquidity vault may add or remove liquidity.
///           • Vault exemption. The vault's own seniority unwind swaps skip the band: they are already capped
///             at ±500 ticks around this oracle by `MWTreasuryPositionLib._swapLimit`, and a senior
///             redemption must never be blocked by a trading rule.
///
/// @dev    Hardening over the shelved `MintwareOracleHook` (round-4 lesson: an instantly repointable trust
///         anchor is a drain vector):
///           – appraisal moves are bounded per update (`maxStepTicks`) and rate-limited (`minUpdateInterval`),
///             so a compromised keeper can only walk the price slowly, in public, with every step on-chain;
///           – the keeper is rotated through a 48 h two-step timelock; the band / step / age / fee config is
///             instant only before the pool exists, then 48 h-timelocked;
///           – the pool must be initialised INSIDE the core band of an appraisal that already exists, and the
///             hook binds to exactly one dynamic-fee pool;
///           – a guardian can pause trading instantly (never redemptions — the vault is exempt).
///         Ticks are in pool space (price of currency0 in currency1, raw units). 1 tick ≈ 1 bp of price.
contract MintwareRwaAppraisalHook is IHooks, Ownable2Step {
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
    }

    // ── immutables / bound state ──────────────────────────────────────────────

    IPoolManager public immutable poolManager;

    address public vault;      // the bound MintwareTreasuryVault (set once)
    PoolId  public poolId;     // the one pool this hook serves (bound at initialize)
    bool    public poolBound;

    // ── appraisal ─────────────────────────────────────────────────────────────

    int24   public appraisalTick;
    uint64  public appraisedAt;
    bool    public hasAppraisal;
    address public keeper;

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

    /// @notice Bind the liquidity vault (set once). The vault is the only LP and the only band-exempt swapper.
    function setVault(address vault_) external onlyOwner {
        if (vault != address(0)) revert AlreadySet();
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
        emit VaultSet(vault_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    // ── appraisal ─────────────────────────────────────────────────────────────

    /// @notice The first appraisal, posted before the pool exists. Not step-bounded (there is no prior).
    function initAppraisal(int24 tick) external {
        if (msg.sender != keeper && msg.sender != owner()) revert OnlyKeeper();
        if (hasAppraisal) revert AppraisalAlreadyInitialised();
        _checkTick(tick);
        hasAppraisal  = true;
        appraisalTick = tick;
        appraisedAt   = uint64(block.timestamp);
        emit AppraisalPosted(tick, tick, uint64(block.timestamp), msg.sender);
    }

    /// @notice Post a new appraisal. Bounded per step and rate-limited — the keeper can walk the reference
    ///         price only slowly and publicly.
    function postAppraisal(int24 tick) external {
        if (msg.sender != keeper) revert OnlyKeeper();
        if (!hasAppraisal) revert NoAppraisal();
        _checkTick(tick);
        Config memory c = config;
        if (block.timestamp < uint256(appraisedAt) + c.minUpdateInterval) revert UpdateTooSoon();
        if (_absDiff(tick, appraisalTick) > c.maxStepTicks) revert StepTooLarge();
        int24 prev    = appraisalTick;
        appraisalTick = tick;
        appraisedAt   = uint64(block.timestamp);
        emit AppraisalPosted(tick, prev, uint64(block.timestamp), msg.sender);
    }

    function isFresh() public view returns (bool) {
        return hasAppraisal && block.timestamp <= uint256(appraisedAt) + config.maxAppraisalAge;
    }

    /// @notice The vault's oracle (the `IJitOracle` shape): the appraisal tick, ready only while fresh.
    function oracleTick() external view returns (int24 tick, bool ready) {
        return (appraisalTick, isFresh());
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

    /// @notice Instantly halt TRADING (never redemptions — the vault's own swaps are exempt).
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

    function beforeInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96)
        external override onlyPoolManager returns (bytes4)
    {
        if (poolBound) revert PoolAlreadyBound();
        if (address(key.hooks) != address(this)) revert WrongPool();
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
        if (sender == vault) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, c.coreFeePips | LPFeeLibrary.OVERRIDE_FEE_FLAG);
        }
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

    function afterSwap(address sender, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external override onlyPoolManager returns (bytes4, int128)
    {
        if (sender == vault) return (IHooks.afterSwap.selector, 0);

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
            c.coreFeePips > MAX_FEE_PIPS || c.specFeePips > MAX_FEE_PIPS || c.coreFeePips > c.specFeePips
        ) revert BadConfig();
    }

    function _absDiff(int24 x, int24 y) private pure returns (uint256) {
        return x >= y ? uint256(int256(x) - int256(y)) : uint256(int256(y) - int256(x));
    }
}
