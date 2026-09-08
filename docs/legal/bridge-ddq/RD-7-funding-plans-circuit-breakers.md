# RD-7 — Funding Plans and Run-on-the-Asset Circuit Breakers

**Status: first draft, grounded in the real engineering already described in RD-8 and RD-1.
No aspirational claims — every mechanism below is cited against real source files or is
honestly marked as not yet built.**

---

## 1. How the card program is funded

The card program's USDC source is the **senior tranche** of `MintwareTreasuryVault`
(`contracts-v4/src/payments/MintwareTreasuryVault.sol`). The structural design:

- **Senior tranche (community capital)** — par-protected, spendable claim on the vault's
  USDC. Senior NAV is price-free (no mark-to-market): it equals deposits minus any shortfall
  absorbed by the junior tranche. Senior capital is what card spend draws from.
- **Junior tranche (team capital, first-loss)** — the team's own capital sits contractually
  *beneath* senior. Code-enforced redemption waterfall: any shortfall (e.g. impaired LP
  position, settlement slippage, fee loss) is absorbed by junior shares before a single
  senior dollar is at risk. This is not discretionary — it is the contract's own
  `_pullUSDC` ordering logic (fixed in `fix/redemption-order-honest-nav`,
  `lib/rewards/vault/*`).

**Reserve sizing:** the `min_liquidity_reserve_usdc` floor in `services/edge-auth/src/portfolio.rs`
is the liquidity buffer the system maintains *above* expected settlement demand. It is sized to
cover: (a) the gap between authorization timestamp and settlement timestamp (card network
settlement typically T+1 to T+3, including weekend/holiday windows), (b) estimated settlement
slippage on the on-chain `settleSpend` leg, and (c) a configurable tail buffer against
correlated spend spikes. This reserve is enforced in real time at every authorization — a
charge that would push spendable liquidity below the floor is declined before it is approved.

---

## 2. Controls that limit rundown speed

These are layered, not sequential — each is independently enforced.

### 2a. Hard per-member daily cap

Each member's role preset carries a fixed daily spend limit checked against their
*cumulative approved spend for the current UTC day* — not just the pending swipe
(`lib/org/cardAuthorize.ts#decideCardSwipe`, `lib/org/standing.ts`). The optional "standing"
tier can widen this cap, but only within the existing hard ceiling — it can never raise a cap
above the hard-coded role maximum or turn a receive-only role into a spender.

**Practical effect:** even if every member of a large org attempts to spend simultaneously, the
aggregate rundown rate is bounded by `memberCount × maxDailyCapPerRole × day`. It is impossible
to drain the vault in a single burst.

### 2b. Authorization-time balance hold

Before a swipe is approved, the edge-auth service (`services/edge-auth/src/portfolio.rs`,
`GET /authorize`) places a **hold** against the member's live spendable — computing
`spendable = NAV − current holds − daily cap consumed − liquidity reserve − hot-buffer floor`.
That hold is reserved (removed from available headroom for other concurrent swipes) for the
duration of the authorization-to-settlement window. A second swipe by the same or any other
member cannot count on liquidity that is already held. This closes the double-spend path.

### 2c. Pre-funded buffer with atomic row-lock

In buffer mode (flag-gated, `CARD_BUFFER_ENABLED`), the `card_spend_buffers.buffer_balance_atomic`
column is used instead of a live NAV hold. Debits are applied with a single row-locked
`UPDATE ... WHERE buffer_balance_atomic >= amount` — a concurrent swipe cannot double-spend the
same balance, because PostgreSQL's row lock means only one transaction can decrement at a time.
The buffer itself is refilled from the vault, not an unlimited source: `lib/org/bufferRefill.ts`
gates refills against the vault's available liquidity and the refill-rate breaker, so a fast
sequence of swipes cannot trigger an unbounded cascade of vault draws.

---

## 3. System-wide circuit breaker — halts all authorizations

`PortfolioGuard` (`services/edge-auth/src/portfolio.rs`) exposes a `breaker_open` flag that,
when set, causes **every** authorization request — regardless of any individual member's cap or
balance — to be declined with a distinct `CircuitBreakerOpen` reason. The circuit breaker can be
set in two ways:

1. **Operator action** — the breaker can be triggered by an operator who observes stress
   conditions (e.g. a sharp fall in vault NAV, a junior-tranche drawdown that narrows the
   first-loss cushion, a settlement failure cascade).
2. **Policy-driven upstream logic** — the breaker is designed to compose with automated
   monitors that observe the coverage ratio, junior-tranche equity, and NAV freshness, and
   trigger it if any threshold is breached. The upstream monitor is not yet a fully automated
   circuit in production (noted honestly), but the breaker itself is wired and functional —
   an operator can throw it immediately.

Once the breaker is open: authorizations halt; existing holds are not paid out; settlement of
already-authorized (pre-breaker) swipes continues — the breaker does not cancel valid
already-approved transactions, it only prevents new ones.

---

## 4. Hot-buffer reserve floor — separate from the circuit breaker

`min_liquidity_reserve_usdc` is a configured USDC floor enforced *before* authorization —
a charge that would push the system below this level receives a `ReserveFloorBreached` decline
rather than a plain insufficient-funds decline. These are deliberately distinct decline reasons:
the system can distinguish "no money" from "money exists, but spending it would break the
reserve."

The reserve is not a static figure — it is designed to be sized against realistic settlement
timing risk, and can be updated by the operator without redeploying the service
(`MemStore::set_liquidity_reserve`). During normal operations the floor ensures the vault can
always honor settlement of already-authorized-but-not-yet-settled swipes even if no new
authorizations are approved.

---

## 5. Loss-waterfall ordering — how shortfalls are absorbed before they reach cardholders

The vault's redemption logic enforces strict priority:

1. **Junior tranche absorbs first.** Any impairment (an LP position worth less than its book
   value, a settlement shortfall, a fee loss) reduces junior shares before senior NAV is
   touched. A junior-tranche holder can go to zero before a single senior dollar is impaired —
   this is the code-enforced first-loss buffer.
2. **Senior redemption is solvency-aware.** The 2026-08 audit hardening introduced a solvency
   check on senior redemption: if junior coverage is still intact, senior redeems at par ($1).
   If junior is exhausted, senior redemptions are pro-rata (each redeemer gets the same
   fractional recovery — no first-redeemer advantage). This eliminates the "run on the asset"
   incentive because being first to redeem does not improve your recovery once the system is in
   a tail scenario (see `fix/redemption-order-honest-nav`).
3. **Settlement is capped under $250.** The oracle-signer-driven `settleSpend` path is hard-
   capped at $250 per transaction on the current live path. A single settlement event cannot
   drain material vault liquidity.

---

## 6. What is NOT yet built (honest)

- **Automated breach-detection → breaker trigger pipeline.** The circuit breaker is wired and
  functional; the upstream automated NAV/coverage-ratio monitor that would throw it without
  human intervention is not yet deployed. In the current state, an operator must observe and
  act — the system does not throw its own breaker on a NAV event automatically.
- **Network-level behavioral fraud signals** (velocity beyond the daily cap, geolocation
  anomaly detection, merchant-category risk scoring) — not described above because they are
  not yet built. If Bridge/Stripe Issuing provides network-level fraud signals as part of the
  issuing program, Mintware's controls described here are designed to compose with them rather
  than replace them.
- **High-value settlement lane (≥$250).** Transactions above the $250 settlement cap require
  an edge-auth-signed authorization, which is not yet wired. The existing hard cap means
  large-ticket exposure is structurally bounded on the current live path.
