# Deployments

## Production

- **URL**: `mintware.finance` (also `mintware-beta.vercel.app`)
- **GitHub**: `https://github.com/MintwareDevelopers/Mintware-Beta`
- **Platform**: Vercel — ⚠ **plan UNCONFIRMED (verify in dashboard).** `vercel.json` declares **5 crons**,
  which **cannot deploy on Hobby** (Hobby caps at 2, once/day). Since the x402 seller is live in prod and
  builds ship (2026-08-27), prod is **almost certainly on Pro** — but confirm the plan + the live commit
  SHA in the dashboard (open task). "Hobby" mentions below are legacy.
- **Branch**: `main` → auto-deploy

## Build

```json
// vercel.json
{
  "buildCommand": "next build --webpack"
}
```

`next build --webpack` forces webpack over Turbopack — needed because Next.js 16.1.6 has Turbopack as default and a prod panic bug (`mod.rs:1526:13`).

## Environment Variables (Vercel)

| Variable | Visibility | Notes |
|---|---|---|
| `LIFI_API_KEY` | Server-only | Renamed from `NEXT_PUBLIC_LIFI_API_KEY` |
| `NEXT_PUBLIC_MW_ROUTER_ENABLED` | Public | **MW meta-router** master switch. `true` = best-execution routing (price a Mintware V4 pool, use it when it beats LI.FI, else fall back to LI.FI). Default off → LI.FI-only, unchanged. |
| `NEXT_PUBLIC_MW_ROUTER_FEE_BPS` / `_MIN_MARGIN_BPS` | Public | Router fee skim + the min margin the internal pool must beat LI.FI by to win. |
| `MW_ROUTER_ADDRESS_{BASE,BASE_SEPOLIA}` / `MW_V4_QUOTER_{…}` | Server-only | Router + V4 quoter addresses per chain (set after deploy; the internal-quote leg no-ops without them → falls back to LI.FI). |
| `NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED` | Public | Gates fee injection |
| `MINTWARE_TREASURY_ADDRESS` | Server-only | Fee injection + calldata verification |
| `NEXT_PUBLIC_MINTWARE_TREASURY` | Public | Client display only |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only (All Envs) | Service role for server routes |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | |
| `AI_ATTRIBUTION_CHAIN_ID` | Server | `8453` (Base mainnet) |
| `CLAIM_MARK_SECRET` | Server | Bearer auth for mark-claimed route |
| `NEXT_PUBLIC_VAULTS_LOCKED` | Public | Set `true` to hide vault pages behind "coming soon" (the real gate; `PHASE2_ENABLED` was removed) |
| `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS` | Public | Gates V4 contract reads |
| `NEXT_PUBLIC_MW_TREASURY_ADDRESS` | Public | Set after contract deploy |
| `TEAM_HARD_GATE` | Server-only | `true` turns ON the Phase-2 User/Team hard gate (`proxy.ts` → `lib/auth/gate.ts`). Unset/`false` = soft-gate showcase, middleware is a pass-through (default). |
| `ALLOW_DEV_BEARER_BYPASS` | Server-only (dev boxes ONLY) | Round-2 audit O-12. `createHandler`'s `auth:'bearer-token'` used to fall OPEN whenever the secret was unset on any `NODE_ENV=development` box (curate/register-class routes unauthenticated locally). It now **fails closed everywhere** (500 `MISSING_SECRET`); set this to `'true'` **and** run with `NODE_ENV=development` to opt back into the local bypass (logged as a warning on every request). Ignored in production/test. Never set on Vercel. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_URL` / `_TOKEN`) | Server-only | Turns every declared `createHandler` `rateLimit` ON. **Unset in prod today ⇒ declared limits are NO-OPS (fail-open)** — `lib/web2/routeHandler.ts` now logs `[routeHandler] rate limiting INACTIVE …` ONCE at boot so the cold-start log says so. Only routes with an in-memory per-IP floor (`/api/gateway/discover`, `/api/gateway/sparklines`) throttle without it (O-8). |
| `PRIVY_APP_SECRET` | Server-only | Privy app secret for server-side session verification (`lib/auth/session.ts#verifyPrivySession`). Required for the hard gate to be a real security boundary; unset → verification fails closed. |
| `ORACLE_SIGNER_PROVIDER` | Server-only | `privy` (verified in prod 2026-09-07 via `GET /api/oracle/signer-check`, bearer `ADMIN_SECRET`) → every `getOracleSigner(role)` resolves a Privy server wallet; `env-key`/unset → raw `*_PRIVATE_KEY` env. Prod `root` = `0x7fD8…7E06` (card/x402/treasury seat). |
| `GATEWAY_ORACLE_PRIVY_WALLET_ID` / `GATEWAY_ORACLE_PRIVY_ADDRESS` | Server-only | **LP Gateway owner seat** (`getOracleSigner('gateway')` — `deploy`/`harvest`/`circuitBreaker`). A DEDICATED Privy wallet (`0x18AE…663c`, the rig owner) with NO fallback to any shared key (re-audit A-3). Set on prod+preview 2026-09-07. Unset ⇒ gateway crons fail closed (`*_signer_unavailable`). |
| `<ROLE>_ORACLE_PRIVY_AUTH_KEY` (e.g. `GATEWAY_ORACLE_PRIVY_AUTH_KEY`, `ROOT_ORACLE_PRIVY_AUTH_KEY`) | Server-only | Round-2 O-6 **credential-level seat separation**. The wallet-API **authorization private key** for that seat's Privy server wallet (created in the Privy dashboard → Wallet API → Authorization keys, then attached to the wallet as its owner). Once a wallet has an authorization keypair, Privy refuses to sign without it — so `PRIVY_APP_SECRET` alone can no longer move that seat's funds. `getOracleSigner(role)` passes it as `walletApi.authorizationPrivateKey` when set. Give `gateway` and `root` DIFFERENT keys. Optional until the dashboard toggle is on; after that, unset ⇒ that seat fails closed (`signer_unavailable`). |
| `LP_GATEWAY_USDG` | Server-only | Quote-asset address the discover feed / registry match against. **RH mainnet (4663) USDG = `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`** — Paxos-NATIVE UUPS proxy, verified 2026-09-07 against Paxos' docs + on-chain (re-audit M-07). Issuer can freeze **and wipe** balances (asset-protection role) — bounded exposure + disclosure. Testnet rig uses mock tUSDG (see `deployments.json`). |
| `ADMIN_SECRET` | Server-only | Bearer for the `(admin)/oracle/*` diagnostics (route group is stripped: `/api/oracle/...`). Set on prod 2026-09-07; unset ⇒ those routes 500 `MISSING_SECRET`. |
| `DECK_PASSWORD` | Server-only | Password for the private investor deck at `/deck` (`lib/deck/gate.ts`). `POST /api/deck/unlock` validates it and sets an http-only cookie holding a hash-derived token; the `/deck` server component renders the deck only when the cookie matches. **Unset ⇒ gate closed to everyone (fail-closed).** Set on Vercel + `.env.local` to open it; share the value with investors out-of-band. |

