# Card Spend Buffer — Design Spec

**Status:** design spec, dated 2026-08-25. Synthesizes a multi-session research/design thread
(card-issuer evaluation + JIT-authorization physics + buffer sizing math). Not yet built — this is
the spec to build against.

## 1. The problem this solves

Mintware's original card-spend pitch assumed something close to true "just-in-time" authorization:
check a user's live, dynamically-priced vault position at the exact moment of a card swipe, pull
the exact amount needed, leave everything else fully deployed until that instant. **This is not
achievable with any card network today, confirmed directly from primary sources, not an assumption
to revisit later.**

- Visa/Mastercard authorization is a synchronous request with a hard timeout carved out of the
  network's own budget. Stripe's real-time webhook: **2s**. Lithic's Auth Stream Access: **6s hard
  cutoff, auto-decline on miss**. Marqeta's Gateway JIT: **3s**, falls back to pre-configured rules.
- Computing a live AMM-priced vault NAV inside that window is a fundamentally harder problem than
  checking a flat token balance: multiple RPC reads (pool reserves, LP supply, price, share math)
  where a single read alone can eat the entire budget under load, and — separately — a live AMM
  price read is manipulable in the same block (flash-loan/sandwich the price, get the auth to read
  the distorted number, revert). A flat balance check has neither problem.
- **Confirmed directly from Stripe's own docs, verbatim, re: their Bridge-powered stablecoin card
  product:** *"Stripe doesn't automatically give control of the `issuing_authorization.request`
  webhook because of transaction submission latency requirements."* Bridge's own JIT pull checks
  two flat, deterministic things — an active on-chain approval, and literal raw USDC balance in the
  wallet — never a computed vault value. Confirmed independently in a live vendor call (Bridge/Osman,
  2026-08-24): *"JIT tech may not work as advertised with cards... the wallet needs to hold the
  USDC to spend."*
- No production card issuer anywhere (Lithic, Marqeta, Stripe/Bridge, MetaMask Card, Gnosis Pay,
  Coinbase/Marqeta) does live AMM-priced position valuation inside the authorization window. Every
  one checks a flat balance or an off-chain custodial ledger. Lithic/Marqeta's "any external ledger"
  marketing is a claim about *format* agnosticism, not about having solved this latency/adversarial
  problem — nothing behind their webhook is exempt from the same physics.

**Conclusion: the buffer-and-refill model below is not a fallback or a compromise version of the
original pitch. It is the actual, universal architecture every live "spend from crypto" product
uses.** Treat it as the real design, not a workaround to eventually replace.

## 2. Core architecture: pre-funded flat buffer, fast automated refill

```
[ Vault position — fully deployed ]  ⇄ redeem/unwind ⇄  [ Spend buffer — flat, spendable ]
        (v4 LP + junior protection,                        (raw stablecoin OR aToken,
         earning LP fees + MEV + lending)                    held at a card-recognized address)
                                                                        │
                                                              card network checks
                                                              THIS balance only,
                                                              never the vault
```

- The **vault** stays exactly as designed — v4 LP position, junior-buffer tranche protection, MEV/
  dynamic-fee capture. Nothing about this changes.
- A small **spend buffer** sits separately, as a flat balance the card issuer can check with a
  simple deterministic lookup — self-custodial wallet address (MetaMask Card) or a card-partner-
  managed financial account (Bridge/Stripe Connect model), depending on issuer.
- The buffer is monitored continuously; the moment it's spent, an automated refill redeems a slice
  of the vault position and pushes fresh balance back in — target: seconds to low minutes, not
  instant, but fast enough that the buffer is rarely caught empty by the *next* swipe.

**This is a newsvendor / safety-stock sizing problem, not a guess.** See §3.

## 3. Buffer sizing — the math

Two related, well-established frameworks, not something to invent from scratch:

**Newsvendor framing** — balances the cost of running out (a declined swipe) against the cost of
overstocking (buffer sitting outside vault protection):

```
Optimal buffer = F⁻¹( Cu / (Cu + Co) )
```
`Cu` = cost of a decline (trust/UX cost), `Co` = cost of exposure (buffer outside tranche
protection), `F` = the CDF of the user's real transaction-size distribution.

**Safety-stock sizing formula** — determines the actual target number, and it has the *identical
shape* to the VaR haircut already used in edge-auth (`γ = 1 − (z·σ·√T + slippage)`), applied to a
different input:

