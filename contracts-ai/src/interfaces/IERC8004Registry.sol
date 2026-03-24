// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  IERC8004Registry
/// @notice Interface for the ERC-8004 AI Agent Identity & Reputation Registry.
///         https://eips.ethereum.org/EIPS/eip-8004
///
/// @dev    AIAttribution.sol depends only on this interface — never on a live
///         registry deployment. The registry address is set at runtime by the
///         owner via setErc8004Registry(). This means:
///           - The contract deploys with zero ERC-8004 dependency.
///           - Registry can be swapped if ERC-8004 is updated.
///           - requireErc8004 = false at launch → permissionless registration.
interface IERC8004Registry {
    /// @notice Returns the owner (controller) of an agent token.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Returns true if the token is registered and active.
    function isRegistered(uint256 tokenId) external view returns (bool);

    /// @notice Returns the on-chain metadata stored at registration time.
    function getAgentMetadata(uint256 tokenId) external view returns (
        string memory name,
        string memory model,
        address       controller,
        bool          active
    );
}
