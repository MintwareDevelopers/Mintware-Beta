// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MintwareBaseVault4626, IFeeVaultNotifier} from "./MintwareBaseVault4626.sol";
import {VaultConfig, PoolProfile} from "./VaultTypes.sol";
import {IYieldAdapter} from "./IYieldAdapter.sol";

/// @title  MintwareDeFiVault4626
/// @notice Surface-1 (DeFi) vault. Extends the ERC-4626 base with single-sided
///         USDC liquidity deployment into a Uniswap V4 pool paired against a
///         team-seeded PROJECT token. This is the ERC-4626 evolution of the
///         Phase-2 SocialVault (behavior preserved; now a tokenized share vault).
///
/// @dev    DEPRECATED — DO NOT DEPLOY WITH REAL VALUE. The go-forward DeFi vault is the solvent
///         dual-sided `MintwareDeFiPairVault` (a share is a real V4 liquidity unit; redemption
///         returns both tokens at true value). This vault's shares are PRINCIPAL-denominated
///         (`totalAssets() == totalPrincipal`, "D5" in the base) while principal is deployed as
///         single-sided USDC LP that converts to the team token on swaps — so par-principal
///         redemption can leave a first-mover / bank-run shortfall (internal audit CRIT #2). The
///         source is retained for provenance and testnet history; new deployments must use
///         `DeployPairVault.s.sol`, and the on-chain registry marks retired vaults via
///         `MintwareVaultRegistry.deactivateVault`. The frontend cutover (single→pair ABI) is the
///         Phase-3B migration and is deploy-gated on the pair vault going live.
///
///         Implements the base's liquidity hooks (_deployLiquidity / _removeLiquidity
///         / _rebalanceLiquidity). Volatility/depth dynamic fees, pool profiles, and
///         idle-capital routing arrive in Track A.
contract MintwareDeFiVault4626 is MintwareBaseVault4626 {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    struct TeamSeed {
        address projectToken;
        uint256 amount;
        uint256 seededAt;
    }

    mapping(bytes32 => TeamSeed) public teamSeeds;

    /// @notice Active pool profile driving the LP tick-range half-width.
    PoolProfile public profile = PoolProfile.BLUE_CHIP;

    /// @notice Swap-fee split (spec): 50% depositors / 25% Mintware / 25% provider.
    uint256 public constant SWAP_DEPOSITOR_BPS = 5_000;
    uint256 public constant SWAP_MINTWARE_BPS  = 2_500;
    uint256 public constant SWAP_PROVIDER_BPS  = 2_500;

    /// @notice Idle-capital yield split (spec): 70% depositors / 30% Mintware.
    uint256 public constant IDLE_DEPOSITOR_BPS = 7_000;
    uint256 public constant IDLE_MINTWARE_BPS  = 3_000;

    // Idle-capital state (Track A4). When enabled, deposits deploy only
    // (1 - idleTargetRatioBps) into the LP and hold the rest as a USDC reserve that a
    // keeper routes to `yieldAdapter`. The reserve covers the idle portion at redemption,
    // so the base redeem logic is unchanged.
    //
    // Stage-1.1 hardening (rehypothecation-reentrancy category — Bunni/Cyfrin):
    //   1. Destination allowlist + 48h timelock — `yieldAdapter` can only be set to an
    //      address that was proposed and confirmed after the timelock. No function ever
    //      accepts a caller-supplied arbitrary vault address (Cyfrin pattern #7).
    //   2. Withdrawal-buffer invariant — `rehypothecationCapBps` caps how much principal
    //      can ever sit in the external adapter, so a hard-floor fraction is always held
    //      by the vault itself (Aave-V4 Reinvestment-Module pattern).
    //   3. CEI + nonReentrant on every route/recall/harvest, with post-transfer balance
    //      assertions so a lying/short-sending adapter cannot desync accounting.
    address public yieldAdapter;
    bool    public idleEnabled;
    uint256 public idleTargetRatioBps;  // e.g. 6_000 = 60%
    uint256 public principalInAdapter;  // USDC principal currently in the adapter

    /// @notice Timelock a new adapter must clear between proposal and activation.
    uint256 public constant ADAPTER_TIMELOCK = 48 hours;

    /// @notice Hard ceiling on the rehypothecation cap — ≥20% of principal is ALWAYS
    ///         retained by the vault (never in the external adapter), even if misconfigured.
    uint256 public constant MAX_REHYP_CAP_BPS = 8_000;

    /// @notice Max fraction of `totalPrincipal` permitted in the external adapter. Default
    ///         70% (30% withdrawal buffer). Owner-settable within [0, MAX_REHYP_CAP_BPS].
    uint256 public rehypothecationCapBps = 7_000;

    /// @notice Allowlisted yield-adapter destinations. Only an allowed adapter may be set
    ///         as `yieldAdapter` or receive routed capital.
    mapping(address => bool)    public adapterAllowed;
    /// @notice Timestamp an adapter was proposed; 0 = not proposed. Confirmable after timelock.
    mapping(address => uint256) public adapterProposedAt;

    event TeamSeeded(bytes32 indexed vaultId, address token, uint256 amount);
    event ProfileRebalanced(PoolProfile indexed profile, int24 tickLower, int24 tickUpper);
    event SwapFeesCollected(uint256 usdcFees, uint256 projFees, uint256 toDepositors, uint256 toMintware, uint256 toProvider);
    event IdleConfigured(bool enabled, uint256 targetRatioBps);
    event YieldAdapterSet(address indexed adapter);
    event AdapterProposed(address indexed adapter, uint256 confirmableAt);
    event AdapterConfirmed(address indexed adapter);
    event AdapterRevoked(address indexed adapter);
    event RehypothecationCapSet(uint256 capBps);
    event IdleRouted(uint256 amount);
    event IdleRecalled(uint256 amount);
    event YieldHarvested(uint256 yield, uint256 toDepositors, uint256 toMintware);

    error InvalidSeed();
    error SeedAlreadyInitialized();
    error InvalidPoolKey();
    error EmptyProfileRange();
    error IdleNotEnabled();
    error NoYieldAdapter();
    error RatioTooHigh();
    error AdapterNotAllowed();
    error AdapterNotProposed();
    error AdapterTimelockPending();
    error RehypothecationCapExceeded();
    error AdapterTransferMismatch();

    constructor(VaultConfig memory cfg, address _poolManager, address _feeVault)
        MintwareBaseVault4626(cfg, _poolManager, _feeVault)
    {}

    // ─────────────────────────────────────────────────────────────────────────
    // Team seeding + pool init (DeFi-surface specific)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Team seeds PROJECT tokens and initializes the V4 pool.
    function seedTeamTokens(
        bytes32 vaultId,
        address projectToken,
        uint256 amount,
        PoolKey calldata key,
        uint160 sqrtPriceX96
    ) external onlyOwner nonReentrant {
        if (projectToken == address(0) || amount == 0) revert InvalidSeed();
        if (teamSeeds[vaultId].projectToken != address(0)) revert SeedAlreadyInitialized();

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool validPair =
            (c0 == projectToken && c1 == asset()) ||
            (c1 == projectToken && c0 == asset());
        if (!validPair) revert InvalidPoolKey();

        if (poolInitialized && PoolId.unwrap(key.toId()) != PoolId.unwrap(poolKey.toId())) {
            revert InvalidPoolKey();
        }

        IERC20(projectToken).safeTransferFrom(msg.sender, address(this), amount);

        teamSeeds[vaultId] = TeamSeed({
            projectToken: projectToken,
            amount:       amount,
            seededAt:     block.timestamp
        });

        if (!poolInitialized) {
            _initializePool(key, sqrtPriceX96);
        }

        emit TeamSeeded(vaultId, projectToken, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pool profiles (Track A1) — set the LP tick range from a risk profile
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Tick half-width for a profile (aligned to tickSpacing by the caller).
    function profileHalfWidth(PoolProfile p) public pure returns (int24) {
        if (p == PoolProfile.BLUE_CHIP) return 600;
        if (p == PoolProfile.EMERGING)  return 1200;
        return 2400; // MEME
    }

    /// @notice Rebalance liquidity into a symmetric range around the current pool
    ///         tick, sized by `p`'s half-width and aligned to the pool's tickSpacing.
    function rebalanceToProfile(PoolProfile p) external onlyOwner nonReentrant whenNotPaused {
        if (!poolInitialized) revert PoolNotInitialized();

        int24 spacing = poolKey.tickSpacing;
        (, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());
        int24 hw = profileHalfWidth(p);

        int24 lower = _alignTick(currentTick - hw, spacing);
        int24 upper = _alignTick(currentTick + hw, spacing);
        if (upper <= lower) revert EmptyProfileRange();

        profile = p;
        poolManager.unlock(abi.encode(Action.Rebalance, abi.encode(lower, upper)));
        emit ProfileRebalanced(p, lower, upper);
    }

    /// @dev Align a tick to the nearest lower multiple of `spacing` (V4 requires
    ///      tickLower/Upper to be multiples of tickSpacing). Rounds toward -infinity.
    function _alignTick(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 rounded = (tick / spacing) * spacing;
        if (tick < 0 && rounded != tick) rounded -= spacing;
        return rounded;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Swap-fee collection + 50/25/25 split (spec fee model)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Realize accrued V4 swap fees on the vault position and split them
    ///         50% depositors (→ FeeVault epoch) / 25% Mintware (→ treasury) / 25% provider.
    /// @dev    USDC fees route natively. PROJECT-token fees: provider takes its 25%
    ///         in-kind; the remaining 75% (depositor 50% + Mintware 25%) goes to treasury
    ///         staging for off-chain USDC conversion + epoch credit (FeeVault is USDC-only).
    function collectFees() external nonReentrant returns (uint256 usdcFees, uint256 projFees) {
        if (!poolInitialized) revert PoolNotInitialized();

        bytes memory res = poolManager.unlock(abi.encode(Action.Collect, bytes("")));
        address projToken;
        (usdcFees, projFees, projToken) = abi.decode(res, (uint256, uint256, address));

        if (usdcFees > 0) {
            uint256 toMintware = (usdcFees * SWAP_MINTWARE_BPS) / BPS;
            uint256 toProvider = (usdcFees * SWAP_PROVIDER_BPS) / BPS;
            uint256 toDepositors = usdcFees - toMintware - toProvider;

            IERC20(asset()).safeTransfer(treasury, toMintware);
            IERC20(asset()).safeTransfer(provider, toProvider);
            if (toDepositors > 0) {
                IERC20(asset()).safeTransfer(feeVault, toDepositors);
                IFeeVaultNotifier(feeVault).notifyFeeReceipt(toDepositors, "trading_fee");
            }
            emit SwapFeesCollected(usdcFees, projFees, toDepositors, toMintware, toProvider);
        }

        if (projFees > 0 && projToken != address(0)) {
            uint256 provShare = (projFees * SWAP_PROVIDER_BPS) / BPS;
            IERC20(projToken).safeTransfer(provider, provShare);
            IERC20(projToken).safeTransfer(treasury, projFees - provShare);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Idle-capital routing (Track A4)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Enable/disable idle capital and set the reserve target (bps of a deposit
    ///         held back from the LP). e.g. 6_000 = 60% reserve / 40% LP.
    function setIdleConfig(bool enabled, uint256 targetRatioBps) external onlyOwner {
        if (targetRatioBps > BPS) revert RatioTooHigh();
        idleEnabled        = enabled;
        idleTargetRatioBps = targetRatioBps;
        emit IdleConfigured(enabled, targetRatioBps);
    }

    /// @notice Set the withdrawal-buffer invariant — the max fraction of `totalPrincipal`
    ///         that may sit in the external adapter. The remainder is always held by the
    ///         vault, guaranteeing instant-withdrawal liquidity independent of the adapter.
    /// @dev    Hard-capped at MAX_REHYP_CAP_BPS (80%) so a misconfig can never rehypothecate
    ///         the whole pool. Lowering it below current exposure is allowed; the invariant
    ///         is enforced at route time, so existing exposure is simply frozen until recalled.
    function setRehypothecationCap(uint256 capBps) external onlyOwner {
        if (capBps > MAX_REHYP_CAP_BPS) revert RatioTooHigh();
        rehypothecationCapBps = capBps;
        emit RehypothecationCapSet(capBps);
    }

    // ── Adapter allowlist (hard-allowlisted destinations + 48h timelock) ──────

    /// @notice Step 1: propose a yield-adapter destination. Starts the 48h timelock.
    function proposeAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert NoYieldAdapter();
        adapterProposedAt[adapter] = block.timestamp;
        emit AdapterProposed(adapter, block.timestamp + ADAPTER_TIMELOCK);
    }

    /// @notice Step 2: confirm a proposed adapter after the timelock — adds it to the allowlist.
    function confirmAdapter(address adapter) external onlyOwner {
        uint256 proposedAt = adapterProposedAt[adapter];
        if (proposedAt == 0)                                     revert AdapterNotProposed();
        if (block.timestamp < proposedAt + ADAPTER_TIMELOCK)     revert AdapterTimelockPending();
        adapterAllowed[adapter] = true;
        emit AdapterConfirmed(adapter);
    }

    /// @notice Remove an adapter from the allowlist — instant (a safety action). Does not
    ///         touch `yieldAdapter`/`principalInAdapter`; recall still works to pull funds back.
    function revokeAdapter(address adapter) external onlyOwner {
        adapterAllowed[adapter]   = false;
        adapterProposedAt[adapter] = 0;
        emit AdapterRevoked(adapter);
    }

    /// @notice Point routing at an allowlisted adapter (or address(0) to disable routing).
    function setYieldAdapter(address adapter) external onlyOwner {
        if (adapter != address(0) && !adapterAllowed[adapter]) revert AdapterNotAllowed();
        yieldAdapter = adapter;
        emit YieldAdapterSet(adapter);
    }

    /// @notice Route `amount` of the idle USDC reserve into the yield adapter.
    /// @dev    CEI: accounting is updated before the external deposit; a post-transfer
    ///         balance assertion rejects a short-pulling adapter. Frozen while paused.
    function routeIdleToYield(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        if (!idleEnabled) revert IdleNotEnabled();
        address adapter = yieldAdapter;
        if (adapter == address(0))        revert NoYieldAdapter();
        if (!adapterAllowed[adapter])     revert AdapterNotAllowed();

        // Withdrawal-buffer invariant: never let external exposure exceed the cap.
        if (principalInAdapter + amount > (totalPrincipal * rehypothecationCapBps) / BPS) {
            revert RehypothecationCapExceeded();
        }

        // Effects
        principalInAdapter += amount;

        // Interactions
        IERC20 a = IERC20(asset());
        uint256 balBefore = a.balanceOf(address(this));
        a.forceApprove(adapter, amount);
        IYieldAdapter(adapter).deposit(amount);
        a.forceApprove(adapter, 0); // clear any dangling allowance
        if (balBefore - a.balanceOf(address(this)) != amount) revert AdapterTransferMismatch();

        emit IdleRouted(amount);
    }

    /// @notice Pull `amount` of routed principal back from the adapter into the vault.
    /// @dev    NOT gated by `whenNotPaused` — recalling capital to safety must remain
    ///         possible during an emergency pause. CEI + balance assertion as above.
    function recallIdleFromYield(uint256 amount) external onlyOwner nonReentrant {
        address adapter = yieldAdapter;
        if (adapter == address(0)) revert NoYieldAdapter();

        // Effects
        principalInAdapter = amount >= principalInAdapter ? 0 : principalInAdapter - amount;

        // Interactions
        IERC20 a = IERC20(asset());
        uint256 balBefore = a.balanceOf(address(this));
        IYieldAdapter(adapter).withdraw(amount);
        if (a.balanceOf(address(this)) - balBefore != amount) revert AdapterTransferMismatch();

        emit IdleRecalled(amount);
    }

    /// @notice Harvest adapter yield (balance above routed principal) and split it
    ///         70% depositors (→ FeeVault epoch) / 30% Mintware (→ treasury).
    /// @dev    Balance assertion on the withdraw rejects a lying adapter; frozen while paused.
    function harvestYield() external nonReentrant whenNotPaused returns (uint256 yield) {
        address adapter = yieldAdapter;
        if (adapter == address(0)) revert NoYieldAdapter();

        uint256 bal = IYieldAdapter(adapter).totalAssets();
        yield = bal > principalInAdapter ? bal - principalInAdapter : 0;
        if (yield == 0) return 0;

        IERC20 a = IERC20(asset());
        uint256 balBefore = a.balanceOf(address(this));
        IYieldAdapter(adapter).withdraw(yield);
        if (a.balanceOf(address(this)) - balBefore != yield) revert AdapterTransferMismatch();

        uint256 toDepositors = (yield * IDLE_DEPOSITOR_BPS) / BPS;
        uint256 toMintware   = yield - toDepositors;

        a.safeTransfer(treasury, toMintware);
        if (toDepositors > 0) {
            a.safeTransfer(feeVault, toDepositors);
            IFeeVaultNotifier(feeVault).notifyFeeReceipt(toDepositors, "idle_yield");
        }
        emit YieldHarvested(yield, toDepositors, toMintware);
    }

    /// @notice Idle USDC held by the vault + routed to the adapter (excludes LP position).
    function idleReserve() external view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + principalInAdapter;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidity hooks — implement the base's virtuals
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Add USDC as single-sided liquidity at the current tick range. When idle
    ///      capital is enabled, only (1 - idleTargetRatioBps) is deployed; the remainder
    ///      stays as a USDC reserve in the vault for the keeper to route to yield.
    function _deployLiquidity(uint256 assets) internal override returns (bytes memory) {
        if (idleEnabled && idleTargetRatioBps > 0) {
            assets = assets - (assets * idleTargetRatioBps) / BPS;
            if (assets == 0) return "";
        }

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == asset();

        uint128 liquidity = usdcIsToken0
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, assets)
            : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, assets);

        if (liquidity == 0) return "";

        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );
        _settleDelta(callerDelta);
        totalLiquidity += liquidity;
        return abi.encode(liquidity);
    }

    /// @dev Realize accrued swap fees (liquidityDelta 0) and take them to the vault.
    ///      Returns abi.encode(usdcFees, projFees, projToken).
    function _collectFees() internal override returns (bytes memory) {
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: 0,
                salt:           bytes32(0)
            }),
            ""
        );
        _settleDelta(d);

        uint256 amt0 = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
        uint256 amt1 = d.amount1() > 0 ? uint256(uint128(d.amount1())) : 0;

        bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == asset();
        uint256 usdcFees  = usdcIsToken0 ? amt0 : amt1;
        uint256 projFees  = usdcIsToken0 ? amt1 : amt0;
        address projToken = usdcIsToken0 ? Currency.unwrap(poolKey.currency1) : Currency.unwrap(poolKey.currency0);

        return abi.encode(usdcFees, projFees, projToken);
    }

    /// @dev Remove exact `liquidity` from the current range, returning tokens here.
    function _removeLiquidity(uint128 liquidity) internal override returns (bytes memory) {
        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower:      tickLower,
                tickUpper:      tickUpper,
                liquidityDelta: -int256(uint256(liquidity)),
                salt:           bytes32(0)
            }),
            ""
        );
        _settleDelta(callerDelta);
        totalLiquidity -= liquidity;
        return "";
    }

    /// @dev Atomically remove all liquidity and re-add all principal at a new range.
    function _rebalanceLiquidity(int24 newTickLower, int24 newTickUpper)
        internal
        override
        returns (bytes memory)
    {
        if (totalLiquidity > 0) {
            (BalanceDelta removeDelta,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({
                    tickLower:      tickLower,
                    tickUpper:      tickUpper,
                    liquidityDelta: -int256(uint256(totalLiquidity)),
                    salt:           bytes32(0)
                }),
                ""
            );
            _settleDelta(removeDelta);
            totalLiquidity = 0;
        }

        tickLower = newTickLower;
        tickUpper = newTickUpper;

        if (totalPrincipal > 0) {
            uint160 sqrtLower = TickMath.getSqrtPriceAtTick(newTickLower);
            uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(newTickUpper);
            bool usdcIsToken0 = Currency.unwrap(poolKey.currency0) == asset();

            uint128 newLiquidity = usdcIsToken0
                ? LiquidityAmounts.getLiquidityForAmount0(sqrtLower, sqrtUpper, totalPrincipal)
                : LiquidityAmounts.getLiquidityForAmount1(sqrtLower, sqrtUpper, totalPrincipal);

            if (newLiquidity > 0) {
                (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
                    poolKey,
                    ModifyLiquidityParams({
                        tickLower:      newTickLower,
                        tickUpper:      newTickUpper,
                        liquidityDelta: int256(uint256(newLiquidity)),
                        salt:           bytes32(0)
                    }),
                    ""
                );
                _settleDelta(addDelta);
                totalLiquidity = newLiquidity;
            }
        }
        return "";
    }
}
