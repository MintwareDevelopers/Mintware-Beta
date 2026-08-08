# Attribution Engine v2 — Signal Spec & Methodology

> **Status:** v2.0 engine built and tested in-repo (`lib/attribution/`, 14/14 golden-wallet
> tests green). Runs on a mock data provider today; live data adapter + population calibration
> are v2.1. This document is the **published methodology** — the thing partners audit and the
> score explains itself against.
>
> **Author:** Attribution team · **Engine version:** `attribution-v2.0.0`

---

## 1. Why v2 — what the legacy score got wrong

The legacy `/score` worker summed six signals to a max of 925:

| Signal | Legacy max | % of total |
|---|---|---|
| Sharing (referrals) | **400** | **43%** |
| Liquidity | 150 | 16% |
| Volume | 100 | 11% |
| Holding | 100 | 11% |
| Governance | 100 | 11% |
| Trading | 75 | 8% |

Four structural defects made it an **activity tally, not a reputation score**:

1. **Sharing = 43% of the score.** A referral farmer with a big low-quality tree could
   out-score a four-year liquidity provider. For a score whose entire pitch is "reward the
   people who actually build the ecosystem," this is indefensible.
2. **~70% of the weight sits in rare behaviors** (Liquidity + Governance + Sharing = 650), so
   the population is bimodal: a huge mass at near-zero and a thin tail. The score doesn't
   discriminate among the 90% of normal wallets.
3. **All-additive, no penalties.** Nothing is ever deducted — a sanctioned, wash-trading, or
   sybil wallet accrues points like anyone else. A reputation score with no downside isn't one.
4. **Opaque, un-normalized.** Normalization was unknown (likely linear), which favors whales
   (10× the volume ≈ 10× the points), and the `insights[]` arrays were always empty, so the
   score could never say *why*.

## 2. Design principles (v2)

- **Contribution over activity.** Weight the behaviors that build an ecosystem (committed
  liquidity, conviction holding, tenure) above the behaviors that merely touch it.
- **Whale-resistant.** Every signal is normalized through a **saturating log curve** — more is
  better, but with diminishing returns, so sophistication beats raw size.
- **A real downside.** A **Risk deduction** (up to −200) turns the tally into a reputation:
  sanctioned / mixer / scam / wash-trading / sybil exposure pulls the score down.
- **Sybil-resistant by construction.** The heaviest weights (Liquidity, Holding, Longevity)
  cost real capital and real time to fake; the cheap-to-farm signal (Network) is capped low and
  quality-weighted.
- **Explainable.** Every signal emits `insights` (reason codes). No black boxes.
- **Deterministic & auditable.** Pure functions, a fixed `nowMs` input, snapshot-tested against
  golden wallets. Same input → same score, forever.
- **Provider-agnostic.** Scoring logic is decoupled from the data source behind one interface.

## 3. The signal model

Positive signals sum to the **925** cap (preserving the legacy max, so the API contract and all
downstream reward math are unaffected). Risk is a separate deduction.

| Signal | Weight | Measures | Primary inputs |
|---|---:|---|---|
| **Liquidity** | 200 | Committed LP depth × duration | LP positions: depth, duration, active |
| **Holding** | 150 | Conviction — value kept, weighted by how long | Token positions: usd value, hold days |
| **Activity** | 150 | Consistency + breadth (not bursts) | active weeks, chains, tx count |
| **Longevity** | 150 | Wallet age + tenure + recency | first-seen, last-seen, active weeks |
| **Volume** | 100 | Lifetime traded value (log-scaled) | lifetime volume USD |
| **Network** | 100 | Referral-tree **quality**, not count | referees' own scores, retention |
| **Governance** | 75 | Votes, proposals, delegations | gov counts |
| **Risk** | −200 | Sanctions / mixer / scam / wash / sybil exposure | risk flags (type, severity) |

Headline rebalance: **Sharing 400 → Network 100** (−75%), **Liquidity 150 → 200**, new
**Longevity 150** and **Risk −200**. The score now rewards what's expensive to fake and
punishes what's cheap to farm.

### 3.1 Signal formulas

All raw sub-values are pushed through `logCurve(v, mid) = 1 − 2^(−v/mid)` (0 at 0, ~0.5 at
`mid`, →1 as v→∞) unless noted, then scaled by the weight. Constants are the calibration knobs.

