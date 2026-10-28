// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Canonical address-encoded permission masks used by Mintware V4 hooks and deploy scripts.
/// @dev Keep the hook constructor permission declarations aligned with these masks; CREATE2 mining
///      uses the mask to select an address whose low 14 bits V4 interprets as enabled callbacks.
library MWV4HookPermissions {
    uint160 internal constant MANAGED_POOL = 0x0AC8;
    uint160 internal constant FEE_ONLY = 0x00C0;
    uint160 internal constant TREASURY_JIT = 0x20C0;
}
