# Production Readiness Inspection

Last audited: 2026-04-03
Owner: Codex review pass

## Executive Summary

Mintware is materially closer to production-ready than the repo state suggested at the start of this audit. The biggest shift is that Solana is now treated the way the product actually intends: strategically paused and technically gated. The app completes a full fresh local production build with `pnpm exec next build --webpack`, the live client surfaces no longer mount Solana wallet code, and the remaining Solana-only API routes now return `410` while the feature flag is off.

The platform is not "100% production ready" yet, but the remaining issues are now clear and bounded:

- the true Solana pause pass still needs to be pushed to `main` and redeployed
- Supabase migration history is drifted between repo and production
- a few runtime/build warnings remain and should be cleaned up deliberately
- the canonical architecture map in [`docs/ARCHITECTURE.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/ARCHITECTURE.md) is stale and no longer matches the product

## Current Readiness Status

### Ready or close to ready

- GitHub is usable as the source of truth again, with Privy, public GitBook docs, the Vercel cron fix, and the Ethereum UX upgrade already pushed to `main`.
- Vercel is correctly linked to project `mintware-beta`.
- Supabase is linked to the live project `bqwcwrnqpayfndgmceal` and reports `ACTIVE_HEALTHY`.
- The app now completes a full local production build after the Solana config restore.
- Core user-facing surfaces are coherent:
  - onboarding and identity
  - swap and trading
  - campaigns and claims
  - social vaults
  - Solana wallet linking

### Still not fully ready

- The true Solana pause pass is local in this branch and not yet part of `main`.
- Production schema history is drifted from repo migration history.
- Public and internal architecture docs are not aligned with current code boundaries.
- Build/runtime warnings still need triage even though they are not blocking the build.

## Deployment Reality

### Intended pipeline

```text
Local repo -> GitHub main -> Vercel production deploy -> https://www.mintware.finance/
GitHub docs/main -> GitBook GitHub Sync -> public docs
```

### Actual current reality

- GitBook is already GitHub-synced.
- Vercel is already linked to the correct project.
- Production fell behind because:
  - `main` had real code that was not deploying cleanly
  - then Vercel builds were blocked by lockfile drift
  - then by the missing Solana config module
- Those deployment blockers are now understood. The remaining missing step is to land the Solana config fix on `main` and let Vercel redeploy it.

## Updated System Map

### Frontend and runtime shell

- Next.js app on Vercel
- `app/` contains public pages, app pages, and server routes
- React Query, wagmi, RainbowKit, Privy, and optional Solana wallet-adapter power wallet-aware UX

### Identity layer

Primary entry points:

- [`components/web2/providers.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/web2/providers.tsx)
- [`lib/web3/useMintwareIdentity.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web3/useMintwareIdentity.ts)
- [`app/api/(web3)/wallet-link/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web3)/wallet-link/route.ts)

Current behavior:

- Privy provides email-first onboarding plus embedded EVM wallets.
- Wagmi remains the transaction/auth bridge for EVM.
- Solana support is feature-flagged and loaded lazily.
- `useMintwareIdentity()` abstracts:
  - external EVM wallets
  - Privy embedded wallets
  - Solana wallets
- Solana wallet linking is a separate signed linking flow, not the primary session model.

### Data layer

Primary entry points:

- [`lib/web2/supabase.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web2/supabase.ts)
- [`supabase/config.toml`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/supabase/config.toml)
- [`supabase/migrations/`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/supabase/migrations)

Current behavior:

- browser uses anon-key Supabase client with RLS
- server/API routes use service-role access through `createSupabaseServiceClient()`
- production project ref is `bqwcwrnqpayfndgmceal`

### External dependencies

- Cloudflare attribution worker for read-side scoring and analytics
- LI.FI for EVM routing and quote generation
- Jupiter Terminal for Solana swapping
- Base-mainnet distributor/oracle flows for reward publication and claims

### Scheduler and automation layer

Primary entry points:

- [`vercel.json`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/vercel.json)
- [`app/api/(rewards)/cron/universal-pipeline/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-pipeline/route.ts)

Current scheduled routes:

- `/api/cron/universal-pipeline`
- `/api/cron/bridge-verify`
- `/api/cron/epoch-end`
- `/api/cron/pool-settle`
- `/api/treasury/sweep`
- `/api/cron/vault-epoch-close`

## Product Flow Map

### 1. Onboarding and wallet identity

```text
User lands on app
-> Privy + wallet choices exposed in providers
-> embedded wallet can be created on login
-> wagmi session becomes active for EVM transactions
-> optional Solana wallet can be connected and linked later
```

Key files:

