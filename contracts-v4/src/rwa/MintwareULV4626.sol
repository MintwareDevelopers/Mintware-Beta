// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager}          from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey}               from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency}              from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta}          from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath}              from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary}          from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts}      from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {MintwareBaseVault4626}       from "../vaults/MintwareBaseVault4626.sol";
import {VaultConfig}                 from "../vaults/VaultTypes.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "./SPVBeneficiaryRegistry.sol";
import {MWRouter}                    from "../MWRouter.sol";

/// @title  MintwareULV4626
/// @notice Surface-2 (RWA) **USDC-only Liquidity Vault** (three-role model, LP side). Public LPs
///         deposit USDC and receive USDC-denominated ERC-4626 shares — they **never mint, hold, or
///         receive `vRWA`**. The vault deploys the USDC as single-sided liquidity into the deal's
///         oracle-banded vRWA/USDC pool (attaching as an authorized LP on the MintwareOracleHook,
///         alongside the issuer's RWA vault). Withdrawals use the base async notice window: a keeper
///         sweeps any vRWA the position accrued (as traders sell into the pool) back to USDC via
///         MWRouter, so LPs are always paid in USDC.
///
/// @dev    **QP gate:** `requireQualifiedPurchaser` defaults to TRUE (safe) — deposits require a
///         registry level ≥ ACCREDITED — so the vault never ships open by accident. Counsel's 3(c)(7)
///         ruling *relaxes* it via `setQualifiedPurchaserRequired(false)` (see
///         docs/developers/rwa-compliance-three-role-model.md §3). Share pricing is par-principal v1
///         (`totalAssets == totalPrincipal`); mark-to-market of the live position is a v2 refinement.
contract MintwareULV4626 is MintwareBaseVault4626 {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    SPVBeneficiaryRegistry public registry;
    MWRouter               public router;
    address public keeper;                 // sweeps accrued vRWA → USDC during the notice window
    address public vrwaToken;              // the pool's non-USDC currency (set at attachPool)
    bool    public usdcIsCurrency0;
    bool    public requireQualifiedPurchaser = true; // SAFE default; 3(c)(7) ruling relaxes it

    KYCLevel public constant MIN_LP_LEVEL = KYCLevel.ACCREDITED;

    event RegistrySet(address indexed registry);
    event RouterSet(address indexed router);
    event KeeperSet(address indexed keeper);
    event QualifiedPurchaserRequiredSet(bool required);
    event PoolAttached(bytes32 indexed poolId, address vrwaToken, bool usdcIsCurrency0);
    event LiquidityDeployed(uint256 usdc, uint128 liquidity);
    event VrwaSwept(uint256 vrwaIn, uint256 usdcOut);

    error NotQualifiedPurchaser();
    error OnlyKeeper();
    error InvalidPoolPair();
    error PoolNotAttached();
    error NoRouter();

    constructor(VaultConfig memory cfg, address _poolManager, address _feeVault, address _registry)
        MintwareBaseVault4626(cfg, _poolManager, _feeVault)
    {
        registry = SPVBeneficiaryRegistry(_registry);
    }

    // ── admin ────────────────────────────────────────────────────────────────

    function setRegistry(address _registry) external onlyOwner {
        registry = SPVBeneficiaryRegistry(_registry);
        emit RegistrySet(_registry);
    }

    function setRouter(address _router) external onlyOwner {
        router = MWRouter(_router);
        emit RouterSet(_router);
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    function setQualifiedPurchaserRequired(bool required) external onlyOwner {
        requireQualifiedPurchaser = required;
        emit QualifiedPurchaserRequiredSet(required);
    }

    /// @notice Attach to the deal's ALREADY-initialized vRWA/USDC pool (created by the RWA vault's
    ///         listAndSeedPool) and set the single-sided USDC range. Does NOT re-initialize the pool.
    ///         The owner must also authorize this vault on the pool's hook (`hook.setLp(ulv, true)`),
    ///         and the range must sit on the USDC-only side of the current price.
    function attachPool(PoolKey calldata key, int24 tl, int24 tu) external onlyOwner {
        if (poolInitialized) revert PoolAlreadyInitialized();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool usdc0 = c0 == asset();
        bool usdc1 = c1 == asset();
        if (!usdc0 && !usdc1) revert InvalidPoolPair();

        poolKey         = key;
        tickLower       = tl;
        tickUpper       = tu;
        poolInitialized = true;
        usdcIsCurrency0 = usdc0;
        vrwaToken       = usdc0 ? c1 : c0;
        emit PoolAttached(PoolId.unwrap(key.toId()), vrwaToken, usdc0);
    }

    // ── deposit gate — USDC only, no vRWA, QP-gated ──────────────────────────

    /// @dev Runs after the base mints shares + deploys liquidity. LPs receive USDC-denominated
    ///      shares and NEVER vRWA. Gate on qualified-purchaser status (reverts the whole deposit).
    function _afterEnter(address, uint256, uint256) internal view override {
        if (!_qualified(_msgSender())) revert NotQualifiedPurchaser();
    }

    function _qualified(address account) internal view returns (bool) {
        if (!requireQualifiedPurchaser) return true;
        if (address(registry) == address(0)) return false;
        (bool ok, KYCLevel lvl) = registry.checkBeneficiary(account);
        return ok && uint8(lvl) >= uint8(MIN_LP_LEVEL);
    }

    // ── keeper: keep the vault USDC-solvent for withdrawals ──────────────────

    /// @notice Deploy the vault's idle USDC balance as single-sided liquidity (e.g. USDC that
    ///         accumulated before attachPool). Owner or keeper.
    function deployReserve() external nonReentrant {
        if (msg.sender != keeper && msg.sender != owner()) revert OnlyKeeper();
        if (!poolInitialized) revert PoolNotAttached();
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        if (bal == 0) return;
        poolManager.unlock(abi.encode(Action.Deploy, abi.encode(bal)));
    }

    /// @notice Swap the vault's accrued vRWA → USDC through MWRouter so async withdrawals settle in
    ///         USDC. Run by the keeper during a redemption's notice window. Owner or keeper.
    function sweepVrwaToUsdc(uint256 amountIn, uint256 minUsdcOut) external nonReentrant returns (uint256 usdcOut) {
        if (msg.sender != keeper && msg.sender != owner()) revert OnlyKeeper();
        if (address(router) == address(0)) revert NoRouter();
        if (!poolInitialized) revert PoolNotAttached();

        uint256 bal = IERC20(vrwaToken).balanceOf(address(this));
        if (amountIn == 0 || amountIn > bal) amountIn = bal;
        if (amountIn == 0) return 0;

        IERC20(vrwaToken).forceApprove(address(router), amountIn);
        // Selling vRWA for USDC: zeroForOne is true iff vRWA is currency0.
        usdcOut = router.swapExactInputSingle(MWRouter.ExactInputSingleParams({
            key:              poolKey,
            zeroForOne:       !usdcIsCurrency0,
            amountIn:         amountIn,
            amountOutMinimum: minUsdcOut,
            recipient:        address(this),
            deadline:         block.timestamp,
            tag:              ""
        }));
        emit VrwaSwept(amountIn, usdcOut);
    }

    // ── liquidity hooks (single-sided USDC) ──────────────────────────────────

    /// @dev Deploy `assets` USDC as single-sided liquidity into [tickLower, tickUpper]. The range
    ///      must be on the USDC-only side of the current price, so the position needs no vRWA; the
    ///      settle then owes only USDC. If the range is mis-set, liquidity computes to ~0 (no-op).
    function _deployLiquidity(uint256 assets) internal override returns (bytes memory) {
        if (!poolInitialized || assets == 0) return "";

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        (uint160 sqrtCurrent,,,) = poolManager.getSlot0(poolKey.toId());

        (uint256 amt0, uint256 amt1) = usdcIsCurrency0 ? (assets, uint256(0)) : (uint256(0), assets);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(sqrtCurrent, sqrtLower, sqrtUpper, amt0, amt1);
        if (liquidity == 0) return "";

        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(callerDelta);
        totalLiquidity += liquidity;
        emit LiquidityDeployed(assets, liquidity);
        return abi.encode(liquidity);
    }

    /// @dev Remove `liquidity`, returning USDC (and any accrued vRWA) to the vault. The base
    ///      async-redeem caps the USDC payout at the vault balance, so the keeper's sweep must have
    ///      converted any accrued vRWA→USDC before settlement.
    function _removeLiquidity(uint128 liquidity) internal override returns (bytes memory) {
        if (liquidity == 0) return "";
        if (liquidity > totalLiquidity) liquidity = totalLiquidity;

        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(liquidity)), salt: bytes32(0)}),
            ""
        );
        _settleDelta(callerDelta);
        totalLiquidity -= liquidity;
        return abi.encode(liquidity);
    }

    /// @dev Rebalance to a new range: remove all liquidity, move the ticks, redeploy the vault's
    ///      USDC balance single-sided. Keeper re-centers as price drifts.
    function _rebalanceLiquidity(int24 newTickLower, int24 newTickUpper) internal override returns (bytes memory) {
        if (totalLiquidity > 0) {
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: -int256(uint256(totalLiquidity)), salt: bytes32(0)}),
                ""
            );
            _settleDelta(d);
            totalLiquidity = 0;
        }
        tickLower = newTickLower;
        tickUpper = newTickUpper;

        uint256 bal = IERC20(asset()).balanceOf(address(this));
        return _deployLiquidity(bal);
    }
}
