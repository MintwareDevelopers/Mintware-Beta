# Platform System Map

Last audited: 2026-04-03
Owner: Codex review pass

## Purpose

This is the current whole-platform map for Mintware as it exists after Privy onboarding, Ethereum UX upgrades, universal rewards, AI agent support, and the Solana live pause.

Use this document when you need to answer:

- what systems exist now
- how the product flows connect
- what writes to Supabase
- what runs on cron
- which dependencies are external

## Top-Level Architecture

```text
User
  ->
Next.js app on Vercel
  ->
  |-- client pages and wallet UX
  |-- server routes in app/api
  |-- cron routes in app/api/(rewards)/cron
  ->
Supabase
  ->
  |-- campaign/reward state
  |-- vault state
  |-- agent state
  |-- referral and identity state
  |-- universal reward ledgers
  ->
External systems
  |-- Privy
  |-- LI.FI
  |-- Cloudflare attribution worker
  |-- Base / EVM contracts
  |-- Pyth
```

## System Boundaries

### Mintware-owned application

- all Next.js pages and UI
- all `app/api` routes
- Supabase reads/writes
- reward attribution logic
- vault bookkeeping
- agent registration and leaderboard APIs
- cron orchestration

### External but depended-on

- Privy for auth/onboarding and embedded wallets
- LI.FI for external swap aggregation — the fallback leg of Mintware's best-execution router (§3)
- Cloudflare attribution worker for score/read-side data
- Pyth price data for vault volatility/rebalance logic
- Base/EVM contracts for distributor claims and vault-adjacent on-chain actions

### Paused / not live on the current surface

- Solana wallet product surface
- Solana claim and swap flows
- Solana as a first-class identity rail

The important distinction is that "paused" does not mean "deleted." It means the live product no longer depends on it.

## Product Surfaces

### 1. Onboarding and identity

Primary files:

- [`components/web2/providers.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/web2/providers.tsx)
- [`lib/web3/useMintwareIdentity.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web3/useMintwareIdentity.ts)
- [`components/web2/MwNav.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/web2/MwNav.tsx)
- [`components/web2/MwAuthGuard.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/web2/MwAuthGuard.tsx)

Current shape:

- Privy is the optional onboarding shell
- wagmi remains the active EVM wallet transport
- embedded and external EVM wallets are normalized through `useMintwareIdentity()`
- Solana is no longer an active identity input on the live surface

Flow:

```text
User lands
-> connect wallet or continue with email
-> Privy may create embedded EVM wallet
-> wagmi session becomes active
-> useMintwareIdentity normalizes address/session state
```

### 2. Attribution and profile

Primary files:

- [`app/(rewards)/profile/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/profile/page.tsx)
- [`app/[address]/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/%5Baddress%5D/page.tsx)
- [`app/api/(rewards)/auth/connect/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/auth/connect/route.ts)

Current shape:

- attribution remains an EVM-first live surface
- read-side score data still comes from the external scoring worker
- identity enrichment and wallet connection state live in Mintware

### 3. Swap and trading

Mintware runs its own **best-execution meta-router**. On pairs it lists (a Mintware V4
pool), it compares its own pool against LI.FI and routes the user to whichever price is
better; every other pair uses LI.FI aggregation. When the internal pool wins, the swap
executes through `MWRouter`, capturing a protocol router fee to treasury and the LP/MEV
to the FeeVault — value that otherwise leaks to the aggregator. For RWA (`vRWA`), the
internal router is the venue: those tokens have no external market.

Primary files:

- [`app/(web3)/swap/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(web3)/swap/page.tsx)
- [`components/rewards/swap/SwapWidget.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/swap/SwapWidget.tsx)
- [`hooks/useQuote.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/hooks/useQuote.ts) · [`hooks/useSwap.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/hooks/useSwap.ts)
- Router engine — [`lib/web2/router/`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web2/router) (best-execution comparator, fee math, V4 quoter, registry)
- Server meta-router — [`app/api/(web2)/swap/best-route/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web2)/swap/best-route/route.ts)
- Internal execution — [`lib/web2/providers/mwInternal.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web2/providers/mwInternal.ts) → [`contracts-v4/src/MWRouter.sol`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/contracts-v4/src/MWRouter.sol)

Current shape:

- best-execution is guaranteed: the internal route is taken only on a strict,
  gas-inclusive improvement over LI.FI; ties and any uncertainty go to LI.FI
- LI.FI runs client-side (key gated by integrator verification); the server
  meta-router augments it with the internal comparison (registry + V4 quoter)
- staged rollout behind `NEXT_PUBLIC_MW_ROUTER_ENABLED` + per-chain router/quoter
  addresses; unset ⇒ pure LI.FI
- full stack is built and tested (Vitest + 14 `MWRouter` forge tests); design +
  activation live in [`docs/developers/phase3-router-design.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/developers/phase3-router-design.md)

Flow:

```text
Swap page
-> LI.FI quote (client) + best-route meta-router (server: MW pool vs LI.FI)
-> best price wins for the user (LI.FI, or MWRouter for a listed pair)
-> pre-wallet review
-> wallet signs route execution (LI.FI router or MWRouter)
-> completion event is sent to swap-event route
-> reward attribution engine writes activity/rewards (MWRouter txs credit too)
```

### 4. Campaigns and reward attribution

Primary files:

