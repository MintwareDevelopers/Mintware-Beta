# Redemption Tail-Redeemer Residual — Diagnosis + FIX (2026-08-24 → RESOLVED 2026-08-25)

> ## ✅ RESOLVED (2026-08-25) — redemption gate (proportional draw)
> The residual is **fixed** in `MintwareTreasuryVault`. Root cause: pricing (`_redeemNav`) and the physical
> draw (`_pullUSDC`) disagreed — the NAV counted junior first-loss, but `_pullUSDC` handed it out
> first-come-first-served, so the tail's dollars were already gone. The fix makes the **physical draw
> proportional**: each redeemer draws at most their **fair share `f` of senior-own** assets (Aave idle +
> on-hand + LP recoverable — so the fungible pool is shared, not raced), then junior first-loss absorbs the
> **actual residual** capped at their **pro-rata share `f × juniorUsdcBuffer`** (so a lone senior is made
> whole, but a finite buffer is shared across many). Settlement is **fail-soft** (pay what's physically
> realizable rather than reverting — the "never below par" guarantee is already void under a haircut; the
> card/team paths stay strict). A non-collapsing par floor (`max(seniorParLiability, totalSeniorAssets())`)
> keeps senior **yield** while stopping the tail collapse.
>
> **Proven:** the pro-rata fuzz guard (`MintwareTreasuryRedemptionOrder.t.sol`, now the fair-floor property,
> un-skipped) passes **5000+ runs** — no redeemer is shortchanged below the fair floor in any order; the
> yield tripwire passes; PROBE2 flipped to confirm the tail is paid pro-rata; `junior_absorbs` still makes a
> lone senior whole; **all 270 payments tests + the 256×128k solvency invariants green.** The residual
> below is the historical diagnosis (six earlier attempts, each caught by the guard) that led to this fix.

---

**Self-review, testnet + unaudited.** The section below documents the **Low, safe-direction** residual as it
was found by the autonomous exploit red-team and **confirmed by executed trace**, and the six patch attempts
that led to the redemption-gate fix above. Regression tests:
`MintwareTreasuryNavResiduals.t.sol` (probes), `MintwareTreasuryRedemptionOrder.t.sol` (fuzz guard),
`MintwareTreasurySeniorYield.t.sol` (yield tripwire).

## Summary

Under **severe impairment** — an LP loss exceeding the **total** junior first-loss capacity — the senior
redemption waterfall is effectively **first-come-first-served** on the depleting junior buffer. The
**last/tail redeemer is shortchanged** (executed: carol ~0.09/share vs early alice ~0.89/share) while
junior first-loss sits partly unspent and senior par (`totalSeniorAssets`) collapses toward 0.

- **Direction: SAFE.** The tail senior is **under**-paid, never over-paid; total payout ≤ vault assets;
  all solvency invariants stay green (256×128k). It is **not** the pro-rata the NatSpec promises.
- **Trigger:** only when the loss exceeds *total* junior capacity (a severe tail event). In moderate
  impairment (junior covers the whole loss), every senior redeems pro-rata — PROBE1 proves this even with
  an appreciated LP + a stranded JIT slice.

## Executed trace (the mechanism)

Harness: `MintwareTreasuryJitStack` (real V4 pool). Seniors: alice 40k, user 10k, carol 10 (dust tail).
Deploy 8k senior to LP; dump 500M TEAM (crashes `recoverableUSDC` 10,017 → 159). Redeem alice → user → carol.

