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

## Two patch attempts — validated and REJECTED

1. **Credit `juniorUsdcBuffer` in `seniorRealizableAssets`** (value legs at `min(deployed+jit, recoverable)`
   + junior separately). **No-op here** — proven by identical trace numbers. The binding term is *par*
   (`totalSeniorAssets`), not realizable; lifting realizable does nothing when `min(par,·)` picks par≈0.
2. **Have `_recoverFromLP` un-earmark junior to cushion the par write-down.** Preserves par (8.70) and
   invariants stay green — **but the tail redeemer then REVERTS `InsufficientIdleLiquidity()`**: the freed
   junior is on the shared free buffer, so EARLIER redeemers consume it, leaving the tail a par *claim*
   with no physical USDC. Trades an under-pay for a revert — strictly worse.

Both were reverted; `contracts-v4/src` is unchanged from `main`.

## Why it needs a redesign (the recommendation)

The problem is **ordering**: a finite first-loss buffer consumed first-come-first-served cannot, by
construction, be shared pro-rata across sequential redeemers once the loss exceeds it. A correct fix is a
**loss-socialization / redemption-gate** mechanism — e.g. snapshot a fixed haircut ratio at the onset of
impairment and price every redeemer against it, or gate redemptions during impairment and settle the
haircut collectively. That is a deliberate design change with its own risk surface (an over-valuation flips
the safe direction to insolvency) and belongs in the **external-audit cycle**, not a same-session patch.

**Interim:** SAFE — no over-extraction or insolvency. The tail senior bears a disproportionate share of a
severe, junior-exhausting loss; documented, characterized by test, and flagged for audit.