- **Liquidity (200).** `depthDuration = Σ depthᵢ · min(durationᵢ/180, 1)`; score =
  `logCurve(depthDuration, 20_000) · 200`. Rewards deep, *sustained* liquidity; a one-block LP
  in-and-out barely registers.
- **Holding (150).** `conviction = Σ usdValueᵢ · min(holdDaysᵢ/180, 1)`; score =
  `logCurve(conviction, 15_000) · 150`. Value you *keep*, not value you flip.
- **Activity (150).** `0.45·logCurve(activeWeeks,26) + 0.30·linearCap(chains,6) +
  0.25·logCurve(txCount,200)`, ×150. Rewards showing up across weeks and chains, not a single
  farm-day burst.
- **Longevity (150).** `ageScore = logCurve(ageDays, 730)`; score =
  `ageScore · (0.6 + 0.4·(0.5·tenure + 0.5·recency)) · 150`, where `tenure =
  activeWeeks / (ageDays/7)` and `recency` decays with a 180-day half-life. **Age gates the
  rest multiplicatively** — a one-day wallet is trivially "100% active + just seen," so those
  only count once real age exists. This is the strongest anti-sybil signal.
- **Volume (100).** `logCurve(lifetimeVolumeUsd, 100_000) · 100`. Log-scaled so a $10M whale
  and a $100k trader aren't 100× apart.
- **Network (100).** `qualitySum = Σ referredScoreᵢ · (retainedᵢ ? 1 : 0.5)`; score =
  `logCurve(qualitySum, 1200) · 100`. Referring **one real high-score LP** beats referring 100
  dormant wallets. Count is irrelevant; quality and retention are everything.
- **Governance (75).** `logCurve(votes + 3·proposals + 2·delegations, 15) · 75`.
- **Risk (−200).** `penalty = min(200, Σ severityᵢ · weight(typeᵢ))`, weights: sanctioned 200,
  mixer 120, scam 100, sybil_cluster 100, wash_trading 80. Applied to the total after summing.

## 4. Normalization — why log

Linear scoring makes a score a wealth proxy (whales win). We use a **saturating exponential**
(`1 − 2^(−v/mid)`) for every magnitude signal:

- monotonic (more is always ≥, never <),
- diminishing returns (the 2nd $50k of liquidity is worth less than the 1st),
- bounded in [0,1) with no clamp discontinuity,
- one interpretable knob per signal (`mid` = the value that earns half the weight).

`mid` values are the v2.0 calibration. **v2.1 replaces the fixed curve with a true percentile
within the live scored population** (`percentileScore` in `normalize.ts` is the seam) — see §9.

## 5. Risk — turning a tally into a reputation

Risk is the philosophical core of v2: reputation must be able to go *down*. Flags carry a
`severity ∈ [0,1]` (a provider's confidence) and a type weight. The deduction caps at −200, so
a sanctioned wallet loses ~a full silver tier regardless of how much activity it farmed.

> Golden-wallet proof: the `0xBAD` fixture (real 500-day history, $300k volume, LP + holdings)
> scores **355 raw → 155 after risk** (would-be silver → bronze). The identical activity with the
> flags removed scores 355. Risk is doing exactly its job.

Risk flags come from two sources:

- **Labeled-address feeds** — sanctions / scam / mixer. The v2.1 data stack (§10) uses the
  **Chainalysis free Sanctions Oracle** (on-chain boolean, EVM, zero cost) as the sanctions
  hard-gate, with a paid graded provider (TRM / Elliptic) or Nansen labels for the rest.
- **Our own graded sybil scorer** (`lib/attribution/sybil.ts`, built + tested) — the
  research-backed upgrade from a boolean `sybil_cluster` flag to a **computed, feature-driven,
  auditable** severity. It mirrors Trusta's two-phase TrustScan: soft heuristics (shared-funder
  clustering, dormant-burst, batch-scripting, wash/round-trip, referral-farm shape) each add
  capped severity, and only a **graph-confirmed ring** (shared funder + behavioral similarity +
  temporal batching co-firing) reaches near-certain severity. Weak single signals land in a
  `needsReview` band instead of penalizing a possibly-real user. Every firing heuristic is
  returned as a reason for appeals. The feature extraction (funding graph, referral-tree entropy,
  action-sequence similarity) is the v2.1 data-layer dependency; the scorer itself is done.

## 6. Interpretability — reason codes

