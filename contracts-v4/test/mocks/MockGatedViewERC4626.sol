// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20}   from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}  from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// @notice Reproduces a real, common 4626 shape: a Morpho-style vault whose VIEW functions are gated
///         behind a `whenNotPaused`-style modifier and REVERT (rather than degrading to 0/returning a
///         stale-but-safe number) once the vault enters an emergency pause / shutdown / mid-upgrade
///         state. `redeem` itself is left untouched — this mock exists specifically to isolate the
///         three calls `MintwareERC4626YieldAdapter.withdraw()` makes BEFORE its one try/catch
///         (`previewWithdraw` L126, `balanceOf` L127, `maxRedeem` L129), which the existing
///         `MockERC4626`/`MockFeeERC4626` mocks never exercise (they only ever fail `redeem`, the one
///         call that's already guarded). Each gate is independently toggleable so a test can isolate
///         exactly which unguarded call bricks `withdraw()`.
contract MockGatedViewERC4626 is ERC4626 {
    bool public previewWithdrawPaused;
    bool public balanceOfPaused;
    bool public maxRedeemPaused;

    error VaultPaused();

    constructor(IERC20 asset_) ERC20("Mock Gated-View Yield USDC", "gvUSDC") ERC4626(asset_) {}

    function setPreviewWithdrawPaused(bool p) external {
        previewWithdrawPaused = p;
    }

    function setBalanceOfPaused(bool p) external {
        balanceOfPaused = p;
    }

    function setMaxRedeemPaused(bool p) external {
        maxRedeemPaused = p;
    }

    /// Bare external call at MintwareERC4626YieldAdapter.sol:126 — no try/catch around it.
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        if (previewWithdrawPaused) revert VaultPaused();
        return super.previewWithdraw(assets);
    }

    /// Bare external call at MintwareERC4626YieldAdapter.sol:127 (also read inside `maxWithdrawable()`,
    /// itself called unguarded at line 124) — no try/catch around it anywhere.
    function balanceOf(address account) public view override(ERC20, IERC20) returns (uint256) {
        if (balanceOfPaused) revert VaultPaused();
        return super.balanceOf(account);
    }

    /// Bare external call at MintwareERC4626YieldAdapter.sol:129 — no try/catch around it.
    function maxRedeem(address owner_) public view override returns (uint256) {
        if (maxRedeemPaused) revert VaultPaused();
        return super.maxRedeem(owner_);
    }
}
