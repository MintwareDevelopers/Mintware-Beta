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
import {MWTimelockedRiskParams} from "../lib/MWTimelockedRiskParams.sol";

/// @title  MintwarePaymentGateway
/// @notice Legacy refill gateway. T7a removes merchant settlement; T7b replaces this refill flow.
contract MintwarePaymentGateway is AccessControl, EIP712, ReentrancyGuard, Pausable, MWTimelockedRiskParams {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 public constant RELAYER_ROLE     = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE      = keccak256("PAUSER_ROLE");

    bytes32 public constant DELEGATED_SPEND_PERMIT_TYPEHASH = keccak256(
        "DelegatedSpendPermit(address user,uint256 maxDailySpendUSDC,uint256 nonce,uint256 deadline)"
    );
    uint256 public constant DEFAULT_GLOBAL_REFILL_CAP = 1_000_000_000;      // $1,000.00/day buffer-refill default
    uint256 public constant MAX_REFILL_CAP            = 1_000_000_000_000;  // $1,000,000 — fat-finger bound on a governed cap
    uint256 public constant MAX_SHORT_LIVED_WINDOW    = 5 minutes;

    IYieldVault public immutable vault;
    IERC20 public immutable usdc;
    address public circleCpnTreasury;

    mapping(address => mapping(uint256 => bool)) public usedNonces;        // user => nonce => revoked

    // ── card spend buffer (docs/developers/card-spend-buffer-spec.md, Option A) ──
    mapping(address => address) public bufferOf;                            // user => their self-registered buffer wallet
    mapping(address => mapping(uint256 => uint256)) public dailyRefillUSDC; // user => epochDay => refilled (separate ledger)
    mapping(address => uint256) public userDailyRefillCap;                  // 0 => DEFAULT_GLOBAL_REFILL_CAP
    mapping(bytes32 => bool) public refillDone;                             // refillId => done (idempotency)
    mapping(bytes32 => address) public refillCapParamUser;                  // timelock param tag => the user it caps
    mapping(address => bool) public userRefillPaused;                       // user's own on-chain refill kill-switch

    struct DelegatedSpendPermit {
        address user;
        uint256 maxDailySpendUSDC;
        uint256 nonce;
        uint256 deadline;
    }
    event NonceRevoked(address indexed user, uint256 indexed nonce);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event BufferAddressUpdated(address indexed user, address indexed oldBuffer, address indexed newBuffer);
    event BufferRefilled(bytes32 indexed refillId, address indexed user, address indexed buffer, uint256 assets, uint256 sharesBurned);
    event UserDailyRefillCapUpdated(address indexed user, uint256 newCap);
    event RefillPauseSet(address indexed user, bool paused);

    error InvalidAmount();
    error PermitExpired();
    error InvalidPermitSignature();
    error NonceRevokedError();
    error InsufficientIdleLiquidity();
    error ZeroAddress();
    error BufferNotSet();
    error RefillAlreadyDone();
    error ExceedsDailyRefillLimit();
    error RefillCapTooHigh();
    error RefillPausedError();

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
        _grantRole(PAUSER_ROLE, admin_);
    }

    // ── admin ──────────────────────────────────────────────────────────────
    function setCircleCpnTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(circleCpnTreasury, newTreasury);
        circleCpnTreasury = newTreasury;
    }

    /// @notice Propose (or instantly apply) a per-user daily buffer-refill cap, through the 48h risk-param
    ///         timelock. TIGHTENING — a lower *effective* cap — applies instantly (safety never waits);
    ///         LOOSENING — a higher effective cap — is delayed 48h and cancellable, so a compromised owner
    ///         can't instantly widen how fast a user's vault position drains into their buffer. `newCap == 0`
    ///         resets to the global default (`DEFAULT_GLOBAL_REFILL_CAP`); direction compares EFFECTIVE caps
    ///         so that reset is judged against the default, not against a raw zero.
    function setUserDailyRefillCap(address user, uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 param = _refillCapParam(user);
        refillCapParamUser[param] = user;
        _changeRiskParam(param, newCap, 0);
    }

    /// @notice Confirm a timelocked (loosening) refill-cap change once its 48h has elapsed.
    function confirmUserDailyRefillCap(address user) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _confirmRiskParam(_refillCapParam(user));
    }

    /// @notice Cancel a pending refill-cap change before it can be confirmed.
    function cancelUserDailyRefillCap(address user) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _cancelRiskParam(_refillCapParam(user));
    }

    // ── MWTimelockedRiskParams hooks (governs userDailyRefillCap only) ──
    function _refillCapParam(address user) internal pure returns (bytes32) {
        return keccak256(abi.encode("MW_REFILL_CAP", user));
    }

    function _effectiveRefillCap(address user) internal view returns (uint256) {
        return userDailyRefillCap[user] > 0 ? userDailyRefillCap[user] : DEFAULT_GLOBAL_REFILL_CAP;
    }

    function _validateRiskParam(bytes32, uint256 v, uint256 v2) internal pure override {
        if (v > MAX_REFILL_CAP || v2 != 0) revert RefillCapTooHigh();
    }

    function _writeRiskParam(bytes32 param, uint256 v, uint256) internal override {
        address user = refillCapParamUser[param];
        userDailyRefillCap[user] = v;
        emit UserDailyRefillCapUpdated(user, v);
    }

    function _readRiskParam(bytes32 param) internal view override returns (uint256) {
        return userDailyRefillCap[refillCapParamUser[param]];
    }

    function _riskParamInstant(bytes32 param, uint256 v, uint256) internal view override returns (bool) {
        uint256 curEff = _effectiveRefillCap(refillCapParamUser[param]);
        uint256 newEff = v > 0 ? v : DEFAULT_GLOBAL_REFILL_CAP;
        return newEff <= curEff; // tightening (smaller/equal effective cap) is instant; loosening waits 48h
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /// @notice A user permanently revokes one of their permit nonces (e.g. lost device, rotate permit).
    function revokeNonce(uint256 nonce) external {
        if (usedNonces[msg.sender][nonce]) revert NonceRevokedError();
        usedNonces[msg.sender][nonce] = true;
        emit NonceRevoked(msg.sender, nonce);
    }

    /// @notice A user registers (or rotates) their OWN card spend-buffer wallet — the address a
    ///         `refillBuffer` redemption pays into. `msg.sender`-pinned so a relayer can never choose
    ///         where a refill lands: the buffer-refill analogue of the AUDIT C1 `receiver` pin.
    function setBufferAddress(address buffer) external {
        if (buffer == address(0)) revert ZeroAddress();
        emit BufferAddressUpdated(msg.sender, bufferOf[msg.sender], buffer);
        bufferOf[msg.sender] = buffer;
        vault.registerDestination(msg.sender, buffer);
    }

    /// @notice A user pauses/unpauses THEIR OWN buffer refills on-chain (audit fix L4). msg.sender-pinned,
    ///         so — unlike revokeNonce, which would also stop spending — a user can granularly halt a
    ///         (possibly compromised) relayer from refilling their buffer without touching their card spend.
    function setRefillPaused(bool paused) external {
        userRefillPaused[msg.sender] = paused;
        emit RefillPauseSet(msg.sender, paused);
    }

    // ── card spend buffer refill (Option A — per-user, funded from the user's own senior shares) ──

    /// @notice Redeem a slice of the user's OWN senior position into USDC and push it to the user's
    ///         registered spend buffer. RELAYER-only. Spec: docs/developers/card-spend-buffer-spec.md.
    ///
    /// @dev    This REPOSITIONS the user's own capital (vault → their own buffer wallet) — it is not a
    ///         merchant payout. The theft vector `settleSpend`'s edge signature guards against is closed
    ///         here structurally: `receiver` is pinned to `bufferOf[user]`, which only the user can set
    ///         (`setBufferAddress`), so a compromised relayer cannot redirect the USDC. No edge auth is
    ///         therefore required. Refills carry their OWN daily-cap ledger (`dailyRefillUSDC`), separate
    ///         from the spend ledger and each bounded by the user's signed permit cap and an admin
    ///         protocol cap — so the worst a rogue relayer can do is move a bounded amount per day into
    ///         the user's own wallet, and the runaway-refill rate is capped. The permit proves the user
    ///         consented to programmatic burns of their shares. Idempotent per `refillId`. CEI order.
    ///
    /// @dev    TWO-LEDGER PERMIT MODEL (audit M2 — accepted by design). One long-lived `DelegatedSpendPermit`
    ///         authorizes BOTH `settleSpend` (merchant payout) and `refillBuffer`, each metered by its OWN
    ///         daily ledger (`dailySpendUSDC` vs `dailyRefillUSDC`). This is intentional: a refill is not a
    ///         second spend — it repositions the user's OWN shares into the user's OWN pinned buffer, from
    ///         which spending is still bounded by the spend ledger. So the refill leg has NO theft vector
    ///         (the `≥$250` edge second-signer gate exists to protect *merchant* payouts and is deliberately
    ///         not required here) and is bounded instead by its own timelock-governed cap, the off-chain
    ///         refill-rate breaker, and the user's on-chain `setRefillPaused` kill-switch (audit L4).
    function refillBuffer(
        bytes32 refillId,
        address user,
        uint256 assets,
        DelegatedSpendPermit calldata permit,
        bytes calldata permitSig
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused returns (uint256 sharesBurned) {
        if (assets == 0) revert InvalidAmount();

        // The user's own on-chain refill kill-switch (audit L4) — checked first.
        if (userRefillPaused[user]) revert RefillPausedError();

        // Destination is PINNED to the user's own registered buffer — never relayer-chosen (mirrors C1).
        address receiver = bufferOf[user];
        if (receiver == address(0)) revert BufferNotSet();

        // ── long-lived delegated permit (the user's consent to burn their shares) ──
        if (block.timestamp > permit.deadline) revert PermitExpired();
        if (permit.user != user) revert InvalidPermitSignature();
        bytes32 permitHash = keccak256(abi.encode(
            DELEGATED_SPEND_PERMIT_TYPEHASH, permit.user, permit.maxDailySpendUSDC, permit.nonce, permit.deadline
        ));
        if (_hashTypedDataV4(permitHash).recover(permitSig) != user) revert InvalidPermitSignature();
        if (usedNonces[user][permit.nonce]) revert NonceRevokedError();

        // ── liquidity + refill daily cap + idempotency (EFFECTS before the external burn — CEI) ──
        if (vault.idleBuffer() < assets) revert InsufficientIdleLiquidity();
        if (refillDone[refillId]) revert RefillAlreadyDone();

        _checkAndUpdateRefillLimit(user, assets, permit.maxDailySpendUSDC);
        refillDone[refillId] = true;

        // ── asset-denominated redemption into the user's buffer ──
        sharesBurned = vault.previewWithdraw(assets);                 // rounds UP → redeemed >= assets
        uint256 redeemed = vault.gatewayRedeem(user, sharesBurned);
        if (redeemed < assets) revert InsufficientIdleLiquidity();

        emit BufferRefilled(refillId, user, receiver, assets, sharesBurned);
    }

    function _checkAndUpdateRefillLimit(address user, uint256 amount, uint256 permitMaxDaily) internal {
        uint256 epochDay = block.timestamp / 1 days;
        uint256 protocolCap = userDailyRefillCap[user] > 0 ? userDailyRefillCap[user] : DEFAULT_GLOBAL_REFILL_CAP;
        uint256 effectiveCap = permitMaxDaily < protocolCap ? permitMaxDaily : protocolCap;
        uint256 spent = dailyRefillUSDC[user][epochDay];
        if (spent + amount > effectiveCap) revert ExceedsDailyRefillLimit();
        dailyRefillUSDC[user][epochDay] = spent + amount;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
