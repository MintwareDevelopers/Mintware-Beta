// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  MWTimelockedOracleSigner
/// @notice Reusable 48h-timelocked oracle-signer rotation, shared by every Mintware V4
///         contract that trusts an off-chain oracle signature (audit fix C7). Replaces
///         the instant, no-timelock, no-zero-check `setOracleSigner` that the base vault
///         and the attribution token used to ship with.
///
/// @dev    Access control is intentionally NOT baked in. The `_propose/_confirm/_cancel`
///         internal functions carry the timelock + zero-check logic; each inheriting
///         contract exposes thin `onlyOwner` wrappers around them. This keeps the
///         primitive free of Ownable diamond-inheritance coupling and lets a contract
///         choose its own admin model.
///
///         Rotation model (mirrors the mainnet MintwareDistributor, the reference):
///           proposeOracleSigner(new)  →  wait ORACLE_ROTATION_DELAY  →  confirmOracleSigner()
///                                     ↘  cancelOracleRotation()  (abort a rogue proposal)
///         While a rotation is pending the CURRENT signer stays fully active — no
///         disruption. The 48h window is the time to detect and cancel a rogue rotation
///         (e.g. an owner-key compromise) before it takes effect.
abstract contract MWTimelockedOracleSigner {
    /// @notice Delay between propose and confirm. 48h to detect/cancel a rogue rotation.
    uint256 public constant ORACLE_ROTATION_DELAY = 48 hours;

    /// @notice Currently active oracle signer.
    address public oracleSigner;

    /// @notice Proposed replacement; zero when no rotation is pending.
    address public pendingOracleSigner;

    /// @notice Earliest timestamp confirmOracleSigner() may be called; zero when idle.
    uint256 public oracleRotationAvailableAt;

    event OracleRotationProposed(address indexed proposed, uint256 availableAt);
    event OracleRotationConfirmed(address indexed previous, address indexed current);
    event OracleRotationCancelled(address indexed cancelled);

    error ZeroOracleSigner();
    error OracleSignerAlreadyInitialized();
    error AlreadyActiveSigner();
    error NoRotationPending();
    error RotationDelayNotElapsed();

    /// @dev One-time initializer (constructor or a single post-deploy wiring call). Reverts
    ///      once a signer is set — after that, rotation must go through the timelock.
    function _initOracleSigner(address signer) internal {
        if (oracleSigner != address(0)) revert OracleSignerAlreadyInitialized();
        if (signer == address(0))       revert ZeroOracleSigner();
        oracleSigner = signer;
    }

    function _proposeOracleSigner(address proposed) internal {
        if (proposed == address(0))    revert ZeroOracleSigner();
        if (proposed == oracleSigner)  revert AlreadyActiveSigner();
        pendingOracleSigner       = proposed;
        oracleRotationAvailableAt = block.timestamp + ORACLE_ROTATION_DELAY;
        emit OracleRotationProposed(proposed, oracleRotationAvailableAt);
    }

    function _confirmOracleSigner() internal {
        if (pendingOracleSigner == address(0))           revert NoRotationPending();
        if (block.timestamp < oracleRotationAvailableAt) revert RotationDelayNotElapsed();
        address previous          = oracleSigner;
        oracleSigner              = pendingOracleSigner;
        pendingOracleSigner       = address(0);
        oracleRotationAvailableAt = 0;
        emit OracleRotationConfirmed(previous, oracleSigner);
    }

    function _cancelOracleRotation() internal {
        if (pendingOracleSigner == address(0)) revert NoRotationPending();
        address cancelled         = pendingOracleSigner;
        pendingOracleSigner       = address(0);
        oracleRotationAvailableAt = 0;
        emit OracleRotationCancelled(cancelled);
    }
}