### x402 (agent pay-per-call — `lib/x402/*`)

| Variable | Visibility | Notes |
|---|---|---|
| `EDGE_AUTH_URL` / `EDGE_AUTH_SECRET` | Server-only | Base URL + shared secret for the Rust `services/edge-auth` decide/reserve/sign service. **Secret-name note:** the TS caller (`lib/x402/config.ts`) sends `EDGE_AUTH_SECRET`; the Rust service reads **`EDGE_API_SECRET` first, then falls back to `EDGE_AUTH_SECRET`** (`services/edge-auth/src/main.rs`). The live Railway deploy sets `EDGE_API_SECRET`, so both names are accepted — but whichever name(s) you set, **they must hold the SAME value** (it's a shared bearer secret) or `/authorize` will reject the caller. |
| `X402_PAY_TO` | Server-only | **Receiving address for x402 fees** — `settleSpend`'s `receiver`, where the per-call USDC lands (`defaultPayTo()`, falls back to `NEXT_PUBLIC_ARC_GATEWAY_ADDRESS` → `MINTWARE_TREASURY_ADDRESS`). Set it to a **Privy wallet address** to collect fees in a Privy wallet you control. Distinct from the signer that submits settle (`getOracleSigner('root')`). |
| `X402_SETTLE_PROVIDER` | Server-only | Chooses the settle model. **`direct`** (⭐ simplest/safest for a fee-collecting seller) → standard x402 "exact": verify the payer's signed EIP-3009 and submit `transferWithAuthorization` so USDC goes **straight to `X402_PAY_TO`** — no vault, no edge-auth, no gateway, no `RELAYER_ROLE`; the submitter (`getOracleSigner('root')`, Privy) is a pure gas payer and needs only gas on the payment network (`DirectFacilitator`/`directSettler`, `lib/x402/config.ts#getFacilitator`). **`oracle`** → the heavier YPN-vault model: in-process `settleSpend` via `getOracleSigner('root')` (burns the payer's vault shares; needs `X402_GATEWAY_ADDRESS` + `X402_PERMIT_CHAIN_ID` + the signer holding `RELAYER_ROLE`; requires `EDGE_AUTH_URL/SECRET`). Unset (default) → `deferredSettler` unless `X402_RELAYER_URL` (Rust relayer) is set. The vault model earns its complexity only when the *payer* wants their balance to keep earning; for collecting a fee, use `direct`. |
| `X402_RELAYER_URL` / `X402_RELAYER_SECRET` | Server-only | **Optional override** — Rust `services/relayer` HTTP endpoint + bearer for `settleSpend` (needs a raw funded key, so NOT Privy-consistent; prefer `X402_SETTLE_PROVIDER=oracle`). `_URL` = the deployed `relayer-server` base URL; `_SECRET` must equal the server's `RELAYER_HTTP_SECRET` (shared bearer). |
| `X402_SUPPORTED_NETWORKS` | Server-only | Comma list of chains the facilitator accepts |
| `X402_TRUST_TIERING` | Server-only | Opt-in `parked` — enables trust-tiered pricing (default off) |
| `X402_SCORE_PRICE_ATOMIC` | Server-only | Per-call price (atomic USDC units) for the score endpoint |
| `X402_GATEWAY_ADDRESS` | Server-only | The `MintwarePaymentGateway` an x402 standing `DelegatedSpendPermit` authorizes — the EIP-712 `verifyingContract` at registration (`POST /api/x402/permit`) AND the settle gateway. `x402PermitGateway()` (`lib/x402/config.ts`) resolves it, falling back to `RELAYER_GATEWAY_ADDRESS` then `NEXT_PUBLIC_ARC_GATEWAY_ADDRESS`. **Unset ⇒ permit register + settle fail closed** (503 / `no_standing_permit`). |
| `X402_PERMIT_CHAIN_ID` | Server-only | Chain id the standing permit's EIP-712 domain binds to. Defaults to Arc (`5042002`); falls back to `EDGE_CHAIN_ID`. Must match the gateway's chain. |

