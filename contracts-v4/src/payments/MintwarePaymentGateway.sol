// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IYieldVault} from "./IYieldVault.sol";

/// @title  MintwarePaymentGateway
/// @notice YPN settlement gateway. A RELAYER submits `settleSpend` for a card charge the edge engine
///         already authorized; the Gateway re-verifies the user's EIP-712 permit(s), enforces daily
///         caps + liquidity, and burns the user's vault shares for USDC to the card rail.
///
/// @dev    Hybrid permit model: < $250 needs only a long-lived `DelegatedSpendPermit`; >= $250 also
///         needs a short-lived (<= 5 min) `ShortLivedHoldAuth` signed by an EDGE_SIGNER.
///
/// @dev    NONCE SEMANTICS (fix vs the v2.1.1 draft): the permit nonce is **revocation-only**. The
///         draft consumed `usedNonces[user][permit.nonce]` on every settle, which made the *long-lived*
///         permit single-use — the 2nd spend would revert `NonceAlreadyUsed`. Here `settleSpend` only
///         CHECKS the nonce (rejecting revoked permits) and never consumes it. Replay of a specific
///         charge is prevented by `holds[holdId].settled`; over-spend by the daily cap. `revokeNonce`
///         is the sole writer of `usedNonces`.
contract MintwarePaymentGateway is AccessControl, EIP712, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 public constant RELAYER_ROLE     = keccak256("RELAYER_ROLE");
    bytes32 public constant EDGE_SIGNER_ROLE = keccak256("EDGE_SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE      = keccak256("PAUSER_ROLE");

    bytes32 public constant DELEGATED_SPEND_PERMIT_TYPEHASH = keccak256(
        "DelegatedSpendPermit(address user,uint256 maxDailySpendUSDC,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant SHORT_LIVED_HOLD_AUTH_TYPEHASH = keccak256(
        "ShortLivedHoldAuth(bytes32 holdId,address user,uint256 amountUSDC,uint256 nonce,uint256 expiry)"
    );

    uint256 public constant HIGH_VALUE_THRESHOLD     = 250_000_000;    // $250.00 (6dp)
    uint256 public constant DEFAULT_GLOBAL_DAILY_CAP = 1_000_000_000;  // $1,000.00
    uint256 public constant MAX_SHORT_LIVED_WINDOW   = 5 minutes;

    IYieldVault public immutable vault;
    IERC20 public immutable usdc;
    address public circleCpnTreasury;

    mapping(address => mapping(uint256 => uint256)) public dailySpendUSDC; // user => epochDay => spent
    mapping(address => uint256) public userDailyCap;
    mapping(address => mapping(uint256 => bool)) public usedNonces;        // user => nonce => revoked

    struct Hold {
        address user;
        uint256 amountUSDC;
        uint256 settledAt;
        bool settled;
        bool cancelled;
    }
    mapping(bytes32 => Hold) public holds;

    struct DelegatedSpendPermit {
        address user;
        uint256 maxDailySpendUSDC;
        uint256 nonce;
        uint256 deadline;
    }
    struct ShortLivedHoldAuth {
        bytes32 holdId;
        address user;
        uint256 amountUSDC;
        uint256 nonce;
        uint256 expiry;
    }

    event PaymentSettled(bytes32 indexed holdId, address indexed user, address indexed receiver, uint256 assets, uint256 sharesBurned);
    event HoldCancelled(bytes32 indexed holdId, address indexed user);
    event NonceRevoked(address indexed user, uint256 indexed nonce);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event UserDailyCapUpdated(address indexed user, uint256 newCap);

    error InvalidAmount();
    error PermitExpired();
    error InvalidPermitSignature();
    error NonceRevokedError();
    error EdgeSignatureRequired();
    error InvalidEdgeSignature();
    error EdgeAuthExpired();
    error InsufficientIdleLiquidity();
    error ExceedsDailySpendLimit();
    error HoldAlreadySettled();
    error HoldCancelledError();
    error ZeroAddress();

    constructor(address vault_, address usdc_, address treasury_, address admin_)
        EIP712("Mintware Payment Gateway", "2.0")
    {
        if (vault_ == address(0) || usdc_ == address(0) || treasury_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }
        vault = IYieldVault(vault_);
        usdc = IERC20(usdc_);
        circleCpnTreasury = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(RELAYER_ROLE, admin_);
        _grantRole(EDGE_SIGNER_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);
    }

    // ── admin ──────────────────────────────────────────────────────────────
    function setCircleCpnTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(circleCpnTreasury, newTreasury);
        circleCpnTreasury = newTreasury;
    }

    function setUserDailyCap(address user, uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        userDailyCap[user] = newCap;
        emit UserDailyCapUpdated(user, newCap);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /// @notice A user permanently revokes one of their permit nonces (e.g. lost device, rotate permit).
    function revokeNonce(uint256 nonce) external {
        if (usedNonces[msg.sender][nonce]) revert NonceRevokedError();
        usedNonces[msg.sender][nonce] = true;
        emit NonceRevoked(msg.sender, nonce);
    }

    /// @notice Settle a card charge the edge engine authorized. RELAYER-only.
    function settleSpend(
        bytes32 holdId,
        address user,
        uint256 assets,
        address receiver,
        DelegatedSpendPermit calldata permit,
        bytes calldata permitSig,
        ShortLivedHoldAuth calldata edgeAuth,
        bytes calldata edgeSig
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused returns (uint256 sharesBurned) {
        if (assets == 0) revert InvalidAmount();
        if (receiver == address(0)) receiver = circleCpnTreasury;

        // ── long-lived delegated permit ──
        if (block.timestamp > permit.deadline) revert PermitExpired();
        if (permit.user != user) revert InvalidPermitSignature();
        bytes32 permitHash = keccak256(abi.encode(
            DELEGATED_SPEND_PERMIT_TYPEHASH, permit.user, permit.maxDailySpendUSDC, permit.nonce, permit.deadline
        ));
        if (_hashTypedDataV4(permitHash).recover(permitSig) != user) revert InvalidPermitSignature();
        // Nonce is REVOCATION-ONLY — checked, never consumed (see contract NatSpec).
        if (usedNonces[user][permit.nonce]) revert NonceRevokedError();

        // ── high-value edge authorization (>= $250) ──
        if (assets >= HIGH_VALUE_THRESHOLD) {
            if (edgeSig.length == 0) revert EdgeSignatureRequired();
            if (edgeAuth.holdId != holdId || edgeAuth.user != user || edgeAuth.amountUSDC != assets) {
                revert InvalidEdgeSignature();
            }
            if (block.timestamp > edgeAuth.expiry) revert EdgeAuthExpired();
            if (edgeAuth.expiry > block.timestamp + MAX_SHORT_LIVED_WINDOW) revert EdgeAuthExpired();
            bytes32 edgeHash = keccak256(abi.encode(
                SHORT_LIVED_HOLD_AUTH_TYPEHASH, edgeAuth.holdId, edgeAuth.user, edgeAuth.amountUSDC, edgeAuth.nonce, edgeAuth.expiry
            ));
            if (!hasRole(EDGE_SIGNER_ROLE, _hashTypedDataV4(edgeHash).recover(edgeSig))) revert InvalidEdgeSignature();
        }

        // ── liquidity + daily limit + hold idempotency (EFFECTS before the external burn — CEI) ──
        if (vault.idleBuffer() < assets) revert InsufficientIdleLiquidity();

        Hold storage h = holds[holdId];
        if (h.settled) revert HoldAlreadySettled();
        if (h.cancelled) revert HoldCancelledError();

        _checkAndUpdateDailyLimit(user, assets, permit.maxDailySpendUSDC);
        holds[holdId] = Hold({user: user, amountUSDC: assets, settledAt: block.timestamp, settled: true, cancelled: false});

        // ── asset-denominated settlement ──
        sharesBurned = vault.previewWithdraw(assets);                 // rounds UP → redeemed >= assets
        uint256 redeemed = vault.burnForPayment(user, sharesBurned, receiver);
        if (redeemed < assets) revert InsufficientIdleLiquidity();

        emit PaymentSettled(holdId, user, receiver, assets, sharesBurned);
    }

    function cancelHold(bytes32 holdId) external onlyRole(RELAYER_ROLE) {
        Hold storage h = holds[holdId];
        if (h.settled) revert HoldAlreadySettled();
        h.cancelled = true;
        emit HoldCancelled(holdId, h.user);
    }

    function _checkAndUpdateDailyLimit(address user, uint256 amount, uint256 permitMaxDaily) internal {
        uint256 epochDay = block.timestamp / 1 days;
        uint256 protocolCap = userDailyCap[user] > 0 ? userDailyCap[user] : DEFAULT_GLOBAL_DAILY_CAP;
        uint256 effectiveCap = permitMaxDaily < protocolCap ? permitMaxDaily : protocolCap;
        uint256 spent = dailySpendUSDC[user][epochDay];
        if (spent + amount > effectiveCap) revert ExceedsDailySpendLimit();
        dailySpendUSDC[user][epochDay] = spent + amount;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
