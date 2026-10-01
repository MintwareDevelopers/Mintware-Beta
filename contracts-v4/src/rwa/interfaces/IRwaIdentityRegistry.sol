// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  IRwaIdentityRegistry
/// @notice The minimum surface Mintware reads from an RWA issuer's identity registry: "is this wallet a
///         verified holder right now?". Shaped after ERC-3643's `IIdentityRegistry.isVerified`, so a real
///         issuer registry (e.g. the licensed partner's) plugs in without an adapter.
/// @dev    Mintware never WRITES a registry and never decides eligibility — the issuer (under its licence)
///         does. The three-role model puts the only compliance check on whoever RECEIVES the asset token,
///         enforced by the token itself; Mintware's contracts are enrolled once as permitted holders.
interface IRwaIdentityRegistry {
    function isVerified(address wallet) external view returns (bool);
}
