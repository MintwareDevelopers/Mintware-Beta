// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @notice Minimal stand-in for Circle's CCTP MessageTransmitter (destination side). `receiveMessage`
///         normally verifies Circle's attestation and mints the bridged USDC to the message's mintRecipient;
///         here it just mints a configured amount to the caller (the router) so the deposit flow can be
///         exercised. `setFail` simulates a bad/replayed message.
contract MockMessageTransmitter {
    MockERC20 public usdc;
    uint256 public mintAmount;
    bool public fail;

    function configure(address usdc_, uint256 amount) external {
        usdc = MockERC20(usdc_);
        mintAmount = amount;
    }

    function setFail(bool f) external {
        fail = f;
    }

    function receiveMessage(bytes calldata, bytes calldata) external returns (bool) {
        if (fail) return false;
        if (mintAmount > 0) usdc.mint(msg.sender, mintAmount);
        return true;
    }
}
