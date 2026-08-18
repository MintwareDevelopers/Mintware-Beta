// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20}     from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626}   from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math}      from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice A NON-STANDARD ERC-4626 that reproduces Arc's XyloNet **XyloVault** behaviour, verified on-chain
///         2026-08-18 — a `withdrawFee` on exit that the "ideal" views IGNORE:
///           • `convertToAssets()` / `maxWithdraw()` — OZ defaults, NO fee → they OVER-REPORT realizable value.
///           • `previewRedeem()` / `previewWithdraw()` — NET the fee (what you actually get / must burn).
///           • `withdraw(assets)` REVERTS `INSUFFICIENT_BALANCE` near full balance (previewWithdraw grosses
///             the shares above what the owner holds); `redeem(shares)` is the working exit, fee-net.
///         This is the harness that proves `MintwareERC4626YieldAdapter` survives a fee-charging source:
///         conservative (fee-net) NAV via `previewRedeem`, and a `redeem`-based best-effort exit.
contract MockFeeERC4626 is ERC4626 {
    using Math for uint256;

    uint256 public immutable withdrawFeeBps; // e.g. 10 = 0.10% on exit (XyloVault = 10)

    constructor(IERC20 asset_, uint256 withdrawFeeBps_) ERC20("Fee Yield USDC", "fyUSDC") ERC4626(asset_) {
        withdrawFeeBps = withdrawFeeBps_;
    }

    /// Raise assets-per-share by donating `amount` of underlying (accrued yield), like MockERC4626.
    function simulateYield(uint256 amount) external {
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), amount);
    }

    // ── fee-aware views (net the fee; convertTo*/maxWithdraw stay OZ default = over-report) ──────────────

    /// Assets actually delivered when redeeming `shares` — the OZ amount minus the exit fee.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        uint256 gross = super.previewRedeem(shares);
        return gross - gross.mulDiv(withdrawFeeBps, 10_000);
    }

    /// Shares to burn to RECEIVE `assets` net — gross the assets up by the fee, then OZ-convert (round up).
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 gross = assets.mulDiv(10_000, 10_000 - withdrawFeeBps, Math.Rounding.Ceil);
        return super.previewWithdraw(gross);
    }

    /// OVER-REPORTS on purpose — `convertToAssets` ignores the exit fee, exactly like XyloVault's maxWithdraw
    /// (999999 reported vs 999000 realizable). This is the trap a naive adapter falls into; ours clamps on
    /// the fee-net `previewRedeem` instead.
    function maxWithdraw(address owner) public view override returns (uint256) {
        return convertToAssets(balanceOf(owner));
    }

    // ── exits ────────────────────────────────────────────────────────────────────────────────────────

    /// XyloVault-like: reverts when the fee-grossed shares exceed the owner's balance (the exact failure the
    /// adapter's redeem-path avoids). Burns `shares`, delivers exactly `assets`, keeps the fee in the vault.
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        uint256 shares = previewWithdraw(assets);
        require(shares <= balanceOf(owner), "XyloVault: INSUFFICIENT_BALANCE");
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return shares;
    }

    /// The working exit: burns `shares`, delivers fee-net assets, keeps the fee.
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        require(shares <= maxRedeem(owner), "ERC4626: redeem more than max");
        uint256 net = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, net, shares);
        return net;
    }
}
