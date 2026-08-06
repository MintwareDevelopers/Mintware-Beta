// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable}  from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title  MWGuardianPausable
/// @notice Shared emergency kill-switch for Mintware V4 contracts (hooks + vaults).
///         Implements the Stage-1.4 "fast pause, deliberate unpause" pattern:
///           - a `guardian` (the real-time monitoring multisig/EOA) can pause instantly
///             the moment an invariant alert fires — no owner-multisig round-trip;
///           - only the `owner` can unpause, so resumption is always a deliberate decision.
///
///         Benchmark (Stage-1.4): Bunni paused ~2h after its alert. Target here is
///         detection-to-pause under 15 minutes, which requires the pause path to be a
///         single guardian call — hence the split roles.
///
/// @dev    Inherit alongside the contract's logic and gate value-moving entry points
///         with `whenNotPaused`. IMPORTANT: in a V4 hook, do NOT gate the swap callbacks
///         (`beforeSwap`/`afterSwap`) with `whenNotPaused` — a hook that reverts in
///         `beforeSwap` bricks the entire pool. Pausing targets *mutations* (LP position
///         changes, deposits, rebalances, rehypothecation), never trading itself.
///
///         Uses OpenZeppelin `Pausable`, so `pause()`/`unpause()` emit the standard
///         `Paused(account)` / `Unpaused(account)` events (do not redeclare them).
abstract contract MWGuardianPausable is Ownable, Pausable {
    /// @notice Address permitted to fast-pause (monitoring bot / guardian multisig).
    address public guardian;

    event GuardianSet(address indexed guardian);

    error NotGuardianOrOwner();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @dev Guardian *or* owner may pause; only owner may unpause.
    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        _;
    }

    /// @notice Set the guardian permitted to fast-pause. Owner only.
    function setGuardian(address _guardian) external onlyOwner {
        guardian = _guardian;
        emit GuardianSet(_guardian);
    }

    /// @notice Emergency pause — callable by the guardian (fast) or the owner.
    function pause() external onlyGuardianOrOwner {
        _pause();
    }

    /// @notice Resume operations — owner only (deliberate).
    function unpause() external onlyOwner {
        _unpause();
    }
}
