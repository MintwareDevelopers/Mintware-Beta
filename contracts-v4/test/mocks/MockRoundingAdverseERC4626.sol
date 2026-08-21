// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20}     from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626}   from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice An **adversarial-rounding** ERC-4626 — the pure-rounding analog of the Bunni V2 trap
///         (2025-09-02). Where `MockFeeERC4626` overstates via an *exit fee*, this one overstates via
///         **rounding in the redeemer's favor** with NO fee:
///           • `convertToAssets()` / `maxWithdraw()`  → round UP + a small over-report (the "safe in
///             isolation" direction Bunni assumed) — these OVER-STATE what a share is worth.
///           • `previewRedeem()` (default) / `redeem()` → honest OZ floor — what a redeemer ACTUALLY gets.
///
///         The point is to prove `MintwareERC4626YieldAdapter` — whose `totalAssets()` trusts the source's
///         `previewRedeem()` — can never be pushed to over-state the NAV backing par-spendable settlement
///         USDC, and that the conservation invariants FAIL LOUDLY the instant the adapter is made to trust
///         the hostile (over-reporting) view instead.
///
///         `navLies` is the teeth switch: when ON, `previewRedeem()` ALSO returns the over-reported value
///         (i.e. the source's own NAV view is adverse), so an adapter that trusts it inherits an overstated
///         NAV while `redeem()` still pays only the honest floor — exactly the "trusted a conversion that
///         rounded the wrong way" vector. Default OFF (a self-consistent, honest source).
contract MockRoundingAdverseERC4626 is ERC4626 {
    /// @notice When true, `previewRedeem` returns the OVER-REPORTED value (the adverse NAV the adapter
    ///         would inherit). When false (default), `previewRedeem` is the honest OZ floor. `redeem()`
    ///         ALWAYS pays the honest floor regardless — that gap is the whole exploit surface.
    bool public navLies;
    /// @notice When true, `redeem` reverts — a stalled/paused source, to exercise the adapter's
    ///         best-effort try/catch (withdraw must still never revert the caller).
    bool public revertRedeem;

    constructor(IERC20 asset_) ERC20("Adverse Yield USDC", "avUSDC") ERC4626(asset_) {}

    function setNavLies(bool v) external { navLies = v; }
    function setRevertRedeem(bool v) external { revertRedeem = v; }

    /// Raise assets-per-share by donating `amount` of underlying (accrued yield).
    function simulateYield(uint256 amount) external {
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), amount);
    }

    /// @notice The TRUE, always-honest redeemable value of `shares` — the OZ floor, exactly what `redeem`
    ///         pays. The adapter never reads this; the invariant harness uses it as the "actually
    ///         realizable now" bound, independent of whatever the adverse views report.
    function honestValue(uint256 shares) public view returns (uint256) {
        return super.previewRedeem(shares);
    }

    // ── adverse views (round UP / over-report — the redeemer-favorable direction) ──────────────────────

    /// OVER-REPORTS on purpose: the honest floor + a rounding fudge (1 wei + ~1bp) in the redeemer's
    /// favor. This is the "safe in isolation" rounding Bunni assumed; a naive adapter that trusts it to
    /// value its NAV would over-state the backing of par-spendable USDC.
    function convertToAssets(uint256 shares) public view override returns (uint256) {
        if (shares == 0) return 0;
        uint256 honest = super.previewRedeem(shares);
        return honest + 1 + honest / 10_000;
    }

    /// XyloVault-shaped: reports the over-stated `convertToAssets`, ignoring that `redeem` pays the floor.
    function maxWithdraw(address owner) public view override returns (uint256) {
        return convertToAssets(balanceOf(owner));
    }

    /// Honest by default (== `redeem` payout). With `navLies`, returns the OVER-REPORTED value — the
    /// hostile NAV an adapter would inherit, while `redeem` below still only pays the floor.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        if (navLies) return convertToAssets(shares);
        return super.previewRedeem(shares);
    }

    // ── exits (ALWAYS pay the honest floor — never the over-reported view) ─────────────────────────────

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        require(!revertRedeem, "AdverseVault: redeem disabled");
        require(shares <= maxRedeem(owner), "ERC4626: redeem more than max");
        uint256 assets = super.previewRedeem(shares); // honest floor — what the vault can actually pay
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return assets;
    }
}
