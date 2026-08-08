# What Attribution Is — Current State

The plain-language definition of the Attribution score as it exists **today**. For the full
methodology (formulas, competitive benchmark, calibration plan) see
[`attribution-engine-v2-spec.md`](attribution-engine-v2-spec.md).

_Status: Attribution Engine v2 is **live in production**. Last updated: 2026-08-08._

---

## In one sentence

Attribution is Mintware's **on-chain reputation score** — a single **0–925** number that measures how
much a wallet has genuinely contributed to and participated in on-chain ecosystems, built to reward
what's expensive to fake and penalize what's cheap to farm.

## In one paragraph

Attribution v2 scores a wallet from **eight weighted, log-normalized signals** minus a **risk
deduction**, and returns the number with plain-language **reason codes** (why it scored what it did).
It runs live at `GET /api/attribution/score-v2`, pulling **real data** from three sources: Zerion
(on-chain behavior), our own referral system (network), and the Chainalysis on-chain oracle
(sanctions risk). It replaces a legacy score whose core flaw was that referrals were 43% of the
total — so a referral farmer could out-score a genuine liquidity provider. v2 makes that impossible.

## The score: eight signals + a risk deduction

Log-normalized (whale-resistant), summing to a **925** max:

| Signal | Weight | What it rewards |
|---|--:|---|
| Liquidity | 200 | Committed LP depth × how long it's provided |
| Holding | 150 | Conviction — value kept, weighted by how long held |
| Activity | 150 | Consistency + breadth across weeks and chains |
| Longevity | 150 | Wallet age + tenure + recency |
| Volume | 100 | Lifetime traded value (log-scaled, not whale size) |
| Network | 100 | Referral-tree **quality** (was 400 in the legacy score) |
| Governance | 75 | Votes, proposals, delegations |
| **Risk** | **−200** | Sanctions / mixer / scam / wash-trading / sybil exposure |

Every result also includes a **tier** (bronze / silver / gold), a **percentile**, per-signal
**insights**, and **top drivers** (the few factors most moving the score, like a credit report's
reason codes).

## What powers it (all live)

The engine reads a provider-agnostic wallet profile; a composite provider fills it from real
sources, each independent and each degrading gracefully if one is unavailable:

| Signals | Source | Live? |
|---|---|---|
| Holding · Activity · Longevity · Volume · Liquidity | **Zerion API** (on-chain behavior) | ✅ live |
| **Network** + referral-farm detection | **our own Supabase** referral data | ✅ live (no external key) |
| **Risk** (sanctions) | **Chainalysis on-chain oracle** (OFAC/EU/UN) | ✅ live (free) |

The response includes `"source": "zerion" \| "mock"` so it's always clear whether a score came from
live data or the safe fallback.

## What's live vs. what still uses the legacy score

- **The v2 engine is live and callable** at `/api/attribution/score-v2`, returning real scores.
- **The score currently shown in the Mintware app UI still comes from the older external scorer.**
  Pointing the app at v2 (the "cutover") is a deliberate, separate step we have **not** taken yet —
  so the app is completely unaffected by everything above until we choose to switch it.

This is intentional: v2 was built **additively** so it could be proven in production without any risk
to the running app.

## Honest limitations (today)

These are known and tracked — the engine is correct; these are data-coverage and calibration gaps:

1. **Percentiles are estimates, not population percentiles.** Every result is marked
   `"percentileBasis": "estimate"` — a calibrated curve, not a rank against a real scored
   population. The machinery for true percentiles is built; producing the population sample
   (a backfill) is an operational step not yet run.
2. **Volume can read low; the largest wallets degrade.** Wallet age (Longevity) is read from
   Zerion's portfolio chart and **resolves correctly for normal wallets** (verified: a real wallet
   scored 5.7 years / Longevity 104). Two residuals: lifetime **Volume** is summed from a single
   transaction page, so it understates heavy traders; and for *pathologically large* wallets
   (millions of txs) Zerion's chart endpoint returns a 500, so their age falls back to the shallow
   value — the score still computes, just with a low Longevity. Deeper volume history is a small
   future refinement.
3. **Graded risk beyond sanctions** (mixer / scam scoring) requires a paid compliance vendor
   (TRM / Elliptic / Nansen) and is **not** enabled. The free sanctions hard-gate is.

## What's left

The engine, three live data sources, the methodology, and the calibration machinery are **done and
in production**. What remains is either operational or a deliberate decision — none of it blocks the
engine from working today:

| # | Item | Type | Notes |
|---|---|---|---|
| 1 | **Volume depth** | small code | sum more than one tx page so heavy traders aren't understated |
| 2 | **Population backfill** | operational | score a large stratified wallet sample → flip percentiles from `estimate` to real `population` |
| 3 | **App cutover** | staged migration | point the app UI at v2; needs a compat layer for old-worker-only fields (`timeline`, `character`, earnings range) and must not fabricate them |
| 4 | **Reward + EAS cutover** | gated on #2 | move payout math and on-chain attestations to v2 **only after** calibration |
| 5 | **Graded risk vendor** | optional / paid | TRM / Elliptic / Nansen for mixer/scam beyond the free sanctions gate |

Nothing here is required for the score to be live and real — it already is. These are the steps from
"live and proven" to "the number the whole app runs on."

## How to read a score

```
GET /api/attribution/score-v2?address=0x…
```

Returns `score` (0–925), `tier`, `percentile` (+ `percentileBasis`), the full `signals[]` breakdown,
`topDrivers[]` reason codes, `risk`, and `source`.

## The full methodology

Formulas, the competitive benchmark against the leading on-chain scores, the data-provider stack,
and the calibration/validation roadmap all live in
[`attribution-engine-v2-spec.md`](attribution-engine-v2-spec.md).
