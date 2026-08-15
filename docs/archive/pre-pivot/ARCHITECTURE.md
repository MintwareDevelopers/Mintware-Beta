# Mintware Platform Architecture

Last audited: 2026-04-03
Status: canonical high-level system view

## Overview

Mintware is now a multi-surface EVM platform, not just a campaigns app.

The live product currently combines:

- Privy-assisted onboarding and wallet identity
- EVM trading and swap attribution
- campaign participation and reward claims
- gated social vault infrastructure
- AI agent registration and leaderboard surfaces
- universal reward ingestion, settlement, and bridge automation

Solana work still exists historically and in some dormant code paths, but it is paused from the live product surface.

## Top-Level System

```text
User
  ->
Next.js app on Vercel
  ->
  |-- React pages and wallet UX
  |-- server routes in app/api
  |-- cron routes in app/api/(rewards)/cron
  ->
Supabase
  |-- rewards and campaign state
  |-- referral and identity state
  |-- vault state
  |-- AI agent state
  |-- universal reward ledgers
  ->
External dependencies
  |-- Privy
  |-- LI.FI
  |-- Cloudflare attribution worker
  |-- Pyth
  |-- Base / EVM contracts
```

## Core Boundaries

### Mintware owns

- user-facing app shell and UI
- all `app/api` routes
- all Supabase writes and service-role workflows
- campaign participation and reward accounting
- vault bookkeeping and vault cron behavior
- AI agent APIs and metadata surfaces
- universal reward orchestration

### External systems provide

- wallet/onboarding support through Privy
- swap routing and route generation through LI.FI
- score/read-side analytics through the attribution worker
- price/volatility inputs through Pyth
- on-chain execution and claim settlement through Base/EVM contracts

### Paused from the live surface

- Solana wallet UX
- Solana claim flow
- Solana swap ingestion as an active product rail

## Main Product Domains

### 1. Identity and onboarding

Key files:

- [`components/web2/providers.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/web2/providers.tsx)
- [`lib/web3/useMintwareIdentity.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web3/useMintwareIdentity.ts)

Current model:

- Privy is the preferred onboarding shell when configured
- wagmi remains the EVM wallet/transaction transport
- `useMintwareIdentity()` normalizes embedded and external EVM wallets
- Solana is not part of the active identity model on the live product

### 2. Attribution and campaigns

Key files:

- [`app/(rewards)/dashboard/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/dashboard/page.tsx)
- [`app/api/(rewards)/campaigns/join/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/campaigns/join/route.ts)
- [`app/api/(rewards)/campaigns/swap-event/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/campaigns/swap-event/route.ts)
- [`lib/rewards/swapHook.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/rewards/swapHook.ts)

Current model:

- users join campaigns through Mintware-owned API routes
- activity and reward writes happen in Supabase, not in the external scoring worker
- token-pool campaigns and points campaigns share a domain but not identical settlement logic

### 3. Trading and swap UX

Key files:

- [`app/(web3)/swap/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(web3)/swap/page.tsx)
- [`components/rewards/swap/SwapWidget.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/swap/SwapWidget.tsx)
- [`components/rewards/swap/SwapConfirmSheet.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/swap/SwapConfirmSheet.tsx)
- [`app/api/(web2)/swap/quote/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web2)/swap/quote/route.ts)

Current model:

- LI.FI quotes are proxied server-side
- fee and referrer injection is enforced server-side
- the app now adds pre-wallet review and clearer transaction context before execution
- swap completion can feed campaign attribution and reward crediting

### 4. Claims and distributor settlement

Key files:

- [`components/rewards/campaigns/ClaimCard.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/campaigns/ClaimCard.tsx)
- [`app/api/(rewards)/claim/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/route.ts)
- [`app/api/(rewards)/claim/status/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/status/route.ts)

Current model:

- Merkle proof generation is server-side
- claim calldata includes oracle deadline
- claim status and claimed markers are mirrored in Supabase

### 5. Social vaults

Key files:

- [`app/(rewards)/vaults/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vaults/page.tsx)
- [`app/(rewards)/vault/create/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vault/create/page.tsx)
- [`app/(rewards)/vault/[id]/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vault/%5Bid%5D/page.tsx)
- [`app/api/(rewards)/vault/deposit/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/vault/deposit/route.ts)
- [`app/api/(rewards)/vault/rebalance/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/vault/rebalance/route.ts)

Current model:

- vaults are a separate product subsystem with their own APIs, off-chain state, and cron touchpoints
- they depend on both on-chain execution and Supabase reconciliation
- they should be thought of as a gated backend-heavy domain, not simple UI

### 6. Universal rewards

Key files:

- [`app/api/(rewards)/cron/universal-pipeline/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-pipeline/route.ts)
- [`app/api/(rewards)/cron/universal-trade-signals/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-trade-signals/route.ts)
- [`app/api/(rewards)/cron/universal-epoch-close/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-epoch-close/route.ts)
- [`app/api/(rewards)/cron/universal-distribution-bridge/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-distribution-bridge/route.ts)

Current model:

- universal rewards are an active backend pipeline
- trade signals are ingested into Supabase-backed ledgers
- epochs are settled and bridged into distributor-compatible outputs
- this is one of the strongest reasons the older March architecture doc was no longer sufficient

### 7. AI agents

Key files:

- [`app/agents/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/agents/page.tsx)
- [`app/api/(web3)/agents/register/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web3)/agents/register/route.ts)
- [`app/api/(web3)/agents/leaderboard/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web3)/agents/leaderboard/route.ts)

Current model:

- agents are now their own product and data surface
- registration, metadata, and leaderboard state are Mintware-owned
- this domain shares the same Supabase and deploy surface as the rest of the app

## Data Ownership Model

### Supabase stores

- campaign state
- participants and activity
- pending rewards and distributions
- referral and wallet-link state
- vault state and rebalance proposal state
- AI agent state
- universal reward ledgers and sync cursors

### Cloudflare attribution worker provides

- score and analytics reads
- some campaign/read-side display data

It is not the write authority for Mintware participation or reward state.

### Contracts provide

- distributor-based claim settlement
- vault-adjacent EVM execution surfaces

## Deployment and Automation

### Deployment path

```text
GitHub main -> Vercel -> mintware.finance
GitHub docs/main -> GitBook sync -> public docs
```

### Current cron schedule

From [`vercel.json`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/vercel.json):

- `universal-pipeline` daily
- `bridge-verify` daily
- `epoch-end` daily
- `pool-settle` daily
- `treasury/sweep` daily
- `vault-epoch-close` weekly

The current schedule is intentionally slower than some older inline comments still suggest.

## Architecture Guidance

- treat Mintware as one Vercel app with several backend-heavy domains
- do not assume old campaign-only mental models still cover the product
- when changing schema, deployment, or cron behavior, consider effects on:
  - campaigns
  - swap attribution
  - vaults
  - agents
  - universal rewards

## See Also

- [`docs/developers/platform-system-map.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/developers/platform-system-map.md)
- [`docs/developers/production-readiness-inspection.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/developers/production-readiness-inspection.md)
- [`docs/developers/supabase-migration-reconciliation.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/developers/supabase-migration-reconciliation.md)
