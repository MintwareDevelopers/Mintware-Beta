// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MintwareTreasuryJitStackTest} from "./MintwareTreasuryJitStack.t.sol";

/// @notice R6 PRO-RATA SAFETY NET. The property that MATTERS for a first-loss tranche: under ANY impairment
///         and ANY redemption ORDER, NO senior holder is shortchanged BELOW the fair pro-rata floor — a
///         finite junior first-loss buffer must be socialized, not drained first-come-first-served (which
///         zeroed the tail: pre-fix the last redeemer got ~9¢ while early redeemers got ~89¢). Fuzzes holder
///         sizes, impairment depth, and redemption order. Checks the DOWNSIDE only: fee/gain distribution can
///         lift some holders ABOVE the floor (harmless upside), and the anti-inflation virtual offset adds
///         bounded rounding on dust — neither is a shortchange.
contract MintwareTreasuryRedemptionOrderTest is MintwareTreasuryJitStackTest {
    uint256 constant WAD = 1e18;

    function _dep(address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositUSDC(amt, 0, who);
        vm.stopPrank();
    }

    /// @dev per-share payout; a REVERT is treated as per-share 0 (a maximal shortchange). `hadShares`
    ///      distinguishes real holders from the nothing-to-redeem case.
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

    /// @dev The fair pro-rata per-share floor BEFORE any redemption = min(par, realizable) / totalShares,
    ///      mirroring `_redeemNav` (par = max(seniorParLiability, totalSeniorAssets) — yield/fee-inclusive).
    function _fairFloorPerShare() internal view returns (uint256) {
        uint256 par  = vault.seniorParLiability();
        uint256 tsa  = vault.totalSeniorAssets();
        if (tsa > par) par = tsa;
        uint256 real = vault.seniorRealizableAssets();
        uint256 nav  = real < par ? real : par;
        uint256 ts   = vault.totalSeniorShares();
        return ts == 0 ? 0 : (nav * WAD) / ts;
    }

    function testFuzz_redemptionOrderIndependence(
        uint256 aAmt,
        uint256 bAmt,
        uint256 cAmt,
        uint256 deployAmt,
        uint256 dump,
        uint256 orderSeed
    ) public {
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
        // size exceeds the idle-first headroom the deploy reverts — skip that run.
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

        // The fair floor EVERY redeemer is entitled to at least (snapshot pre-redemption).
        uint256 fairPs = _fairFloorPerShare();

        // Redeem A, B, C, and the setUp `user` (10k) in a fuzzed order; track the worst per-share.
        address[4] memory holders = _order(orderSeed, A, B, C, user);
        uint256 minPs = type(uint256).max;
        uint256 counted;
        for (uint256 i; i < 4; ++i) {
            (uint256 ps, bool hadShares) = _redeem(holders[i]);
            if (!hadShares) continue;
            counted++;
            if (ps < minPs) minPs = ps;
        }

        // PROPERTY: no holder is shortchanged below the fair pro-rata floor by redemption ORDER. Pre-fix the
        // tail collapsed to ~0 (a ~90% shortchange); the redemption gate keeps every holder ≥ ~the floor.
        // A 3% downside band absorbs floor / virtual-offset rounding (dust included); upside is unbounded.
        if (counted >= 2 && fairPs > 0) {
            assertGe(
                minPs,
                (fairPs * 97) / 100,
                "R6 pro-rata VIOLATED: a redeemer is shortchanged below the fair floor by redemption order"
            );
        }
    }

    function _order(uint256 seed, address a, address b, address c, address d)
        internal
        pure
        returns (address[4] memory ord)
    {
        address[4] memory base = [a, b, c, d];
        for (uint256 i = 4; i > 1; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % i;
            (base[i - 1], base[j]) = (base[j], base[i - 1]);
        }
        return base;
    }
}
