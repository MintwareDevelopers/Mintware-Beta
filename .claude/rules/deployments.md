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

## Cron Jobs (defined in vercel.json)

| Path | Schedule |
|---|---|
| `/api/cron/universal-pipeline` | `30 4 * * *` (4:30am) |
| `/api/cron/epoch-end` | `0 1 * * *` (1am) |
| `/api/cron/pool-settle` | `0 2 * * *` (2am) |
| `/api/treasury/normalize-mev` | `0 3 * * *` (3am) |
| `/api/cron/vault-epoch-close` | `0 0 * * 1` (Monday midnight) |
| `/api/cron/vault-weighted-epoch-close` | `0 1 * * 1` (Monday 1am) |

> Reconciled to `vercel.json` (2026-08-08). The old table listed `/api/treasury/sweep`
> (replaced by `normalize-mev`) and `/api/cron/rwa-hold-snapshot` (RWA shelved — removed).

Hobby plan: max once/day per cron.

Privy rollout note: the Privy integration is already merged on `main` at commit `ec56a62d` and production env/dashboard setup was completed, but it is not live until Vercel can deploy a newer build than the old production commit. On Hobby, frequent cron schedules in `vercel.json` block that deployment; after upgrading Vercel, redeploy `main` (or commit `ec56a62d`) so the `NEXT_PUBLIC_PRIVY_APP_ID` build-time gate can take effect.

## Reown Cloud (WalletConnect)

Project ID: `580f461c981a43d53fc25fe59b64306b`
Allowlisted: `localhost:3000`, `mintware-beta.vercel.app`

## Pending

- Oracle signer key: stored ONLY in the secret manager (Vercel `ORACLE_PRIVATE_KEY` / 1Password) — never commit. ⚠ The value previously committed here was EXPOSED and must be rotated on-chain (see audit 2026-07-31).

If a cron route 404s in production, verify the route file and matching `vercel.json` cron entry are actually merged to `main` before debugging envs. The universal pipeline also depends on the first two schema tables (`trade_signals`, `trade_signal_sync_state`) existing in Supabase; without them the cron cannot create its sync cursor or ingest anything.

## Build Notes

- Vercel webpack builds will fail fast on duplicate App Router paths, so keep the public agents landing page at `/agents` and move leaderboard-style surfaces under a distinct child route like `/agents/leaderboard`.
- Solana wallet-adapter code should not be imported eagerly into the global provider tree during SSR-sensitive builds; lazy-load the Solana provider on the client and never construct `PublicKey` values from placeholder strings at module scope.
