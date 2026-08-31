// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  MWTimelockedRiskParams
/// @notice Reusable 48h-timelocked, bounded, publicly-disclosed change process for RISK PARAMETERS —
///         the governance rail legal asked for on the ETH-senior vault stack. Sits alongside its sibling
///         `MWTimelockedOracleSigner` (same shape: `propose → wait 48h → confirm`, with `cancel`), and is
///         shared verbatim by `MintwareTreasuryVault`, `MintwareEthSettlement`, and
///         `MintwareTreasuryJitHook` so the rule set is written once, not copy-pasted three times.
///
/// @dev    THE GOVERNANCE MODEL (why each rule exists):
///           • BOUNDED       — every proposal is range-checked at PROPOSE time (`_validateRiskParam`), so a
///                             fat-finger / compromised owner can never even *schedule* an out-of-range value.
///           • TIMELOCKED    — a RISK-INCREASING change (loosening a cap, lowering a coverage floor, widening
///                             a slippage band, disabling a fail-closed guard) is delayed 48h so the change is
///                             public and cancellable before it takes effect. A RISK-DECREASING change
///                             (tightening for safety) applies INSTANTLY — safety must never wait. The
///                             direction is decided per-param by the inheritor's `_riskParamInstant` hook.
///           • FIRST-SET     — before the surface is "live" (`_riskParamsLive()` false — e.g. pre-activation /
///                             pre-arming, during deploy + test setUp) EVERY change is instant, mirroring
///                             `MWTimelockedOracleSigner`'s one-time initializer. Once live, the rules above bind.
///           • DISCLOSED     — `RiskParamProposed` / `RiskParamConfirmed` / `RiskParamCancelled` make every
///                             pending and applied change observable on-chain.
///
/// @dev    EMERGENCY SAFETY IS NEVER TIMELOCKED. The guardian pause (`MWGuardianPausable`) and the automatic
///         JIT loss-breaker are deliberately NOT routed through this contract — they must fire instantly.
///         This rail governs only the deliberate *tuning* of risk parameters, never the kill-switches.
///
/// @dev    Access control is intentionally NOT baked in (same posture as `MWTimelockedOracleSigner`). The
///         `_changeRiskParam / _confirmRiskParam / _cancelRiskParam` internals carry the bounds + timelock +
///         disclosure; each inheriting contract exposes thin `onlyOwner` wrappers around them and implements
///         four hooks that describe its own params. Values are carried as `uint256` (a bool is 0/1, an
///         `int24`/`uint16` is widened); two-slot params (e.g. a cap + its window) use the `value2` field.
abstract contract MWTimelockedRiskParams {
    /// @notice Delay between propose and confirm for a risk-INCREASING change. 48h to detect + cancel.
    uint256 public constant RISK_PARAM_DELAY = 48 hours;

    struct RiskParamChange {
        uint256 value;  // proposed primary value
        uint256 value2; // proposed secondary value (0 / unused for single-slot params)
        uint256 eta;    // earliest confirm timestamp; 0 == nothing pending
    }

    /// @notice Pending scheduled change per param id (bytes32 tag). `eta == 0` means none pending.
    mapping(bytes32 => RiskParamChange) public pendingRiskParam;

    event RiskParamProposed(bytes32 indexed param, uint256 oldVal, uint256 newVal, uint256 newVal2, uint256 eta);
    event RiskParamConfirmed(bytes32 indexed param, uint256 oldVal, uint256 newVal, uint256 newVal2);
    event RiskParamCancelled(bytes32 indexed param, uint256 newVal, uint256 newVal2);

    error NoRiskParamPending();
    error RiskParamDelayNotElapsed();

    // ── inheritor hooks (describe this contract's params) ─────────────────────────────

    /// @dev Bounds-check `v`/`v2` for `param`; REVERT if out of range. Runs at propose time AND re-runs at
    ///      confirm time (cheap belt-and-suspenders — a param's constant bounds cannot change, but this keeps
    ///      a confirm from ever writing a value the current code would reject).
    function _validateRiskParam(bytes32 param, uint256 v, uint256 v2) internal view virtual;

    /// @dev Write the storage variable(s) for `param` and emit the contract's own domain event. Called on an
    ///      instant change and on a confirmed one.
    function _writeRiskParam(bytes32 param, uint256 v, uint256 v2) internal virtual;

    /// @dev Current primary value of `param` (for the disclosure events' `oldVal`).
    function _readRiskParam(bytes32 param) internal view virtual returns (uint256);

    /// @dev True iff applying (`v`,`v2`) to `param` may happen INSTANTLY — i.e. the surface is not yet live
    ///      (`!_riskParamsLive()`) OR the change is risk-decreasing / neutral (a safety tightening). The
    ///      inheritor reads its own current state to decide direction. A `false` return routes the change
    ///      through the 48h timelock.
    function _riskParamInstant(bytes32 param, uint256 v, uint256 v2) internal view virtual returns (bool);

    // ── the shared change process (wrapped by onlyOwner setters in the inheritor) ──────

    /// @dev PROPOSE (or instantly apply). Bounds first, then: instant → write now; else schedule at +48h,
    ///      OVERWRITING any prior pending change for this param (a re-propose replaces the queue entry).
    function _changeRiskParam(bytes32 param, uint256 v, uint256 v2) internal {
        _validateRiskParam(param, v, v2);
        uint256 oldVal = _readRiskParam(param);
        if (_riskParamInstant(param, v, v2)) {
            _writeRiskParam(param, v, v2);
            // AUDIT (L1): a safety-instant change SUPERSEDES any queued (now-stale) change for this param
            // — drop it so a pre-existing loosening can't later be confirmed to silently revert this
            // tightening. "Safety never waits" must also mean safety is durable.
            RiskParamChange memory stale = pendingRiskParam[param];
            if (stale.eta != 0) {
                delete pendingRiskParam[param];
                emit RiskParamCancelled(param, stale.value, stale.value2);
            }
            emit RiskParamConfirmed(param, oldVal, v, v2);
            return;
        }
        uint256 eta = block.timestamp + RISK_PARAM_DELAY;
        pendingRiskParam[param] = RiskParamChange({value: v, value2: v2, eta: eta});
        emit RiskParamProposed(param, oldVal, v, v2, eta);
    }

    /// @dev CONFIRM a timelocked change once its 48h has elapsed. Re-validates bounds, then writes.
    function _confirmRiskParam(bytes32 param) internal {
        RiskParamChange memory c = pendingRiskParam[param];
        if (c.eta == 0) revert NoRiskParamPending();
        if (block.timestamp < c.eta) revert RiskParamDelayNotElapsed();
        _validateRiskParam(param, c.value, c.value2);
        uint256 oldVal = _readRiskParam(param);
        delete pendingRiskParam[param];
        _writeRiskParam(param, c.value, c.value2);
        emit RiskParamConfirmed(param, oldVal, c.value, c.value2);
    }

    /// @dev CANCEL a pending change (abort a rogue / superseded proposal before it can be confirmed).
    function _cancelRiskParam(bytes32 param) internal {
        RiskParamChange memory c = pendingRiskParam[param];
        if (c.eta == 0) revert NoRiskParamPending();
        delete pendingRiskParam[param];
        emit RiskParamCancelled(param, c.value, c.value2);
    }

    /// @dev Surface-live predicate. Overridden by the inheritor (`activated` / `settlementRail set` / oracle
    ///      initialized). Default: always live (fail-safe — an inheritor that forgets to override still gets
    ///      the timelock). Exposed as a hook so `_riskParamInstant` implementations can share it.
    function _riskParamsLive() internal view virtual returns (bool) {
        return true;
    }
}
