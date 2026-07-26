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
| `NEXT_PUBLIC_PHASE2_ENABLED` | Public | Gates vault pages — not set until Phase 2 launch |
| `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS` | Public | Gates V4 contract reads |
| `NEXT_PUBLIC_MW_TREASURY_ADDRESS` | Public | Set after contract deploy |

## Cron Jobs (defined in vercel.json)

| Path | Schedule |
|---|---|
| `/api/cron/bridge-verify` | `0 0 * * *` (midnight) |
| `/api/cron/epoch-end` | `0 1 * * *` (1am) |
| `/api/cron/pool-settle` | `0 2 * * *` (2am) |
| `/api/treasury/sweep` | `0 3 * * *` (3am) |
| `/api/cron/vault-epoch-close` | `0 0 * * 1` (Monday midnight) |

Hobby plan: max once/day per cron.

Privy rollout note: the Privy integration is already merged on `main` at commit `ec56a62d` and production env/dashboard setup was completed, but it is not live until Vercel can deploy a newer build than the old production commit. On Hobby, frequent cron schedules in `vercel.json` block that deployment; after upgrading Vercel, redeploy `main` (or commit `ec56a62d`) so the `NEXT_PUBLIC_PRIVY_APP_ID` build-time gate can take effect.

## Reown Cloud (WalletConnect)

Project ID: `580f461c981a43d53fc25fe59b64306b`
Allowlisted: `localhost:3000`, `mintware-beta.vercel.app`

## Pending

- `CORE_DAO_BRIDGE_CONTRACT` — blocked on Molten confirmation (`0x__PENDING_MOLTEN_CONFIRMATION__`)
- Oracle private key to import: `dec4d807960fdd609d64da1c71f4a94b2bcefacd50e5a4acd77120184f88b615`

If a cron route 404s in production, verify the route file and matching `vercel.json` cron entry are actually merged to `main` before debugging envs. The universal pipeline also depends on the first two schema tables (`trade_signals`, `trade_signal_sync_state`) existing in Supabase; without them the cron cannot create its sync cursor or ingest anything.

## Build Notes

- Vercel webpack builds will fail fast on duplicate App Router paths, so keep the public agents landing page at `/agents` and move leaderboard-style surfaces under a distinct child route like `/agents/leaderboard`.
- Solana wallet-adapter code should not be imported eagerly into the global provider tree during SSR-sensitive builds; lazy-load the Solana provider on the client and never construct `PublicKey` values from placeholder strings at module scope.