- [`app/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/page.tsx)
- [`components/web2/providers.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/web2/providers.tsx)
- [`lib/web3/useMintwareIdentity.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web3/useMintwareIdentity.ts)
- [`app/(rewards)/profile/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/profile/page.tsx)
- [`app/api/(web3)/wallet-link/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web3)/wallet-link/route.ts)

### 2. EVM swap and trading

```text
Swap page
-> client asks server for LI.FI quote
-> /api/swap/quote injects fee/referrer server-side
-> user reviews swap in app UI before wallet prompt
-> wallet signs and route executes
-> swap event hits Mintware reward attribution route
-> rewards/activity are written into Supabase
```

Key files:

- [`app/(web3)/swap/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(web3)/swap/page.tsx)
- [`components/rewards/swap/SwapWidget.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/swap/SwapWidget.tsx)
- [`components/rewards/swap/SwapConfirmSheet.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/swap/SwapConfirmSheet.tsx)
- [`hooks/useSwap.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/hooks/useSwap.ts)
- [`app/api/(web2)/swap/quote/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web2)/swap/quote/route.ts)
- [`app/api/(rewards)/campaigns/swap-event/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/campaigns/swap-event/route.ts)
- [`lib/rewards/swapHook.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/rewards/swapHook.ts)

### 3. Solana swap attribution

```text
Paused strategically and now gated:
-> client Solana wallet surfaces do not mount in the live app
-> wallet linking, Solana claim, and Solana swap ingestion routes return 410 while paused
-> deeper Solana implementation remains in-repo for later reuse
-> no live production flow depends on Solana being available
```

Key files:

- [`components/rewards/swap/JupiterTerminal.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/swap/JupiterTerminal.tsx)
- [`app/api/(rewards)/campaigns/sol-swap-event/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/campaigns/sol-swap-event/route.ts)
- [`lib/web3/verifySolanaTx.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web3/verifySolanaTx.ts)
- [`config/solana.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/config/solana.ts)

### 4. Campaign creation and funding

```text
Creator configures campaign
-> app creates campaign row in Supabase
-> UI checks allowance state and approval needs
-> wallet approves only if needed
-> wallet funds distributor/campaign on-chain
```

Key files:

- [`app/(rewards)/create-campaign/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/create-campaign/page.tsx)
- [`components/rewards/creator/Step5Review.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/creator/Step5Review.tsx)
- [`app/api/(rewards)/campaigns/create/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/campaigns/create/route.ts)

### 5. Reward claim flow

```text
ClaimCard asks /api/claim/status for pending/claimable rows
-> user selects claim or batch claim
-> /api/claim reconstructs Merkle proof server-side
-> wallet submits on-chain claim
-> /api/claim/mark-claimed updates the off-chain record
```

Key files:

- [`components/rewards/campaigns/ClaimCard.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/campaigns/ClaimCard.tsx)
- [`app/api/(rewards)/claim/status/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/status/route.ts)
- [`app/api/(rewards)/claim/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/route.ts)
- [`app/api/(rewards)/claim/mark-claimed/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/mark-claimed/route.ts)
- [`app/api/(rewards)/claim/sol/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/sol/route.ts)

### 6. Social vaults

```text
User creates or views vault
-> approve token only when needed
-> simulate deposit/seed before submitting
-> on-chain tx executes
-> companion API routes mirror/reconcile off-chain state
```

Key files:

