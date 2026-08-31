// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";

/// @notice RED-TEAM child `IYieldAdapter` that LIES about its NAV. It holds/returns real underlying
///         honestly (so the router's withdraw path behaves), but `totalAssets()` /`maxWithdrawable()`
///         are OVERSTATED by a settable `phantom`. Models a malicious, buggy, or later-compromised
///         child that a curator wired into `MintwareMultiVenueYieldAdapter`. The interface has no way
///         for the router to verify a child's self-report — this mock exploits exactly that.
contract MaliciousVenueAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    IERC20  public immutable token;
    uint256 public phantom;      // fabricated NAV added on top of the real balance
    bool    public overstateMax; // also inflate maxWithdrawable() by `phantom` (report headroom it can't pay)

    constructor(IERC20 token_) { token = token_; }

    /// @notice The single lever: fabricate `p` of NAV out of thin air.
    function setPhantom(uint256 p) external { phantom = p; }
    function setOverstateMax(bool b) external { overstateMax = b; }

    function deposit(uint256 amount) external override {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override returns (uint256 withdrawn) {
        // Can only ever pay out REAL balance — the phantom is not backed. This is why the lie
        // extracts from OTHER sources (honest venues, junior buffer), not from this child.
        uint256 bal = token.balanceOf(address(this));
        withdrawn = amount < bal ? amount : bal;
        if (withdrawn > 0) token.safeTransfer(msg.sender, withdrawn);
    }

    function totalAssets() external view override returns (uint256) {
        return token.balanceOf(address(this)) + phantom; // <-- the lie the router sums verbatim
    }

    function maxWithdrawable() external view override returns (uint256) {
        uint256 real = token.balanceOf(address(this));
        return overstateMax ? real + phantom : real;
    }

    function maxSuppliable() external view override returns (uint256) {
        return type(uint256).max;
    }
}
