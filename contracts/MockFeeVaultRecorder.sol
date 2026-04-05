// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockFeeVaultRecorder {
    uint256 public lastEpochId;
    address public lastLp;
    uint256 public lastAmount;
    uint256 public callCount;

    function recordClaim(uint256 epochId, address lp, uint256 amount) external {
        lastEpochId = epochId;
        lastLp = lp;
        lastAmount = amount;
        callCount += 1;
    }
}
