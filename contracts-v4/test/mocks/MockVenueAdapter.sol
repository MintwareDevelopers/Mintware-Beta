// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";

/// @notice An `IYieldAdapter` child for exercising the multi-venue router: holds deposits and can be paused
///         (headroom 0), supply-capped, or made to revert on deposit — to test the router's best-effort
///         weighted split + never-revert withdraw. (Distinct from `MockYieldAdapter`, which the treasury
///         tests use with different knobs.)
contract MockVenueAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bool    public paused;        // maxWithdrawable/maxSuppliable -> 0
    bool    public revertDeposit; // deposit() reverts (router must swallow + leave idle)
    uint256 public supplyCap;     // max additional supply (0 => unlimited)

    constructor(IERC20 token_) { token = token_; }

    function setPaused(bool p) external { paused = p; }
    function setRevertDeposit(bool r) external { revertDeposit = r; }
    function setSupplyCap(uint256 c) external { supplyCap = c; }
    /// Simulate accrued yield by donating underlying (raises totalAssets).
    function simulateYield(uint256 amount) external { token.safeTransferFrom(msg.sender, address(this), amount); }

    function deposit(uint256 amount) external override {
        require(!revertDeposit, "MockVenueAdapter: deposit reverts");
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override returns (uint256 withdrawn) {
        if (paused) return 0;
        uint256 bal = token.balanceOf(address(this));
        withdrawn = amount < bal ? amount : bal;
        if (withdrawn > 0) token.safeTransfer(msg.sender, withdrawn);
    }

    function totalAssets() external view override returns (uint256) {
        return token.balanceOf(address(this));
    }

    function maxWithdrawable() external view override returns (uint256) {
        return paused ? 0 : token.balanceOf(address(this));
    }

    function maxSuppliable() external view override returns (uint256) {
        if (paused) return 0;
        return supplyCap == 0 ? type(uint256).max : supplyCap;
    }
}