- [`app/(rewards)/vaults/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vaults/page.tsx)
- [`app/(rewards)/vault/create/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vault/create/page.tsx)
- [`app/(rewards)/vault/[id]/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vault/[id]/page.tsx)
- [`lib/web3/vault/useSocialVault.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web3/vault/useSocialVault.ts)
- [`app/api/(rewards)/vault/deposit/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/vault/deposit/route.ts)
- [`app/api/(rewards)/vault/withdraw/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/vault/withdraw/route.ts)
- [`app/api/(rewards)/vault/rebalance/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/vault/rebalance/route.ts)

### 7. Universal rewards pipeline

```text
Cron invokes /api/cron/universal-pipeline
-> sync trade signals from configured chain/hook
-> settle universal epochs
-> bridge universal distributions into the distributor pipeline
```

Key files:

- [`app/api/(rewards)/cron/universal-pipeline/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-pipeline/route.ts)
- [`app/api/(rewards)/cron/universal-trade-signals/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-trade-signals/route.ts)
- [`app/api/(rewards)/cron/universal-epoch-close/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-epoch-close/route.ts)
- [`app/api/(rewards)/cron/universal-distribution-bridge/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-distribution-bridge/route.ts)

## Dependencies and Responsibility Boundaries

### Mintware-owned

- app shell and UX
- API routes
- Supabase writes and server-side reads
- campaign creation, participation, reward accounting
- vault state and off-chain bookkeeping
- cron orchestration

### External but critical

- Privy for onboarding/session UX
- wagmi and wallet providers for EVM execution
- Solana wallet-adapter and Jupiter remain dormant dependencies for later reuse
- LI.FI for EVM routing
- Cloudflare attribution worker for score/read surfaces
- Vercel for deploy/runtime/cron hosting

### Boundary that matters most

The attribution worker is still read-side infrastructure. Writes and reward truth live in Mintware API routes and Supabase. That split remains critical and the stale architecture doc underplays how much more Mintware-owned state now exists.

## Production Risks and Findings

### P1: Supabase migration history is drifted

Observed from linked project `bqwcwrnqpayfndgmceal`:

- remote-only versions:
  - `20260401000001`
  - `20260401000002`
  - `20260401000003`
- local-only versions:
  - `20260329000003`
  - `20260401000004`
  - `20260401000005`
  - `20260401000006`
  - `20260401000007`
- duplicate local migration version numbers also exist in repo

Impact:

- repo is not a clean authoritative history of production schema changes
- `supabase db push` would be unsafe right now
- schema reconciliation needs to happen before any confident database rollout process

### P1: Solana pause pass is local until pushed

The client/API gating changes exist in this branch, not yet on `main`.

Impact:

- the repo now has a safe paused posture locally
- production will still expose residual Solana behavior until this is pushed and redeployed
- this is the shortest path to ensuring paused Solana cannot affect production again

### P2: Architecture documentation is stale

[`docs/ARCHITECTURE.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/ARCHITECTURE.md) still describes:

- LI.FI as client-side only
- older cron assumptions
- pre-Privy identity boundaries
- older campaign/reward language

Impact:

- engineering onboarding is misleading
- production debugging takes longer because the map is no longer trustworthy

### P2: Build warnings remain

Observed during the successful local production build:

- `middleware` convention deprecation warning
- `@upstash/redis` Edge runtime warning
- Privy optional dependency warning for `@farcaster/mini-app-solana`
- noisy server-side `WalletContext` / `indexedDB` logs during static generation

Impact:

- not blockers today
- should be triaged before calling the platform fully production-hardened

## What Changed Since the Old Architecture Map

- Privy and embedded wallets are now part of the onboarding path.
- Identity is unified across EVM, embedded wallets, and optional Solana.
- LI.FI quoting is server-mediated for fee/referrer enforcement.
- Ethereum UX improvements are live in the codebase:
  - pre-wallet review
  - fiat-first fee display
  - safer approvals
  - stronger claim/campaign/vault transaction UX
- Solana is now treated as dormant infrastructure rather than an active live surface.
- Universal reward cron orchestration exists and should be treated as a first-class system component.
- Social vaults are no longer a side experiment; they are now a real on-chain + API surface.

## Solana Status

Solana should currently be treated as:

- paused strategically
- preserved in-repo for later
- blocked from the live product surface while paused

That means the right short-term posture is not "keep building Solana." It is:

- keep the feature flag off
- keep the live client EVM-only
- keep paused Solana endpoints returning `410`
- later decide whether to resume the preserved code intentionally

## Readiness Checklist

### Before calling production ready

- [ ] push the Solana pause pass to `main`
- [ ] confirm Vercel production deploy is built from that commit
- [ ] verify `https://www.mintware.finance/` reflects current `main`
- [ ] reconcile Supabase migration history
- [ ] refresh or replace [`docs/ARCHITECTURE.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/ARCHITECTURE.md)
- [ ] triage build warnings and decide which are acceptable

### Good signs already in place

- [x] repo linked to the correct Vercel project
- [x] repo linked to the correct Supabase project
- [x] public docs path is back on `main`
- [x] local fresh production build now succeeds
- [x] paused Solana endpoints are gated behind `410`
- [x] live Solana wallet imports are removed from the active product surface
- [x] major user flows have current implementation ownership in Mintware code

## Recommended Next Actions

1. Push the local Solana pause pass to `main` immediately and watch the Vercel production deploy.
2. Create a dedicated Supabase migration-reconciliation task before any further schema rollout.
3. Replace the stale architecture doc with a simplified source-of-truth version based on this inspection.
4. Triage the remaining build warnings, especially:
   - Privy optional dependency noise
   - Edge runtime compatibility warnings
   - noisy `indexedDB` logs during static generation
5. Keep Solana paused until there is an explicit decision to resume it, and treat the current gated state as the baseline.
