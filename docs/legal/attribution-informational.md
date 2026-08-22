# Attribution scores are purely informational

**Status:** confirmation of current + planned product behavior, grounded in the code as of this
branch. **Not** legal advice; nothing here is an offer.

## The confirmation

Mintware's **Attribution score** is a reputation signal derived from public, on-chain activity. In
the current product, and as planned, an Attribution score **does not feed any access, credit, or
spend-limit decision.** It does not gate who may spend, how much they may spend, whether a card
swipe or x402 call authorizes, or whether an on-chain settlement executes. It is **informational**:
a display + fairness signal, plus one carve-out (rewards distribution weighting) described below,
which is not access, credit, or a spend limit.

Spend, authorization, and settlement decisions are made **only** on:

- **Treasury NAV** (net asset value of the vault backing the balance),
- a **role / daily spend cap** (org card path), and
- a **statistical VaR haircut** (a volatility-based collateral discount) — a z-score, *not* a
  reputation score.

## Where this is enforced in the code

### 1. The x402 / card **spend + authorize** path references no Attribution

- **`lib/org/cardAuthorize.ts`** (`decideCardSwipe`) — the card-swipe authorize decision — imports
  only the edge-auth NAV-hold authorizer (`httpEdgeAuthorizer`) and the role/daily-cap helpers
  (`policyForRole`, `withinDailyCap`). It contains **no** `attribution` / `score` reference.
- **`lib/org/settleSwipe.ts`** (`settleSwipeEvent`) — the on-chain settle path (burn shares → pay
  merchant) — contains **no** `attribution` / `score` reference. Its guards are money-safety only
  (approved · unsettled · under the cap · activated permit · not expired).

### 2. x402 trust-tiering is **OFF by default**, and even when on, is not Attribution

- **`lib/x402/config.ts`** — the optional trust-tiering seam is off unless an operator explicitly
  opts in: `if (process.env.X402_TRUST_TIERING !== 'parked') return undefined`. Default → no trust
  source → the facilitator authorizes on **NAV alone**.
- **`lib/x402/pricing.ts`** — when tiering *is* enabled it tiers by **parked size** ("skin in the
  game"), explicitly **no Attribution**. Attribution is documented throughout `lib/x402/*` as *one
  possible, pluggable* `TrustSource` input, **never a dependency** — the default path never consults
  it.

### 3. The edge-auth authorization core has no reputation input

- The Rust **`services/edge-auth`** service decides `authorize` off cached vault **NAV** minus holds,
  caps, and a **VaR haircut** (`services/edge-auth/src/haircut.rs`). The only "score" anywhere in the
  service is the VaR **z-score** (a confidence parameter of the haircut), not a reputation score.
  There is no `attribution` / `reputation` input to the decision.

## The one carve-out: rewards distribution weighting

Attribution **does** weight **rewards-pool distribution multipliers** — it scales how a fixed,
already-funded rewards pool is split among participants:

- `lib/rewards/vault/weightedDistribution.ts` — an LP's share of the base pot is scaled by their
  Attribution percentile (linear).
- `lib/rewards/universal/epochAllocator.ts` — buckets swappers into Attribution bands for epoch
  allocation.

This is **not** access, credit, or a spend limit: it only changes the *proportion of a reward a user
receives*, never whether they may transact, how much they may spend, or whether a payment
authorizes/settles. It cannot make a balance un-spendable or extend anyone credit.

## Regression guard (CI)

`lib/x402/no-attribution-in-spend.test.ts` (Vitest) source-scans the spend / authorize / settle
modules (`lib/org/cardAuthorize.ts`, `lib/org/settleSwipe.ts`, `lib/x402/edgeHttp.ts`) and asserts
they import and reference **no** attribution / reputation / score module, and that x402 trust-tiering
stays off unless an operator opts in. If a future change wires a reputation score into a
spend/authorize/settle decision, this test fails in CI.