Two layers, both modeled on credit scoring's **adverse-action reason codes** (ECOA/FCRA "up to
four specific principal reasons"; CFPB Circular 2023-03 holds this applies to ML models too — no
black-box exemption):

- **Per-signal `insights[]`** — every signal returns human-readable reasons ("Depth × duration:
  $55.0k of committed, time-weighted liquidity"; "Long-term: 2 positions held over 90 days").
- **`topDrivers[]`** — the ≤4 key factors moving the score, each tagged `strength` or `weakness`,
  risk (the material adverse factor) first, then the biggest opportunities, then the top strength.
  A wallet always sees both what's holding it back and what it's earned. In v2.1, non-linear
  components attribute via SHAP; today's linear-weighted engine attributes exactly (weight ×
  normalized signal).

## 7. Scoring pipeline

```
getWalletActivity(address)      # data layer → provider-agnostic WalletActivity
        ↓
computeScore(activity, nowMs)   # pure, deterministic
        ↓  liquidity ─┐
           holding ───┤
           activity ──┤
           longevity ─┼─ Σ (cap 925) = rawScore
           volume ────┤
           network ───┤
           governance ┘
           risk ─────── penalty (≤200)
        ↓
   score = clamp(rawScore − penalty, 0, 925)
   tier  = gold ≥617 · silver ≥308 · bronze
   percentile, signals[+risk], insights
```

## 8. Golden wallets (the test contract)

`lib/attribution/score.test.ts` locks the thesis with five archetypes (all at a fixed `NOW_MS`):

| Wallet | Profile | v2 score | Tier | Pctile | What it proves |
|---|---|---:|---|---:|---|
| `0xLP` | 4-yr LP, deep positions, real holdings | **743** | gold | 86 | genuine contributors top the board |
| `0xBAD` | real activity **+ sanctioned/mixer flags** | **155** | bronze | 29 | risk drops 355→155 (would-be silver→bronze) |
| `0xWHALE` | $8.5M volume, no conviction/history | **147** | bronze | 28 | volume alone ≠ reputation (Volume maxes at 100, total stays low) |
| `0xNEW` | minimal footprint | **14** | bronze | 5 | new ≈ unproven |
| `0xFARM` | 1-day, **140 referrals**, sybil flag | **0** | bronze | 0 | farming is worthless (raw 39 − risk 70 → 0) |

Exact v2.0 output at `NOW_MS`. LP signal breakdown: liquidity 170 · holding 144 · activity 134 ·
longevity 107 · volume 99 · governance 57 · network 32. The farmer's 140 referrals earn just
28 Network (low-quality, unretained) — then the sybil flag zeroes the wallet entirely.

The single most important assertion: **`0xLP.score − 0xFARM.score > 400`.** Under the legacy
weighting the farmer could win; under v2 it scores zero. That inversion is the whole point.

## 9. Roadmap — v2.0 → v2.1 → v2.2

- **v2.0 (done).** Deterministic engine, log normalization, risk deduction, graded sybil scorer,
  reason codes, mock provider, 26 golden-wallet + invariant tests, `GET /api/attribution/score-v2`.
- **v2.1 — live data + true percentiles + validation.**
  1. **Live data adapter (backbone started).** The **Zerion adapter is built + tested**
     (`lib/attribution/providers/zerion.ts`, pure mapper, 7 fixture tests) — it maps Zerion
     positions + transactions → Holding, Activity, Longevity, Volume, and current Liquidity, and
     goes live the moment `ZERION_API_KEY` is set (the composite `resolveWalletActivity` falls back
     to the golden-wallet mock until then, and on any provider error). The **referral-DB Network
     adapter is also built + tested** (`lib/attribution/providers/referrals.ts`) — it fills the
     Network signal from our own `referral_records` + `wallet_profiles` (no external key,
     retention-weighted) and doubles as the referral-farm sybil sensor (a 120-wallet pending farm
     scores <20 Network and takes a graded Risk deduction). Remaining backbone: Chainalysis/Nansen
     Risk, Helius (Solana), and self-indexed LP depth-over-time.
  2. **Scored-population backfill → true percentiles.** Sample **≥200k–500k wallets**, stratified
     by chain, activity-recency, and birth cohort — *including dormant/dead wallets* (active-only
     sampling is survivorship bias that inflates every percentile). Compute all 8 signals; freeze
     an **empirical CDF per signal + a composite CDF** tagged to the model version. Percentile
     lookups read the frozen artifact, not live data (so a wallet's score never moves because
     *other* people acted). Replace `percentileFor`'s calibrated curve with `percentileScore`.
  3. Set **tier cutoffs on percentiles, not raw scores**, with hysteresis/dead-zones so wallets
     don't flicker across a boundary.
  4. Wire real risk feeds (Chainalysis oracle + graded provider) and the sybil feature extraction
     (funding graph, referral-tree entropy, action-sequence similarity) that feeds `sybil.ts`.
  5. **Drift monitoring.** Recompute distributions on a schedule; **PSI vs the frozen CDF** per
     signal (PSI < 0.1 stable, 0.1–0.25 watch, > 0.25 → recalibrate as a new MINOR version).
