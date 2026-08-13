// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  ILiquidityModule
/// @notice The LP seam for the treasury-anchored ULV (`MintwareTreasuryVault`). The vault deploys a
///         slice of community USDC + the team's junior token as two-sided liquidity through this
///         interface, and recovers USDC through it to serve senior redemptions. It is the *only*
///         surface the vault touches the pool through — so the concrete implementation can be a
///         movable-price mock (for the tranche-solvency fuzz), and later a real Uniswap-V4 JIT module,
///         with **zero vault change**.
///
/// @dev    SENIORITY IS ENFORCED HERE. `recover` and `recoverableUSDC` value the position in USDC by
///         (conceptually) selling the junior team token to reach the USDC target FIRST — i.e. the
///         junior (team token) is spent to make the senior (community USDC) whole. That is what makes
///         `recoverableUSDC()` the correct right-hand side of the vault's solvency invariant:
///         `deployedFromSenior <= recoverableUSDC()`  <=>  the junior buffer still covers the senior.
///
/// @dev    All USDC amounts are 6dp. `recover`/`recoverableUSDC` are MTM (price-dependent) — this is
///         the ONLY place a price enters the system; the senior NAV never reads it.
interface ILiquidityModule {
    /// @notice Deploy `usdcAmount` senior USDC (pulled from the vault) plus up to `maxTeamToken` junior
    ///         token as two-sided liquidity. Returns the team token actually consumed.
    function deploy(uint256 usdcAmount, uint256 maxTeamToken) external returns (uint256 teamTokenUsed);

    /// @notice Recover liquidity to return AS CLOSE TO `usdcWanted` USDC as the position allows, sending
    ///         the USDC to the vault. Junior token is spent first (seniority). Returns the USDC actually
    ///         returned (`<= usdcWanted` only if the whole position is exhausted) and any junior token
    ///         handed back to the vault's reserve.
    function recover(uint256 usdcWanted) external returns (uint256 usdcReturned, uint256 teamTokenReturned);

    /// @notice USDC the position can return RIGHT NOW at current price (junior token valued by selling it
    ///         for USDC). This is the MTM backing behind the senior claim — the invariant's RHS.
    function recoverableUSDC() external view returns (uint256);

    /// @notice Collect accrued swap fees as USDC into the vault. Returns the USDC collected.
    function collectFees() external returns (uint256 usdcFees);
}
