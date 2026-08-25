# Attribution-for-Agents (x402 Seller) — Activation Runbook

> **Status (verified 2026-08-25): the 402 seller is ALREADY LIVE in production.**
> `GET https://mintware.finance/api/x402/score?address=0x…` returns a real **HTTP 402** PAYMENT-REQUIRED
> challenge today (confirmed by request) — verify = live YPN NAV hold. The 503 gate is already passed:
> `EDGE_AUTH_URL`/`EDGE_AUTH_SECRET` are set on Vercel; `defaultPayTo()` resolves via the
> `MINTWARE_TREASURY_ADDRESS` fallback (so `X402_PAY_TO` is not required); `supportedNetworks()` defaults to
> `['base','base-sepolia']`. **The one remaining gap is the LIVE SETTLE path**: `X402_RELAYER_URL` is unset,
> so the facilitator uses `deferredSettler` (hold placed, settle deferred). Deploy the relayer + wire it
> (§2 Step 2) to get real on-chain `tx_hash` settlement — audit-gated. This is the go-live delta, NOT a
> rebuild; do not re-spec or reimplement tested code (81/81 Vitest green).

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

### Step 1 — ✅ DONE (verified live 2026-08-25): the `402` challenge is already serving
`EDGE_AUTH_URL` + `EDGE_AUTH_SECRET` are set on Vercel (Production + Preview); `defaultPayTo()` resolves via
the `MINTWARE_TREASURY_ADDRESS` fallback (`X402_PAY_TO` optional — set it only to route x402 receipts to a
DIFFERENT address); `supportedNetworks()` defaults to `['base','base-sepolia']`. So the route already passes
its own guard and returns a real `402` (not `503`). Nothing to do here unless changing the pay-to.

### Step 2 — turn deferred → live on-chain settle (`tx_hash`)

Two ways to wire the on-chain settle leg. **Option A is the platform-consistent one** — settle through
the SAME Privy/oracle signer the card flow already uses, no separate service, no raw key. Option B (the
Rust relayer) stays supported as an override for when you want a dedicated always-on submitter.

`config.ts#getSettler()` precedence: `X402_RELAYER_URL` set → Rust relayer (Option B); else
`X402_SETTLE_PROVIDER=oracle` → in-process oracle/Privy settler (Option A); else `deferredSettler`.

#### Option A — in-process oracle/Privy settle (recommended, Privy-consistent)

The x402 `settleSpend` is submitted by `getOracleSigner('root')` — identical to the card path
(`lib/org/settleSwipe.ts`). With `ORACLE_SIGNER_PROVIDER=privy` the signing key lives in **Privy's
enclave** (a Privy server wallet you control), not in env. No `services/relayer` deploy, no
`RELAYER_SIGNER_KEY`.

**Prereqs (one-time):** the Privy signer setup from `docs/developers/professional-key-setup.md` —
`ORACLE_SIGNER_PROVIDER=privy`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `ROOT_ORACLE_PRIVY_WALLET_ID`,
`ROOT_ORACLE_PRIVY_ADDRESS`. That Privy wallet address must hold `RELAYER_ROLE` on the gateway (grant
below) and hold a little gas on the settle chain.

**Vercel wiring:**
```bash
vercel env add X402_SETTLE_PROVIDER  production   # = oracle   ← flips config.ts to the in-process settler
vercel env add X402_GATEWAY_ADDRESS  production   # = the MintwarePaymentGateway address
vercel env add X402_PERMIT_CHAIN_ID  production   # = settle chain id (Arc 5042002 default; set Base's if Base-first)
vercel env add X402_PAY_TO           production   # = the address that RECEIVES the fees (see note below)
vercel --prod
```

**Grant the role** (once) — the Privy signer address must hold `RELAYER_ROLE` on the gateway or every
settle mines with status 0:
```bash
cast send <GATEWAY> "grantRole(bytes32,address)" $(cast keccak "RELAYER_ROLE") <PRIVY_SIGNER_ADDR> \
  --rpc-url <RPC> --private-key <GATEWAY_ADMIN_KEY>
```

> **Where the fees land — two wallets, not one.** The **signer** above (`getOracleSigner('root')`, a
> Privy wallet) only *submits* the tx and pays gas. The **fee revenue** (the $0.01/call USDC) goes to
> `settleSpend`'s `receiver` = `defaultPayTo()` = **`X402_PAY_TO`** (falling back to the Arc gateway,
> then `MINTWARE_TREASURY_ADDRESS`). **To collect all x402 fees in a Privy wallet you can access, set
> `X402_PAY_TO` to that Privy wallet's address.** Then both the signer and the receiver are Privy wallets
> you control.

#### Option B — Rust relayer (`services/relayer`) — optional override

Use only if you want a dedicated always-on submitter. Root `services/relayer` (`railway.json` already
defines `cargo build --release --bin relayer-server` → `./bin/relayer-server`). Service vars (⚠ = secret;
fails closed without the first three): `RELAYER_HTTP_SECRET` (= Vercel `X402_RELAYER_SECRET`),
`RELAYER_SIGNER_KEY` (funded raw key holding `RELAYER_ROLE`; fallback `RELAYER_SUBMIT_KEY`),
`RELAYER_RPC_URL`, `RELAYER_GATEWAY_ADDRESS` (fallback `GATEWAY_ADDRESS`), `RELAYER_SETTLEMENT_ADDRESS`
(optional, `/settle-batch`), `PORT` (8080). Grant `RELAYER_ROLE` to the signer as above; `curl /health`;
then set Vercel `X402_RELAYER_URL` + `X402_RELAYER_SECRET` (+ `X402_GATEWAY_ADDRESS`/`X402_PERMIT_CHAIN_ID`/
`X402_PAY_TO`) and `vercel --prod`. Note this path needs a **raw** funded key, so it is NOT Privy-consistent.

**Do not do either with real value pre-audit.**

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