### Relayer HTTP settle server (`services/relayer` — `relayer-server` bin)

The always-on on-chain settle service: `POST /settle` · `POST /settle-batch` · `GET /health`. Every
money-moving gate **fails closed** — the service boots and answers `/health`, but settle stays disabled
(401/503) until the operator sets the bearer + funded key + RPC. Railway-deployable
(`services/relayer/railway.json` + `rust-toolchain.toml`, mirroring edge-auth). **Not deployed yet** —
this is the "always-on relayer" in the deploy-gated remainder; runs live only when these are set.

| Variable | Visibility | Notes |
|---|---|---|
| `RELAYER_HTTP_SECRET` | Server-only | Bearer secret guarding `/settle` + `/settle-batch`. **Unset ⇒ all settle requests 401 (fail closed).** Must equal the caller's `X402_RELAYER_SECRET` (and any org/card caller's relayer secret). |
| `RELAYER_SIGNER_KEY` | Server-only | Funded signer key (holds `RELAYER_ROLE` on the Gateway / settlement contract). Falls back to `RELAYER_SUBMIT_KEY`. **Unset/invalid ⇒ 503 `signer_unavailable`** (never runs keyless). Never log or commit. |
| `RELAYER_RPC_URL` | Server-only | Destination-chain JSON-RPC. **Unset ⇒ 503 `rpc_unavailable`.** |
| `RELAYER_GATEWAY_ADDRESS` | Server-only | Default `MintwarePaymentGateway` for `/settle` (per-request `gateway` overrides). Falls back to `GATEWAY_ADDRESS`. |
| `RELAYER_SETTLEMENT_ADDRESS` | Server-only | Default `MintwareEthSettlement` for `/settle-batch` (per-request `settlement` overrides). Falls back to `SETTLEMENT_ADDRESS`. |
| `PORT` | Server-only | Bind port (default `8080`). |

