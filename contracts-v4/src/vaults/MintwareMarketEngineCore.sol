// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MintwareMarketLifecycleModule} from "./MintwareMarketLifecycleModule.sol";

import {MintwareV4PoolVault} from "./MintwareV4PoolVault.sol";
import {IMarketAdapterBinding} from "./IMarketAdapterBinding.sol";
import {IMarketAssetMark} from "./IMarketAssetMark.sol";
import {MWMarketShareMath} from "../lib/MWMarketShareMath.sol";
import {MWMarketValuation} from "../lib/MWMarketValuation.sol";
import {MWV4PositionMath} from "../lib/MWV4PositionMath.sol";
import {MWV4TickSpacing} from "../lib/MWV4TickSpacing.sol";
import {MWExactTransfer} from "../lib/MWExactTransfer.sol";

/// @title MintwareMarketEngineCore
/// @notice Shared implementation for versioned, one-pool quote-valued market claims.
/// @dev New issuance only. Existing Gateway, PairVault, Matched, Treasury, and JIT claim owners keep their
///      deployed addresses and exit paths. This draft supports exact-transfer ERC-20 pair assets, measured
///      single/dual-sided deposits, dual-sided liquidity deployment, independent marking of the non-quote
///      asset, guarded range recentering, and pro-rata in-kind exits. Single-sided balances require an
///      owner/keeper swap with explicit price-limit and minimum-output parameters before paired LP
///      deployment; automated zapping and JIT accounting are not implemented.
abstract contract MintwareMarketEngineCore is MintwareV4PoolVault, ERC20, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using MWExactTransfer for IERC20;

    uint16 private constant BPS = 10_000;
    enum UnlockAction {
        Collect,
        Add,
        Remove,
        Swap,
        Recenter
    }

    struct MarketConfig {
        address poolManager;
        PoolKey poolKey;
        address quoteAsset;
        address nonQuoteMark;
        address lifecycleModule;
        address initialOwner;
        int24 tickLower;
        int24 tickUpper;
        uint64 maxMarkAge;
        uint16 maxSpotMarkDeviationBps;
        uint256 minInitialContribution;
        uint256 principalCap;
        uint16 maxPositionBps;
        int24 recenterEdgeTicks;
        int24 maxRecenterTickMove;
        uint64 recenterCooldown;
    }

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    IERC20 public immutable quoteAsset;
    IMarketAssetMark public immutable nonQuoteMark;
    MintwareMarketLifecycleModule public immutable lifecycleModule;
    uint8 internal immutable token0Decimals;
    uint8 internal immutable token1Decimals;
    uint8 internal immutable quoteDecimals;
    bool internal immutable quoteIsToken0;
    uint64 internal immutable maxMarkAge;
    uint16 internal immutable maxSpotMarkDeviationBps;
    uint256 internal immutable minInitialContribution;
    uint256 internal immutable principalCap;
    uint16 internal immutable maxPositionBps;
    int24 public immutable recenterEdgeTicks;
    int24 public immutable maxRecenterTickMove;
    uint64 public immutable recenterCooldown;

    IMarketAdapterBinding public adapter0;
    IMarketAdapterBinding public adapter1;
    bool public activated;
    uint128 public positionLiquidity;
    uint256 public lastRecenterAt;
    bytes32 internal _activeUnlockHash;

    event EngineActivated(address indexed adapter0, address indexed adapter1, address indexed mark);
    event Deposited(address indexed account, uint256 amount0, uint256 amount1, uint256 shares);
    event IdleAllocated(uint256 amount0, uint256 amount1);
    event IdleRecalled(uint256 amount0, uint256 amount1);
    event LiquidityDeployed(uint128 liquidity, uint256 used0, uint256 used1);
    event IdleSwapped(bool zeroForOne, uint256 amountIn, uint256 amountOut, uint160 sqrtPriceLimitX96);
    event FeesCollected(uint256 amount0, uint256 amount1);
    event PositionRecentered(int24 oldLower, int24 oldUpper, int24 newLower, int24 newUpper, uint128 liquidity);
    event Withdrawn(address indexed account, address indexed recipient, uint256 sharesBurned, uint256 amount0, uint256 amount1);

    error InvalidPool();
    error InvalidQuoteAsset();
    error InvalidRange();
    error InvalidConfiguration();
    error InvalidTokenDecimals();
    error InvalidAdapter();
    error AlreadyActivated();
    error NotActivated();
    error UnexpectedUnlock();
    error NestedUnlock();
    error ZeroAmount();
    error InitialContributionTooSmall();
    error ZeroShares();
    error InvalidRecipient();
    error PrincipalCapExceeded();
    error PositionCapExceeded();
    error InsufficientLiquidity();
    error ExitMinimumNotMet();
    error NotSelf();
    error AdapterReceiptMismatch();
    error AdapterNavUnavailable(address adapter);
    error InvalidSwap();
    error ExitMarkUnavailable();
    error PoolMarkDeviationExceeded();
    error RecenterNotDue();
    error RecenterMoveExceeded();

    constructor(MarketConfig memory config, bool allowHookedPool, bytes32 expectedModuleCodehash)
        MintwareV4PoolVault(config.poolManager, config.initialOwner)
        ERC20("Mintware Market Share", "MWMS")
    {
        address currency0 = Currency.unwrap(config.poolKey.currency0);
        address currency1 = Currency.unwrap(config.poolKey.currency1);
        if (
            currency0 == address(0) || currency1 == address(0) || currency0 >= currency1
                || currency0.code.length == 0 || currency1.code.length == 0
                || (!allowHookedPool && address(config.poolKey.hooks) != address(0))
                || config.poolKey.tickSpacing <= 0
                || config.poolKey.fee > 1_000_000
        ) revert InvalidPool();
        if (config.quoteAsset != currency0 && config.quoteAsset != currency1) revert InvalidQuoteAsset();
        if (
            config.nonQuoteMark == address(0) || config.nonQuoteMark.code.length == 0
                || config.lifecycleModule == address(0)
                || config.lifecycleModule.codehash != expectedModuleCodehash
                || config.maxMarkAge == 0
        ) {
            revert InvalidConfiguration();
        }
        IMarketAssetMark markSource = IMarketAssetMark(config.nonQuoteMark);
        address expectedAsset = config.quoteAsset == currency0 ? currency1 : currency0;
        if (markSource.asset() != expectedAsset || markSource.quoteAsset() != config.quoteAsset) {
            revert InvalidConfiguration();
        }
        if (
            config.tickLower >= config.tickUpper || config.tickLower % config.poolKey.tickSpacing != 0
                || config.tickUpper % config.poolKey.tickSpacing != 0
        ) revert InvalidRange();
        if (
            config.maxSpotMarkDeviationBps == 0 || config.maxSpotMarkDeviationBps > BPS
                || config.minInitialContribution == 0 || config.principalCap < config.minInitialContribution
                || config.maxPositionBps == 0 || config.maxPositionBps > BPS
                || config.recenterEdgeTicks <= 0 || config.maxRecenterTickMove <= 0
                || config.recenterCooldown == 0
        ) revert InvalidConfiguration();
        int256 initialWidth = int256(config.tickUpper) - int256(config.tickLower);
        if (int256(config.recenterEdgeTicks) * 2 >= initialWidth) revert InvalidConfiguration();

        uint8 decimals0 = IERC20Metadata(currency0).decimals();
        uint8 decimals1 = IERC20Metadata(currency1).decimals();
        if (decimals0 > 18 || decimals1 > 18) revert InvalidTokenDecimals();

        (uint160 sqrtPriceX96,,,) = IPoolManager(config.poolManager).getSlot0(config.poolKey.toId());
        if (sqrtPriceX96 == 0) revert InvalidPool();
        // Reuse TickMath validation for both bounds before storing the immutable pool configuration.
        TickMath.getSqrtPriceAtTick(config.tickLower);
        TickMath.getSqrtPriceAtTick(config.tickUpper);

        poolKey = config.poolKey;
        poolInitialized = true;
        tickLower = config.tickLower;
        tickUpper = config.tickUpper;
        token0 = IERC20(currency0);
        token1 = IERC20(currency1);
        quoteAsset = IERC20(config.quoteAsset);
        nonQuoteMark = markSource;
        lifecycleModule = MintwareMarketLifecycleModule(config.lifecycleModule);
        token0Decimals = decimals0;
        token1Decimals = decimals1;
        quoteDecimals = config.quoteAsset == currency0 ? decimals0 : decimals1;
        quoteIsToken0 = config.quoteAsset == currency0;
        maxMarkAge = config.maxMarkAge;
        maxSpotMarkDeviationBps = config.maxSpotMarkDeviationBps;
        minInitialContribution = config.minInitialContribution;
        principalCap = config.principalCap;
        maxPositionBps = config.maxPositionBps;
        recenterEdgeTicks = config.recenterEdgeTicks;
        maxRecenterTickMove = config.maxRecenterTickMove;
        recenterCooldown = config.recenterCooldown;
    }

    /// @notice Bind the two dedicated token adapters once, before the engine opens for deposits.
    function configureAdapters(address adapter0_, address adapter1_) external onlyOwner {
        if (activated || address(adapter0) != address(0) || address(adapter1) != address(0)) revert AlreadyActivated();
        if (adapter0_ == address(0) || adapter1_ == address(0) || adapter0_ == adapter1_) revert InvalidAdapter();

        IMarketAdapterBinding candidate0 = IMarketAdapterBinding(adapter0_);
        IMarketAdapterBinding candidate1 = IMarketAdapterBinding(adapter1_);
        if (
            adapter0_.code.length == 0 || adapter1_.code.length == 0
                || address(candidate0.asset()) != address(token0) || address(candidate1.asset()) != address(token1)
                || candidate0.vault() != address(this) || candidate1.vault() != address(this)
        ) revert InvalidAdapter();

        adapter0 = candidate0;
        adapter1 = candidate1;
    }

    /// @notice Open deposits after the pool, adapters, and independent non-quote mark are verified.
    function activate() external onlyOwner {
        if (activated) revert AlreadyActivated();
        if (address(adapter0) == address(0) || address(adapter1) == address(0)) revert InvalidAdapter();
        (uint256 price0, uint256 price1) = _readPrices();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(price0, price1, sqrtPriceX96);
        // Prove that both adapter NAV reads are available before the first shares can be issued.
        // Continued source availability remains an installation/operations requirement.
        _adapterAssets(adapter0);
        _adapterAssets(adapter1);
        activated = true;
        emit EngineActivated(address(adapter0), address(adapter1), address(nonQuoteMark));
    }

    /// @notice Current marked NAV in quote-token raw units. Pending fees are excluded until `harvest` collects them.
    function totalNav() external view returns (uint256) {
        _requireActivated();
        (uint256 price0, uint256 price1) = _readPrices();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        return _navAt(price0, price1, sqrtPriceX96);
    }

    /// @notice Deposit either or both pool tokens and mint the same quote-valued portfolio claim.
    function deposit(uint256 amount0, uint256 amount1, uint256 minSharesOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesMinted)
    {
        _requireActivated();
        _beforeShareChange();
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();
        if (minSharesOut == 0) revert ZeroShares();

        _collectFees();
        (uint256 price0, uint256 price1) = _readPrices();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(price0, price1, sqrtPriceX96);
        uint256 supplyBefore = totalSupply();
        uint256 assets0Before = token0.balanceOf(address(this)) + _adapterAssets(adapter0);
        uint256 assets1Before = token1.balanceOf(address(this)) + _adapterAssets(adapter1);
        uint128 liquidityBefore = positionLiquidity;

        uint256 received0;
        uint256 received1;
        if (amount0 != 0) {
            uint256 before0 = token0.balanceOf(address(this));
            token0.safeTransferFromExact(amount0);
            received0 = token0.balanceOf(address(this)) - before0;
        }
        if (amount1 != 0) {
            uint256 before1 = token1.balanceOf(address(this));
            token1.safeTransferFromExact(amount1);
            received1 = token1.balanceOf(address(this)) - before1;
        }

        // New contributions enter the already-bound per-token yield adapters up to current capacity.
        // Any capacity shortfall stays as liquid engine balance and remains included in NAV.
        _allocateDeposit(adapter0, token0, received0);
        _allocateDeposit(adapter1, token1, received1);

        (uint160 currentSqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(price0, price1, currentSqrtPriceX96);
        // Compare both NAVs at the post-callback spot so a permitted spot move is not attributed to the deposit.
        uint256 navBefore = _navFrom(
            assets0Before, assets1Before, liquidityBefore, price0, price1, currentSqrtPriceX96
        );
        uint256 navAfter = _navAt(price0, price1, currentSqrtPriceX96);
        if (navAfter < navBefore) revert InvalidConfiguration();
        uint256 contribution = navAfter - navBefore;
        if (supplyBefore == 0) {
            if (contribution < minInitialContribution) revert InitialContributionTooSmall();
            sharesMinted = MWMarketShareMath.sharesForBootstrap(navAfter, quoteDecimals);
        } else {
            sharesMinted = MWMarketShareMath.sharesForDeposit(contribution, navBefore, supplyBefore);
        }
        if (sharesMinted < minSharesOut) revert ZeroShares();
        if (navAfter > principalCap) revert PrincipalCapExceeded();
        _mint(msg.sender, sharesMinted);
        emit Deposited(msg.sender, received0, received1, sharesMinted);
    }

    /// @notice Move raw idle assets into their dedicated, verified yield adapters.
    function allocateIdle(uint256 amount0, uint256 amount1) external onlyOwner nonReentrant whenNotPaused {
        _requireActivated();
        _beforePositionChange();
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();
        if (amount0 != 0) _supplyToAdapter(adapter0, token0, amount0);
        if (amount1 != 0) _supplyToAdapter(adapter1, token1, amount1);
        emit IdleAllocated(amount0, amount1);
    }

    /// @notice Recall adapter assets into idle balances without requiring an LP deployment.
    /// @dev Kept separate from `deployLiquidity`: recall remains useful when the LP cap is full or
    ///      pool conditions make a new position undesirable. Withdrawals recall their own exit shares.
    function recallIdle(uint256 amount0, uint256 amount1)
        external
        nonReentrant
        returns (uint256 received0, uint256 received1)
    {
        _requireActivated();
        _beforePositionChange();
        if (amount0 == 0 && amount1 == 0) revert ZeroAmount();
        if (amount0 != 0) received0 = _recallFromAdapter(adapter0, token0, amount0);
        if (amount1 != 0) received1 = _recallFromAdapter(adapter1, token1, amount1);
        emit IdleRecalled(received0, received1);
    }

    /// @notice Request best-effort return of adapter assets to this engine for deployment or exits.
    /// @dev Convert a bounded idle balance during the atomic deployment flow. The owner/keeper supplies
    ///      an independent price limit and minimum output; this does not borrow or touch another claim.
    function _swapIdleExactIn(bool zeroForOne, uint256 amountIn, uint256 minAmountOut, uint160 sqrtPriceLimitX96)
        internal
        virtual
        returns (uint256 actualAmountIn, uint256 amountOut)
    {
        _requireActivated();
        if (amountIn == 0 || minAmountOut == 0 || amountIn > uint256(type(int256).max)) revert InvalidSwap();
        IERC20 input = zeroForOne ? token0 : token1;
        if (amountIn > input.balanceOf(address(this))) revert InvalidSwap();
        uint256 inputBefore = input.balanceOf(address(this));
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        (uint256 price0, uint256 price1) = _readPrices();
        _assertPoolSpotNearMark(price0, price1, sqrtPriceX96);
        if (
            (zeroForOne && (sqrtPriceLimitX96 >= sqrtPriceX96 || sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE))
                || (!zeroForOne && (sqrtPriceLimitX96 <= sqrtPriceX96 || sqrtPriceLimitX96 >= TickMath.MAX_SQRT_PRICE))
        ) revert InvalidSwap();

        bytes memory result = _executeUnlock(
            abi.encode(UnlockAction.Swap, zeroForOne, amountIn, sqrtPriceLimitX96)
        );
        amountOut = abi.decode(result, (uint256));
        uint256 inputAfter = input.balanceOf(address(this));
        if (inputAfter > inputBefore) revert InvalidSwap();
        actualAmountIn = inputBefore - inputAfter;
        if (actualAmountIn == 0 || actualAmountIn > amountIn || amountOut < minAmountOut) revert InvalidSwap();
        emit IdleSwapped(zeroForOne, actualAmountIn, amountOut, sqrtPriceLimitX96);
    }

    /// @notice Optionally recall, price-limit swap, and deploy idle assets in one atomic owner operation.
    /// @dev Set recall amounts to zero to use existing idle balances. Set `amountIn` to zero to skip the
    ///      swap; in that case `minAmountOut` and `sqrtPriceLimitX96` must also be zero. A failed later step
    ///      reverts all adapter recalls and swap effects.
    function deployLiquidity(
        uint256 amount0,
        uint256 amount1,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut,
        uint160 sqrtPriceLimitX96,
        uint128 minLiquidity
    )
        external
        onlyOwner
        nonReentrant
        whenNotPaused
        returns (uint128 added, uint256 actualAmountIn, uint256 amountOut)
    {
        _requireActivated();
        _beforePositionChange();
        uint256 received0;
        uint256 received1;
        if (amount0 != 0) received0 = _recallFromAdapter(adapter0, token0, amount0);
        if (amount1 != 0) received1 = _recallFromAdapter(adapter1, token1, amount1);
        emit IdleRecalled(received0, received1);
        if (amountIn != 0) {
            (actualAmountIn, amountOut) =
                _swapIdleExactIn(zeroForOne, amountIn, minAmountOut, sqrtPriceLimitX96);
        } else if (minAmountOut != 0 || sqrtPriceLimitX96 != 0) {
            revert InvalidSwap();
        }
        added = _deployLiquidity(minLiquidity);
    }

    function _deployLiquidity(uint128 minLiquidity) private returns (uint128 added) {
        _requireActivated();
        if (minLiquidity == 0) revert ZeroAmount();
        _collectFees();
        (uint256 price0, uint256 price1) = _readPrices();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(price0, price1, sqrtPriceX96);
        uint256 navBefore = _navAt(price0, price1, sqrtPriceX96);
        if (navBefore > principalCap) revert PrincipalCapExceeded();

        uint256 lpValue = _totalPositionValue(price0, price1, sqrtPriceX96);
        uint256 lpCap = Math.mulDiv(navBefore, maxPositionBps, BPS);
        if (lpValue >= lpCap) revert PositionCapExceeded();
        uint256 room = lpCap - lpValue;
        uint256 idle0 = token0.balanceOf(address(this));
        uint256 idle1 = token1.balanceOf(address(this));
        uint256 idleValue = _value0(idle0, price0) + _value1(idle1, price1);
        if (idleValue == 0) revert InsufficientLiquidity();

        uint256 deployValue = room < idleValue ? room : idleValue;
        uint256 max0 = Math.mulDiv(idle0, deployValue, idleValue);
        uint256 max1 = Math.mulDiv(idle1, deployValue, idleValue);
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        added = MWV4PositionMath.liquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, max0, max1);
        if (
            added < minLiquidity || added == 0
                || added > uint128(type(int128).max) - positionLiquidity
        ) revert InsufficientLiquidity();
        bytes memory result = _executeUnlock(
            abi.encode(UnlockAction.Add, int128(uint128(added)), max0, max1)
        );
        (uint256 used0, uint256 used1) = abi.decode(result, (uint256, uint256));
        (uint160 postAddSqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(price0, price1, postAddSqrtPriceX96);
        uint256 navAfter = _navAt(price0, price1, postAddSqrtPriceX96);
        if (navAfter > principalCap) revert PrincipalCapExceeded();
        if (
            _totalPositionValue(price0, price1, postAddSqrtPriceX96)
                > Math.mulDiv(navAfter, maxPositionBps, BPS)
        ) {
            revert PositionCapExceeded();
        }
        emit LiquidityDeployed(added, used0, used1);
    }

    /// @notice Collect accrued PoolManager fees into the portfolio so the next share change prices them once.
    function harvest() external nonReentrant returns (uint256 amount0, uint256 amount1) {
        _requireActivated();
        _beforePositionChange();
        (amount0, amount1) = _collectFees();
        emit FeesCollected(amount0, amount1);
    }

    /// @notice Move the existing market position to a same-width range around spot when it nears an edge.
    /// @dev Permissionless, bounded, and atomic: the old range is removed and the same engine-owned
    ///      portfolio claim is reallocated to a new range before the unlock completes. PoolManager keys
    ///      differ because ticks differ; no shares, claim owners, or settlement rights change. Any failed
    ///      add reverts the removal and preserves the old range.
    function recenter(uint128 minLiquidity) external virtual nonReentrant whenNotPaused {
        _requireActivated();
        _beforePositionChange();
        if (positionLiquidity == 0 || minLiquidity == 0) revert InsufficientLiquidity();
        if (block.timestamp < uint256(lastRecenterAt) + recenterCooldown) revert RecenterNotDue();

        (uint256 price0, uint256 price1) = _readPrices();
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(price0, price1, sqrtPriceX96);
        int24 oldLower = tickLower;
        int24 oldUpper = tickUpper;
        _recenterBounds(currentTick, oldLower, oldUpper);
        _collectFees();

        // Fee settlement calls the token contracts. Re-read spot afterwards so a callback cannot
        // make the range calculation stale between the guard and the position mutation.
        (uint256 postCollectPrice0, uint256 postCollectPrice1) = _readPrices();
        (uint160 postCollectSqrtPriceX96, int24 postCollectTick,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(postCollectPrice0, postCollectPrice1, postCollectSqrtPriceX96);
        (int24 newLower, int24 newUpper) = _recenterBounds(postCollectTick, oldLower, oldUpper);

        bytes memory result = _executeUnlock(
            abi.encode(UnlockAction.Recenter, newLower, newUpper, minLiquidity)
        );
        (int24 actualLower, int24 actualUpper,,) = abi.decode(result, (int24, int24, uint256, uint256));
        if (actualLower != newLower || actualUpper != newUpper) revert InvalidConfiguration();
        tickLower = newLower;
        tickUpper = newUpper;
        lastRecenterAt = block.timestamp;

        (uint256 finalPrice0, uint256 finalPrice1) = _readPrices();
        (uint160 postSqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        _assertPoolSpotNearMark(finalPrice0, finalPrice1, postSqrtPriceX96);
        emit PositionRecentered(oldLower, oldUpper, newLower, newUpper, positionLiquidity);
    }

    function _recenterBounds(int24 currentTick, int24 oldLower, int24 oldUpper)
        private
        view
        returns (int24 newLower, int24 newUpper)
    {
        if (
            int256(currentTick) > int256(oldLower) + int256(recenterEdgeTicks)
                && int256(currentTick) < int256(oldUpper) - int256(recenterEdgeTicks)
        ) revert RecenterNotDue();

        int24 spacing = poolKey.tickSpacing;
        int24 width = oldUpper - oldLower;
        int24 alignedTick = MWV4TickSpacing.alignDown(currentTick, spacing);
        int24 lowerHalfWidth = MWV4TickSpacing.alignDown(width / 2, spacing);
        newLower = alignedTick - lowerHalfWidth;
        newUpper = newLower + width;
        int256 move = int256(newLower) - int256(oldLower);
        if (move < 0) move = -move;
        if (move == 0) revert RecenterNotDue();
        if (move > int256(maxRecenterTickMove)) revert RecenterMoveExceeded();
        TickMath.getSqrtPriceAtTick(newLower);
        TickMath.getSqrtPriceAtTick(newUpper);
    }

    /// @notice Redeem a pro-rata portion of the portfolio in kind, retaining shares for any undelivered value.
    /// @dev Incomplete exits use the least deliverable per-token fraction for both payouts and share burn.
    ///      Flooring to raw-token and liquidity units may leave sub-unit residual backing for remaining shares.
    function withdraw(uint256 shares, address recipient, uint256 minAmount0, uint256 minAmount1)
        external
        nonReentrant
        returns (uint256 burned, uint256 amount0Out, uint256 amount1Out)
    {
        _requireActivated();
        _beforeShareChange();
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 supplyBefore = totalSupply();
        if (shares == 0 || shares > balanceOf(msg.sender) || shares > supplyBefore) revert ZeroShares();
        uint256 price0;
        uint256 price1;
        bool markAvailable;
        try this.readPricesForExit() returns (uint256 exitPrice0, uint256 exitPrice1) {
            price0 = exitPrice0;
            price1 = exitPrice1;
            markAvailable = true;
        } catch {
            // Complete pro-rata delivery does not need a mark; incomplete delivery does.
        }
        _collectFees();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        uint256 idle0 = token0.balanceOf(address(this));
        uint256 idle1 = token1.balanceOf(address(this));
        uint256 adapterAssets0 = _adapterAssets(adapter0);
        uint256 adapterAssets1 = _adapterAssets(adapter1);
        uint128 liquidityBefore = positionLiquidity;

        uint256 requestedIdle0 = Math.mulDiv(idle0, shares, supplyBefore);
        uint256 requestedIdle1 = Math.mulDiv(idle1, shares, supplyBefore);
        uint256 requestedAdapter0 = Math.mulDiv(adapterAssets0, shares, supplyBefore);
        uint256 requestedAdapter1 = Math.mulDiv(adapterAssets1, shares, supplyBefore);
        uint128 requestedLiquidity = uint128(Math.mulDiv(liquidityBefore, shares, supplyBefore));

        bool complete = _withdrawalFullyDeliverable(shares, supplyBefore);
        uint256 lpReceived0;
        uint256 lpReceived1;
        if (requestedLiquidity != 0) {
            try this.removeLiquidityForExit(requestedLiquidity) returns (uint256 received0, uint256 received1) {
                lpReceived0 = received0;
                lpReceived1 = received1;
            } catch {
                complete = false;
            }
        }

        uint256 adapterReceived0;
        uint256 adapterReceived1;
        bool bucketComplete;
        (adapterReceived0, bucketComplete) = _recallExitBucket(adapter0, token0, requestedAdapter0);
        if (!bucketComplete) complete = false;
        (adapterReceived1, bucketComplete) = _recallExitBucket(adapter1, token1, requestedAdapter1);
        if (!bucketComplete) complete = false;

        uint256 payout0 = requestedIdle0 + adapterReceived0 + lpReceived0;
        uint256 payout1 = requestedIdle1 + adapterReceived1 + lpReceived1;

        uint256 portfolio0 = idle0 + adapterAssets0;
        uint256 portfolio1 = idle1 + adapterAssets1;
        if (liquidityBefore != 0) {
            (uint256 lpOwed0, uint256 lpOwed1) = MWV4PositionMath.amountsForLiquidity(
                sqrtPriceX96, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), liquidityBefore
            );
            portfolio0 += lpOwed0;
            portfolio1 += lpOwed1;
        }
        uint256 owed0 = Math.mulDiv(portfolio0, shares, supplyBefore);
        uint256 owed1 = Math.mulDiv(portfolio1, shares, supplyBefore);
        // A position's rounded token proceeds can exceed the estimated in-kind share by a few units.
        // Cap before transfers so a later failure in the other token cannot strand an overpayment.
        payout0 = Math.min(payout0, owed0);
        payout1 = Math.min(payout1, owed1);
        uint256 fraction = 1e18;
        if (!complete) {
            if (!markAvailable) revert ExitMarkUnavailable();
            _assertPoolSpotNearMark(price0, price1, sqrtPriceX96);
            (uint160 currentSqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
            _assertPoolSpotNearMark(price0, price1, currentSqrtPriceX96);
            if (owed0 != 0) fraction = Math.min(fraction, Math.mulDiv(payout0, 1e18, owed0));
            if (owed1 != 0) fraction = Math.min(fraction, Math.mulDiv(payout1, 1e18, owed1));
            payout0 = Math.mulDiv(owed0, fraction, 1e18);
            payout1 = Math.mulDiv(owed1, fraction, 1e18);
        }
        bool canPay0 = _exitTransferAvailable(token0, recipient);
        bool canPay1 = _exitTransferAvailable(token1, recipient);
        if (!canPay0 || !canPay1) {
            if (!markAvailable) revert ExitMarkUnavailable();
            _assertPoolSpotNearMark(price0, price1, sqrtPriceX96);
            (uint160 currentSqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
            _assertPoolSpotNearMark(price0, price1, currentSqrtPriceX96);
            complete = false;
            fraction = Math.min(fraction, Math.mulDiv(shares - 1, 1e18, shares));
            payout0 = canPay0 ? Math.mulDiv(owed0, fraction, 1e18) : 0;
            payout1 = canPay1 ? Math.mulDiv(owed1, fraction, 1e18) : 0;
        }
        (amount0Out, bucketComplete) = _payExitBucket(token0, recipient, payout0);
        bool transferFailed = !bucketComplete;
        if (!bucketComplete) complete = false;
        (amount1Out, bucketComplete) = _payExitBucket(token1, recipient, payout1);
        if (!bucketComplete) transferFailed = true;
        if (!bucketComplete) complete = false;

        if (amount0Out < minAmount0 || amount1Out < minAmount1) revert ExitMinimumNotMet();
        if (amount0Out == 0 && amount1Out == 0) revert ZeroAmount();
        burned = shares;
        if (!complete) {
            if (transferFailed) {
                if (!markAvailable) revert ExitMarkUnavailable();
                uint256 requiredBurn;
                if (amount0Out != 0 && owed0 != 0) {
                    requiredBurn = Math.mulDiv(shares, amount0Out, owed0, Math.Rounding.Ceil);
                }
                if (amount1Out != 0 && owed1 != 0) {
                    requiredBurn = Math.max(
                        requiredBurn, Math.mulDiv(shares, amount1Out, owed1, Math.Rounding.Ceil)
                    );
                }
                burned = requiredBurn + 2;
                if (burned >= shares) {
                    if (shares == 1) revert MWMarketShareMath.IncompleteExitConsumesRequest();
                    burned = shares - 1;
                }
            } else {
                burned = Math.mulDiv(shares, fraction, 1e18, Math.Rounding.Ceil);
            }
            if (burned == 0 || burned >= shares) revert MWMarketShareMath.IncompleteExitConsumesRequest();
        }
        _burn(msg.sender, burned);
        emit Withdrawn(msg.sender, recipient, burned, amount0Out, amount1Out);
    }

    /// @notice Isolate LP removal so a failed token/PoolManager delivery does not cancel healthy exit buckets.
    function removeLiquidityForExit(uint128 liquidity) external returns (uint256 received0, uint256 received1) {
        if (msg.sender != address(this)) revert NotSelf();
        if (liquidity == 0 || liquidity > positionLiquidity || liquidity > uint128(type(int128).max)) {
            revert InsufficientLiquidity();
        }
        bytes memory result = _executeUnlock(abi.encode(UnlockAction.Remove, -int128(liquidity)));
        return abi.decode(result, (uint256, uint256));
    }

    /// @notice Isolate a best-effort adapter withdrawal for one exit bucket.
    function recallForExit(IMarketAdapterBinding adapter, IERC20 token, uint256 requested)
        external
        returns (uint256 received)
    {
        if (msg.sender != address(this)) revert NotSelf();
        return _recallFromAdapter(adapter, token, requested);
    }

    /// @notice Isolate recipient transfer so one frozen/restricted token cannot cancel the other payout.
    function payExact(IERC20 token, address recipient, uint256 amount) external {
        if (msg.sender != address(this)) revert NotSelf();
        token.safeTransferExact(recipient, amount);
    }

    /// @dev Self-call boundary so withdraw can proceed with complete pro-rata delivery if the mark is unavailable.
    function readPricesForExit() external view returns (uint256 price0, uint256 price1) {
        if (msg.sender != address(this)) revert NotSelf();
        return _readPrices();
    }

    /// @dev Keep adapter recall failure isolated to its token bucket while measuring actual receipt.
    function _recallExitBucket(IMarketAdapterBinding adapter, IERC20 token, uint256 requested)
        private
        returns (uint256 received, bool complete)
    {
        if (requested == 0) return (0, true);
        try this.recallForExit(adapter, token, requested) returns (uint256 actualReceived) {
            received = actualReceived;
            complete = actualReceived >= requested;
        } catch {
            complete = false;
        }
    }

    /// @dev Keep recipient transfer failure isolated to its token bucket.
    function _payExitBucket(IERC20 token, address recipient, uint256 amount)
        private
        returns (uint256 delivered, bool complete)
    {
        if (amount == 0) return (0, true);
        try this.payExact(token, recipient, amount) {
            return (amount, true);
        } catch {
            return (0, false);
        }
    }

    /// @dev A zero-value transfer probe detects frozen/blacklisted recipient buckets before either payout.
    function _exitTransferAvailable(IERC20 token, address recipient) private returns (bool) {
        try this.payExact(token, recipient, 0) { return true; } catch { return false; }
    }

    /// @notice PoolManager callback for this engine's typed add/remove/fee-collection actions.
    function unlockCallback(bytes calldata data) external virtual returns (bytes memory result) {
        return _unlockCallback(data);
    }

    function _unlockCallback(bytes calldata data) internal returns (bytes memory result) {
        _onlyPoolManager();
        if (_activeUnlockHash == bytes32(0) || keccak256(data) != _activeUnlockHash) revert UnexpectedUnlock();
        UnlockAction action = abi.decode(data, (UnlockAction));
        (bool success, bytes memory output) = address(lifecycleModule).delegatecall(
            abi.encodeCall(
                MintwareMarketLifecycleModule.executeCallback,
                (poolManager, poolKey, tickLower, tickUpper, token0, token1, uint8(action), data, positionLiquidity)
            )
        );
        if (!success) assembly ("memory-safe") { revert(add(output, 0x20), mload(output)) }
        (positionLiquidity, result) = abi.decode(output, (uint128, bytes));
        if (action == UnlockAction.Recenter) {
            (tickLower, tickUpper,,) = abi.decode(result, (int24, int24, uint256, uint256));
        }
    }

    function _supplyToAdapter(IMarketAdapterBinding adapter, IERC20 token, uint256 amount) private {
        if (amount == 0 || amount > token.balanceOf(address(this)) || amount > adapter.maxSuppliable()) {
            revert InvalidAdapter();
        }
        uint256 beforeBalance = token.balanceOf(address(this));
        token.forceApprove(address(adapter), amount);
        adapter.deposit(amount);
        token.forceApprove(address(adapter), 0);
        uint256 afterBalance = token.balanceOf(address(this));
        if (beforeBalance < afterBalance || beforeBalance - afterBalance != amount) revert AdapterReceiptMismatch();
    }

    function _allocateDeposit(IMarketAdapterBinding adapter, IERC20 token, uint256 amount) private {
        if (amount == 0) return;
        uint256 capacity = adapter.maxSuppliable();
        uint256 supplied = amount < capacity ? amount : capacity;
        if (supplied != 0) _supplyToAdapter(adapter, token, supplied);
    }

    function _recallFromAdapter(IMarketAdapterBinding adapter, IERC20 token, uint256 amount)
        private
        returns (uint256 received)
    {
        uint256 beforeBalance = token.balanceOf(address(this));
        adapter.withdraw(amount);
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance) revert AdapterReceiptMismatch();
        received = afterBalance - beforeBalance;
        if (received > amount) revert AdapterReceiptMismatch();
    }

    /// @dev NAV failure is intentionally fail-closed: exits cannot fairly size an adapter bucket or
    ///      value residual shares without its current claim amount. Keep this distinct from a failed recall.
    function _adapterAssets(IMarketAdapterBinding adapter) internal view returns (uint256 assets) {
        try adapter.totalAssets() returns (uint256 reportedAssets) {
            return reportedAssets;
        } catch {
            revert AdapterNavUnavailable(address(adapter));
        }
    }

    function _collectFees() internal returns (uint256 amount0, uint256 amount1) {
        if (positionLiquidity == 0) return (0, 0);
        bytes memory result = _executeUnlock(abi.encode(UnlockAction.Collect));
        return abi.decode(result, (uint256, uint256));
    }

    function _executeUnlock(bytes memory data) internal returns (bytes memory result) {
        if (_activeUnlockHash != bytes32(0)) revert NestedUnlock();
        _activeUnlockHash = keccak256(data);
        result = poolManager.unlock(data);
        delete _activeUnlockHash;
    }

    function _readPrices() internal view returns (uint256 price0, uint256 price1) {
        (uint256 marketPrice,) = MWMarketValuation.freshPriceWad(nonQuoteMark, maxMarkAge);
        if (quoteIsToken0) return (1e18, marketPrice);
        return (marketPrice, 1e18);
    }

    function _navAt(uint256 price0, uint256 price1, uint160 sqrtPriceX96) internal view returns (uint256 nav) {
        uint256 assets0 = token0.balanceOf(address(this)) + _adapterAssets(adapter0);
        uint256 assets1 = token1.balanceOf(address(this)) + _adapterAssets(adapter1);
        return _navFrom(assets0, assets1, positionLiquidity, price0, price1, sqrtPriceX96);
    }

    function _navFrom(
        uint256 assets0,
        uint256 assets1,
        uint128 liquidity,
        uint256 price0,
        uint256 price1,
        uint160 sqrtPriceX96
    ) internal view virtual returns (uint256 nav) {
        if (liquidity != 0) {
            (uint256 lp0, uint256 lp1) = MWV4PositionMath.amountsForLiquidity(
                sqrtPriceX96,
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                liquidity
            );
            assets0 += lp0;
            assets1 += lp1;
        }
        nav = _value0(assets0, price0) + _value1(assets1, price1)
            + _additionalNav(price0, price1, sqrtPriceX96);
    }

    function _positionValue(uint256 price0, uint256 price1, uint160 sqrtPriceX96) internal view returns (uint256) {
        if (positionLiquidity == 0) return 0;
        (uint256 amount0, uint256 amount1) = MWV4PositionMath.amountsForLiquidity(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            positionLiquidity
        );
        return _value0(amount0, price0) + _value1(amount1, price1);
    }

    function _totalPositionValue(uint256 price0, uint256 price1, uint160 sqrtPriceX96)
        internal
        view
        returns (uint256)
    {
        return _positionValue(price0, price1, sqrtPriceX96)
            + _additionalPositionValue(price0, price1, sqrtPriceX96);
    }

    function _value0(uint256 amount, uint256 priceWad) internal view returns (uint256) {
        return MWMarketValuation.quoteValueRaw(amount, token0Decimals, quoteDecimals, priceWad);
    }

    function _value1(uint256 amount, uint256 priceWad) internal view returns (uint256) {
        return MWMarketValuation.quoteValueRaw(amount, token1Decimals, quoteDecimals, priceWad);
    }

    /// @dev Compare the V4 spot-implied quote value of one whole non-quote token with its independent mark.
    ///      Both values use quote-token raw units, so token decimal and currency orientation differences
    ///      are handled by the shared valuation helpers rather than by a hand-built sqrt-price ratio.
    function _assertPoolSpotNearMark(uint256 price0, uint256 price1, uint160 sqrtPriceX96) internal view {
        uint8 assetDecimals = quoteIsToken0 ? token1Decimals : token0Decimals;
        uint256 assetUnit = 10 ** assetDecimals;
        uint256 markedQuoteRaw = quoteIsToken0
            ? _value1(assetUnit, price1)
            : _value0(assetUnit, price0);
        uint256 poolQuoteRaw = MWV4PositionMath.quoteValue(assetUnit, sqrtPriceX96, quoteIsToken0);
        if (markedQuoteRaw == 0 || poolQuoteRaw == 0) revert PoolMarkDeviationExceeded();
        uint256 deviation = poolQuoteRaw > markedQuoteRaw
            ? poolQuoteRaw - markedQuoteRaw
            : markedQuoteRaw - poolQuoteRaw;
        if (deviation > Math.mulDiv(markedQuoteRaw, maxSpotMarkDeviationBps, BPS)) {
            revert PoolMarkDeviationExceeded();
        }
    }

    function _beforeShareChange() internal virtual {}

    function _beforePositionChange() internal virtual {}

    function _withdrawalFullyDeliverable(uint256, uint256) internal view virtual returns (bool) {
        return true;
    }

    function _additionalNav(uint256, uint256, uint160) internal view virtual returns (uint256) {
        return 0;
    }

    function _additionalPositionValue(uint256, uint256, uint160) internal view virtual returns (uint256) {
        return 0;
    }

    function _requireActivated() internal view {
        if (!activated) revert NotActivated();
    }
}
