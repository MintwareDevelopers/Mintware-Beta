// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareTreasuryJitStackTest} from "./MintwareTreasuryJitStack.t.sol";

/// @notice Closes the yield validation blind spot. The mock adapter reports `totalAssets = balanceOf`, so
///         minting USDC into it simulates Aave interest. These tests PROVE that a senior redemption returns
///         par + accrued yield — so any change to the redeem NAV that strips yield (e.g. a deposits-only
///         par claim) fails LOUDLY here instead of passing green against a yield-less mock. Passes on the
///         current code; it is the tripwire for the R6 pro-rata redesign.
contract MintwareTreasurySeniorYieldTest is MintwareTreasuryJitStackTest {
    address internal alice = makeAddr("y_alice");

    function _dep(address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    /// @dev Simulate yield: mint USDC into the adapter so `adapter.totalAssets()` grows (aTokens accrue).
    function _accrueYield(uint256 amt) internal {
        usdc.mint(address(adapter), amt);
    }

    /// A single senior deposits, the vault earns yield, and the senior redeems — must receive MORE than
    /// they put in (par + yield). This is the property a deposits-only par-claim would silently break.
    function test_senior_redeems_par_plus_yield() public {
        uint256 dep = 100_000 * ONE;
        _dep(alice, dep);

        uint256 yield = 5_000 * ONE; // 5% simulated interest on the idle senior USDC
        _accrueYield(yield);

        uint256 shares = vault.seniorShares(alice);
        vm.prank(alice);
        uint256 out = vault.redeemSenior(shares, 0);

        // With yield present and no impairment, the senior must get their principal PLUS (approximately)
        // their share of the yield — strictly MORE than par. `user` (setUp 10k) also holds, so alice's
        // share of the 5k yield is ~ dep/(dep+10k). Lower-bound: alice clearly gets > par.
        assertGt(out, dep, "senior redemption must include yield (got only par or less)");
        // Upper sanity: never more than principal + the full yield pool.
        assertLe(out, dep + yield + 2, "senior over-paid beyond principal + yield");
    }

    /// Two equal seniors, yield accrues, both redeem — each must get an equal, above-par per-share
    /// (yield shared pro-rata, no impairment).
    function test_two_seniors_share_yield_equally() public {
        address bob = makeAddr("y_bob");
        _dep(alice, 50_000 * ONE);
        _dep(bob,   50_000 * ONE);

        _accrueYield(4_000 * ONE);

        uint256 sa = vault.seniorShares(alice);
        vm.prank(alice);
        uint256 oa = vault.redeemSenior(sa, 0);
        uint256 sb = vault.seniorShares(bob);
        vm.prank(bob);
        uint256 ob = vault.redeemSenior(sb, 0);

        uint256 psA = (oa * 1e18) / sa;
        uint256 psB = (ob * 1e18) / sb;
        assertGt(psA, 1e18 - 1, "alice per-share must be >= par (yield lifts it)");
        assertApproxEqRel(psA, psB, 0.005e18, "equal seniors must share yield equally");
    }
}
