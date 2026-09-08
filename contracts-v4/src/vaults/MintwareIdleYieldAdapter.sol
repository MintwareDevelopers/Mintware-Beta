// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step}    from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IYieldAdapter} from "./IYieldAdapter.sol";

/// @title  MintwareIdleYieldAdapter
/// @notice A ZERO-YIELD `IYieldAdapter`: it just custodies the underlying, fully liquid, and never deploys it
///         anywhere. Exists for the case where NO real yield source is available yet -- on Robinhood Chain
///         mainnet today every USDG ERC-4626 vault (Morpho Vault V2 -- the only yield rail that exists on that
///         chain at all) reports `maxDeposit == 0` for the LP Gateway seat; see
///         docs/developers/audits/closeout/mainnet-yield-sources.md. Swapping this in behind
///         `MintwareLpGatewayStaging` lets the gateway accept deposits and hold them safely with no external-
///         protocol dependency, at the cost of the "earns immediately" promise -- depositors are held ready,
///         not earning, until the owner points staging at a real adapter once one exists.
/// @dev    This is deliberately the simplest possible `IYieldAdapter`: no external call in the hot path at
///         all (`deposit`/`withdraw` are plain ERC-20 transfers), so there is no yield-source solvency risk,
///         no share-price manipulation surface, no revert-on-preview class (C-10) -- the whole reason those
///         findings existed elsewhere in this codebase is an external protocol call, and this contract makes
///         none. Same safety discipline as `MintwareERC4626YieldAdapter`/`AaveV3YieldAdapter` everywhere it
///         still applies:
///           • `onlyVault` supply/withdraw; `setVault` is ONE-TIME (a re-settable sink could be drained).
///           • `withdraw` never reverts, per the `IYieldAdapter` contract -- normally that means full delivery
///             up to the balance (nothing is ever deployed elsewhere), but the quote asset can be USDG, whose
///             issuer can freeze an address (M-07): a raw-call transfer (not `SafeERC20`, which cannot be
///             `try/catch`-wrapped) serves 0 on ANY failure instead of reverting, so a freeze degrades to a
///             re-credit (A-1) rather than bricking the whole exit including the unrelated LP leg (round-3 IA-10).
///           • Ownable2Step, renounce disabled (the owner holds the deposit-cap lever below).
///           • **`depositCap`** is the on-chain bound for "accept a small amount of real value while there is
///             no external audit yet" (owner-adjustable). `deposit` reverts once the cap is hit -- the same
///             failure mode a capped real ERC-4626 source already produces here (`ERC4626ExceededMaxDeposit`),
///             so callers up the stack (staging, the position manager's `deploy` re-stage try/catch) need no
///             new handling for it. Starts at whatever the deployer passes; **0 leaves it closed** until the
///             owner opens it explicitly -- a forgotten cap fails closed, never open. Round-3 tooling sweep
///             (Slither's hand-triage AND an independent Aderyn pass both caught this): the cap is checked
///             against `suppliedPrincipal` -- cumulative vault-initiated deposits minus withdrawals -- NOT the
///             live `balanceOf`, so an outsider can no longer grief deposits closed by donating up to the cap.
///             A donation still counts fully toward `totalAssets()`/NAV; it just no longer touches the cap in
///             either direction.
contract MintwareIdleYieldAdapter is IYieldAdapter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset; // the underlying this adapter holds (e.g. USDG)

    /// @notice The only address allowed to supply/withdraw. Owner-settable ONCE (deploy chicken-and-egg).
    address public vault;

    /// @notice Hard ceiling on cumulative principal the VAULT may ever supply (see `suppliedPrincipal` --
    ///         donations are NOT gated by this and do not count against it). Owner-adjustable; explicit
    ///         `type(uint256).max` removes the bound -- there is no implicit "unlimited" default.
    uint256 public depositCap;

    /// @notice Cumulative principal actually supplied by the vault (deposits minus withdrawals), tracked
    ///         separately from `asset.balanceOf(this)` so a plain donation can never move the deposit-cap gate
    ///         in EITHER direction: it can't bypass the cap (donations were never able to), and it can no
    ///         longer be used to GRIEF the cap closed either -- gating on raw balance let anyone freeze
    ///         deposits by donating up to `depositCap`. Donations still count fully toward `totalAssets()` /
    ///         `maxWithdrawable()`, i.e. toward depositor NAV; they simply stop mattering to the cap.
    uint256 public suppliedPrincipal;

    event VaultSet(address indexed vault);
    event DepositCapSet(uint256 cap);
    event Supplied(uint256 amount);
    event Withdrawn(uint256 requested, uint256 withdrawn);

    error OnlyVault();
    error ZeroAddress();
    error VaultAlreadySet();
    error RenounceDisabled();
    error DepositCapExceeded();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /// @param asset_       The underlying token (e.g. USDG).
    /// @param vault_       Initial authorized vault (may be zero, set later via `setVault`).
    /// @param owner_       Adapter owner (holds the deposit-cap lever).
    /// @param depositCap_  Starting cap in the underlying's own decimals. 0 = closed until raised.
    constructor(address asset_, address vault_, address owner_, uint256 depositCap_) Ownable(owner_) {
        if (asset_ == address(0)) revert ZeroAddress();
        asset = IERC20(asset_);
        vault = vault_; // zero allowed
        depositCap = depositCap_;
        emit DepositCapSet(depositCap_);
    }

    // ── admin ──────────────────────────────────────────────────────────────────

    /// @notice Disabled -- renouncing would freeze `depositCap` at whatever it is. Ownership moves via the
    ///         two-step `transferOwnership` → `acceptOwnership` handoff instead.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        if (vault != address(0)) revert VaultAlreadySet(); // one-time -- the withdraw sink must be immutable
        vault = vault_;
        emit VaultSet(vault_);
    }

    /// @notice Raise or lower the bound on total assets this adapter will hold. Takes effect immediately --
    ///         lowering it below the current balance simply blocks further deposits, it never forces a
    ///         withdrawal (existing depositors are never touched by a cap change).
    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    // ── IYieldAdapter ────────────────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Reverts `DepositCapExceeded` once `suppliedPrincipal + amount` would exceed `depositCap` -- checked
    ///      against TRACKED principal, not the live balance, so a plain donation to this contract can neither
    ///      bypass the cap (it never could) nor grief it closed for everyone else (it now cannot).
    function deposit(uint256 amount) external override onlyVault nonReentrant {
        if (amount == 0) return;
        if (suppliedPrincipal + amount > depositCap) revert DepositCapExceeded();
        asset.safeTransferFrom(vault, address(this), amount);
        suppliedPrincipal += amount;
        emit Supplied(amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Never reverts for ANY reason (per the interface contract), matching `MintwareERC4626YieldAdapter`
    ///      exactly. Round-3 adversarial pass (IA-10): the quote asset here is USDG, whose issuer can freeze an
    ///      address (M-07) -- a bare `safeTransfer` would then revert this call, and since neither
    ///      `MintwareLpGatewayStaging.unstage` nor the position manager's idle leg wrap that call in try/catch,
    ///      an availability failure here used to brick the WHOLE exit including the unrelated, unfrozen LP leg
    ///      (defeating the A-1 / M-01 "withdrawals never brick" design the rest of the stack was built around).
    ///      `SafeERC20.safeTransfer` cannot itself be wrapped in `try/catch` -- it is an internal library call
    ///      inlined here, with no external-call boundary -- so this uses a raw low-level call instead, tolerant
    ///      of both bool-returning and void-returning ERC-20s, and serves 0 on ANY failure so the PM re-credits
    ///      shares (A-1) instead of reverting. `suppliedPrincipal` is only reduced on an ACTUAL delivery, floored
    ///      at 0 -- a delivered withdrawal can legitimately exceed tracked principal (e.g. one holder draws down
    ///      NAV a donation inflated for everyone), which must never underflow the tracker.
    function withdraw(uint256 amount) external override onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 bal = asset.balanceOf(address(this));
        withdrawn = amount < bal ? amount : bal;
        if (withdrawn == 0) return 0;
        (bool ok, bytes memory ret) = address(asset).call(abi.encodeCall(IERC20.transfer, (vault, withdrawn)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) return 0; // frozen/paused/non-compliant token
        suppliedPrincipal = withdrawn >= suppliedPrincipal ? 0 : suppliedPrincipal - withdrawn;
        emit Withdrawn(amount, withdrawn);
    }

    /// @inheritdoc IYieldAdapter
    function totalAssets() external view override returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Always the full balance -- there is no source liquidity constraint to clamp against.
    function maxWithdrawable() external view override returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Remaining room under `depositCap` against TRACKED principal (see `suppliedPrincipal`), so a caller
    ///      can check headroom the same way it would against a real ERC-4626 source's `maxDeposit` -- and a
    ///      donation-inflated balance never makes this read 0 when the cap actually has room.
    function maxSuppliable() external view override returns (uint256) {
        return suppliedPrincipal >= depositCap ? 0 : depositCap - suppliedPrincipal;
    }
}