### Cards (Lithic sandbox — human org cards)

| Variable | Visibility | Notes |
|---|---|---|
| `LITHIC_API_KEY` | Server-only | Lithic sandbox API key — self-serve, no KYB. Production issuance is a separate gated tier, not this key. |
| `LITHIC_ENV` | Server-only | `sandbox` (default) or `production` — only ever `sandbox` until a real production tier exists |
| `LITHIC_WEBHOOK_SECRET` | Server-only | ASA responder HMAC secret (`whsec_...`) from enrolling the webhook endpoint in the Lithic sandbox dashboard. Unset = webhook fails closed with 503, never a fake decline. |
| `LITHIC_EVENT_WEBHOOK_SECRET` | Server-only | Signing secret for the **general Events** subscription (`card_transaction.updated`) → `/api/cards/lithic/capture-webhook`. DISTINCT from the ASA secret. Unset = capture webhook fails closed (503). |
| `LITHIC_AUTO_SETTLE_ENABLED` | Server-only | `'true'` turns ON automatic on-chain settlement when Lithic reports a capture. **Default OFF** — every capture is acked and left for a manual "Settle" click. Enabling lets the oracle signer settle small swipes with no human in the loop, so it's a deliberate ops act. |
| `LITHIC_AUTO_SETTLE_MAX_USD` | Server-only | Auto-settle ceiling (default `50`). Approved swipes above this are left for manual review. Hard-capped just under the gateway's $250 edge-sig boundary regardless. |

### Card spend buffer (docs/developers/card-spend-buffer-spec.md — testnet/pre-audit)

Two INDEPENDENT dark-launch flags, both **OFF by default and fail-closed**. The buffer model is a
pre-funded flat balance the issuer checks at auth time, topped up from the member's vault position —
a real card rail can't survive a live AMM-NAV read in the ~6s ASA window (spec §1).