```
Buffer target = z × σ(demand) × √(lead time T)
```
- `z` — target service level (1.65 ≈ 95% no-decline rate, 2.33 ≈ 99%). Product decision.
- `σ(demand)` — variance in the user's real transaction-size distribution (not price volatility).
- `T` — refill lead time: detect-spend → redeem-vault-slice → push-fresh-balance. **The single
  biggest lever on buffer size** — a 2-second refill needs a tiny buffer; a 2-minute refill needs a
  much bigger one. Must be measured honestly (worst case, not best case) once built.

**Real-world precedent for this exact pattern:** ATM cash-loading — sizing how much physical cash
to stock per machine against uncertain withdrawal demand and a fixed refill cycle, using historical
demand + a target service level (commonly ~98% no-stockout). Same math, different asset.

**Known, unavoidable failure mode:** a single transaction larger than the current buffer declines,
full stop — the card issuer only ever sees the buffer, never the vault behind it. Mitigations, not
optional polish:
- Size the *default* buffer off a realistic transaction-size distribution for the user's actual
  usage pattern (a "business" spend profile needs a bigger default than a "coffee" profile) — this
  is exactly what the Standing-tier design (see `constants/cards-landing.ts` `CARDS_STANDING`)
  should feed into over time, not a static, one-size default forever.
- A manual "prepare to spend $X" override in-app, ahead of a known larger purchase.
- The spend agent's predictive top-up and decline-retry roles (§5) — this is the mechanism that
  actually closes the gap in practice.

## 4. Yield-while-waiting — where it's real, and where it isn't

**Confirmed real: MetaMask Card.** Explicitly supports spending directly from Aave aTokens
(`aUSDC`, `aBasUSDC`, `amUSD`) — *"spend yield-bearing positions directly without unwrapping
first... continue earning Aave yield until the moment they are spent."* Mechanism: Aave's
`supply(asset, amount, onBehalfOf, referralCode)` — the vault calls this with `onBehalfOf` = the
user's own wallet address, Aave mints the aToken directly there in the same transaction. No separate
unwrap step, no extra hop.

**Not confirmed for Bridge/Stripe.** Their docs describe "the stablecoin balance to spend from" and
require Bridge to explicitly whitelist a specific `currency` — no documented auto-unwrap-a-yield-
token capability. Treat the Bridge buffer as **raw, non-earning USDC** until/unless confirmed
otherwise directly with them.

**Unconfirmed but plausible for Rain.** Rain's own materials confirm they support at least one
yield-bearing, directly-spendable stablecoin already (**USD+, ~5% APY, "remains spendable"**) —
proving the *category* is live on their platform, even though aUSDC specifically isn't confirmed.
Worth a direct, informed question in the next Rain conversation (either "can the wallet hold aUSDC"
or "can we use USD+ the same way").

**Do not assume this generalizes across issuers.** It's a per-platform feature, not a property of
"holding a yield-bearing token" in general. Verify per integration before building against it.

## 5. The spend agent — not a separate feature, one component with four jobs

An agent role, watching the buffer continuously, with a bounded and specific mandate — not an
open-ended "AI decides things" system:

1. **Predictive top-up.** React to an earlier signal than the actual card-network authorization
   request — a "prepare to pay" tap, a learned pattern — and refill *before* the swipe reaches the
   network. This lowers the effective buffer floor substantially, but **does not reduce it to
   zero** — there is always a minimum determined by (a) how much genuine advance notice any real
   signal provides, and (b) how long an on-chain transfer actually takes to settle. Do not build
   against a zero-buffer assumption for the card-rail path, ever — that's a different rail (§6).
2. **Decline-and-retry recovery.** If a swipe hits an empty/undersized buffer and declines, detect
   it immediately, fund the buffer, and prompt (or auto-trigger) a fast retry. A real, honest
   fallback — not a seamless first-try guarantee, a fast second-try recovery.
3. **Adaptive safety-stock tuning.** The buffer target isn't static — the agent adjusts it over time
   as it observes a user's real transaction pattern, converging the default toward the actual
   newsvendor-optimal size for that specific user rather than a one-size-fits-all constant.
4. **Circuit breaker.** Enforces the refill-rate cap (§6) — same "loss-breaker" instinct already
   built into the JIT liquidity engine, applied here to prevent a compromised wallet or repeated-
   fraud pattern from triggering runaway refills one small buffer-drain at a time.

## 6. User-facing controls

Mirror the existing risk-parameter governance shape (`MWTimelockedRiskParams` — bounded, disclosed,
asymmetric: tightening instant, loosening delayed) applied at the per-user level:

