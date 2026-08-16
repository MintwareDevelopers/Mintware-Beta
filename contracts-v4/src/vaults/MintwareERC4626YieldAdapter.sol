// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626}        from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IYieldAdapter} from "./IYieldAdapter.sol";

/// @title  MintwareERC4626YieldAdapter
/// @notice A single-asset `IYieldAdapter` over ANY ERC-4626 yield source — the pluggable seam the YPN USDC
///         vault idles into when Aave isn't the right primitive. **This is the adapter YPN uses on Arc:**
///         Arc's native USDC-yield primitive (or a Circle reserve/T-bill product) is wired in as the
///         `yieldSource` 4626, and everything else — the vault, the Gateway, the edge — is unchanged. On
///         Base the vault uses `AaveV3YieldAdapter`; on Arc it uses this. Same `IYieldAdapter` contract.
///
/// @dev    Mirrors `AaveV3YieldAdapter`'s safety discipline exactly:
///           • `onlyVault` supply/withdraw; `setVault` is ONE-TIME (a re-settable sink could be drained).
///           • **Withdraw is BEST-EFFORT and can never revert** — it is called on the settlement hot path;
///             clamps to headroom + a per-block cap, wraps the 4626 `withdraw` in try/catch, returns the
///             actual amount so the vault falls back to its own hot reserves. A stalled yield source
///             degrades to "serve from buffer", never a bricked settlement.
///           • **Per-block withdraw cap** bounds how much can leave the source in one block.
///           • The 4626's `asset()` is verified against our `asset` in the constructor — a mis-wired source
///             (wrong underlying) can't silently mis-account funds (a Bunni-class guard).
///           • Supply-only into the 4626 ⇒ no borrow / no leverage; the only loss vector is the yield
///             source's own solvency, which is out of our control (same as the Aave adapter).
contract MintwareERC4626YieldAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20   public immutable asset;       // the underlying this adapter idles (USDC on Arc)
    IERC4626 public immutable yieldSource;  // Arc's yield primitive, as a 4626

    /// @notice The only address allowed to supply/withdraw. Owner-settable ONCE (deploy chicken-and-egg).
    address public vault;

    /// @notice Max underlying withdrawable per block (0 = unlimited). Bounds drain during toxic flow.
    uint256 public perBlockWithdrawCap;
    uint256 private _lastWithdrawBlock;
    uint256 private _withdrawnThisBlock;

    event VaultSet(address indexed vault);
    event PerBlockWithdrawCapSet(uint256 cap);
    event Supplied(uint256 amount);
    event Withdrawn(uint256 requested, uint256 withdrawn);

    error OnlyVault();
    error ZeroAddress();
    error AssetMismatch();
    error VaultAlreadySet();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /// @param asset_       The underlying token (USDC).
    /// @param yieldSource_ The ERC-4626 yield source — its `asset()` MUST equal `asset_`.
    /// @param vault_       Initial authorized vault (may be zero, set later via `setVault`).
    /// @param owner_       Adapter owner (roles + per-block cap).
    constructor(address asset_, address yieldSource_, address vault_, address owner_) Ownable(owner_) {
        if (asset_ == address(0) || yieldSource_ == address(0)) revert ZeroAddress();
        // Guard: the 4626 must actually be a vault over OUR asset (mis-wire / attacker source protection).
        if (IERC4626(yieldSource_).asset() != asset_) revert AssetMismatch();
        asset       = IERC20(asset_);
        yieldSource = IERC4626(yieldSource_);
        vault       = vault_; // zero allowed
    }

    // ── admin ──────────────────────────────────────────────────────────────────
    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        if (vault != address(0)) revert VaultAlreadySet(); // one-time — the withdraw sink must be immutable
        vault = vault_;
        emit VaultSet(vault_);
    }

    function setPerBlockWithdrawCap(uint256 cap) external onlyOwner {
        perBlockWithdrawCap = cap;
        emit PerBlockWithdrawCapSet(cap);
    }

    // ── IYieldAdapter ────────────────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    function deposit(uint256 amount) external override onlyVault nonReentrant {
        if (amount == 0) return;
        asset.safeTransferFrom(vault, address(this), amount);
        asset.forceApprove(address(yieldSource), amount);
        yieldSource.deposit(amount, address(this)); // 4626 shares minted to this adapter
        emit Supplied(amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Best-effort. Clamps to `maxWithdrawable()` (source headroom ∧ per-block cap), then the 4626
    ///      `withdraw(assets, vault, this)` sends EXACTLY that many assets to the vault (or reverts, caught →
    ///      0). Never reverts for an availability reason.
    function withdraw(uint256 amount) external override onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 want = amount < maxWithdrawable() ? amount : maxWithdrawable();
        if (want == 0) return 0;
        try yieldSource.withdraw(want, vault, address(this)) returns (uint256 /* sharesBurned */) {
            withdrawn = want; // 4626 withdraw(assets) transfers exactly `want` to the receiver (vault)
        } catch {
            return 0; // stalled source → serve from the vault's own buffer instead
        }
        if (block.number != _lastWithdrawBlock) {
            _lastWithdrawBlock = block.number;
            _withdrawnThisBlock = 0;
        }
        _withdrawnThisBlock += withdrawn;
        emit Withdrawn(amount, withdrawn);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Underlying attributable to us = the 4626 assets our shares redeem for (principal + yield).
    function totalAssets() external view override returns (uint256) {
        return yieldSource.convertToAssets(yieldSource.balanceOf(address(this)));
    }

    /// @inheritdoc IYieldAdapter
    /// @dev min(our redeemable assets, the source's own `maxWithdraw`, per-block remaining). The 4626's
    ///      `maxWithdraw` already reflects source liquidity / pause, so a frozen source returns 0 here.
    function maxWithdrawable() public view override returns (uint256) {
        uint256 mine   = yieldSource.convertToAssets(yieldSource.balanceOf(address(this)));
        uint256 srcMax = yieldSource.maxWithdraw(address(this));
        uint256 cap    = _blockRemaining();
        uint256 m = mine < srcMax ? mine : srcMax;
        return m < cap ? m : cap;
    }

    /// @inheritdoc IYieldAdapter
    /// @dev The 4626's own `maxDeposit` (0 if the source is capped/paused). Deposit is not a hot path.
    function maxSuppliable() external view override returns (uint256) {
        return yieldSource.maxDeposit(address(this));
    }

    function _blockRemaining() internal view returns (uint256) {
        if (perBlockWithdrawCap == 0) return type(uint256).max;
        if (block.number != _lastWithdrawBlock) return perBlockWithdrawCap;
        return perBlockWithdrawCap > _withdrawnThisBlock ? perBlockWithdrawCap - _withdrawnThisBlock : 0;
    }
}
