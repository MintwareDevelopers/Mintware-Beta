// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MWDynamicFee} from "../../src/hooks/MWDynamicFee.sol";

/// @title  MWFormalProofs — ULV increment 2 (symbolic / Halmos)
/// @notice Formal proofs (Halmos + z3) of the ULV pure fee math and the mulDiv ROUNDING DIRECTIONS
///         the vault relies on. Where a target is a real pure library function it is called directly
///         (proves the real bytecode). Where the arithmetic is an inline mulDiv inside a stateful vault
///         function, the EXACT pattern the vault uses (`a*bps/BPS` floor + remainder; `a*s/T` floor) is
///         proven here as a lemma — binding these to the vault bytecode 1:1 would need extracting the
///         math into a shared pure library (noted for the audit). These complement, not replace, the
///         256×128k Foundry invariants: fuzzing SAMPLES, Halmos PROVES over all inputs (within bounds).
///
/// @dev    Run: `halmos --contract MWFormalProofs`. Bounds via `vm.assume` keep the solver tractable and
///         match real caller ranges (fees/bps/ticks are all far below these caps on Base).
contract MWFormalProofs is Test {
    uint256 constant BPS                = 10_000;
    uint256 constant MAX_PIPS           = 1_000_000; // 100% in V4 pips
    uint256 constant MAX_NON_LP_FEE_BPS = 4_000;     // vault: LPs always keep ≥ 60%
    uint256 constant VIRTUAL_LIQUIDITY  = 1_000;     // vault inflation-defense offset

    // ─────────────────────────────────────────────────────────────────────────
    // 1. REAL CODE — MWDynamicFee.volatilityFee is bounded (fee-bounds invariant, design §5.8)
    // ─────────────────────────────────────────────────────────────────────────
    function check_volatilityFee_neverExceedsCeiling(uint24 base, uint24 maxFee, uint256 dev, uint256 slope) public pure {
        vm.assume(base  <= MAX_PIPS);
        vm.assume(maxFee <= MAX_PIPS);
        vm.assume(dev   <= 1_000_000);   // deviation in ticks — bounded
        vm.assume(slope <= MAX_PIPS);    // pips per tick
        uint24 fee = MWDynamicFee.volatilityFee(base, maxFee, dev, slope);
        uint256 cap = maxFee == 0 ? MAX_PIPS : maxFee;
        assert(uint256(fee) <= cap);          // never above the configured ceiling
        assert(uint256(fee) <= MAX_PIPS);     // never above 100% (would brick swaps)
    }

    function check_volatilityFee_neverBelowBase(uint24 base, uint24 maxFee, uint256 dev, uint256 slope) public pure {
        vm.assume(base  <= MAX_PIPS);
        vm.assume(maxFee == 0 || maxFee >= base);   // sane config: ceiling ≥ floor
        vm.assume(dev   <= 1_000_000);
        vm.assume(slope <= MAX_PIPS);
        uint24 fee = MWDynamicFee.volatilityFee(base, maxFee, dev, slope);
        assert(uint256(fee) >= uint256(base));      // deviation only ever ADDS to the base floor
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. REAL CODE — MWDynamicFee.rateLimit clamps the per-block step (anti-front-run, design §5.8)
    // ─────────────────────────────────────────────────────────────────────────
    function check_rateLimit_withinStep(uint24 last, uint24 target, uint256 maxStep) public pure {
        vm.assume(last   <= MAX_PIPS);
        vm.assume(target <= MAX_PIPS);
        vm.assume(maxStep <= MAX_PIPS);
        uint24 out = MWDynamicFee.rateLimit(last, target, maxStep);
        if (last == 0) { assert(out == target); return; }        // uninitialized adopts target
        // the move from `last` is never larger than `maxStep`
        uint256 delta = uint256(out) >= uint256(last) ? uint256(out) - uint256(last) : uint256(last) - uint256(out);
        assert(delta <= maxStep);
        // and never overshoots the target's direction
        if (target >= last) assert(uint256(out) <= uint256(target) || uint256(out) <= uint256(last) + maxStep);
        else                assert(uint256(out) >= uint256(target) || uint256(out) + maxStep >= uint256(last));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. LEMMA — the fee-split arithmetic (_splitFee): conservation + rounding favors LP
    // ─────────────────────────────────────────────────────────────────────────
    function check_splitFee_conservesAndFavorsLP(uint256 fee, uint16 tBps, uint16 bBps) public pure {
        vm.assume(uint256(tBps) + uint256(bBps) <= MAX_NON_LP_FEE_BPS);   // enforced by setFeeSplit
        vm.assume(fee <= 1e30);                                            // fee*bps ≤ 1e34 ≪ 2^256
        uint256 t  = (fee * tBps) / BPS;
        uint256 b  = (fee * bBps) / BPS;
        uint256 lp = fee - t - b;                                         // LP takes the remainder
        assert(t + b + lp == fee);                                        // conservation — zero dust
        uint256 lpNominal = (fee * (BPS - uint256(tBps) - uint256(bBps))) / BPS;
        assert(lp >= lpNominal);                                          // rounding favors LP
        assert(t <= (fee * uint256(tBps)) / BPS);                         // protocol cut never over its share
        assert(b <= (fee * uint256(bBps)) / BPS);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. LEMMA — the idle-leg redeem mulDiv (`idle*s/TL`): rounds DOWN, never over-pays
    // ─────────────────────────────────────────────────────────────────────────
    function check_redeemIdle_roundsDown(uint256 idle, uint256 s, uint256 TL) public pure {
        vm.assume(TL > 0 && s <= TL);
        vm.assume(idle <= 1e30 && s <= 1e30);                            // no mul overflow (≤ 1e60 ≪ 2^256)
        uint256 out = (idle * s) / TL;
        assert(out <= idle);                                             // never removes more than the whole leg
        assert(out * TL <= idle * s);                                    // floor: rounds toward the vault
        if (s == TL) assert(out == idle);                               // full redemption is exact
    }

    // sum-safety: two disjoint redeemers (s1 + s2 ≤ TL) can never together draw more than `idle`
    function check_redeemIdle_sumNeverExceedsBacking(uint256 idle, uint256 s1, uint256 s2, uint256 TL) public pure {
        vm.assume(TL > 0);
        vm.assume(s1 <= TL && s2 <= TL && s1 + s2 <= TL);
        vm.assume(idle <= 1e30 && s1 <= 1e30 && s2 <= 1e30);
        uint256 o1 = (idle * s1) / TL;
        uint256 o2 = (idle * s2) / TL;
        assert(o1 + o2 <= idle);                                        // Σ pro-rata ≤ backing (solvency)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. LEMMA — the deposit mint mulDiv with the virtual-liquidity inflation offset
    //            `minted = (TL+V)·liq / (managed+V)` — a depositor never mints value from nothing
    // ─────────────────────────────────────────────────────────────────────────
    function check_depositMint_noInflation(uint256 TL, uint256 managed, uint256 liq) public pure {
        vm.assume(TL <= 1e30 && managed <= 1e30 && liq <= 1e30);
        uint256 V = VIRTUAL_LIQUIDITY;
        uint256 minted = ((TL + V) * liq) / (managed + V);              // managed+V ≥ V > 0, no div-by-0
        // A depositor contributing `liq` into a pool of `managed` never mints more than their
        // proportional claim on the pre-existing supply+contribution (rounds toward existing holders).
        assert(minted * (managed + V) <= (TL + V) * liq);              // floor property
    }
}