Immediately before carol redeems:
```
totalSeniorAssets (par)   : 8,695,739   (≈ 8.70 USDC)  ← already collapsed
seniorRealizableAssets    : 8,695,739
deployedFromSenior        : 0            ← written down by _recoverFromLP
recoverableUSDC           : 0
juniorUsdcBuffer          : ~7.79 USDC   ← unspent
carol shares              : 10.0
→ carol per-share 0.0909 (vs alice/user 0.8932)
```
`_redeemNav = min(par, realizable)`. The **par term** is the binding one: `totalSeniorAssets =
adapter + freeSeniorBuffer + deployedFromSenior + jitBorrowed` (senior's OWN assets, **excluding** junior).
By the tail, alice+user have drained the senior principal to ~0 and `_recoverFromLP` has written
`deployedFromSenior` down to `recoverableUSDC()` — so par ≈ 0, and `min(par≈0, real) ⇒ ~0` for carol, even
though ~7.79 of junior first-loss remains. Root: **`_recoverFromLP` (MintwareTreasuryVault.sol ~L1037-1041)
floors the senior write-down at `recoverableUSDC()` ALONE**; `_pullUSDC` draws junior only for a *physical*
shortfall, never to cushion the *par* write-down, so junior is stranded for the last redeemer.

## Validation infrastructure now in place (closing the blind spot)

Two test assets make this fixable-and-verifiable rather than a leap of faith:
- **`MintwareTreasurySeniorYield.t.sol` — a yield tripwire (PASSES on `main`).** The mock adapter reports
  `totalAssets = balanceOf`, so minting USDC into it simulates Aave interest. These tests prove a senior
  redemption returns *par + yield*, so any fix that strips yield (e.g. a deposits-only claim) now fails
  LOUDLY instead of passing green against a yield-less mock.
- **`MintwareTreasuryRedemptionOrder.t.sol` — the pro-rata fuzz guard (`vm.skip(true)`).** Fuzzes holder
  sizes, impairment depth, AND redemption order; asserts equal per-share payout (a revert = maximal
  shortchange). It **cleanly catches the class** (`max−min per-share ≈ 0.95` vs 2% tolerance) and, in
  testing the fix attempts below, caught *every* incomplete patch — the existing solvency invariants do
  not model sequential-redemption order-dependence; this does. Un-skip it when the redesign lands.

## Six patch attempts — validated and REJECTED

1. **Credit `juniorUsdcBuffer` in `seniorRealizableAssets`** (value legs at `min(deployed+jit, recoverable)`
   + junior separately). **No-op here** — proven by identical trace numbers. The binding term is *par*
   (`totalSeniorAssets`), not realizable; lifting realizable does nothing when `min(par,·)` picks par≈0.
2. **Have `_recoverFromLP` un-earmark junior to cushion the par write-down.** Preserves par (8.70) and
   invariants stay green — **but the tail redeemer then REVERTS `InsufficientIdleLiquidity()`**: the freed
   junior is on the shared free buffer, so EARLIER redeemers consume it, leaving the tail a par *claim*
   with no physical USDC. Trades an under-pay for a revert — strictly worse.
3. **Track a `seniorParLiability` (claim = deposits − pro-rata redemptions) and cap `_redeemNav` at it**
   instead of the collapsing `totalSeniorAssets`, + count junior in realizable. This *does* fix the
   pro-rata bug — but it **strips the senior's YIELD**: `totalSeniorAssets` includes `adapter.totalAssets()`
   (Aave yield on idle senior USDC), so redemptions currently return *par + yield*; a deposits-only claim
   caps at par. **The test suite cannot catch this** (the mock adapter has no yield), so the change would
   pass CI while silently regressing production. A correct claim must track deposits **+ accrued yield** (a
   yield-accrual index) — materially more than a patch.
4. **Yield-preserving par floor: `_redeemNav = min(max(seniorParLiability, totalSeniorAssets()), realizable)`.**
   Elegant on paper — `totalSeniorAssets` (yield-inclusive) governs normal ops so yield is kept, the
   deposit floor stops the tail collapse. The **yield tripwire passes**. But the tail redeemer then
   **REVERTS**: with the floor, the tail NAV correctly rises to `realizable`, but the share-math **virtual
   offset overshoots `realizable`** on the last full redemption of a tiny pool (`+VIRTUAL` in the
   numerator), so `_pullUSDC` can't source the payout.
5. **Add a clamp `assetsOut = min(assetsOut, seniorRealizableAssets())`** to kill the overshoot. Fixes the
   specific PROBE2 case — but the **fresh-fuzzed guard immediately finds another** severe-impairment config
   where a holder is still shortchanged (`max−min ≈ 0.95`). Each path fixed, the fuzzer finds the next.

All were reverted; `contracts-v4/src` is unchanged from `main`. The pattern across six attempts is
conclusive: **NAV pricing alone cannot fix this** — early redeemers *physically* consume the shared pool
(idle senior, LP proceeds, junior first-loss) at their computed NAV, so no matter how the tail is priced,
the physical USDC is not there for it. The fix must change the **physical draw** (reserve each holder's
pro-rata share, or socialize the loss before any redemption) — coordinated with the NAV, the virtual
offset, and the 60/30/10 fee-reserve buckets. That is a redemption-gate REDESIGN.

## Why it needs a redesign (the recommendation)

The problem is **ordering**: a finite first-loss buffer consumed first-come-first-served cannot, by
construction, be shared pro-rata across sequential redeemers once the loss exceeds it — and the natural
fixes each hit a wall (no-op / revert / yield-strip, above). A correct fix is a **loss-socialization /
redemption-gate** mechanism with a **yield-accruing senior par-claim**: e.g. track the senior claim as
`deposits + accrued yield` via an index, cap redemption at `min(claim, physical-incl-junior)`, and draw
proportionally; or gate redemptions during impairment and settle the haircut collectively. That is a
deliberate design change with its own risk surface (an over-valuation flips the safe direction to
insolvency; a yield-accrual bug misprices every redemption) and belongs in the **external-audit cycle**.

## Ready-made guard for the fix

`contracts-v4/test/payments/MintwareTreasuryRedemptionOrder.t.sol` fuzzes holder sizes, impairment depth,
**and redemption order**, asserting equal per-share payout (a revert counts as a maximal shortchange). It
**cleanly catches this class** — confirmed `max−min per-share ≈ 0.95` vs a 2% tolerance on current `main`.
It is committed `vm.skip(true)`; **un-skip it when implementing the redesign** so the fix is fuzzed at
128k-call scale against exactly this property. This is the safety net the two invariant-passing patch
attempts (2 and 3) slipped past — the existing solvency invariants don't model sequential-redemption
order-dependence, and this one does.

**Interim:** SAFE — no over-extraction or insolvency. The tail senior bears a disproportionate share of a
severe, junior-exhausting loss; documented, characterized by test, and flagged for audit.