- **v2.2 — validation + cutover.**
  1. **Prove it predicts something real.** Pick one forward outcome — **90-day non-sybil
     retention** (primary) and **future non-liquidation** (secondary, most FICO-analogous). Score
     at *t₀*, evaluate over (*t₀*, *t₀+90d*) on a **time-forward holdout** (never a random split).
     Report **AUC/Gini, KS, decile lift**, and a monotonic calibration curve. Target KS ≥ 0.30,
     Gini ≥ 0.40 to claim it's meaningfully predictive — and say so honestly if it isn't yet.
  2. **Goodhart holdout.** Keep a population that never receives score-gated rewards; each version,
     re-measure signal→outcome on it. Divergence from the incentivized population = the score is
     being gamed and must be revised.
  3. **Cutover.** A thin adapter maps v2 `ScoreResult` → legacy `/score` fields
     (`character`, `timeline`, `projects`, `uvOpportunities`); flip the app off the external
     worker onto the in-repo engine. The `/score` contract is preserved throughout, so nothing
     downstream breaks during the swap. Run the new engine in **shadow mode** first (compute
     alongside, compare distributions) before promoting — the FICO/FHFA validation-before-rollout
     pattern.

## 10. Competitive benchmark & industry upgrades

Synthesized from a deep-research pass on how the leading scores are actually computed. The
strongest validation of v2: **every leading score already does what v2's core does** — sigmoid/log
normalization (never linear), money is never the top weight, and sybil resistance is
graph-topology + cost-of-forgery (not a black-box number).

### 10.1 How the leaders compute

| Score | Range | Normalization | Sybil / anti-game | Published? |
|---|---|---|---|---|
| **Spectral MACRO** | 350–850 (FICO mirror) | ML (GBM), 100+ features, 7 groups | longitudinal, liquidation history | partial |
| **Cred Protocol** | 300–1000 | tree classifier, **time-series of health factors** | liquidation=default proxy; weights withheld | **arXiv paper** |
| **ARCx** | 0–999 | rules; **Gaussian "sweet-spot" curve** (penalizes extremes) | 120-day accrual, penalty roll-off | **yes (rules)** |
| **Gitcoin/Human Passport** | 0–100 | additive stamp weights + ML model (0–100) | **cost-of-forgery weights + credential dedup** | **yes (weights public)** |
| **Trusta MEDIA + Sybil** | 0–100 each | **per-variable sigmoid → weighted subscores** (M/E/D/I/A) | **Asset-Transfer-Graph: Louvain+K-Core, 4 fingerprints, K-means refine** | **yes** |
| **Nansen Smart Money** | labels | realized-PnL, rolling window, top-N | consistency + rotating membership | no (proprietary) |
| **DeBank** | ranked | balances | **$1,000 balance floors** kill dust farming | partial |

Notable: Trusta puts **Engagement (30) > Monetary (25)** — behavior beats money — exactly v2's
Liquidity/Holding/Longevity (500) ≫ Volume (100) posture.

### 10.2 Adopted in v2.0

- **Log/sigmoid normalization over linear** — every signal (whale-resistant). ✅
- **Money is never the top weight** — Liquidity (contribution) 200 > Volume 100; Network capped 100. ✅
- **Graph-topology sybil detection** (Trusta ATG) — `sybil.ts`: shared-funder clustering,
  four farm fingerprints, behavioral-similarity confirmation, graded severity. ✅
- **Reason codes** (FICO/FCRA ≤4 key factors) — `topDrivers[]`. ✅
- **Monotonicity invariant** — CI-enforced test: more good behavior never lowers the score. ✅
- **Recency decay / rolling window** (ARCx-style) — Longevity's recency half-life. ✅

