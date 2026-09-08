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
///           • `withdraw` is best-effort per the `IYieldAdapter` contract, but since funds are NEVER deployed
///             anywhere else, "best-effort" always equals "full" here -- the only clamp is our own balance.
///           • Ownable2Step, renounce disabled (the owner holds the deposit-cap lever below).
///           • **`depositCap`** is the on-chain bound for "accept a small amount of real value while there is
///             no external audit yet" (owner-adjustable). `deposit` measured against the CURRENT balance
///             reverts once the cap is hit -- the same failure mode a capped real ERC-4626 source already
///             produces here (`ERC4626ExceededMaxDeposit`), so callers up the stack (staging, the position
///             manager's `deploy` re-stage try/catch) need no new handling for it. Starts at whatever the
///             deployer passes; **0 leaves it closed** until the owner opens it explicitly -- a forgotten cap
///             fails closed, never open.
contract MintwareIdleYieldAdapter is IYieldAdapter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset; // the underlying this adapter holds (e.g. USDG)

    /// @notice The only address allowed to supply/withdraw. Owner-settable ONCE (deploy chicken-and-egg).
    address public vault;

    /// @notice Hard ceiling on total assets this adapter will ever hold. Owner-adjustable; explicit
    ///         `type(uint256).max` removes the bound -- there is no implicit "unlimited" default.
    uint256 public depositCap;

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
    /// @dev Reverts `DepositCapExceeded` once `balance + amount` would exceed `depositCap` -- checked against
    ///      the CURRENT on-chain balance (not a separately tracked total), so a plain donation to this
    ///      contract only ever helps existing holders' NAV, never bypasses the cap on a real deposit.
    function deposit(uint256 amount) external override onlyVault nonReentrant {
        if (amount == 0) return;
        uint256 bal = asset.balanceOf(address(this));
        if (bal + amount > depositCap) revert DepositCapExceeded();
        asset.safeTransferFrom(vault, address(this), amount);
        emit Supplied(amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Never reverts for a liquidity reason (per the interface contract) -- trivially true here since
    ///      nothing is ever deployed elsewhere; the only clamp is our own balance.
    function withdraw(uint256 amount) external override onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 bal = asset.balanceOf(address(this));
        withdrawn = amount < bal ? amount : bal;
        if (withdrawn == 0) return 0;
        asset.safeTransfer(vault, withdrawn);
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
    /// @dev Remaining room under `depositCap`, so a caller can check headroom the same way it would against a
    ///      real ERC-4626 source's `maxDeposit`.
    function maxSuppliable() external view override returns (uint256) {
        uint256 bal = asset.balanceOf(address(this));
        return bal >= depositCap ? 0 : depositCap - bal;
    }
}
