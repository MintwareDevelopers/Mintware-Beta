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
/// @notice Surface-2 (RWA) issuer-inventory + holder-redemption vault (three-role model). `vRWA`
///         is the tokenized security ITSELF — issuer-supplied, not a synthetic claim minted to
///         depositors — so the public 4626 deposit path is CLOSED here (public USDC LPing lives in
///         MintwareULV4626). The issuer mints `vRWA` inventory via listAndSeedPool() and capitalizes
///         the USDC redemption reserve via fundReserve(). Redemption is keyed on `vRWA` (not vault
///         shares), so a secondary-market holder can redeem: they burn `vRWA` up front (requestRedeem)
///         and the issuer settles USDC at par from the reserve after the 30-day window AND a KYC check
///         on the holder (SPVBeneficiaryRegistry) — confirmSettlement.
///
/// @dev    KYC boundary (see docs/developers/rwa-compliance-three-role-model.md): for Reg D assets
///         the `vRWA` token is WHITELISTED, so trading/holding is gated at every transfer and
///         redemption re-checks KYC here; Reg A+ assets trade openly.
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

    // vRWA-keyed redemption (three-role model): a holder redeems the `vRWA` they hold — whether
    // acquired on the secondary market or otherwise — NOT a 4626 vault share. Par 1:1 vRWA→USDC
    // (reserve-only, par-stable wrapper; see navKeeper). The issuer settles from the USDC reserve,
    // KYC-gated, after the window. The base 4626 share-redemption path is unused on this surface.
    struct RwaRedemption {
        uint256 amountVrwa;   // vRWA burned up front = USDC owed at par
        uint64  requestedAt;
        uint64  settleAfter;  // requestedAt + REDEMPTION_WINDOW
        bool    settled;
    }
    mapping(address => RwaRedemption) public rwaRedemptions;

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
    event ReserveFunded(address indexed from, uint256 usdc);
    event RedemptionRequested(address indexed holder, uint256 amountVrwa, uint256 settleAfter);

    error OnlyIssuer();
    error UseConfirmSettlement();
    error InsufficientVRWA();
    error RatioTooHigh();
    error NoYieldAdapter();
    error InvalidPoolPair();
    error DepositsDisabled();
    error RedemptionPending();
    error NoRedemption();
    // NoticeNotExpired is inherited from MintwareBaseVault4626.

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

    /// @dev Three-role model: the public 4626 deposit path is CLOSED on the RWA surface — a
    ///      depositor must never receive `vRWA` (it is the issuer-supplied security, not a wrapper
    ///      minted per deposit), and public USDC LPing lives in MintwareULV4626, not here. Reverting
    ///      in this post-mint hook disables deposit() / mint() / depositWithLock() atomically.
    function _afterEnter(address, uint256, uint256) internal pure override {
        revert DepositsDisabled();
    }

    /// @notice Issuer capitalizes the USDC redemption reserve. The non-reserve portion (default
    ///         60%) is routed to the yield adapter; the rest stays as reserve to settle redemptions.
    function fundReserve(uint256 usdc) external nonReentrant {
        if (usdc == 0) return;
        IERC20(asset()).safeTransferFrom(_msgSender(), address(this), usdc);
        if (yieldAdapter != address(0) && reserveRatioBps < BPS) {
            uint256 toYield = usdc - (usdc * reserveRatioBps) / BPS;
            if (toYield > 0) {
                IERC20(asset()).forceApprove(yieldAdapter, toYield);
                IYieldAdapter(yieldAdapter).deposit(toYield);
                principalInYield += toYield;
            }
        }
        emit ReserveFunded(_msgSender(), usdc);
    }

    /// @notice Queue a redemption keyed on `vRWA` (not 4626 shares) — so a secondary-market holder
    ///         who never deposited can still redeem. Burns the caller's `vRWA` up front; the issuer
    ///         settles USDC from reserve after the window (confirmSettlement).
    function requestRedeem(uint256 vrwaAmount) public override {
        if (vrwaAmount == 0 || vrwa.balanceOf(msg.sender) < vrwaAmount) revert InsufficientVRWA();
        RwaRedemption storage existing = rwaRedemptions[msg.sender];
        if (existing.amountVrwa != 0 && !existing.settled) revert RedemptionPending();

        vrwa.burn(msg.sender, vrwaAmount);
        uint64 settleAfter = uint64(block.timestamp + REDEMPTION_WINDOW);
        rwaRedemptions[msg.sender] = RwaRedemption({
            amountVrwa:  vrwaAmount,
            requestedAt: uint64(block.timestamp),
            settleAfter: settleAfter,
            settled:     false
        });
        emit RedemptionRequested(msg.sender, vrwaAmount, settleAfter);
    }

    /// @dev Holder self-service redemption is disabled — the issuer settles (KYC-gated).
    function executeRedeem() external pure override returns (uint256) {
        revert UseConfirmSettlement();
    }

    /// @notice Issuer settles a holder's queued `vRWA` redemption after the window + a KYC check,
    ///         paying USDC at par (1:1) from the reserve. Recalls from the yield adapter on shortfall.
    function confirmSettlement(address holder) external nonReentrant returns (uint256 assetsOut) {
        if (msg.sender != issuer) revert OnlyIssuer();
        registry.requireBeneficiary(holder, MIN_KYC); // KYC enforced at the settlement boundary

        RwaRedemption storage r = rwaRedemptions[holder];
        if (r.amountVrwa == 0 || r.settled)  revert NoRedemption();
        if (block.timestamp < r.settleAfter) revert NoticeNotExpired();

        uint256 needed = r.amountVrwa; // par 1:1 vRWA → USDC (both 6dp; par-stable wrapper)
        uint256 bal    = IERC20(asset()).balanceOf(address(this));
        if (bal < needed && yieldAdapter != address(0) && principalInYield > 0) {
            uint256 shortfall = needed - bal;
            uint256 pull = shortfall > principalInYield ? principalInYield : shortfall;
            IYieldAdapter(yieldAdapter).withdraw(pull);
            principalInYield -= pull;
        }

        r.settled = true;
        assetsOut = needed;
        IERC20(asset()).safeTransfer(holder, needed);
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
