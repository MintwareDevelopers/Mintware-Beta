// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  IYieldAdapter
/// @notice Pluggable idle-capital yield sink for ULV buffered-rehypothecation. A concrete adapter
///         (e.g. `AaveV3YieldAdapter`) wraps a lending source; the vault supplies idle capital and
///         pulls it back — critically, on a swap hot path, so **withdraw is best-effort and must
///         never revert the caller** (a bricked swap is the failure mode we design against).
/// @dev    Single-asset: one adapter per token (a dual-sided vault holds one per side). All amounts
///         are in that adapter's underlying token.
interface IYieldAdapter {
    /// @notice Supply `amount` of the underlying (pulled from the caller) into the yield source.
    /// @dev    Caller (the vault) MUST `approve` first, and SHOULD check `maxSuppliable()` — a full
    ///         reserve makes the source's supply revert.
    function deposit(uint256 amount) external;

    /// @notice Best-effort withdraw of up to `amount` back to the caller. Returns the amount actually
    ///         returned (`<= amount`). NEVER reverts for a liquidity/availability reason — returns 0
    ///         or a partial amount so the caller can fall back to its own reserves.
    function withdraw(uint256 amount) external returns (uint256 withdrawn);

    /// @notice Underlying attributable to the caller in the source (principal + accrued yield).
    function totalAssets() external view returns (uint256);

    /// @notice How much can be withdrawn right now given source state (liquidity, paused/inactive).
    ///         Callers size a JIT/buffer pull as `min(needed, maxWithdrawable())`.
    function maxWithdrawable() external view returns (uint256);

    /// @notice How much can be supplied right now (0 if the reserve is paused/frozen/inactive).
    function maxSuppliable() external view returns (uint256);
}
