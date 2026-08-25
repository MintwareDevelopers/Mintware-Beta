# Attribution-for-Agents (x402 Seller) — Activation Runbook

> **Status (verified 2026-08-25): code-complete + tested on `main`. This is the go-live delta — NOT a
> rebuild.** `GET /api/x402/score` is a 402-paywalled Attribution score lookup; the full path (verify = live
> YPN NAV hold, settle = relayer) is built and wired. What remains is **config + deploy + audit**, below.
> Do not re-spec or reimplement — re-specifying risks a duplicate/conflicting build of tested code.

## 0. Verified state (what's already done)

- **Code (on `main`, tested — 81/81 Vitest green as of 2026-08-25):**
  - `lib/x402/{types,protocol,pricing,facilitator,require402,edgeHttp,config,treasury,vaultReader,permitStore}.ts`
  - `app/api/x402/{score,verify,settle,supported,account,permit}/route.ts`
  - `public/.well-known/x402.json` — machine-readable facilitator manifest
  - AgentKit actions: `MINTWARE_X402_PAY`, `MINTWARE_X402_QUOTE`, park/unpark/treasury (`plugins/agentkit`)
  - `/app/agents` — parking-account UI (parked / spendable / earning, live off the vault)
- **Settle wiring confirmed** (`lib/x402/config.ts`): `settler = X402_RELAYER_URL ? httpSettler(...) : deferredSettler`
  — so setting the relayer URL flips settlement from deferred to a live on-chain `settleSpend`. `httpSettler`
  (`edgeHttp.ts`) POSTs to the relayer `/settle` with the standing `DelegatedSpendPermit` (from the payer-keyed
  permit store) + optional edge auth; the settle route verifies the payer's EIP-3009 signature and binds
  `from/to/value` (audit R5-H2) before any settle.
- **Infra already up:** edge-auth deployed (`mintware-edge-auth-production.up.railway.app`); the relayer HTTP
  `relayer-server` bin is built (fail-closed bearer/key/RPC) — **built, not yet deployed**.
- Canonical spec (thesis, architecture, interfaces, risks, phased status §9): `agentkit-compute-402-spec.md`.

## 1. What it is (recap)

`GET /api/x402/score?address=0x…` — unpaid → `402 PAYMENT-REQUIRED`; paid + verified → the real per-wallet
score (6-chain compute), settlement kicked best-effort. **Price $0.01/call** (`X402_SCORE_PRICE_ATOMIC ??
'10000'`, 6dp USDC — already market-correct; don't change without reason). Verification is a **hold against
live YPN vault NAV** (`edge-auth`), not a prepaid balance — the payer's capital keeps earning until settlement.
Trust-tiered pricing (`pricing.ts`) is optional; **Attribution is one optional input, never a hard dependency**
(`no-attribution-in-spend.test.ts` guards this).

## 2. Go-live runbook (config + deploy — no code changes)

### Step 1 — Vercel env: turns `503` → real `402` (verify works; settle deferred)
| Var | Value | Notes |
|---|---|---|
| `EDGE_AUTH_URL` | `https://mintware-edge-auth-production.up.railway.app` | already deployed |
| `EDGE_AUTH_SECRET` | *(secret)* | MUST equal edge-auth's `EDGE_API_SECRET` |
| `X402_PAY_TO` | *(receiving address)* | x402 settlement recipient |

Without these the route returns `503 x402_seller_unconfigured` **by design** — do not relax that check.

### Step 2 — deploy the relayer + wire it: turns deferred → live on-chain settle (`tx_hash`)
1. Deploy `services/relayer` (`relayer-server` bin) on Railway (mirrors edge-auth; `railway.json` +
   `rust-toolchain.toml` present) with: `RELAYER_HTTP_SECRET`, `RELAYER_SIGNER_KEY` (funded, holds
   `RELAYER_ROLE` on the gateway — see `treasuryProvisioning.requiredGatewayRoleGrants`), `RELAYER_RPC_URL`,
   `RELAYER_GATEWAY_ADDRESS`.
2. Vercel: `X402_RELAYER_URL` (its base URL), `X402_RELAYER_SECRET` (= relayer's `RELAYER_HTTP_SECRET`),
   `X402_GATEWAY_ADDRESS`, `X402_PERMIT_CHAIN_ID` (defaults to Arc `5042002`). `config.ts` then selects
   `httpSettler` and settle returns a real `tx_hash`.

### Step 3 — settle chain: Base-first
Per canonical-spec §11 decision #4. Do not build Arc settlement in this pass — Arc stays the yield leg, CCTP
rebalances, per the existing topology.

## 3. Gates (do NOT skip)

- **External audit** — the single gate for the whole converged stack. No real value moves through this
  endpoint pre-audit; testnet / deferred-settle demos are fine.
- **Public facilitator listing** — do this **last, post-audit**, so outside agents can route through Mintware
  without a prior integration (the real "agents pay us at scale" step). When it happens, record verified paid
  lookups via the ERC-8004 **Validation Registry** (independent, verifiable) — **not** the Reputation Registry
  (an independent study found it ~90.6% Sybil-coordinated on Base, this stack's chain).

## 4. Done means

`GET /api/x402/score` returns a real `402` in production (not `503`); an agent pays and receives a score
end-to-end on **testnet** with the relayer's live settle path (not `deferredSettler`) — **before** any
real-value / mainnet claim is made publicly.

## 5. Out of scope for activation

- Rebuilding any `lib/x402/*`, the score route, or the pricing model — it exists and is tested; touch only to
  fix an actual bug.
- Arc settlement; MCP transport beyond the P5 code-complete state.
- ERC-8004 Validation Registry recording — a real follow-on (§3), not required to activate.
