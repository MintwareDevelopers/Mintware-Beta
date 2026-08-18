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

    /// @dev Test hook to simulate Aave illiquidity: caps what `withdraw`/`maxWithdrawable` can return while
    ///      `totalAssets` still reports the full principal (aTokens exist but aren't withdrawable right now).
    ///      Default `type(uint256).max` = fully liquid, so existing tests are unaffected.
    uint256 public withdrawableCap = type(uint256).max;

    constructor(address _underlying) {
        underlying = IERC20(_underlying);
    }

    function setWithdrawableCap(uint256 cap) external {
        withdrawableCap = cap;
    }

    function deposit(uint256 amount) external override {
        underlying.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external override returns (uint256) {
        uint256 avail = _withdrawable();
        uint256 got = amount < avail ? amount : avail; // best-effort, bounded by the liquidity cap
        if (got > 0) underlying.safeTransfer(msg.sender, got);
        return got;
    }

    function totalAssets() external view override returns (uint256) {
        return underlying.balanceOf(address(this)); // full principal (independent of the liquidity cap)
    }

    function maxWithdrawable() external view override returns (uint256) {
        return _withdrawable();
    }

    function _withdrawable() internal view returns (uint256) {
        uint256 bal = underlying.balanceOf(address(this));
        return bal < withdrawableCap ? bal : withdrawableCap;
    }

    function maxSuppliable() external pure override returns (uint256) {
        return type(uint256).max;
    }
}