| Control | Description | Default source |
|---|---|---|
| Target buffer size | "Keep $X ready to spend" | Auto-sized off real spend history (§3), user-adjustable within a protocol max |
| Per-transaction cap | Max a single swipe can pull | Bounded default; mirrors card issuer's own configurable spending controls where available |
| Refill-rate cap | Max auto-topped-up per day/week | Circuit-breaker input (§5.4) |
| Manual "prepare to spend $X" | One-tap pre-emptive top-up ahead of a known large purchase | User-triggered |
| Pause auto-refill | Opt out of automatic top-up entirely | User-triggered |

## 7. Relationship to existing code — don't duplicate, reuse and extend

**`MintwareEthSettlement.sol`'s `juniorUsdcBuffer` solves a related but different problem.** It's a
**settlement-side shortfall cushion** — if the on-chain WETH→USDC conversion comes up short during
batch settlement, the junior buffer tops up the gap so the *rail* (whatever card program is already
live) still gets paid what it's owed. That's downstream of authorization, a safety net for
Mintware's own settlement obligation.

**The new buffer in this spec is upstream of that** — a per-user, pre-funded balance the card
*issuer itself* checks directly, before authorization happens at all, independent of and prior to
Mintware's settlement logic.

**Both are real, both stay.** They share one underlying primitive worth building once and reusing:
**"redeem a slice of the vault position into liquid USDC."** The card-buffer refill trigger and any
future settlement-shortfall top-up should both call into the same redemption logic rather than each
implementing their own unwind path.

## 8. What this does NOT affect — agentic (x402) spend is a different rail, unconstrained by any of this

Confirmed directly from `lib/x402/vaultReader.ts`: agent-initiated spend already does a **live,
computed `eth_call`** — `convertToAssets(shares(agent))` — real-time vault NAV, at spend time, no
buffer, no pre-funding, nothing from this whole document applies to it.

**Why: x402 never touches Visa/Mastercard's rails at all.** The entire buffer requirement in this
spec exists *because* card-network authorization carries a hard synchronous timeout that any
computed, AMM-priced value can't reliably meet. x402 is a direct HTTP/on-chain-settled payment with
no such clock. This is a genuine, structural advantage for agent-to-agent and agent-to-merchant
commerce that Mintware already has shipped — not something this buffer work needs to replicate or
protect.

**Important, easy-to-miss caveat: this advantage does NOT extend to agents holding a Visa/
Mastercard "agent payment" credential** (Mastercard Agent Pay / Agentic Tokens, Visa Trusted Agent
Protocol / Intelligent Commerce). Those are still card-network rails under the hood — an agent
transacting through one of them inherits the exact same 2-6s flat-balance authorization physics as
a human card swipe. They make it easier for an agent to *hold* a scoped, verified payment
credential; they do not exempt the transaction from §1's constraint. Don't build an agent-card
integration assuming those programs unlock true live-vault JIT — they don't.

**Practical implication:** the real differentiation story is "agent-to-agent/agent-to-merchant
commerce that skips card rails entirely, via x402, gets genuine real-time spend against live
liquidity — already shipped" — not "agents make card swipes real-time," which isn't achievable on
any card rail, agent-held credential or not.

## 9. Open items before build

- [ ] Measure real refill lead time `T` once a first integration is live (worst case, not best case)
- [ ] Confirm with Rain directly: aUSDC or USD+ support for the buffer wallet
- [ ] Confirm with Bridge directly: any path to a yield-bearing buffer asset, or accept raw-USDC-only
- [ ] Decide default `z` (service level) as a real product decision, not a placeholder
- [ ] Build the shared "redeem vault slice → liquid USDC" primitive referenced in §7 once, reuse in
      both the settlement-shortfall path and the new buffer-refill path
- [ ] Spec the spend agent's exact autonomy boundary — which of its four jobs (§5) act without
      confirmation vs. require it, before any real capital is behind this

## 10. Build status (2026-08-26) — Option A, dark-launched