- [`app/(rewards)/dashboard/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/dashboard/page.tsx)
- [`app/(rewards)/campaign/[id]/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/campaign/%5Bid%5D/page.tsx)
- [`app/api/(rewards)/campaigns/join/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/campaigns/join/route.ts)
- [`app/api/(rewards)/campaigns/swap-event/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/campaigns/swap-event/route.ts)
- [`lib/rewards/swapHook.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/rewards/swapHook.ts)

Current shape:

- campaigns are still the central rewards UX
- participation and attribution are Mintware-owned writes
- token-pool and points campaigns share some UI but differ in settlement logic

Flow:

```text
User joins campaign
-> participant row written
-> swap or trade activity occurs
-> swapHook validates tx and campaign state
-> pending rewards or points are written
```

### 5. Claim settlement

Primary files:

- [`components/rewards/campaigns/ClaimCard.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/components/rewards/campaigns/ClaimCard.tsx)
- [`app/api/(rewards)/claim/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/route.ts)
- [`app/api/(rewards)/claim/status/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/status/route.ts)
- [`app/api/(rewards)/claim/mark-claimed/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/claim/mark-claimed/route.ts)

Current shape:

- claim proofs are reconstructed server-side from stored tree dumps
- claim calldata now includes oracle deadline
- batch claim and single claim are both active EVM flows
- Solana claim route exists only as a paused rail

Flow:

```text
Claim UI
-> claim/status fetch
-> claim proof generation
-> wallet claim tx
-> mark-claimed update
```

### 6. Social vaults

Primary files:

- [`app/(rewards)/vaults/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vaults/page.tsx)
- [`app/(rewards)/vault/create/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vault/create/page.tsx)
- [`app/(rewards)/vault/[id]/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(rewards)/vault/%5Bid%5D/page.tsx)
- [`lib/web3/vault/useSocialVault.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/lib/web3/vault/useSocialVault.ts)
- [`app/api/(rewards)/vault/deposit/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/vault/deposit/route.ts)
- [`app/api/(rewards)/vault/rebalance/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/vault/rebalance/route.ts)

Current shape:

- vaults are a distinct subsystem, not just “campaigns with deposits”
- backend persists deposit/withdraw/rebalance state in Supabase
- vault routes depend on both on-chain actions and off-chain synchronization
- vault cron and proposal routes increase ops complexity substantially

### 7. Universal rewards pipeline

Primary files:

- [`app/api/(rewards)/cron/universal-pipeline/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-pipeline/route.ts)
- [`app/api/(rewards)/cron/universal-trade-signals/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-trade-signals/route.ts)
- [`app/api/(rewards)/cron/universal-epoch-close/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-epoch-close/route.ts)
- [`app/api/(rewards)/cron/universal-distribution-bridge/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(rewards)/cron/universal-distribution-bridge/route.ts)

Current shape:

- universal rewards are now a real backend rail
- trade signals are ingested, settled, and bridged in sequence
- this system has its own env contract and migration footprint
- it shares the same deploy surface as the rest of the app, so it raises overall operational complexity

Flow:

```text
cron
-> sync trade signals
-> settle universal epochs
-> bridge epochs into distributor-compatible outputs
```

### 8. AI agent system

Primary files:

- [`app/agents/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/agents/page.tsx)
- [`app/(web3)/agent/[address]/page.tsx`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/(web3)/agent/%5Baddress%5D/page.tsx)
- [`app/api/(web3)/agents/register/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web3)/agents/register/route.ts)
- [`app/api/(web3)/agents/leaderboard/route.ts`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/app/api/(web3)/agents/leaderboard/route.ts)

Current shape:

- agent registration and metadata are Mintware-owned
- leaderboard is backed by Supabase view/table data
- this is now a distinct product surface, not just an experiment

## Cron Surface

From [`vercel.json`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/vercel.json):

- `/api/cron/universal-pipeline` daily at `04:30 UTC`
- `/api/cron/bridge-verify` daily at `00:00 UTC`
- `/api/cron/epoch-end` daily at `01:00 UTC`
- `/api/cron/pool-settle` daily at `02:00 UTC`
- `/api/treasury/sweep` daily at `03:00 UTC`
- `/api/cron/vault-epoch-close` weekly on Monday at `00:00 UTC`

Important note:

some route headers/comments still talk about “every 15 minutes.” The deployed schedule is now daily, and the docs should treat `vercel.json` as the source of truth.

## Data Ownership

### Supabase-owned domain state

- campaign definitions and participation
- pending rewards, distributions, payout history
- referral state
- wallet-link state
- vault state and proposal state
- AI agent profiles and scores
- universal reward ledgers and sync cursors

### Read-side external data

- attribution score and some campaign analytics from the external worker
- external swap aggregation from LI.FI (fallback leg of the best-execution router)
- volatility/pricing inputs from Pyth

### Contracts / on-chain truth

- distributor claim settlement
- vault-related transaction execution

## Biggest Dependency Edges

### Shared identity edge

Privy + wagmi now influence:

- onboarding
- transaction UX
- profile state
- campaign join/fund flows
- vault deposit/seed flows

### Shared Supabase edge

Most subsystems now depend on the same live database:

- rewards
- referrals
- wallet links
- vaults
- agents
- universal rewards

That makes migration discipline and schema clarity much more important than before.

### Shared deploy edge

Everything ships through one Next.js/Vercel app:

- user UI
- APIs
- cron routes
- docs source repo

That is convenient, but it also means operational mistakes can affect many domains at once.

## What To Keep In Mind

- the architecture is no longer simple enough to hold in memory casually
- “campaign app” is no longer an adequate model for Mintware
- the strongest current source of whole-platform truth is this file plus the production readiness inspection

The next durable cleanup should be to rewrite [`docs/ARCHITECTURE.md`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build/docs/ARCHITECTURE.md) around this map.
