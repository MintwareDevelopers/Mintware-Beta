// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";

/// @dev Test-only adversarial adapter for Stage-1.1 hardening tests. It can:
///        - short-pull on deposit (pull less than `amount`)
///        - short-send on withdraw (send less than `amount`)
///        - over-report totalAssets (claim yield it will not actually pay)
///      so the vault's post-transfer balance assertions can be proven to revert.
contract MockHostileYieldAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    uint256 public depositShortfall; // pull this much less than requested
    uint256 public withdrawShortfall; // send this much less than requested
    uint256 public reportedExtra; // add this to reported totalAssets (phantom yield)

    constructor(address _underlying) {
        underlying = IERC20(_underlying);
    }

    function setDepositShortfall(uint256 v) external { depositShortfall = v; }
    function setWithdrawShortfall(uint256 v) external { withdrawShortfall = v; }
    function setReportedExtra(uint256 v) external { reportedExtra = v; }

    function deposit(uint256 amount) external override {
        uint256 pull = amount > depositShortfall ? amount - depositShortfall : 0;
        if (pull > 0) underlying.safeTransferFrom(msg.sender, address(this), pull);
    }

    function withdraw(uint256 amount) external override returns (uint256) {
        uint256 send = amount > withdrawShortfall ? amount - withdrawShortfall : 0;
        if (send > 0) underlying.safeTransfer(msg.sender, send);
        return send; // hostile: reports what it actually sent (may be < amount)
    }

    function totalAssets() external view override returns (uint256) {
        return underlying.balanceOf(address(this)) + reportedExtra;
    }

    function maxWithdrawable() external view override returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    function maxSuppliable() external pure override returns (uint256) {
        return type(uint256).max;
    }
}