Decision: **Option A** (per-user buffer funded from the member's OWN senior shares). Everything below
is **testnet/pre-audit** and **flag-gated OFF by default**; external audit of `refillBuffer` gates real
value.

**Built + tested:**
- **Sizing** (`lib/cards/bufferSizing.ts`, 19 tests) — newsvendor + safety-stock `z·σ·√(T/period)`,
  Acklam probit; mirrors the edge-auth VaR haircut shape, rounds UP.
- **Decision logic** (`lib/cards/bufferPolicy.ts`, 15 tests) — flat auth check · refill planner ·
  refill-rate circuit breaker (reuses the edge-auth breaker instinct).
- **On-chain refill** (`MintwarePaymentGateway.refillBuffer` + `setBufferAddress` + separate
  `dailyRefillUSDC` cap, 12 Forge tests, 0 regression) — reuses the whole `settleSpend` safety core;
  closes the AUDIT-C1 theft vector structurally (receiver pinned to the user's self-registered buffer).
- **Schema** (`20260826000001`) — `card_spend_buffers` (1:1) + `card_buffer_refills` ledger, deny-all RLS.
- **Refill orchestrator** (`lib/org/bufferRefill.ts`, 8 tests) — the shared core (mirrors
  `settleSwipe.ts`), gated by `CARD_BUFFER_REFILL_ENABLED` + per-card config + the breaker.
- **Auth wiring** (`decideCardSwipe`) — the flat check replaces live-NAV on the card rail when
  `CARD_BUFFER_ENABLED` + a buffer row exist; default path unchanged.
- **Monitor** (`lib/org/bufferMonitor.ts#syncBufferBalance`) — reconciles the cached balance against
  on-chain `usdc.balanceOf(buffer_address)`.
- **Reactive path** (capture-webhook buffer branch) — at capture the pre-funded buffer already paid;
  marks cleared, reconciles, enqueues a reactive refill (no `settleSpend`).
- **Steady-state cron** (`/api/cron/card-buffer-refill`, 5 tests) — bearer-auth sweep: sync + refill
  each enabled buffer. Dark-launched; not yet in `vercel.json` (bearer-callable meanwhile).
- **User controls** (`/api/orgs/[id]/cards/[cardId]/buffer` + `parseBufferConfig`, 9 tests) —
  member/owner-gated config write (enable, service level, caps, sizing inputs, breaker).

The buffer is now **end-to-end**: configure → flat auth → capture reconcile + reactive refill → cron
backstop → on-chain `refillBuffer`. ~89 TS + 12 Forge tests green; both feature flags OFF by default.

- **Adaptive sizing** (`lib/cards/bufferTuning.ts` + `lib/org/bufferTuner.ts`, 15 tests) — the spend
  agent's §5.3 safety-stock tuning: derives (μ_L, σ) from the member's settled swipe history and
  EMA-blends the stored sizing inputs toward the measured distribution (recomputing the target). Run
  by the refill cron; no capital. `z` default is settled → 95% (`serviceLevelBps 9500`) coffee / 99%
  (`9900`) business, per `BUFFER_PROFILE_DEFAULTS`.

- **Timelock-governed refill cap** — `setUserDailyRefillCap` now routes through `MWTimelockedRiskParams`
  (48h): tightening (lower effective cap) instant, loosening delayed + cancellable, bounded at propose;
  `confirmUserDailyRefillCap` / `cancelUserDailyRefillCap`. 6 Forge tests.

**Still to build:** the spend agent's §5.1 *predictive* top-up (needs an earlier-than-auth signal), and
the remaining §9 pre-build items (measure real `T` — needs a live integration; confirm issuer
yield-buffer support — needs a Rain/Bridge answer). External audit of the `refillBuffer` contract change
gates real value.

## 11. Security audit + remediation (2026-08-26)

Adversarial Hacken/CertiK-style round: 5 independent reviewers attacked the new code by dimension,
a refute-first verifier tested each finding against the real code (default REFUTED). 18 survived (14
confirmed, 4 plausible); 3 refuted. All 9 distinct root issues fixed + tested, 0 regression:

| ID | Sev | Fix |
|---|---|---|
| C1 | Critical | Reservation ledger — `reserved_atomic` + atomic `reserve_card_buffer` (SELECT…FOR UPDATE) debits at auth; no more over-approval across swipes. |
| H1 | High | Buffer address derived from on-chain `bufferOf[member]`, never client/DB. |
| H2 | High | `auth_mode` recorded per swipe; capture honors it (no dropped settlement). |
| M1 | Med | `begin/end_card_refill` — atomic rate window + per-card in-flight mutex (no double-refill / breaker bypass). |
| M2 | Accepted | Two-ledger permit documented — refill has no theft vector (own pinned buffer), bounded by refill cap + breaker + pause. |
| L1 | Low | Instant risk-param tighten clears a queued loosen. |
| L2 | Low | Removed the unauthenticated GET config leak. |
| L3 | Low | Unique refillId minted up front (no `'pending'` wedge). |
| L4 | Low | On-chain `userRefillPaused` self-serve kill-switch. |

New migrations: `20260826000002` (reservation + auth_mode), `20260826000003` (refill lock). Still
testnet/pre-audit — an external audit remains the gate for real value.
