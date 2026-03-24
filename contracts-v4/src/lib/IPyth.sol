// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  IPyth
/// @notice Minimal interface for the Pyth Network on-chain price oracle.
///         Full SDK: https://github.com/pyth-network/pyth-sdk-solidity
///         Base mainnet Pyth contract: 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a
interface IPyth {

    struct Price {
        int64  price;       // Price value (multiply by 10^expo for actual value)
        uint64 conf;        // Confidence interval (±) in the same units as price
        int32  expo;        // Exponent — typically -8 (price = price * 10^-8)
        uint   publishTime; // Unix timestamp of price publication
    }

    /// @notice Get the most recent price, only if it is not older than `age` seconds.
    /// @dev    Reverts if price is stale. Use in afterSwap — if it reverts we fail-open.
    function getPriceNoOlderThan(bytes32 id, uint age) external view returns (Price memory price);

    /// @notice Get the most recent price regardless of age.
    /// @dev    Use with caution — may return a stale price.
    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);

    /// @notice Get the latest available price update fee for a given set of price IDs.
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint feeAmount);

    /// @notice Update price feeds with fresh data from Pyth's off-chain service.
    function updatePriceFeeds(bytes[] calldata updateData) external payable;
}