### 10.3 Adopted in v2.1 / v2.2

- **True percentiles via frozen ECDF + PSI drift** (FICO discipline) — §9 v2.1.
- **Cost-of-forgery credential weighting + dedup** (Gitcoin) — weight a referee by identity
  credibility; one credential binds to one profile → defeats the "1000 empty wallets" attack.
- **Balance-floor on Network** (DeBank) — a referee only counts toward Network if it clears an
  economic floor. (v2.0 already quality-weights by `referredScore`, which soft-floors dust.)
- **EAS trust attestations** as a small Identity contribution (Cred's "Trust" group) — we already
  mint EAS.
- **Gas-spent + protocol-category diversity** (Rubyscore/Trusta) — sybil-resistant Activity
  sub-features (category breadth > raw contract count).
- **Realized-PnL "Performance" sub-feature** (Nansen) — skill, not just size; heaviest data lift, deferred.

### 10.4 Data stack (the v2.1 dependency)

No single vendor serves every signal; **balances/positions/tx/risk are buyable, but Volume,
Governance, and historical LP-depth must be indexed ourselves.**

| Role | Pick | Feeds | Notes |
|---|---|---|---|
| Positions / balances / tx (EVM + Solana) | **Zerion API** | Holding, Activity, Longevity, Liquidity (current) | best EVM+Solana parity, 8,000+ protocols |
| Labels / smart-money / graph | **Nansen API** | Network, soft Risk | counterparties, related-wallets, 500M+ labels |
| Sanctions floor | **Chainalysis Sanctions Oracle** | Risk | on-chain boolean, EVM, **free**; Base uses a distinct contract |
| Graded risk (paid) | **TRM** or **Elliptic** | Risk | Elliptic = best cross-chain bridge tracing |
| Solana primary | **Helius** (DAS + Enhanced Tx) | Solana Holding/Activity/Longevity/Volume | Solana-native parsed history |
| **LP depth-over-time** (the hard gap) | **The Graph** (forked Uniswap subgraph / Substreams) | Liquidity (time-series) | **no vendor sells this — index it** |
| DEX volume | **Dune `dex.trades`** or **Bitquery** | Volume | cheap turnkey cross-DEX volume |
| Governance | **Snapshot API + Governor subgraphs** | Governance | no wallet-API vendor has votes |

⚠️ **Do not architect on Dune Sim** — it is being sunset (new signups off May 2026, shutdown
Aug 2026). Its successors are Zerion / Codex / Mobula.

## 11. Model card — limitations, bias, versioning

Following the Model Cards framework (Mitchell et al. 2019):

- **Intended use.** A reputation signal for routing rewards / fee-share / access — *not* a credit
  score, and not personalized financial advice. ECOA/FCRA don't bind us; we adopt their
  explainability + validation bar as a quality standard, not a compliance obligation.
- **Weights are population-average**, not universal (myFICO makes the same caveat) — a single
  scorecard in v2.0; segment-specific weighting is a possible v3 evolution.
- **Who this disadvantages (the on-chain fair-lending analogue).** New wallets and new-chain users
  score low by construction (Longevity, tenure). This is intended (unproven ≈ low) but must be
  disclosed: the score entrenches incumbency and under-serves privacy-preserving users who split
  activity across addresses. The uniqueness/credential path (10.3) is additive and **capped** so
  its *absence* never punishes.
- **Versioning.** Semantic: MAJOR = signal set / weight change (breaks comparability), MINOR =
  recalibration / ECDF refresh, PATCH = bug fix. The model card + frozen CDF + weights are pinned
  per version; a new version ships in shadow mode and is promoted only on measured lift.
- **Goodhart.** Once the score gates value, wallets optimize signals, not reputation. Defenses:
  multiple orthogonal signals (no single cheap one dominates), cost-to-game asymmetry (favor
  slow/expensive signals — Longevity, locked Liquidity), the sybil layer, and the non-incentivized
  holdout that detects drift.

## 12. The API contract (preserved)

The new engine's `ScoreResult` is a superset of what the app consumes (`score`, `tier`,
`percentile`, `signals[]`). The legacy UI-only fields (`character`, `timeline`, `projects`,
`uvOpportunities`) are produced by a thin compat adapter at cutover (v2.2). Import the API base
from `lib/web2/api.ts` — never hardcode. Nothing downstream of `/score` changes shape.