| Variable | Visibility | Notes |
|---|---|---|
| `CARD_BUFFER_ENABLED` | Server-only | `'true'` makes `decideCardSwipe` use the FLAT buffer check (`lib/cards/bufferPolicy.authorizeAgainstBuffer` against `card_spend_buffers.buffer_balance_atomic`) INSTEAD of the live-NAV `edge.authorize` on the card rail, for any card that has a buffer row. Unset/other → the edge-auth path is byte-for-byte unchanged. |
| `CARD_BUFFER_REFILL_ENABLED` | Server-only | `'true'` lets `lib/org/bufferRefill.refillCardBuffer` submit the on-chain `MintwarePaymentGateway.refillBuffer` (redeem the member's own senior shares → their registered buffer wallet, via `getOracleSigner('root')` in the RELAYER seat). Unset → the orchestrator no-ops (`reason:'disabled'`). Also gated per-card by `auto_refill_enabled` + a registered buffer + a live permit + the refill-rate breaker. |
| `CARD_BUFFER_TUNE_WINDOW_SECS` / `_ALPHA_BPS` / `_MIN_SAMPLES` | Server-only | Adaptive sizing (`lib/org/bufferTuner.tuneBufferSizing`, run by the refill cron — spec §5.3). Observation window (default 30d), EMA blend rate toward the measured distribution (default `3000` = 30%), and the min settled-swipe sample count before it tunes (default `5`). No capital — only re-shapes the target. |

### LP Gateway (V1) — Robinhood Chain (`lib/gateway/*`, `app/api/gateway/*`, gateway crons, deploy scripts)

**One home for every `LP_GATEWAY_*` var** (round-2 audit O-14 #7 — ~24 were undocumented). Generated by
`grep -rn 'process.env.LP_GATEWAY' lib app scripts` on 2026-09-08; re-run that grep when you add one. All
money-moving knobs default **OFF / fail-closed**. `LP_GATEWAY_USDG` (quote asset) is in the main table above.

| Variable | Read by | Default | Meaning · fail-closed behaviour |
|---|---|---|---|
| `LP_GATEWAY_CHAIN_ID` | `lib/gateway/chain.ts`, deploy + smoke scripts | — (scripts: `46630`) | Chain id of the live rig. **`gatewayConfig()` returns `null` without it** → every gateway route/cron answers `503 gateway_not_configured`. |
| `LP_GATEWAY_RPC_URL` | `chain.ts`, scripts | — (scripts: RH testnet RPC) | JSON-RPC for server reads + signer submits. Required with `CHAIN_ID` (same `null` ⇒ 503). ⚠ echoed by `/api/gateway/meta` (HO-13) — never put a keyed provider URL here. |
| `LP_GATEWAY_POSITION_MANAGER` | `chain.ts`, smoke | — | The single-env fallback PM instance (pre-registry). See the depositable rule in `lp-gateway.md` — the registry (`gateway_instances`, on-chain-verified) is the trust root; this env is the bootstrap/last-resort. |
| `LP_GATEWAY_STAGING` | `chain.ts` | — | Staging (Morpho earn reserve) paired with the env PM. |
| `LP_GATEWAY_POOL_ADDRESS` | `chain.ts` | — | The env PM's pool key. Must be the **32-byte v4 poolId** (or 20-byte address), never a label — the label convention was the root cause of HO-2. |
| `LP_GATEWAY_USDG` | `discovery.ts`, `meta` route, registry | **unset in prod (2026-09-08)** | USDG address the Discover feed / curator queue / registry match **by ADDRESS**. **Unset ⇒ quote asset UNKNOWN ⇒ every pool ineligible ⇒ Discover feed EMPTY + curator queue ingests nothing (fail-closed, O-7; never matched by pair name any more).** Set it (RH mainnet `0x5fc5360D…1d168`, testnet = the rig's tUSDG) to light the feed. Route response carries `usdgConfigured:false` while unset. |
| `LP_GATEWAY_GT_NETWORK` | `discovery.ts`, `sparkline.ts` | `robinhood` (= RH **mainnet** on GeckoTerminal) | GeckoTerminal network slug. Shape-checked (`[a-z0-9-]`) — an invalid value falls back to `robinhood`. |
| `LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS` | `discovery.ts` | `72` | An auto+pending candidate that drops out of the top-30 is pruned only after this many hours unseen (three daily runs). Curator-decided (`approved`/`rejected`) and `manual` rows are **never** pruned. |
| `LP_GATEWAY_CURATOR_SECRET` | `app/api/gateway/curate` | — | Bearer for `POST /api/gateway/curate`. **Unset ⇒ 500 `MISSING_SECRET`** (fails closed; no dev bypass without `ALLOW_DEV_BEARER_BYPASS`). |
| `LP_GATEWAY_HARVEST_ENABLED` | `harvest.ts` | OFF | `'true'` lets the harvest cron collect fees. Unset ⇒ `503 disabled`. ⚠ Not scheduled in `vercel.json` (see crons). |
| `LP_GATEWAY_HARVEST_MIN_ATOMIC` | `harvest.ts` | `1000000` (1 USDG) | Dust floor — skip a harvest whose collectable quote fees are below it. `0` disables the floor. |
| `LP_GATEWAY_HARVEST_DESTINATION` | `opsConfig.ts` | `buffer` | `buffer` = credit depositors' spendable buffers (the A-4 ledger — **not safe for third-party funds until event-indexed**, O-4) · `restake` = compound into Morpho, lifting NAV pro-rata (the recommended setting today). |
| `LP_GATEWAY_PERF_FEE_BPS` | `harvest.ts` | `1000` (10%) | Performance fee skimmed from harvested fees. Clamped 0–10000. |
| `LP_GATEWAY_DEPLOY_ENABLED` | `deploy.ts` | OFF | `'true'` lets the deploy cron move staged capital into the LP. Unset ⇒ `503 disabled`. ⚠ Not scheduled in `vercel.json`. |
| `LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC` | `deploy.ts` | `0` | Min staged balance before a deploy. **`0` ⇒ never deploys** (`below_threshold`). Malformed ⇒ throws → 500 (fail-closed, no reason code — HO-16). |
| `LP_GATEWAY_DEPLOY_RATIO_BPS` | `deploy.ts` | `5000` | Target deployed fraction of (staged + deployedPrincipal), cost-basis (C-3). On-chain `MAX_DEPLOY_BPS` is the hard cap regardless. |
| `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY` | `deploy.ts` | `0` | Absolute-`L` slippage floor passed to `deploy()`. **`0` ⇒ the cron REFUSES to deploy** (A-3). One global value for all pools — O-9 (per-pool compute-from-spot) is still open. |
| `LP_GATEWAY_DEPLOY_WINDOW_SECS` | `deploy.ts` | `3600` | Idempotency window for the deploy claim (L-02). |
| `LP_GATEWAY_DEPLOY_REF_MAX_DEV_BPS` | `deploy.ts` | `500` | **Round-3 XR-2.** Max deviation (bps) between spot and the EXTERNAL reference price (GeckoTerminal's last price for this pool via the Discover feed) before the cron refuses to deploy (`ref_price_deviation`). The on-chain band is pre-flighted too: out of band ⇒ the cron `poke()`s one step and returns `ref_catching_up` instead of sending a reverting deploy. |
| `LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE` | `deploy.ts` | `true` | **Fail-closed default:** no external reference for the pool ⇒ `ref_price_unavailable`, no deploy. Only an explicit `false` waives it — the **testnet rig** needs `false` (GeckoTerminal has no testnet data); never set it on mainnet. |
| `LP_GATEWAY_CIRCUIT_BREAKER_ENABLED` | `opsConfig.ts` | OFF | `'true'` lets a sustained out-of-range alert auto-`setPaused(true)` (blocks deposits, never withdraw). Never auto-unpauses. |
| `LP_GATEWAY_ALERT_DEBOUNCE_SECS` | `alerts.ts` | `21600` (6 h) | Min gap between repeat alerts of one kind per instance. |
| `LP_GATEWAY_ROUTER_ADDRESS` / `LP_GATEWAY_QUOTER` | `routerSwap.ts`, `v4SwapExec.ts` | — | The paired↔quote swap executor + quoter. **Unset ⇒ swap seams are fail-closed no-ops** (harvest leaves paired fees unconverted; deploy can't acquire the paired leg). Also needs `NEXT_PUBLIC_MW_ROUTER_ENABLED=true`. |
| `LP_GATEWAY_SWAP_SLIPPAGE_BPS` | `v4SwapExec.ts` | `100` (1%) | Slippage bound for the executor swap. Clamped 1–5000. |
| `LP_GATEWAY_YIELD_SOURCE` | `scripts/deploy-lp-gateway-robinhood.mjs` (deploy-time) | — (mock `MockERC4626` deployed) | Real ERC-4626 yield source (the curated Morpho vault on mainnet). Code + `asset()` checked at deploy; unset on testnet ⇒ a mock source behind the **production** adapter. |
| `LP_GATEWAY_TUSDG` | `scripts/smoke-lp-gateway-robinhood.mjs` | rig default | Smoke-test token override. Test-only. |
| `LP_TICK_LOWER` / `LP_TICK_UPPER` / `LP_MAX_DEVIATION_BPS` | deploy script (deploy-time, immutable per instance) | `±22980` / `500` | Range width and the clamped-follower per-block step (H-03). **Default is 500 bps (5%)**, not the "2000" older docs cited. |
| `LP_FORK_RPC_URL` | Forge fork tests | — | Self-skips the fork suites when unset (CI stays green). |
| `GATEWAY_ORACLE_PRIVY_WALLET_ID` / `_ADDRESS` | `getOracleSigner('gateway')` | — | See the main table — the dedicated owner seat; no `root` fallback in app code. ⚠ The deploy script still falls back to `ROOT_*` silently (HO-14, open). |

**Cron truth (`vercel.json`, 2026-09-08):** `gateway-discover` = **daily `0 5 * * *`** (NOT "every 3h"),
`gateway-snapshot` = daily `0 6 * * *`. **`gateway-harvest` and `gateway-deploy` are NOT scheduled** — they
exist as bearer routes and run only when hit manually with `CRON_SECRET` (and their `*_ENABLED` flag on).

### Arc / parking account (idle-USDC-earns-in-place)

| Variable | Visibility | Notes |
|---|---|---|
| `ARC_RPC_URL` | Server-only | Circle Arc L1 RPC (chain `5042002`) |
| `ARC_USDC` | Server-only | USDC token address on Arc |
| `ARC_YIELD_SOURCE` | Server-only | Arc yield primitive — XyloVault `0x240Eb8…f747` |
| `NEXT_PUBLIC_ARC_VAULT_ADDRESS` | Public | Deployed Arc spend-stack vault |
| `NEXT_PUBLIC_ARC_GATEWAY_ADDRESS` | Public | Spend gateway address |
| `NEXT_PUBLIC_ARC_CCTP_ROUTER` | Public | CCTP router for Base↔Arc USDC bridging |
| `ARC_CPN_TREASURY` | Server-only | Circle Payments Network treasury |
| `MINTWARE_PARK_VAULT` / `MINTWARE_PARK_USDC` / `MINTWARE_PARK_RPC` | Server-only | Parking-account vault, USDC, and RPC |

## Cron Jobs (defined in vercel.json)

> **This table is the one home for cron facts, and it is generated** from `vercel.json`
> by `pnpm context:sync` — never hand-edit between the AUTO markers (see `.claude/CONTEXT-MAP.md`).

<!-- AUTO:crons -->
<!-- generated by scripts/context-sync.mjs — do not edit by hand -->
| Path | Schedule |
|---|---|
| `/api/cron/universal-pipeline` | `30 4 * * *` |
| `/api/treasury/normalize-mev` | `0 3 * * *` |
| `/api/cron/vault-weighted-epoch-close` | `0 1 * * 1` |
| `/api/cron/farcaster-weekly-cast` | `0 2 * * 1` |
| `/api/cron/gateway-discover` | `0 5 * * *` |
| `/api/cron/gateway-snapshot` | `0 6 * * *` |
<!-- /AUTO:crons -->

⚠ **Legacy (Hobby) note:** "max once/day per cron" applied on Hobby. With **5 crons live in `vercel.json`**
this only holds if prod is on **Pro** — confirm the plan (see Production above). The old "Hobby frequent
crons block deployment / Privy not live until a newer build deploys" caveat is **STALE**: prod is shipping
newer builds (x402 seller went live 2026-08-27), so deployment is no longer blocked. Confirm Privy's actual
live status against the deployed commit rather than trusting this note.

## Reown Cloud (WalletConnect)

Project ID: `580f461c981a43d53fc25fe59b64306b`
Allowlisted: `localhost:3000`, `mintware-beta.vercel.app`

## Pending

- Oracle signer key: stored ONLY in the secret manager (Vercel `ORACLE_PRIVATE_KEY` / 1Password) — never commit. ⚠ The value previously committed here was EXPOSED and must be rotated on-chain (see audit 2026-07-31).

If a cron route 404s in production, verify the route file and matching `vercel.json` cron entry are actually merged to `main` before debugging envs. The universal pipeline also depends on the first two schema tables (`trade_signals`, `trade_signal_sync_state`) existing in Supabase; without them the cron cannot create its sync cursor or ingest anything.

## Testnet deployments (landed on `main` via PR #264 — dark-launched)

**All testnet, empty, unaudited.** On `main` ≠ live — every money surface is flag/env-gated off in prod.
External audit is the only gate left before real value.

- **Arc testnet** (Circle Arc L1, chain `5042002`) — YPN spend stack (vault + gateway + CCTP router).
- **Base Sepolia** — ULV engine + ETH-collateral/settlement stack.

Foundry deploy scripts (`contracts-v4/script/`):

| Script | Deploys |
|---|---|
| `DeployArcSpendStack.s.sol` | Arc YPN spend stack |
| `DeployEthCollateralVault.s.sol` | ETH-collateral vault |
| `DeployEthSettlement.s.sol` | ETH settlement stack (`MintwareEthSettlement`) |
| `DeployFloatSettlement.s.sol` | **Go-forward** YPN float settlement (`MintwareTreasuryFloatSettlement`) — establishes the deploy path; env-with-mock-fallback. AUDIT + real-deep-pool gated (needs real wstETH/ETH + ETH/USDC pools + Lido/oracle refs for real use; testnet uses mocks). Carries a **pool-depth pre-flight guard** — see below. |
| `DeployWeightedDistributor.s.sol` | Vault-weighted epoch reward rail |

### Float-settlement mainnet references + pool-depth guard (`DeployFloatSettlement.s.sol`)

**Still env-gated until real deep pools exist.** The float settlement's keeper 2-hop
(wstETH → ETH → USDC) + emergency swap need DEEP `wstETH/ETH` + `ETH/USDC` pools and real Lido/Aave
references. The pool liquidity itself is an ops/capital step (out of scope here); the *code* half is:

**Mainnet reference addresses** (canonical **Ethereum mainnet**; documented, env-overridable **defaults** —
NOT hardcoded into any audited contract; one home = [`config/settlement.ts`](../../config/settlement.ts)).
**⚠ VERIFY every address before deploy** — exact-address correctness is a deploy-time responsibility; set
each explicitly in the deploy env and re-check against Etherscan / the protocol's own docs:

| Ref | Address (⚠ VERIFY at deploy) | Deploy env var |
|---|---|---|
| Lido `wstETH` (18dp) | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `WSTETH_ADDRESS` (+ `LIDO_RATE_SOURCE`) |
| Lido `stETH` (18dp) | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | (rate math ref) |
| Aave v3 `Pool` | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | (idle rehypothecation ref) |
| `WETH` (18dp) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `WETH_ADDRESS` |
| `USDC` (6dp) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `USDC_ADDRESS` |

**Pool-depth pre-flight guard.** Before deploying the settlement the script reads the **actual** in-range
liquidity of BOTH canonical pools (`StateLibrary.getLiquidity(poolManager, poolId)`) and **reverts
`PoolTooThin`** if either is below `MIN_POOL_LIQUIDITY` — so it is impossible to stand the settlement up
against a thin pool. Controls:
- `ENFORCE_POOL_DEPTH` — default `= !INIT_POOLS`, i.e. **ON for a real deploy** (real pools already exist →
  `INIT_POOLS=false`), **OFF on the mock rig** (freshly-initialized mock pools have no real depth, mirroring
  how the script relaxes its other mock-only gates).
- `MIN_POOL_LIQUIDITY` — the floor (Uniswap-V4 `L` units, **pool-specific, not USD**). Default
  `MIN_POOL_LIQUIDITY_DEFAULT = 1e15` is a conservative placeholder that **⚠ MUST be tuned per pool/decimals
  at deploy**.

This whole path stays **env-gated + audit-gated**: on testnet it runs against mocks (guard skipped); a real
mainnet deploy requires the verified addresses above, real deep pools passing the depth guard, real Lido/oracle
references, and an external audit.

## Build Notes

- Vercel webpack builds will fail fast on duplicate App Router paths, so keep the public agents landing page at `/agents` and move leaderboard-style surfaces under a distinct child route like `/agents/leaderboard`.
- Solana wallet-adapter code should not be imported eagerly into the global provider tree during SSR-sensitive builds; lazy-load the Solana provider on the client and never construct `PublicKey` values from placeholder strings at module scope.
