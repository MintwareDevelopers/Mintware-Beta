# Mintware — "Turn It On" Runbook (owner actions)

> These are the steps I can't execute (they need your Railway / Vercel / Supabase / 1Password
> access and a funded key). Each is one command or one dashboard action. **Nothing here is a
> code change — it's flipping built features on.** Do them in order; each unlocks the next.
> ⚠ Everything is testnet + pre-audit — do NOT point any of this at mainnet or real value
> until the external audit is done.

---

## 0. Prereqs
- Repo access with merge rights; Vercel project `mintware-beta`; a Railway account; Supabase project; 1Password/secret manager for keys.

## 1. Merge the ready PRs (done / in flight)
- ✅ `#443` (contracts), `#444` (edge-auth), `#419` (vaults) — merged.
- ⏳ Cards: one clean `consolidate/cards` PR is being prepared (replaces #401/#408). Review + merge it when it lands.

## 2. Rotate the exposed oracle signer key  🔴 BLOCKER before any mainnet
```bash
# generate a fresh signer (or provision a Privy wallet), then on each gateway/settlement contract:
cast send <gateway> "grantRole(bytes32,address)" $(cast keccak RELAYER_ROLE) <NEW_SIGNER> --rpc-url <RPC> --private-key <ADMIN_KEY>
cast send <gateway> "revokeRole(bytes32,address)" $(cast keccak RELAYER_ROLE) <OLD_SIGNER> --rpc-url <RPC> --private-key <ADMIN_KEY>
```
- Update `ORACLE_PRIVATE_KEY` (Vercel + 1Password) to the new key; never commit it.

## 3. Deploy the relayer HTTP server  ⭐ the single biggest unlock
Unblocks: vendor pay, x402 on-chain settle, high-value card settle.
```bash
# services/relayer/railway.json + rust-toolchain.toml already pin the build.
railway login
railway link            # to a new/empty Railway project
railway up --service relayer-server   # from services/relayer/
```
Set on the Railway service (Variables):
```
RELAYER_HTTP_SECRET   = <shared bearer; must equal X402_RELAYER_SECRET below>
RELAYER_SIGNER_KEY    = <funded key holding RELAYER_ROLE on the gateway>   # never log/commit
RELAYER_RPC_URL       = <destination-chain JSON-RPC>
RELAYER_GATEWAY_ADDRESS = <MintwarePaymentGateway>
RELAYER_SETTLEMENT_ADDRESS = <MintwareEthSettlement>   # for /settle-batch
PORT = 8080
```
Confirm: `curl https://<relayer>/health` → ok (settle stays 401/503 until the three secrets are set — fail-closed by design).

## 4. Flip x402 spend live (park/settle)  — the score-seller is already live
On Vercel (Production + Preview):
```
EDGE_AUTH_URL     = https://mintware-edge-auth-production.up.railway.app   # already deployed
EDGE_AUTH_SECRET  = <shared secret; must equal edge-auth's EDGE_API_SECRET>
X402_PAY_TO       = <Privy wallet address to collect fees>
X402_SETTLE_PROVIDER = oracle        # in-process settleSpend via the oracle signer (no raw key)
X402_GATEWAY_ADDRESS = <MintwarePaymentGateway>
X402_PERMIT_CHAIN_ID = <gateway chain id>
# optional relayer transport instead of oracle:
X402_RELAYER_URL / X402_RELAYER_SECRET   # = the §3 relayer + its RELAYER_HTTP_SECRET
```
Routes flip from 503 → live once these are set.

## 5. Arm the ≥$250 edge lane + edge-auth spend gates
On the edge-auth Railway service:
```
EDGE_SIGNER_KEY = <signer for ShortLivedHoldAuth>   # ≥$250 lane fails closed until set
# spend-safety gates (default OFF — turn on deliberately when going live):
#   set the hot-buffer reserve floor + circuit-breaker via the admin surface / MemStore setters
```

## 6. Activate rate-limiting  🔴 currently fail-OPEN in prod
On Vercel:
```
UPSTASH_REDIS_REST_URL   = <upstash url>
UPSTASH_REDIS_REST_TOKEN = <upstash token>
```
Without these the `createHandler` limiter fails open (no limiting). Set both to activate.

## 7. Turn on the built-but-gated features (Vercel, as you want them)
```
TEAM_HARD_GATE = true          # + pnpm add @privy-io/server-auth ; set PRIVY_APP_SECRET ; Privy dashboard RBAC
PRIVY_APP_SECRET = <privy secret>
NEXT_PUBLIC_MW_ROUTER_ENABLED = true    # pools-first meta-router (else LI.FI-only)
NEXT_PUBLIC_VAULTS_LOCKED = <unset/false to show vaults>
LITHIC_AUTO_SETTLE_ENABLED = true       # optional: auto-settle small card captures
```

## 8. Cards — apply the Supabase migrations (after the cards PR merges)
```bash
supabase db push     # applies contracts-v4-adjacent migrations: card_spend_buffer, bridge_card_rail, etc.
```
Enroll the Lithic webhooks (ASA + Events) in the Lithic sandbox dashboard → copy the two signing secrets:
```
LITHIC_API_KEY, LITHIC_WEBHOOK_SECRET, LITHIC_EVENT_WEBHOOK_SECRET
```
(Production card issuance = a separate KYB-gated tier / CPN — not this key.)

## 9. Vault Discovery real data — deploy the subgraph
```
NEXT_PUBLIC_VAULT_SUBGRAPH_URL = <deployed subgraph url>
```
Until set, the Vault Discovery UI falls back to mock data (`lib/vaults/subgraph.ts`).

## 10. Treasury provisioning (per real treasury vault) — REQUIRED, fails silently if skipped
```bash
# grant RELAYER_ROLE to the ORACLE signer on the gateway (factory grants to deployer, NOT the oracle signer):
cast send <gateway> "grantRole(bytes32,address)" $(cast keccak RELAYER_ROLE) <ORACLE_SIGNER>
# point edge-auth at THIS vault (one edge-auth instance = one treasury today):
#   EDGE_VAULT_ADDRESS = <treasury vault> ; EDGE_VAULT_KIND = <kind>
```

---

## What stays gated regardless (external, not a flag)
- **External audit** — the gate over all money surfaces. Nothing above should carry real value until it's done.
- **CPN production card issuer** (Lithic is sandbox), **real deep pools** for float settlement, **Arc mainnet** — partner/capital/ops.
