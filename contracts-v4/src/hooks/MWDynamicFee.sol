// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  MWDynamicFee
/// @notice Deviation-priced swap-fee math for the Phase-3 DeFi dynamic-fee hook (Track A2).
///         Fees are expressed in V4 pips (1_000_000 = 100%, so 3000 = 0.30%). Pure + unit-testable.
///
/// @dev    Volatility fee: the further spot deviates from the truncated oracle, the higher the fee
///         (capture more of the value that volatility/manipulation creates). The caller
///         (MWHookCoordinator) supplies the deviation in TICKS and a per-tick slope.
library MWDynamicFee {
    uint24  internal constant MAX_PIPS = 1_000_000; // 100%

    /// @notice base + slope·deviation, clamped to `maxFeePips` (or 100% if 0).
    /// @param baseFeePips      floor fee in pips (e.g. 3000 = 0.30%)
    /// @param maxFeePips       ceiling fee in pips (0 → 100%)
    /// @param deviationTicks   |spot − oracle| in ticks (from MWOracleGuard.deviationTicks)
    /// @param slopePipsPerTick pips added per tick of deviation
    function volatilityFee(
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint256 deviationTicks,
        uint256 slopePipsPerTick
    ) internal pure returns (uint24) {
        uint256 fee = uint256(baseFeePips) + (deviationTicks * slopePipsPerTick);
        uint256 cap = maxFeePips == 0 ? MAX_PIPS : maxFeePips;
        if (fee > cap) fee = cap;
        return uint24(fee);
    }

    /// @notice Convex volatility fee: `base + slope·dev + quadMult·dev²`, clamped to `maxFeePips`
    ///         (or 100% if 0). The quadratic term makes toxic / arb-sized prints (large `dev`) pay
    ///         SUPER-linearly while mean-reverting retail (small `dev`) still pays ≈ the floor —
    ///         the Bunni-v2 base shape. `quadMult == 0` reduces EXACTLY to `volatilityFee` (increment 1),
    ///         so a hook can migrate from linear to quadratic by raising one param.
    /// @dev    Pure + clamped, but NOT self-guarding against overflow — same convention as `volatilityFee`:
    ///         the CALLER must bound `slope` and `quadMult` (≤ MAX_PIPS) and `dev` is tick-bounded at
    ///         runtime (≤ ~1.77e6), so `slope·dev` (≤ ~1.8e12) and `quadMult·dev²` (≤ ~3.2e18) stay far
    ///         under 2^256. Under those bounds it can never revert on the swap path (the Bunni-class bar).
    /// @param quadMultiplierPipsPerTickSq  pips added per tick² of deviation (0 ⇒ pure linear)
    function volatilityFeeQuad(
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint256 deviationTicks,
        uint256 slopePipsPerTick,
        uint256 quadMultiplierPipsPerTickSq
    ) internal pure returns (uint24) {
        uint256 fee = uint256(baseFeePips)
            + (deviationTicks * slopePipsPerTick)
            + (quadMultiplierPipsPerTickSq * deviationTicks * deviationTicks);
        uint256 cap = maxFeePips == 0 ? MAX_PIPS : maxFeePips;
        if (fee > cap) fee = cap;
        return uint24(fee);
    }

    /// @notice Time-decaying surge floor: `maxSurgePips · 2^(−elapsed/halfLife)`, computed as an
    ///         integer-halving with linear interpolation across the current half-life. Starts at the
    ///         full `maxSurgePips` (elapsed 0) and halves every `halfLife` seconds. Used as an
    ///         anti-sandwich / anti-stale clamp — a FLOOR the caller takes `max()` with the base fee
    ///         right after a liquidity reposition / NAV move, decaying back to nothing.
    /// @dev    Pure + revert-free by construction, so it can sit on the swap path (the Bunni-class bar):
    ///         `halfLife == 0` (or `maxSurgePips == 0`) returns 0; `halvings >= 24` returns 0 (2^-24 of a
    ///         ≤1e6-pip value rounds to 0 — fully decayed); and `hi >= lo`, `frac < halfLife` ⇒ the interp
    ///         never underflows and stays in `[lo, hi] ⊆ [0, maxSurgePips]`. The caller MUST bound
    ///         `halfLife` (e.g. ≤ 365 days) so `(hi − lo)·frac` cannot overflow — with `hi ≤ 1e6 < 2^20`
    ///         and `frac < halfLife`, a bounded `halfLife` keeps the product far under 2^256.
    /// @param maxSurgePips  surge ceiling in pips (caller bounds ≤ MAX_PIPS)
    /// @param elapsed       seconds since the surge was armed
    /// @param halfLife      half-life in seconds (0 ⇒ surge disabled ⇒ 0)
    function surgeFee(uint24 maxSurgePips, uint256 elapsed, uint256 halfLife) internal pure returns (uint24) {
        if (halfLife == 0 || maxSurgePips == 0) return 0;
        if (elapsed == 0) return maxSurgePips;
        uint256 halvings = elapsed / halfLife;
        if (halvings >= 24) return 0; // fully decayed
        uint256 hi = uint256(maxSurgePips) >> halvings;
        uint256 lo = uint256(maxSurgePips) >> (halvings + 1);
        uint256 frac = elapsed % halfLife;
        // linear interpolation hi → lo across [0, halfLife): monotone non-increasing, no underflow.
        uint256 surge = hi - ((hi - lo) * frac) / halfLife;
        return uint24(surge);
    }

    /// @notice MEV-tax fee component (Phase 2): a fee proportional to the swap's REVEALED priority-fee bid,
    ///         `min(k · (priorityFeeWei / 1e9), capPips)`. A searcher arbing us must outbid for top-of-block
    ///         via priority fee under Base's priority ordering, so taxing that bid recaptures its edge to the
    ///         vault — oracle-free (the searcher's own bid is the value signal). `k == 0` or zero priority
    ///         ⇒ 0 (tax off / no toxic bid). This is the fee-OVERRIDE approximation of the canonical MEV-tax
    ///         (which takes a delta) — chosen so no `beforeSwapReturnDelta` bit / CREATE2 re-mine is needed.
    /// @dev    Saturating + revert-free for ANY inputs (no caller bound needed): if `k·gwei` would meet or
    ///         exceed `capPips` we return `capPips` BEFORE multiplying, so the product can never overflow.
    /// @param k               pips of fee per gwei of priority fee (0 ⇒ tax off)
    /// @param priorityFeeWei  `tx.gasprice − block.basefee`, in wei (caller floors at 0)
    /// @param capPips         max tax contribution in pips (caller bounds ≤ MAX_PIPS)
    function mevTaxPips(uint256 k, uint256 priorityFeeWei, uint24 capPips) internal pure returns (uint24) {
        if (k == 0 || capPips == 0) return 0;
        uint256 gweiAmt = priorityFeeWei / 1e9;
        if (gweiAmt == 0) return 0;
        if (gweiAmt > uint256(capPips) / k) return capPips; // k·gweiAmt ≥ cap → saturate (pre-mult, no overflow)
        return uint24(k * gweiAmt);                         // guaranteed ≤ capPips ≤ MAX_PIPS
    }

    /// @notice Diamond-style LVR surcharge (Phase 3 — the directional lever). LVR (loss-versus-rebalancing)
    ///         is the value an arbitrageur EXTRACTS from LPs by realigning spot to the true price; it leaks
    ///         only on the swap that CLOSES the gap to the (truncated) oracle. This returns a surcharge to
    ///         add ON TOP of the base/volatility fee — but the CALLER applies it to the gap-closing (arb)
    ///         direction ONLY, passing `capturedTicks` = the mispricing that direction is arbing (and 0 for
    ///         benign flow that widens the gap). That directionality is what makes it LVR-aware rather than a
    ///         symmetric volatility tax: benign, uninformed flow — the flow that PAYS LPs — is never
    ///         surcharged; the arbitrageur's edge is recaptured to the LP. `surcharge = slope·t + quad·t²`,
    ///         clamped to `capPips`. `slope == quad == 0` (lever off) or `captured == 0` (benign) ⇒ 0.
    /// @dev    Saturating + revert-free for ANY inputs (no caller bound needed), the Bunni-class swap-path bar:
    ///         if the linear term alone meets the cap we return `capPips` BEFORE the quadratic multiply, so no
    ///         product can overflow. Under runtime bounds (`captured` tick-bounded ≤ ~1.77e6; caller keeps
    ///         `slope`,`quad` ≤ MAX_PIPS) both terms stay far under 2^256 anyway.
    /// @param capturedTicks              ticks of mispricing the ARB direction is closing (caller: 0 if benign)
    /// @param slopePipsPerTick           pips of LVR surcharge per captured tick (0 ⇒ lever off)
    /// @param quadMultiplierPipsPerTickSq convex term per captured tick² (0 ⇒ linear)
    /// @param capPips                    surcharge ceiling in pips (0 → MAX_PIPS)
    function lvrSurchargePips(
        uint256 capturedTicks,
        uint256 slopePipsPerTick,
        uint256 quadMultiplierPipsPerTickSq,
        uint24 capPips
    ) internal pure returns (uint24) {
        if (capturedTicks == 0 || (slopePipsPerTick == 0 && quadMultiplierPipsPerTickSq == 0)) return 0;
        uint256 cap = capPips == 0 ? MAX_PIPS : capPips;
        uint256 lin = slopePipsPerTick * capturedTicks;
        if (lin >= cap) return uint24(cap); // linear term alone saturates → no quad multiply, no overflow
        uint256 fee = lin + quadMultiplierPipsPerTickSq * capturedTicks * capturedTicks;
        if (fee > cap) fee = cap;
        return uint24(fee);
    }

    /// @notice Rate-limit a fee move: clamp `target` to within `maxStep` of `last` (Stage-1.2).
    /// @dev    Prevents a single-block jump from base fee to max fee, which is what lets an MEV
    ///         searcher cleanly front-run a predictable hike / back-run a predictable drop. The
    ///         caller passes `maxStep = maxFeeStepPerBlock × blocksElapsed` so the budget scales
    ///         with elapsed time. `last == 0` (uninitialized) adopts `target` directly.
    function rateLimit(uint24 last, uint24 target, uint256 maxStep) internal pure returns (uint24) {
        if (last == 0) return target;
        if (target > last) {
            uint256 up = uint256(last) + maxStep;
            return target > up ? uint24(up) : target;
        }
        uint256 down = uint256(last) > maxStep ? uint256(last) - maxStep : 0;
        return uint256(target) < down ? uint24(down) : target;
    }
}
