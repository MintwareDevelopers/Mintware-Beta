// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MintwareBaseVault4626, IFeeVaultNotifier} from "../vaults/MintwareBaseVault4626.sol";
import {VaultConfig}           from "../vaults/VaultTypes.sol";
import {IYieldAdapter}         from "../vaults/IYieldAdapter.sol";
import {MintwareVRWA}          from "./MintwareVRWA.sol";
import {SPVBeneficiaryRegistry, KYCLevel} from "./SPVBeneficiaryRegistry.sol";

/// @title  MintwareRWAVault4626
/// @notice Surface-2 (RWA) vault. Extends the ERC-4626 base and reuses its async-redeem
///         machinery with a 30-day settlement window. On deposit it mints a `vRWA` bearer
///         token 1:1 with shares; redemption burns the vRWA up front (a permissionless
///         claim ticket) and is settled by the issuer only after the window AND a KYC check
///         on the redeeming holder (SPVBeneficiaryRegistry).
///
/// @dev    KYC is enforced ONLY at settlement — deposits, vRWA trading, and fee accrual are
///         permissionless. This v1 is reserve-only (USDC held in the vault, no V4 pool); the
///         vRWA/USDC pool + oracle-band OracleHook + 40/60 reserve deployment land next.
contract MintwareRWAVault4626 is MintwareBaseVault4626 {
    using SafeERC20 for IERC20;

    MintwareVRWA           public immutable vrwa;
    SPVBeneficiaryRegistry public immutable registry;
    address public issuer;

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

    error OnlyIssuer();
    error UseConfirmSettlement();
    error InsufficientVRWA();
    error RatioTooHigh();
    error NoYieldAdapter();

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

    // ── liquidity hooks — reserve-only v1 (USDC held in vault; no V4 pool yet) ──
    function _deployLiquidity(uint256) internal pure override returns (bytes memory) { return ""; }
    function _removeLiquidity(uint128) internal pure override returns (bytes memory) { return ""; }
    function _rebalanceLiquidity(int24, int24) internal pure override returns (bytes memory) { return ""; }
}
