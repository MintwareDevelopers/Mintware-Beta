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

import {MintwareBaseVault4626, IFeeVaultNotifier} from "../vaults/MintwareBaseVault4626.sol";
import {VaultConfig}           from "../vaults/VaultTypes.sol";
import {IYieldAdapter}         from "../vaults/IYieldAdapter.sol";
import {MintwareVRWA}          from "./MintwareVRWA.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "./SPVBeneficiaryRegistry.sol";

/// @title  MintwareRWAVault4626
/// @notice Surface-2 (RWA) vault. Extends the ERC-4626 base and reuses its async-redeem
///         machinery with a 30-day settlement window. On deposit it mints a `vRWA`
///         token 1:1 with shares; redemption burns the vRWA up front (a claim
///         ticket) and is settled by the issuer only after the window AND a KYC check
///         on the redeeming holder (SPVBeneficiaryRegistry).
///
/// @dev    KYC boundary (target model — see docs/developers/rwa-compliance-three-role-model.md):
///         for Reg D assets the `vRWA` token is WHITELISTED, so trading/holding is gated at every
///         transfer and redemption re-checks KYC here; Reg A+ assets trade openly. Under the
///         three-role restructure this contract is repurposed as the issuer wrapping +
///         holder-redemption vault (the public USDC LP path moves to a new MintwareULV4626).
contract MintwareRWAVault4626 is MintwareBaseVault4626 {
    using SafeERC20     for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary  for IPoolManager;

    MintwareVRWA           public immutable vrwa;
    SPVBeneficiaryRegistry public immutable registry;
    address public issuer;

    // Secondary-market seed state — set transiently across the listAndSeedPool unlock.
    bool    private _seeding;
    uint256 private _seedAmt0;
    uint256 private _seedAmt1;

    uint256  public constant REDEMPTION_WINDOW = 30 days;
    KYCLevel public constant MIN_KYC = KYCLevel.BASIC;

    // Capital deployment (spec): reserveRatioBps held as USDC reserve, the rest routed to
    // the yield adapter. Default 40% reserve / 60% yield.
    address public yieldAdapter;
    uint256 public reserveRatioBps = 4_000;
    uint256 public principalInYield;
    uint256 public constant YIELD_DEPOSITOR_BPS = 7_000; // idle-yield split 70/30
    uint256 public constant YIELD_MINTWARE_BPS  = 3_000;

    event IssuerSet(address indexed issuer);
    event SettlementConfirmed(address indexed holder, uint256 assetsOut);
    event YieldAdapterSet(address indexed adapter);
    event ReserveRatioSet(uint256 bps);
    event YieldHarvested(uint256 yield, uint256 toDepositors, uint256 toMintware);
    event PoolListed(bytes32 indexed poolId, uint160 sqrtPriceX96, uint128 liquidity);

    error OnlyIssuer();
    error UseConfirmSettlement();
    error InsufficientVRWA();
    error RatioTooHigh();
    error NoYieldAdapter();
    error InvalidPoolPair();

    constructor(
        VaultConfig memory cfg,
        address _poolManager,
        address _feeVault,
        address _vrwa,
        address _registry,
        address _issuer
    ) MintwareBaseVault4626(cfg, _poolManager, _feeVault) {
        vrwa     = MintwareVRWA(_vrwa);
        registry = SPVBeneficiaryRegistry(_registry);
        issuer   = _issuer;
    }

    function setIssuer(address _issuer) external onlyOwner {
        issuer = _issuer;
        emit IssuerSet(_issuer);
    }

    function setYieldAdapter(address adapter) external onlyOwner {
        yieldAdapter = adapter;
        emit YieldAdapterSet(adapter);
    }

    function setReserveRatio(uint256 bps) external onlyOwner {
        if (bps > BPS) revert RatioTooHigh();
        reserveRatioBps = bps;
        emit ReserveRatioSet(bps);
    }

    /// @notice Harvest yield-adapter return (balance above routed principal), split
    ///         70% depositors (→ FeeVault epoch "rwa_yield") / 30% Mintware (→ treasury).
    function harvestYield() external nonReentrant returns (uint256 yield) {
        if (yieldAdapter == address(0)) revert NoYieldAdapter();
        uint256 bal = IYieldAdapter(yieldAdapter).totalAssets();
        yield = bal > principalInYield ? bal - principalInYield : 0;
        if (yield == 0) return 0;

        IYieldAdapter(yieldAdapter).withdraw(yield);
        uint256 toDepositors = (yield * YIELD_DEPOSITOR_BPS) / BPS;
        uint256 toMintware   = yield - toDepositors;

        IERC20(asset()).safeTransfer(treasury, toMintware);
        if (toDepositors > 0) {
            IERC20(asset()).safeTransfer(feeVault, toDepositors);
            IFeeVaultNotifier(feeVault).notifyFeeReceipt(toDepositors, "rwa_yield");
        }
        emit YieldHarvested(yield, toDepositors, toMintware);
    }

    // ── list: seed the oracle-banded vRWA/USDC secondary market ──────────────
    //
    // The RWA vault is a reserve model — depositor USDC stays as reserve/yield and is
    // NOT auto-LP'd. Tradeability comes from a one-time issuer-seeded secondary pool:
    // the vault mints vRWA market inventory to itself, the issuer supplies USDC, and
    // both are placed as two-sided liquidity in a V4 pool whose `hooks` is a
    // MintwareOracleHook (bands + band fee). From then on, holders trade vRWA↔USDC
    // against this pool (e.g. via MWRouter). Depositor reserve is never touched.

    /// @notice List the vRWA on an oracle-banded V4 pool and seed two-sided liquidity.
    /// @param key           vRWA/USDC PoolKey. `hooks` MUST be a MintwareOracleHook whose
    ///                      `vault` is set to this vault; `fee` MUST be the V4 dynamic-fee
    ///                      flag (the hook sets the band fee per swap).
    /// @param sqrtPriceX96  initial price (should equal the oracle appraisal).
    /// @param usdcSeed      USDC pulled from the caller (issuer) as pool inventory.
    /// @param vrwaSeed      vRWA minted to the vault as pool inventory.
    function listAndSeedPool(
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24   seedTickLower,
        int24   seedTickUpper,
        uint256 usdcSeed,
        uint256 vrwaSeed
    ) external onlyOwner nonReentrant {
        if (poolInitialized) revert PoolAlreadyInitialized();

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool validPair =
            (c0 == address(vrwa) && c1 == asset()) ||
            (c1 == address(vrwa) && c0 == asset());
        if (!validPair) revert InvalidPoolPair();

        // Bring the seed into the vault: pull USDC from the issuer, mint vRWA inventory.
        if (usdcSeed > 0) IERC20(asset()).safeTransferFrom(_msgSender(), address(this), usdcSeed);
        if (vrwaSeed > 0) vrwa.mint(address(this), vrwaSeed);

        tickLower = seedTickLower;
        tickUpper = seedTickUpper;
        _initializePool(key, sqrtPriceX96);

        bool usdcIsToken0 = c0 == asset();
        _seedAmt0 = usdcIsToken0 ? usdcSeed : vrwaSeed;
        _seedAmt1 = usdcIsToken0 ? vrwaSeed : usdcSeed;
        _seeding  = true;
        bytes memory res = poolManager.unlock(abi.encode(Action.Deploy, abi.encode(uint256(0))));
        _seeding  = false;
        _seedAmt0 = 0;
        _seedAmt1 = 0;

        uint128 liq = res.length >= 32 ? abi.decode(res, (uint128)) : 0;
        emit PoolListed(PoolId.unwrap(key.toId()), sqrtPriceX96, liq);
    }

    /// @dev RWA redemption uses the 30-day settlement window.
    function _noticePeriod() internal pure override returns (uint256) {
        return REDEMPTION_WINDOW;
    }

    /// @dev Mint the vRWA bearer instrument 1:1 with shares on deposit, and route the
    ///      non-reserve portion (default 60%) of the net USDC to the yield adapter.
    function _afterEnter(address receiver, uint256 netAssets, uint256 shares) internal override {
        vrwa.mint(receiver, shares);

        if (yieldAdapter != address(0) && reserveRatioBps < BPS) {
            uint256 toYield = netAssets - (netAssets * reserveRatioBps) / BPS;
            if (toYield > 0) {
                IERC20(asset()).forceApprove(yieldAdapter, toYield);
                IYieldAdapter(yieldAdapter).deposit(toYield);
                principalInYield += toYield;
            }
        }
    }

    /// @notice Queue a redemption — burns the caller's vRWA claim ticket up front, then
    ///         starts the 30-day window on the shares.
    function requestRedeem(uint256 shares) public override {
        if (vrwa.balanceOf(msg.sender) < shares) revert InsufficientVRWA();
        vrwa.burn(msg.sender, shares);
        super.requestRedeem(shares);
    }

    /// @dev Holder self-service redemption is disabled — the issuer settles (KYC-gated).
    function executeRedeem() external pure override returns (uint256) {
        revert UseConfirmSettlement();
    }

    /// @notice Issuer settles a holder's queued redemption after the window + a KYC check.
    /// @dev    Recalls from the yield adapter if the USDC reserve can't cover the payout.
    function confirmSettlement(address holder) external nonReentrant returns (uint256 assetsOut) {
        if (msg.sender != issuer) revert OnlyIssuer();
        registry.requireBeneficiary(holder, MIN_KYC); // KYC only at the redemption boundary

        uint256 needed = convertToAssets(withdrawalRequests[holder].shares);
        uint256 bal    = IERC20(asset()).balanceOf(address(this));
        if (bal < needed && yieldAdapter != address(0) && principalInYield > 0) {
            uint256 shortfall = needed - bal;
            uint256 pull = shortfall > principalInYield ? principalInYield : shortfall;
            IYieldAdapter(yieldAdapter).withdraw(pull);
            principalInYield -= pull;
        }

        assetsOut = _executeRedeemFor(holder);
        emit SettlementConfirmed(holder, assetsOut);
    }

    // ── liquidity hooks ──────────────────────────────────────────────────────
    //
    // Reserve model: on a normal deposit the base calls _deployLiquidity, but the RWA
    // vault holds USDC as reserve/yield rather than LP'ing it, so _deployLiquidity is a
    // no-op EXCEPT during listAndSeedPool (_seeding), where it places the issuer's
    // two-sided seed. Redemptions settle from reserve, so _removeLiquidity /
    // _rebalanceLiquidity are no-ops — a user redemption must never unwind the issuer's
    // market inventory.

    /// @dev During listAndSeedPool: add the two-sided seed as concentrated liquidity.
    ///      On ordinary deposits (_seeding == false): no-op (reserve model).
    function _deployLiquidity(uint256) internal override returns (bytes memory) {
        if (!_seeding) return "";

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);
        (uint160 sqrtCurrent,,,) = poolManager.getSlot0(poolKey.toId());

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtCurrent, sqrtLower, sqrtUpper, _seedAmt0, _seedAmt1
        );
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

    function _removeLiquidity(uint128) internal pure override returns (bytes memory) { return ""; }
    function _rebalanceLiquidity(int24, int24) internal pure override returns (bytes memory) { return ""; }
}
