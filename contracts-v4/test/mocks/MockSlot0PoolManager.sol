// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Idle-path (tokenId == 0) unit rigs never touch V4, but since round 3 the gateway constructor reads
///      `getSlot0` (XR-2: pool must be initialised; the follower is anchored at creation) and the follower runs
///      from creation. This stand-in answers `extsload(bytes32)` with a slot0 word whose sqrtPriceX96 is
///      `sqrtPrice` (default 2^96 = price 1.0) and reverts on every other call, exactly like the codeless stub
///      it replaces — so any path that would have reached V4 still fails loudly.
contract MockSlot0PoolManager {
    uint160 public sqrtPrice = 0x1000000000000000000000000; // 2^96

    function setSqrtPrice(uint160 s) external {
        sqrtPrice = s;
    }

    function extsload(bytes32) external view returns (bytes32) {
        return bytes32(uint256(sqrtPrice)); // tick / fees = 0 in the upper bits
    }

    fallback() external payable {
        revert("MockSlot0PoolManager: not V4");
    }

    receive() external payable {
        revert("MockSlot0PoolManager: not V4");
    }
}
