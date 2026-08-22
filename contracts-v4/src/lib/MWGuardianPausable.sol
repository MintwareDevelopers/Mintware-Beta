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

    /// @notice AUDIT M5: timestamp of the current pause (0 when unpaused). Used by the auto-heal below.
    uint256 public pausedAt;

    /// @notice AUDIT M5: after a pause has stood for this long, ANYONE may unpause (`unpauseAfterTimeout`).
    ///         This bounds a lower-trust guardian's power: a fast-pause is a temporary emergency brake, not
    ///         an indefinite freeze of user withdrawals/redemptions. The owner can always re-pause (resetting
    ///         the clock) if the incident is ongoing, and can unpause immediately. Default 30 days — long
    ///         enough for real incident response, finite so a single key can never trap user funds forever.
    uint256 public maxPauseDuration = 30 days;

    event GuardianSet(address indexed guardian);
    event MaxPauseDurationSet(uint256 seconds_);
    event AutoUnpaused(uint256 pausedAt, uint256 at);

    error NotGuardianOrOwner();
    error PauseTimeoutNotReached();
    error AutoHealDisabled();

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

    /// @notice AUDIT M5: tune the auto-heal window (0 disables it — owner-only indefinite pause). Owner only.
    function setMaxPauseDuration(uint256 seconds_) external onlyOwner {
        maxPauseDuration = seconds_;
        emit MaxPauseDurationSet(seconds_);
    }

    /// @notice Emergency pause — callable by the guardian (fast) or the owner. Stamps `pausedAt` so the
    ///         auto-heal timeout can bound how long a fast-pause may stand.
    function pause() external onlyGuardianOrOwner {
        pausedAt = block.timestamp;
        _pause();
    }

    /// @notice Resume operations — owner only (deliberate).
    function unpause() external onlyOwner {
        pausedAt = 0;
        _unpause();
    }

    /// @notice AUDIT M5: permissionless auto-heal. Once a pause has stood for `maxPauseDuration`, ANYONE may
    ///         lift it — so a compromised/rogue guardian cannot freeze user exits indefinitely (only the
    ///         owner can, by actively re-pausing). Disabled when `maxPauseDuration == 0`.
    function unpauseAfterTimeout() external {
        if (maxPauseDuration == 0) revert AutoHealDisabled();
        _requirePaused();
        if (block.timestamp < pausedAt + maxPauseDuration) revert PauseTimeoutNotReached();
        emit AutoUnpaused(pausedAt, block.timestamp);
        pausedAt = 0;
        _unpause();
    }
}
