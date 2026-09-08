# RD-8 — Fraud Prevention Program

**Status: first draft, describing controls that are genuinely built and tested today (not aspirational).
Every mechanism below is cited against real source files. Flag-gated items are noted as such — this
document describes the system honestly, including what's off by default.**

## 1. Spend authorization — belt and suspenders

Every card swipe passes through `decideCardSwipe` (`lib/org/cardAuthorize.ts`), which layers two
independent controls rather than relying on either alone:

- **Belt — role-based daily cap.** Each member's spend is bounded by a fixed role-preset daily limit,
  checked against their *cumulative approved spend for the current UTC day* (not just the single swipe
  in question — closing a real gap where a cap could otherwise be bypassed one swipe at a time). An
  optional "standing" tier can widen this limit for members with a track record of settled spend, but
  standing can only ever widen a limit *within* the existing hard cap — it can never remove the cap or
  turn a receive-only role into a spender.

- **Suspenders — real-money backstop, fail-closed.** Independent of the role cap, every swipe is also
  checked against either (a) a pre-funded, atomically-reserved buffer balance (row-locked so concurrent
  swipes cannot double-spend the same balance), or (b) a live hold against the member's actual on-chain
  vault equity via the edge-auth service. **If edge-auth is unreachable or unconfigured, the swipe is
  declined — it never silently defaults to approved because a downstream service is unavailable.**

## 2. System-wide circuit breaker

Independent of any single member's spend, a global `PortfolioGuard` (`services/edge-auth/src/portfolio.rs`)
can halt **all** authorizations platform-wide: `breaker_open: true` causes every charge — even a
trivially fundable one — to decline with a distinct `CircuitBreakerOpen` reason, regardless of any
individual member's balance or cap. This is a deliberate stop-loss: if a stress condition (e.g. the
junior first-loss cushion or overall coverage ratio falling below a floor) is detected upstream, the
whole authorization surface halts rather than continuing to approve against a system that may not be
able to honor them.

## 3. Always-liquid hot-buffer reserve

A configurable `min_liquidity_reserve_usdc` floor is enforced *before* any charge is allowed to draw
liquidity below it. This reserve exists specifically to absorb settlement-timing risk (weekend/holiday
gaps between authorization and settlement, plus settlement slippage) so that a spike in spend can never
silently push the system below what it needs to stay whole. A charge that would breach this floor is
declined with its own distinct reason (`ReserveFloorBreached`), separate from a plain insufficient-funds
decline — the system can tell the difference between "no money" and "there is money, but touching it
would break the reserve," and treats them differently.

## 4. Multi-collateral, freshness-gated valuation

Where a member's spend authority spans more than one collateral type (USDC directly, or ETH/LST
positions), the aggregate spendable amount is computed as the sum of each position's equity, but with a
hard safety rule: **a single stale price or stale NAV on any one leg fails the *entire* aggregate
valuation safe** — the system will not authorize against a basket it cannot currently price correctly,
even if the other legs are fine. ETH-denominated legs are additionally reduced by a VaR-style haircut
(a fixed percentage held back against price volatility) before being counted as spendable — a $3,000 ETH
position is not treated as $3,000 of spending power, it's discounted for the volatility of the asset
itself.

## 5. Idempotent, capped settlement

The actual on-chain settlement leg (`settleSpend`/`burnForPayment`) is capped under $250 per transaction
on the current oracle-signer-driven path (a higher-value edge-auth-signed lane is a separate, not-yet-
wired capability) — bounding the maximum single-transaction exposure of the currently-live settlement
path regardless of any other control. Settlement keys are idempotent per hold: a repeated settlement
request for the same authorized hold cannot double-submit or double-pay.

## 6. Fail-closed posture as a design principle, not a footnote

Every money-moving control in this document defaults to declining, not approving, when a dependency is
unavailable: edge-auth unreachable → decline. Bearer secrets unset on the relayer/edge services → all
requests rejected (401/503), never processed with a default. This is a deliberate, repeated pattern
across the system, not an incidental property of one code path.

---

**What this document does not yet cover, honestly:** device/behavioral fraud signals (velocity checks
beyond the daily cap, geolocation anomaly detection, merchant-category risk scoring) are not described
above because they are not yet built — this document should not imply otherwise. If Bridge's own
issuing stack (Stripe Issuing) already provides network-level fraud signals (which it very likely does),
this section should be revised to describe how Mintware's controls compose with theirs, once confirmed.
