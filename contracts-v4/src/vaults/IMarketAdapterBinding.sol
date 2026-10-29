// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IYieldAdapter} from "./IYieldAdapter.sol";

/// @notice Read-only wiring exposed by Mintware adapters bound to one market owner.
interface IMarketAdapterBinding is IYieldAdapter {
    function asset() external view returns (IERC20);
    function vault() external view returns (address);
}
