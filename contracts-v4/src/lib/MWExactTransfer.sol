// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice ERC-20 transfer that reverts unless the sender is debited and recipient receives exactly `amount`.
library MWExactTransfer {
    using SafeERC20 for IERC20;

    error InexactTransfer(address token, address recipient, uint256 expected, uint256 received);
    error InexactSenderDebit(address token, uint256 expected, uint256 debited);

    /// @notice Pull exactly `amount` from the external caller into the calling contract.
    /// @dev    Binds the debit source to `msg.sender` so internal callers cannot accidentally authorize a
    ///         different address. Pair with `safeTransferExact` when accounting requires both sides of an
    ///         ERC-20 movement to match nominal units. This rejects recipient-tax and sender-surcharge tokens.
    function safeTransferFromExact(IERC20 token, uint256 amount) internal {
        (uint256 recipientBefore, uint256 recipientAfter) = _pullFromCallerWithExactDebit(token, amount);
        uint256 received = recipientAfter >= recipientBefore ? recipientAfter - recipientBefore : 0;
        if (received != amount) revert InexactTransfer(address(token), address(this), amount, received);
    }

    /// @notice Pull `amount` from the caller, require an exact caller debit, and return actual receipt.
    /// @dev    Keeps balance-delta accounting for recipient-tax tokens while rejecting sender-surcharge
    ///         behavior that would charge the payer more than the requested amount.
    function safeTransferFromMeasuredExactDebit(IERC20 token, uint256 amount) internal returns (uint256 received) {
        (uint256 recipientBefore, uint256 recipientAfter) = _pullFromCallerWithExactDebit(token, amount);
        // Preserve the prior measured-delta fail-closed behavior if a rebasing or adversarial token
        // reduces this contract's reported balance during the pull.
        received = recipientAfter - recipientBefore;
    }

    /// @dev Shared caller-bound pull and exact sender-debit check. The wrappers deliberately keep their
    ///      distinct recipient-delta policies: one requires exact receipt, the other returns the measure.
    function _pullFromCallerWithExactDebit(IERC20 token, uint256 amount)
        private
        returns (uint256 recipientBefore, uint256 recipientAfter)
    {
        address sender = msg.sender;
        uint256 senderBefore = token.balanceOf(sender);
        recipientBefore = token.balanceOf(address(this));
        token.safeTransferFrom(sender, address(this), amount);
        uint256 senderAfter = token.balanceOf(sender);
        recipientAfter = token.balanceOf(address(this));
        uint256 debited = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        if (debited != amount) revert InexactSenderDebit(address(token), amount, debited);
    }

    function safeTransferExact(IERC20 token, address recipient, uint256 amount) internal {
        uint256 senderBefore = token.balanceOf(address(this));
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        uint256 senderAfter = token.balanceOf(address(this));
        uint256 afterBalance = token.balanceOf(recipient);
        uint256 debited = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        if (debited != amount) revert InexactSenderDebit(address(token), amount, debited);
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert InexactTransfer(address(token), recipient, amount, received);
    }

    /// @notice Transfer exactly `amount` out of the calling contract.
    /// @dev    Use only when the recipient independently verifies its receipt. PoolManager's
    ///         `settle()` does so against the delta owed during its unlock.
    function safeTransferWithExactDebit(IERC20 token, address recipient, uint256 amount) internal {
        uint256 senderBefore = token.balanceOf(address(this));
        token.safeTransfer(recipient, amount);
        uint256 senderAfter = token.balanceOf(address(this));
        uint256 debited = senderBefore >= senderAfter ? senderBefore - senderAfter : 0;
        if (debited != amount) revert InexactSenderDebit(address(token), amount, debited);
    }
}
