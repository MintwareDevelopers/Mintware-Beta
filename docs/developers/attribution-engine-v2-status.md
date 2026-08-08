# Attribution Engine v2 — Status & What's Live

Plain-language companion to the full methodology in
[`attribution-engine-v2-spec.md`](attribution-engine-v2-spec.md). This page answers one question:
**what actually exists and works right now.**

_Last updated: 2026-08-08._

---

## The one-paragraph version

We re-engineered the Attribution reputation score from scratch as a real, tested, in-repo engine
(`lib/attribution/`). It fixes the legacy score's core flaw — referrals were 43% of the total, so a
farmer could out-score a genuine LP — by rebalancing to reward what's expensive to fake (liquidity,
holding, tenure) and deducting for risk (sanctions, sybil). It runs live at
`GET /api/attribution/score-v2`, powered by three real data sources, two of which need no API key.
It is **not yet the score the app displays** — that's a deliberate, separate cutover step.

## There are two attribution scores right now

| | Legacy score (live in the app today) | Engine v2 (new) |
|---|---|---|
| Where | External Cloudflare worker | In-repo `lib/attribution/` |
| Endpoint | the old `/score` the app calls | `GET /api/attribution/score-v2` |
| Status | unchanged, still powers the app | built + deployed, **not yet wired into the app** |

v2 is **additive** — it did not touch or replace the legacy score. The app keeps working exactly as
before until we choose to cut over.

## What v2 measures

Eight signals, log-normalized (whale-resistant), summing to the same **925** max, minus a risk
deduction:

| Signal | Weight | |
|---|--:|---|
| Liquidity | 200 | LP depth × duration |
| Holding | 150 | conviction — value kept, weighted by how long |
| Activity | 150 | consistency + breadth |
| Longevity | 150 | wallet age + tenure + recency |
| Volume | 100 | lifetime traded value (log-scaled) |
| Network | 100 | referral-tree **quality** (was 400) |
| Governance | 75 | votes / proposals / delegations |
| **Risk** | **−200** | sanctions / mixer / scam / wash / sybil |

Every score also carries **reason codes** (`topDrivers`) and per-signal **insights** — a wallet
always sees why it scored what it did.

## What's live right now, and from where

The engine reads a provider-agnostic `WalletActivity`; a composite provider fills it from real
sources, each independent and each degrading gracefully:

| Signal group | Source | Needs a key? | Status |
|---|---|---|---|
| Holding · Activity · Longevity · Volume · current Liquidity | **Zerion API** | Yes (free tier) | ✅ built; lights up when `ZERION_API_KEY` is set |
| **Network** + referral-farm sybil | **our own Supabase** referral data | No | ✅ live |
| **Risk** (sanctions) | **Chainalysis on-chain oracle** (OFAC/EU/UN) | No (free) | ✅ live |

Without the Zerion key, a real wallet still gets a live **Network** and **Risk** result; the on-chain
behavioral signals return empty until the key is present (the provider falls back to safe mock data,
and the response says `"source": "mock"` vs `"zerion"`).

## Calibration (percentiles)

The machinery for **true population percentiles** is built (`calibration.ts`: frozen-ECDF lookup +
PSI drift monitoring). It ships **no distribution**, so every result is marked
`"percentileBasis": "estimate"` until a real backfill artifact is produced — an estimate is never
presented as a real population percentile. Producing that artifact (scoring a large, stratified
wallet sample) is an operational step, not a code change.

## How to call it

```
GET /api/attribution/score-v2?address=0x…
```

Returns `score`, `tier`, `percentile` (+ `percentileBasis`), the full `signals[]` breakdown,
`topDrivers[]` reason codes, `risk`, and `source` (`zerion` | `mock`).

## What's done vs. what's left

**Done (code):** the engine, the graded sybil scorer, reason codes, the monotonicity invariant, the
Zerion / referral / sanctions adapters, the calibration machinery, the published methodology, and 49
passing tests.

**Left (not code — decisions / ops):**
1. **Set `ZERION_API_KEY`** in the runtime (env var) → turns on the behavioral signals.
2. **Population backfill** → real percentiles instead of the estimate curve.
3. **Optional paid risk vendor** (TRM / Elliptic / Nansen) → graded risk beyond sanctions.
4. **Cutover** → point the app's score at `/api/attribution/score-v2` instead of the legacy worker
   (a small, contained change, done when you're ready — the app is unaffected until then).

## Where the detail lives

Full methodology, competitive benchmark, data-stack, and roadmap:
[`attribution-engine-v2-spec.md`](attribution-engine-v2-spec.md).
