# Redemption Tail-Redeemer Residual — Diagnosis for Audit (2026-08-24)

**Self-review, testnet + unaudited.** This documents a **Low, safe-direction** residual found by the
autonomous exploit red-team and **confirmed by executed trace** — deliberately left UNFIXED because the
correct remediation is a redemption-model redesign, not a patch (two patch attempts were validated and
rejected; see below). Regression/characterization tests:
`contracts-v4/test/payments/MintwareTreasuryNavResiduals.t.sol`.

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

## Three patch attempts — validated and REJECTED

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

All three were reverted; `contracts-v4/src` is unchanged from `main`.

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
