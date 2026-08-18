# AgentKit × Compute × x402 — Spec

> **Status:** spec + initial build (P1–P4 code-complete, config/audit-gated). Branch
> `feat/ypn-vault-convergence`. Author-time: 2026-08-18. Implementation status at §9.
> **One-liner:** Mintware gives agents **a place to park capital that keeps earning while staying spendable
> in place** — an agent treasury where idle USDC earns yield and is spent per call over x402 without ever
> un-parking into a hot wallet. Mintware is the funding rail *and* the x402 facilitator, so verify is a hold
> against the *earning* balance and settlement burns from it directly. (Reputation-gating is an **optional
> lever**, not a dependency — the default path authorizes purely on live NAV.)

---

## 1. Thesis

**The product is an agent treasury: a place to park capital that keeps earning while staying spendable.**
Agents accumulate idle USDC (fees, runway, float) that today sits dead in a hot wallet. Mintware lets an agent
**park** that USDC in a yield vault where it earns, and **spend it in place** — each payment draws straight
from the earning position (a hold against NAV → settlement burns shares), so capital is never un-parked to be
usable. "Never idle, never locked, always yours," for agents.

[x402](https://x402.org) is the *spend trigger*: the HTTP-native way for agents to pay per request in
stablecoins (`402 Payment Required` → sign → retry). x402 solves the *transport* of a machine payment; it does
**not** solve where the money lives or whether it has to sit idle waiting to be spent. The parking account is
what makes the spend rail matter — and Mintware being both the funding rail and the facilitator is what lets
the balance stay productive right up to settlement.

**We already built the hard parts for YPN.** x402 + the account view are the framing on top of it:

| x402 needs… | Mintware already has… |
|---|---|
| A place to **park capital that earns** | YPN yield vault — USDC earns in an ERC-4626 source until the instant it's spent (`MintwareERC4626YieldAdapter`, fee-aware) |
| Verify the payer can pay, fast, per call | `edge-auth` `POST /authorize` — sizes a hold off live vault **NAV** in ~10 ms (proven on Arc) |
| Settle on-chain, burning from the earning balance | `services/relayer` `settle` + CCTP (`cctp.rs`); gateway burns shares → USDC to payee |
| An agent-side client | `@mintware/agentkit-actions` (`plugins/agentkit`) — Coinbase AgentKit actions, already published |
| *(optional)* spend policy by trust | pluggable `TrustSource` — parked size / tenure / staking / Attribution. **Not required** |

The wedge is not "an agent pays for a thing." It is: **the only x402 facilitator where the payer's balance is
productive right up to settlement, and where price/limits are a function of on-chain reputation.** Idle agent
treasuries are a real cost; sybil agents are a real risk; both are things we already price.

## 2. Background — x402 in 60 seconds

x402 (Coinbase CDP, whitepaper May 2025; **x402 Foundation** under the Linux Foundation since **2026-04-02**;
**v2** formalized session tokens + multi-chain):

1. Client requests a protected resource.
2. Server replies **`402`** with a `PAYMENT-REQUIRED` header — base64 **payment-requirements** JSON:
   `scheme` (`exact` | `deferred`), `network` (EVM / Solana), `maxAmountRequired`, `asset` (e.g. USDC),
   `payTo`, `resource`, `validUntil`, nonce.
3. Client signs a **PaymentPayload** (for USDC on EVM: an EIP-3009 `transferWithAuthorization`) and retries
   with a `PAYMENT-SIGNATURE` header.
4. A **facilitator** (middleware) runs **`/verify`** then **`/settle`** on-chain; the server returns the
   resource. Transports: **HTTP and MCP**.

The two schemes matter for us:
- **`exact`** — pay the exact amount up front; settle immediately.
- **`deferred`** — authorize now, settle later / aggregated. **This is a hold-then-settle**, which is precisely
  `edge-auth`'s model. Deferred + session tokens are where YPN wins.

_Sources: [x402.org v2 launch](https://x402.org/x402-v2-launch/), [x402 whitepaper](https://www.x402.org/x402-whitepaper.pdf), [Allium explainer](https://www.allium.so/blog/x402-explained-the-internet-native-payments-standard-for-apis-data-and-agent-commerce/)._

## 3. Three roles (and what we build)

x402 has three actors. Mintware can occupy all three; we sequence them by leverage.

### A. Payer — the AgentKit client (agent spends)
An AgentKit-powered agent hits a 402-gated compute/API endpoint; a Mintware action auto-pays from the agent's
**YPN Liquid Sovereign Account**. New action alongside the existing three:

```
MINTWARE_X402_PAY  — given a 402 challenge (or a URL), construct + sign the PaymentPayload from the agent's
                     YPN balance, honor the agent's spend policy, retry, and return the resource.
```
The balance it pays from is *yield-bearing until this call*; the action never pre-funds a hot wallet.

### B. Facilitator — backed by YPN  ⭐ the moat
Mintware runs an x402 **facilitator** whose `/verify` is `edge-auth`'s NAV-hold and whose `/settle` is the
relayer. Because verification is a *hold against a productive vault*, the payer keeps earning until settlement;
because it is reputation-aware, the facilitator can enforce per-agent caps and dynamic price. No other
facilitator can offer "your float still earns."

### C. Seller — Mintware sells its own compute over 402 (dogfood, ship first)
Put a 402 paywall in front of Mintware's own machine-callable surface — **Attribution scoring** (`/score`,
agent leaderboard) and **edge authorization** — so any agent can buy a reputation lookup for USDC with zero
account setup. Fastest to ship (wraps an existing API), and it makes us an x402 *consumer* of our own rail.

## 4. Architecture — the money flow

```
 Agent (AgentKit)                Compute/API (x402 seller)         Mintware facilitator (YPN-backed)
 ────────────────                ─────────────────────────         ─────────────────────────────────
  call resource ───────────────▶ 402 PAYMENT-REQUIRED
  MINTWARE_X402_PAY:
    read YPN balance
    sign PaymentPayload ────────▶ retry w/ PAYMENT-SIGNATURE ─────▶ /verify  → edge-auth POST /authorize
                                                                     (hold sized off live NAV, ~10ms,
                                                                      Attribution-gated cap)
                                  ◀── 200 + resource ──────────────  (server serves on verified hold)
                                                                     /settle → relayer settleSpend / CCTP
                                                                     (burn earning shares → USDC to payTo)
```

**Concept mapping (x402 → Mintware component):**

| x402 | Mintware |
|---|---|
| `scheme: deferred` | `edge-auth` hold (authorize now, settle later) |
| facilitator `/verify` | `POST /authorize` → `{approved, hold_id, hold_usdc}` off live vault NAV |
| facilitator `/settle` | `services/relayer` `settle` (+ `cctp.rs` if `payTo` is on another chain) |
| x402 v2 **session token** | `hold_id` (idempotent, reservable, expiring — `store.rs`) |
| `asset: USDC`, `network: base` | USDC on Base for settlement; **Arc** for the yield leg, **CCTP** bridges |
| *(optional)* payer spend policy | pluggable `TrustSource` → hold-size fraction. Default: authorize on NAV alone |

## 5. Why *compute* specifically

Compute (inference, tool calls, data/API) is the canonical x402 buyer: high call frequency, tiny per-call
amounts, no human in the loop. Three properties of that workload are things we uniquely price:

- **Idle-cost** — an agent that must pre-fund a spend wallet loses the yield on its float. YPN keeps it earning
  until the call. At agent-scale call volume this is a real, compounding saving.
- **Spend caps** — an autonomous agent needs a hard, real-time ceiling. `edge-auth` already sizes and enforces
  holds; a runaway agent is declined (`insufficient_equity`) exactly as the live Arc demo showed for `$300`.
- **Reputation-priced access** — sybil/abusive agents are the failure mode of open machine payments. Attribution
  lets a seller (or our facilitator) *price by trust*: higher score → higher rate limit / better price; unknown
  → conservative cap. This is a lever no generic facilitator has.

## 6. Interfaces (concrete)

### 6.1 AgentKit action — `MINTWARE_X402_PAY`
`plugins/agentkit/src/index.ts`, same `customActionProvider` shape as the existing three.
- **Input (zod):** `{ url: string, maxAmountUsd?: number, network?: 'base'|'arc' }`.
- **Behavior:** GET `url` → on `402`, parse `PAYMENT-REQUIRED` → enforce `maxAmountUsd` against the agent's
  policy → sign PaymentPayload from the agent wallet (or the agent's YPN account, via the facilitator) →
  retry with `PAYMENT-SIGNATURE` → return body. Read-only preflight (`MINTWARE_X402_QUOTE`) returns the price
  without paying.
- **Reuses:** the AI-Attribution SDK wallet plumbing already imported here.

### 6.2 Facilitator HTTP surface (new, thin — wraps edge-auth + relayer)
```
POST /x402/verify   { paymentRequirements, paymentPayload } → { valid, holdId, maxSettleable }   // → edge /authorize
POST /x402/settle   { holdId, paymentPayload }              → { settled, txHash }                 // → relayer settle
GET  /x402/supported                                        → { schemes:['exact','deferred'], networks:[…] }
```
`/verify` and `/settle` are the x402-standard facilitator endpoints; internally they are a **rename + adapter**
over primitives that already exist and are tested. Bearer-guarded, **fail-closed** (edge-auth already rejects
when the secret is unset — audit C1).

### 6.3 Seller middleware (for role C, and for any protocol using our rail)
A tiny Next.js/`createHandler` wrapper: `require402({ priceUsd, payTo, scheme })` that returns the `402` +
`PAYMENT-REQUIRED` on an unpaid request and calls the facilitator to verify a `PAYMENT-SIGNATURE`. First
mount: in front of `/score` (sell an Attribution lookup for USDC).

## 7. Optional trust-tiered pricing (a lever, not a dependency)

**The default facilitator authorizes purely on live NAV — no reputation, no Attribution, nothing extra.** The
account and the spend rail stand on their own. *Optionally*, a facilitator or seller can tier the hold/price by
a trust percentile:

| Trust percentile | Rate limit | Price multiplier | Cap sizing |
|---|---|---|---|
| 0–33% (unknown/new) | tight | 1.0× (or surcharge) | conservative NAV fraction |
| 34–66% | standard | 1.0× | standard |
| 67–100% (proven) | high | discount | full NAV headroom |

The percentile can come from **any** signal — parked size, deposit tenure, staking, or (only if wanted) an
Attribution score. The source is a pluggable `TrustSource` port (`lib/x402/facilitator.ts`); omit it and none
of this runs. `lib/x402/pricing.ts` implements the buckets. **Attribution is one possible input, never a
requirement.**

## 8. Settlement topology

- **Settle on Base** where x402 facilitators + USDC EIP-3009 are native today; x402 v2 is multi-chain, so
  **Arc** settlement follows as x402 adds it.
- **Yield on Arc** (the fee-aware `MintwareERC4626YieldAdapter` → XyloVault seam), **CCTP** rebalances between
  the earn side and wherever `payTo` settles. This is the same Base↔Arc topology already proven this session.
- **MCP transport** (x402 v2) — expose `MINTWARE_X402_PAY` as an MCP tool too, so MCP-native agents pay without
  AgentKit.

## 9. Phased build

| Phase | Deliverable | Status |
|---|---|---|
| **P0** | This spec | ✅ |
| **P1** | **Seller:** `require402()` (`lib/x402/require402.ts`) + `GET /api/x402/score` behind a 402 paywall (dogfood) | ✅ code-complete |
| **P2** | **Payer:** `MINTWARE_X402_PAY` + `MINTWARE_X402_QUOTE` AgentKit actions (`plugins/agentkit`) | ✅ code-complete |
| **P3** | **Facilitator-backed-by-YPN:** `YpnFacilitator` + `POST /api/x402/verify`→edge-auth, `POST /api/x402/settle`→relayer | ✅ code-complete (relayer settle transport is a config flip) |
| **P4** | **Reputation-gated pricing** (`lib/x402/pricing.ts`) wired into the facilitator | ✅ code-complete (percentile→policy; ReputationSource port pending a wire to Attribution) |
| **P5** | MCP transport for the payer action | ⏳ not started |

**The parking account (the core):**
- `lib/x402/treasury.ts` (park + spend-in-place model) + `vaultReader.ts` (fee-net parked USDC off the Arc
  vault: `convertToAssets(shares(agent))`) + `GET /api/x402/account` (returns `spendableLive`).
- **Park / un-park:** `MINTWARE_PARK` (approve + `deposit`) and `MINTWARE_UNPARK` (`redeem` shares → USDC
  back; capital is always yours). **Check:** `MINTWARE_TREASURY`.
- **Live spendable:** edge-auth `GET /available/:user` (read-only headroom = NAV equity − holds − cap −
  liquidity, reusing `ledger::available`, no hold reserved) → `httpSpendableSource`, wired into the account
  route. Without edge-auth, spendable defaults to the full parked balance — **parking does not lock**.
- **UI:** `/app/agents` — the clickable parking account (parked / spendable / earning, live off the vault).

**Build state (2026-08-18):** `lib/x402/*` (types, protocol, pricing, facilitator, require402, edgeHttp,
config, treasury, vaultReader) + 5 routes under `app/api/x402/*` + the `/app/agents` page + 5 new AgentKit
actions (park, unpark, treasury, x402 quote/pay) + edge-auth `GET /available/:user` + an end-to-end
seller-flow integration test. **47 Vitest + 82 edge-auth (Rust) tests green**, project typecheck + clippy
clean. **Runtime-gated** (not code-gated): `EDGE_AUTH_URL`/`EDGE_AUTH_SECRET` + `X402_PAY_TO` for the
facilitator/seller/live-spendable; **the relayer is a signing/submission library with no HTTP surface, so a
live `settle` endpoint is a separate server + funded-key task (deploy-gated)** — until then the facilitator
uses `deferredSettler`. Trust-tiering is **optional** and off by default. Same external audit gates real value.

## 10. Security & risks

- **Replay / double-spend** — enforce x402 `validUntil` + nonce; the `hold_id` is idempotent and expiring
  (`store.rs`), so a captured payload can't be re-held; settle is once-per-hold.
- **Verify/settle gap** — the deferred window between authorize and settle is a credit risk; bound it with the
  per-block/per-window caps already in edge-auth and the vault, and never serve above `maxSettleable`.
- **Facilitator trust** — a facilitator can grief by verifying-then-not-settling; our facilitator settles via
  our own relayer, and sellers can require settlement proof (`txHash`) before serving high-value resources.
- **Fail-closed** — edge-auth rejects when the bearer secret is unset (audit C1); the facilitator inherits this.
- **NAV honesty** — settlement burns *fee-net* shares (the XyloVault fee-aware fix); the facilitator must quote
  and cap on `previewRedeem`, never the over-reported `convertToAssets`, so a hold never exceeds realizable USDC.
- **Chain reorg on settle** — treat `/settle` as pending until finality on the settle chain; deferred scheme
  tolerates this by design.
- **Sybil at the payment layer** — reputation-gated caps are the mitigation, not an afterthought.

## 11. Open decisions (for review)

1. **Role emphasis / order.** Recommended: **P1 seller (dogfood) → P2 payer → P3 facilitator**. Alternative:
   lead with the facilitator (bigger story, more code, nothing to demo until it's whole). *Recommend the former.*
2. **Whose wallet signs in the payer action** — the agent's own external wallet, or the agent's YPN account via
   the facilitator (so even the payer leg keeps earning)? *Recommend YPN-account-via-facilitator once P3 exists;
   external wallet before that.*
3. **Facilitator: our own only, or register on public facilitator lists** so any x402 client can route through
   us? *Recommend public listing once P3 is audited — it's a distribution flywheel.*
4. **Settle chain default** — Base now (x402-native) with Arc to follow, vs push Arc immediately. *Recommend
   Base-first.*

## 12. Fit with the existing stack

- Funding rail: [`session-handoff-arc.md`](session-handoff-arc.md) (YPN live on Arc), `config/arc.ts`,
  `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` (fee-aware).
- Authorization: `services/edge-auth` (`/authorize`, holds, NAV refresher, VaR haircut).
- Settlement: `services/relayer` (`settle`, `cctp.rs`).
- Reputation: Attribution (Base mainnet) + `@mintware/agentkit-actions` (`plugins/agentkit`).
- Nothing here is greenfield contracts — x402 is an HTTP + adapter layer over primitives that already ship
  green (Forge 463/0/4; edge-auth + relayer green). The gate in front of *real value* remains the same single
  external audit as the rest of the converged stack.
