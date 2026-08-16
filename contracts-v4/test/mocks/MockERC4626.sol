// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20}    from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}   from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626}  from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal ERC-4626 yield source for Foundry tests — stands in for Arc's yield primitive.
///         `simulateYield` donates underlying to raise the share price (accrued yield); `failWithdrawals`
///         makes `withdraw` revert so the adapter's best-effort try/catch can be exercised.
contract MockERC4626 is ERC4626 {
    bool public failWithdrawals;

    constructor(IERC20 asset_) ERC20("Mock Yield USDC", "myUSDC") ERC4626(asset_) {}

    /// Raise assets-per-share by donating `amount` of underlying (pulled from the caller).
    function simulateYield(uint256 amount) external {
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), amount);
    }

    function setFailWithdrawals(bool f) external {
        failWithdrawals = f;
    }

    /// `maxWithdraw` stays truthful (reports redeemable assets) so the adapter attempts the withdraw and
    /// hits the revert — exercising the best-effort guard rather than the maxWithdrawable==0 short-circuit.
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        require(!failWithdrawals, "MockERC4626: withdraw disabled");
        return super.withdraw(assets, receiver, owner);
    }
}
