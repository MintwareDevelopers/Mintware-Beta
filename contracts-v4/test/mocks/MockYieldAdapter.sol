// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../../src/vaults/IYieldAdapter.sol";

/// @dev Test-only yield adapter: holds the deposited underlying and lets tests mint
///      simulated yield into it.
contract MockYieldAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;

    constructor(address _underlying) {
        underlying = IERC20(_underlying);
    }

    function deposit(uint256 amount) external override {
        underlying.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override {
        underlying.safeTransfer(msg.sender, amount);
    }

    function totalAssets() external view override returns (uint256) {
        return underlying.balanceOf(address(this));
    }
}
