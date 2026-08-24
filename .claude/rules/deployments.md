# Deployments

## Production

- **URL**: `mintware.finance` (also `mintware-beta.vercel.app`)
- **GitHub**: `https://github.com/MintwareDevelopers/Mintware-Beta`
- **Platform**: Vercel (Hobby plan)
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
| `PRIVY_APP_SECRET` | Server-only | Privy app secret for server-side session verification (`lib/auth/session.ts#verifyPrivySession`). Required for the hard gate to be a real security boundary; unset → verification fails closed. |

### x402 (agent pay-per-call — `lib/x402/*`)

| Variable | Visibility | Notes |
|---|---|---|
| `EDGE_AUTH_URL` / `EDGE_AUTH_SECRET` | Server-only | Base URL + shared secret for the Rust `services/edge-auth` decide/reserve/sign service. **Secret-name note:** the TS caller (`lib/x402/config.ts`) sends `EDGE_AUTH_SECRET`; the Rust service reads **`EDGE_API_SECRET` first, then falls back to `EDGE_AUTH_SECRET`** (`services/edge-auth/src/main.rs`). The live Railway deploy sets `EDGE_API_SECRET`, so both names are accepted — but whichever name(s) you set, **they must hold the SAME value** (it's a shared bearer secret) or `/authorize` will reject the caller. |
| `X402_PAY_TO` | Server-only | Receiving address for x402 settlements |
| `X402_RELAYER_URL` / `X402_RELAYER_SECRET` | Server-only | Rust `services/relayer` HTTP endpoint + bearer secret for `settleSpend`. `_URL` = the deployed `relayer-server` base URL; `_SECRET` must equal the server's `RELAYER_HTTP_SECRET` (shared bearer). |
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
| `/api/cron/vault-epoch-close` | `0 0 * * 1` |
| `/api/cron/vault-weighted-epoch-close` | `0 1 * * 1` |
<!-- /AUTO:crons -->

Hobby plan: max once/day per cron.

Privy rollout note: the Privy integration is already merged on `main` at commit `ec56a62d` and production env/dashboard setup was completed, but it is not live until Vercel can deploy a newer build than the old production commit. On Hobby, frequent cron schedules in `vercel.json` block that deployment; after upgrading Vercel, redeploy `main` (or commit `ec56a62d`) so the `NEXT_PUBLIC_PRIVY_APP_ID` build-time gate can take effect.

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
