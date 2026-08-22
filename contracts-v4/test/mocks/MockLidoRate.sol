// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IWstEthRate} from "../../src/payments/MintwareTreasuryFloatSettlement.sol";

/// @notice Settable stand-in for Lido's wstETH exchange-rate view (`stEthPerToken()`), so tests can pin the
///         ETH-per-wstETH reference the settlement bounds against — and lower it to simulate a depeg.
contract MockLidoRate is IWstEthRate {
    uint256 public rate; // WETH (ETH) per 1e18 wstETH, 1e18-scaled

    constructor(uint256 initial) { rate = initial; }

    function set(uint256 r) external { rate = r; }

    function stEthPerToken() external view override returns (uint256) { return rate; }
}
