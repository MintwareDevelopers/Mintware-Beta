// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareBaseVault4626} from "../vaults/MintwareBaseVault4626.sol";
import {VaultConfig}           from "../vaults/VaultTypes.sol";
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
    MintwareVRWA           public immutable vrwa;
    SPVBeneficiaryRegistry public immutable registry;
    address public issuer;

    uint256  public constant REDEMPTION_WINDOW = 30 days;
    KYCLevel public constant MIN_KYC = KYCLevel.BASIC;

    event IssuerSet(address indexed issuer);
    event SettlementConfirmed(address indexed holder, uint256 assetsOut);

    error OnlyIssuer();
    error UseConfirmSettlement();
    error InsufficientVRWA();

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

    /// @dev RWA redemption uses the 30-day settlement window.
    function _noticePeriod() internal pure override returns (uint256) {
        return REDEMPTION_WINDOW;
    }

    /// @dev Mint the vRWA bearer instrument 1:1 with shares on deposit.
    function _afterEnter(address receiver, uint256, uint256 shares) internal override {
        vrwa.mint(receiver, shares);
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
    function confirmSettlement(address holder) external nonReentrant returns (uint256 assetsOut) {
        if (msg.sender != issuer) revert OnlyIssuer();
        registry.requireBeneficiary(holder, MIN_KYC); // KYC only at the redemption boundary
        assetsOut = _executeRedeemFor(holder);
        emit SettlementConfirmed(holder, assetsOut);
    }

    // ── liquidity hooks — reserve-only v1 (USDC held in vault; no V4 pool yet) ──
    function _deployLiquidity(uint256) internal pure override returns (bytes memory) { return ""; }
    function _removeLiquidity(uint128) internal pure override returns (bytes memory) { return ""; }
    function _rebalanceLiquidity(int24, int24) internal pure override returns (bytes memory) { return ""; }
}
