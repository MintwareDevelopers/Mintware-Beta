// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareTreasuryJitStackTest} from "./MintwareTreasuryJitStack.t.sol";

/// @notice R6 PRO-RATA SAFETY NET. Property: under ANY impairment and ANY redemption ORDER, all senior
///         holders must receive an equal per-share payout — a finite first-loss buffer must be socialized,
///         not consumed first-come-first-served. Fuzzes holder sizes, impairment depth, and redemption
///         order. FAILS on the pre-redesign code (tail redeemer shortchanged / reverts); becomes the guard
///         for the loss-socialization redesign (approach A). Deposits price 1:1 at par, so equal per-share
///         is the correct pro-rata outcome.
contract MintwareTreasuryRedemptionOrderTest is MintwareTreasuryJitStackTest {
    uint256 constant WAD = 1e18;

    function _dep(address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    /// @dev per-share payout; a REVERT is treated as per-share 0 (a maximal shortchange — the holder
    ///      cannot exit at all). `hadShares` distinguishes real holders from the nothing-to-redeem case.
    function _redeem(address who) internal returns (uint256 perShare, bool hadShares) {
        uint256 s = vault.seniorShares(who);
        if (s == 0) return (0, false);
        hadShares = true;
        vm.prank(who);
        try vault.redeemSenior(s, 0) returns (uint256 a) {
            perShare = (a * WAD) / s;
        } catch {
            perShare = 0; // revert == worst-case shortchange
        }
    }

    function testFuzz_redemptionOrderIndependence(
        uint256 aAmt,
        uint256 bAmt,
        uint256 cAmt,
        uint256 deployAmt,
        uint256 dump,
        uint256 orderSeed
    ) public {
        // SKIPPED until the loss-socialization redesign lands (see
        // docs/developers/redemption-tail-residual-2026-08-24.md). This property FAILS on current code —
        // it is the ready-made guard for the fix, not a passing assertion today. Un-skip when the redesign
        // (a yield-accruing senior par-claim / redemption gate) is implemented so it fuzzes the fix at scale.
        // Confirmed to catch the bug: max−min per-share ≈ 0.95 vs the 2% tolerance on current main.
        vm.skip(true);

        address A = makeAddr("A");
        address B = makeAddr("B");
        address C = makeAddr("C"); // the potential dust tail

        aAmt = bound(aAmt, 1_000 * ONE, 100_000 * ONE);
        bAmt = bound(bAmt, 1_000 * ONE, 100_000 * ONE);
        cAmt = bound(cAmt, 10 * ONE, 100_000 * ONE);
        _dep(A, aAmt);
        _dep(B, bAmt);
        _dep(C, cAmt);

        // Deploy a senior slice into the IL-bearing LP so impairment is reachable. Guarded: if the fuzzed
        // size exceeds the idle-first headroom the deploy reverts — skip that run (no impairment to test).
        deployAmt = bound(deployAmt, 2_000 * ONE, 8_000 * ONE);
        try vault.deployToLP(deployAmt, vault.juniorTokens()) {} catch { return; }

        // Impair the pool at a fuzzed severity, then settle the JIT slice the dump opens.
        dump = bound(dump, 100_000 * ONE, 1_000_000_000 * ONE);
        team.mint(trader, dump * 2);
        vm.startPrank(trader);
        team.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(key, _sellTeamZeroForOne(), dump);
        vm.stopPrank();
        vm.roll(block.number + 1);
        hook.sweepJit();

        // Redeem A, B, C, and the setUp `user` (10k) in a fuzzed order.
        address[4] memory holders = _order(orderSeed, A, B, C, user);
        uint256 minPs = type(uint256).max;
        uint256 maxPs = 0;
        uint256 counted = 0;
        for (uint256 i; i < 4; ++i) {
            (uint256 ps, bool hadShares) = _redeem(holders[i]);
            if (!hadShares) continue;
            counted++;
            if (ps < minPs) minPs = ps;
            if (ps > maxPs) maxPs = ps;
        }

        // PROPERTY: every holder's per-share payout is equal within 2% (rounding/virtual-offset tolerance).
        // A first-come-first-served drain of the junior buffer under severe impairment violates this — the
        // tail holder receives materially less (down to 0 / revert) than the early holders.
        if (counted >= 2 && maxPs > 0) {
            assertLe(
                maxPs - minPs,
                (maxPs * 2) / 100,
                "R6 pro-rata VIOLATED: per-share payout depends on redemption order (tail shortchanged)"
            );
        }
    }

    function _order(uint256 seed, address a, address b, address c, address d)
        internal
        pure
        returns (address[4] memory ord)
    {
        address[4] memory base = [a, b, c, d];
        // Fisher-Yates over 4 using the seed → a uniformly fuzzed permutation.
        for (uint256 i = 4; i > 1; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % i;
            (base[i - 1], base[j]) = (base[j], base[i - 1]);
        }
        return base;
    }
}
