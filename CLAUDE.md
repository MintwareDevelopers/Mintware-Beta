# Mintware Phase 1 — Project Context for Claude

> **Before building anything:** Read the `## Architecture Boundaries` section.
> It explains the #1 source of confusion across past sessions.

**Production URL:** https://mintware-beta.vercel.app
**GitHub:** https://github.com/MintwareDevelopers/Mintware-Beta
**Supabase project:** `bqwcwrnqpayfndgmceal`
**Full system docs:** `docs/` folder (ARCHITECTURE.md, API_MAP.md, ISSUES.md, schema.sql)

---

## What This Project Is
Mintware is a DeFi reputation + rewards platform:
- **Attribution** (live) — on-chain reputation scoring for wallets across 100+ chains
- **Mintware** (Phase 1) — campaign reward engine weighted by Attribution score

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.1.6 (App Router, Turbopack default) |
| Language | TypeScript 5.7 |
| Wallet | RainbowKit 2 + wagmi 3 + viem 2 |
| Data fetching | @tanstack/react-query 5 |
| Styling | Tailwind CSS v4 (landing page only); inline `<style>` blocks (all other pages) |
| Database | Supabase (`@supabase/ssr` v0.9.0) |
| Fonts | Plus Jakarta Sans (`--font-jakarta`), DM Mono (`--font-mono`) via `next/font/google` |
| Analytics | @vercel/analytics |
| Package manager | **pnpm** (always use pnpm, never npm/yarn) |
| UI components | shadcn/ui in `components/ui/` — **scaffolded but unused in app pages** |

---

## Architecture Boundaries

**This is the #1 source of confusion across past Claude sessions. Read before touching any API or campaign code.**

There are two separate systems. Do not mix them up.

### Attribution Worker (external, read-only — NOT our code)
URL: `https://attribution-scorer.ceo-1f9.workers.dev`
Defined as `export const API` in `lib/api.ts`.

**What it does:** Wallet scoring, campaign list display data, leaderboard.
**What it does NOT do:** Joins, writes, reward tracking, participant state.

| Endpoint | Used for |
|----------|---------|
| `GET /score?address=` | Attribution score on profile page + join score check |
| `GET /campaigns` | Campaign list on dashboard |
| `GET /campaign?id=&address=` | Campaign detail display data |
| `GET /leaderboard?campaign_id=` | Leaderboard data |
| ~~`POST /join`~~ | **DEPRECATED** — returned "Invalid wallet". Replaced by our route. |

**Critical gotcha:** `GET /campaign?id=&address=` always returns `participant: null` even for wallets that have joined. It reads its own separate database, not our Supabase. This is why `locallyJoined` state exists in `campaign/[id]/page.tsx`.

### Our Next.js API (writes everything to Supabase)

Joins, reward credits, claims, cron jobs, referrals — all go through our routes.

| Route | Purpose |
|-------|---------|
| `POST /api/campaigns/join` | Join campaign — validates, fetches score, upserts `participants` |
| `POST /api/campaigns/swap-event` | Swap webhook from Molten — credits rewards |
| `GET /api/claim/status?address=` | List all claimable rewards for wallet |
| `GET /api/claim?address=&distribution_id=` | Merkle proof + amount for claiming |
| `POST /api/claim` | Mark distribution claimed after on-chain tx |
| `GET /api/rewards/pending?address=` | Locked pending rewards (token pool) |
| `GET /api/referral?address=` | Referral stats |
| `POST /api/referral/generate` | Upsert wallet profile + return stats |
| `GET /api/campaigns/manage?wallet=` | Creator's campaigns |
| `GET /api/teams/whitelist?address=` | Check whitelist status |
| `POST /api/teams/apply` | Submit whitelist application |
| `GET /api/cron/pool-settle` | Settle token pool rewards → Merkle distributions (every 15 min) |
| `GET /api/cron/epoch-end` | Close points epoch + publish distribution |
| `GET /api/cron/bridge-verify` | Verify Core DAO bridge txs (**BLOCKED** — awaiting contract) |

**Rule:** If you're writing data about a user or campaign — it goes through our API → Supabase. Never through the Attribution Worker.

---

## Environment Variables

**Canonical reference:** `docs/.env.example`

### Active variables (set in Vercel + `.env.local`)

| Variable | Purpose | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, RLS enforced) | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server only, bypasses RLS) | |
| `NEXT_PUBLIC_LIFI_INTEGRATOR` | LI.FI integrator name — `"mintware"` | |
| `NEXT_PUBLIC_LIFI_API_KEY` | LI.FI integrator API key | |
| `NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED` | **Must be `"true"` to enable fee collection.** Gates `fee` + `referrer` params in `getRoutes()`. Without it, no fee is passed to LI.FI and Mintware earns nothing on swaps. | Set in Vercel. |
| `NEXT_PUBLIC_0X_API_KEY` | 0x swap API key (fallback routing) | |
| `NEXT_PUBLIC_MINTWARE_TREASURY` | LI.FI fee recipient wallet. Passed as `referrer` to `getRoutes()`. | `0x3F9529e33273fcCec66BaE34B51397e1d01937Bf` |
| `MINTWARE_TREASURY_ADDRESS` | **Server-side** treasury address. Used in `onchainPublisher` oracle≠treasury guard. Must match `NEXT_PUBLIC_MINTWARE_TREASURY`. | `0x3F9529e33273fcCec66BaE34B51397e1d01937Bf` |
| `NEXT_PUBLIC_DISTRIBUTOR_ADDRESS` | MintwareDistributor contract for claim UI | Base mainnet: `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE` |
| `NEXT_PUBLIC_REWARDS_MODE` | `"live"` — enables real reward calculation | |
| `CRON_SECRET` | Bearer token securing all `/api/cron/*` routes | |
| `SWAP_WEBHOOK_SECRET` | Auth for Molten server-side webhook. **See critical note below.** | |
| `BASE_RPC_URL` | Base mainnet RPC | defaults to `https://mainnet.base.org` |
| `CORE_DAO_RPC_URL` | Core DAO RPC | defaults to `https://rpc.coredao.org` |
| `ORACLE_SIGNER_ADDRESS` | EIP-712 oracle signer public address | `0xc75D4b4bdB4D7ac103671f45E99D2FA6107B2e93` |
| `DISTRIBUTOR_PRIVATE_KEY` | Oracle signer private key — signs Merkle roots (server only, never expose) | |
| `COINGECKO_API_KEY` | Price feed (optional, falls back to free tier) | |

### SWAP_WEBHOOK_SECRET — critical behaviour

`/api/campaigns/swap-event` receives events from **two sources**:

1. **LI.FI client-side** — the swap page calls it directly after `executeRoute()` completes. **No auth header** is sent. `SWAP_WEBHOOK_SECRET` must **NOT** be set in Vercel for this to work — if it is, all client-side reward credits return 401.

2. **Molten server-side** — will call the same endpoint with an `Authorization: Bearer {SWAP_WEBHOOK_SECRET}` header once Molten is configured.

**Current state:** `SWAP_WEBHOOK_SECRET` is deleted from Vercel. Client-side swap events work. When Molten is wired up, the secret will be added back and the route will accept both authenticated (Molten) and unauthenticated (client) requests — check the route auth logic before enabling.

### Deprecated — do NOT use these names

| Variable | Why deprecated |
|---|---|
| `NEXT_PUBLIC_MW_TREASURY_ADDRESS` | Was set to the contract address, not the treasury. Use `NEXT_PUBLIC_DISTRIBUTOR_ADDRESS` for the contract and `NEXT_PUBLIC_MINTWARE_TREASURY` for fee recipient. |
| `NEXT_PUBLIC_CAMPAIGN_WORKER_URL` | Pointed to unused second Worker (`mintware-campaigns.ceo-1f9.workers.dev`). Removed from all code. |

---

## Database (Supabase `bqwcwrnqpayfndgmceal`)

**Canonical schema:** `docs/schema.sql`
**9 migrations applied** (latest: `20260319000001_participants_and_activity.sql`)

### Tables

| Table | Purpose |
|-------|---------|
| `campaigns` | Campaign config + state (both types) |
| `participants` | One row per wallet per campaign. Created by `/api/campaigns/join`. |
| `activity` | Per-action event log. Dedup by `(wallet, tx_hash, action_type)`. |
| `pending_rewards` | Token pool reward locks per tx. `locked → claimable → claimed`. |
| `distributions` | Merkle tree publication records. One per campaign per epoch. |
| `epoch_state` | Active epoch window + point accumulator. One active epoch per campaign. |
| `daily_payouts` | Per-wallet Merkle proof + payout per epoch. **Canonical claim table.** |
| `campaign_payouts` | Legacy daily rank records. Do not write new data here. |
| `swap_events` | Append-only webhook audit log from Molten. |
| `wallet_profiles` | One row per connected wallet. `ref_code` deterministic. |
| `referral_records` | Referral link conversions. |
| `referral_stats` | VIEW — aggregated stats per wallet. |
| `whitelisted_teams` | Teams approved for points campaigns. |
| `team_applications` | Inbound whitelist applications. |

### Key conventions
- `ref_code` is deterministic: `"mw_" + address.slice(2, 8).toLowerCase()` — never depends on DB
- `activity` dedup prevents double-crediting across retries
- `pending_rewards` unique on `(tx_hash, reward_type)` — one lock per reward type per tx
- One active epoch per campaign: enforced by partial unique index on `epoch_state`
- All writes via service role. All reads public (anon key + RLS)

---

## Campaign Types

### Token Reward Pool — referral growth engine

A sponsor funds a pool. Users share referral links and earn % of swap volume their referrals generate.

- **Referrer** earns `referral_reward_pct`% of every swap their referrals make (main incentive)
- **Buyer** gets `buyer_reward_pct`% rebate on their own swap (minor additive)
- **Mintware** takes `platform_fee_pct`% (default 2%)
- Pool depletes as rewards are paid. Settlement via pool-settle cron (every 15 min on Pro plan).

**UI copy:** "Share your link → earn % of every swap your referrals make"
**Do NOT say:** "earn $X per day" or "swap to earn"

### Points Campaign — epoch-based scored payouts

Whitelisted protocol sponsors a fixed pool. Users earn points for on-chain actions weighted by Attribution + Sharing scores.

- `trade` — 8 pts, once per calendar day (**LIVE**)
- `referral_trade` — 8 pts per referred wallet per trading day (**LIVE**)
- `bridge` — 15 pts, one-time (**BLOCKED** — awaiting Core DAO bridge contract)
- `referral_bridge` — 60 pts per referred bridge (**BLOCKED** — same reason)

At epoch end: pool split proportionally by `points × attribution_multiplier × sharing_multiplier`.

**Score multipliers:**

| Percentile | Attribution | Sharing |
|---|---|---|
| 0–33% | 1.0× | 1.0× |
| 34–66% | 1.25× | 1.15× |
| 67–100% | 1.5× | 1.3× |

Max combined multiplier: 1.95×. Formula: `wallet_payout = (epoch_pool / epoch_count) × (wallet_points / total_points) × multiplier`

**Score multiplier implementation notes:**
- `attribution_score` comes from the Attribution Worker `/score` API (max signal sum = 925). Percentile is computed across all participants in the epoch.
- `sharing_score` is the Attribution API's `sharing` signal score. **Max is 400** (not 125 — old bug). Percentile bins: 0–33% = 1.0×, 34–66% = 1.15×, 67–100% = 1.3×.
- Multipliers are **only applied when `campaign.use_score_multiplier = true`**. If the flag is false, all wallets get 1.0× combined regardless of scores.
- Both of these are enforced in `lib/campaigns/epochProcessor.ts` (`SHARING_SCORE_MAX = 400`, `use_score_multiplier` guard).

**Daily caps (token pool campaigns):**
- `daily_wallet_cap_usd` — max a single wallet can earn per calendar day across all reward types
- `daily_pool_cap_usd` — max the campaign pool can pay out in total per calendar day
- Both are checked before calling `deduct_token_pool_reward`. If either cap is reached, the event is skipped with a `daily_wallet_cap_reached` or `daily_pool_cap_reached` reason.
- Cap period = UTC calendar day (midnight to midnight).

---

## LI.FI Swap Fee (Mintware Platform Revenue)

**This is entirely separate from campaign reward pool fees.**

- **Fee:** 0.5% on every swap routed through the Mintware swap UI (`LIFI_FEE = 0.005` in `lib/swap/lifi.ts`)
- **Recipient:** `NEXT_PUBLIC_MINTWARE_TREASURY` (`0x3F9529e33273fcCec66BaE34B51397e1d01937Bf`)
- **Mechanism:** Passed as `{ fee: 0.005, referrer: LIFI_TREASURY }` to LI.FI's `getRoutes()`. LI.FI routes the fee to the referrer address on every completed swap.
- **Gate:** Only active when `NEXT_PUBLIC_LIFI_INTEGRATOR_VERIFIED === "true"` (set in Vercel). Without this, `feeOptions` is `{}` and no fee is collected.
- **Where it lives:** `components/swap/MintwareSwap.tsx` ~line 250.

**What campaign pool fees are (completely different):**
- Token pool campaigns: sponsors pre-fund a pool. `platform_fee_pct` (default 2%), `buyer_reward_pct`, and `referral_reward_pct` are all paid out of that pool per tx via the `pending_rewards` table and pool-settle cron.
- Points campaigns: sponsors pay a flat B2B sponsorship fee. No per-tx fee logic.
- Neither of these has anything to do with the LI.FI swap fee.

---

## Join Flow

**How it works (as of 2026-03-19):**

1. User clicks "Join Campaign" → `JoinButton.tsx`
2. `POST /api/campaigns/join` with `{ campaign_id, address }`
3. Route fetches Attribution score (4s timeout, defaults 0 on failure)
4. For points campaigns: checks `min_score` gate. For token_pool: always open.
5. Upserts row into Supabase `participants` table
6. Returns `{ ok: true, attribution_score }`
7. `JoinButton` calls `onJoined()` → sets `locallyJoined = true` in page state
8. `ReferralCard` appears immediately with copy link

**Why `locallyJoined` exists:**
After joining, the page re-fetches campaign data from the Attribution Worker (`GET /campaign?id=&address=`). The Worker always returns `participant: null` because it reads its own database, not our Supabase. Without `locallyJoined`, the UI would revert to "Join Campaign". This is a known gap — the long-term fix is to build our own `GET /api/campaigns/[id]` route.

---

## Claim Flow

1. `GET /api/claim/status?address=` → list of claimable rewards with `distribution_id`
2. `GET /api/claim?address=&distribution_id=` → `{ campaign_id, epoch_number, merkle_root, oracle_signature, cumulative_amount_wei, merkle_proof }`
3. Browser calls `MintwareDistributor.claim(campaignId, epochNumber, merkleRoot, oracleSignature, cumulativeAmount, merkleProof)`
4. `POST /api/claim` → marks `daily_payouts.claimed_at`

**Cumulative model:** Each leaf encodes wallet's TOTAL earned across all epochs. Contract tracks `claimedCumulative[wallet]` and pays the delta. Wallets that skip epochs claim everything owed in one tx.

---

## Deployed Contracts

### MintwareDistributor

| Chain | Address |
|-------|---------|
| Base mainnet | `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE` |
| Base Sepolia (testnet) | `0xcf2EA99639C038a475B710b2Be82b974D777C306` |
| Core DAO | Not yet deployed (awaiting bridge contract) |

**Owner:** `0x46BB4fea89DFfc5a8a1187EB4A524275568f42d7`
**Oracle signer:** `0xc75D4b4bdB4D7ac103671f45E99D2FA6107B2e93` (derived from `DISTRIBUTOR_PRIVATE_KEY`)
**Treasury:** `0x3F9529e33273fcCec66BaE34B51397e1d01937Bf`

**⚠️ Oracle ≠ Treasury — important implication:**
`claim()` sends tokens to `msg.sender`. When `onchainPublisher` auto-claims the treasury fee leaf after signing, it calls `claim()` from the oracle wallet — so fees would land in the oracle wallet, not the treasury.

`onchainPublisher` detects this mismatch (`ORACLE_SIGNER_ADDRESS ≠ MINTWARE_TREASURY_ADDRESS`) and **skips auto-claim**, logging a warning. The oracle signature is still stored in Supabase. Treasury must manually call `claim()` using the stored `oracle_signature` from the `distributions` table.

**Long-term fix:** Rotate `DISTRIBUTOR_PRIVATE_KEY` to a key whose derived address equals `NEXT_PUBLIC_MINTWARE_TREASURY`, or use a separate treasury claimer contract. Until then, treasury fees require manual claiming.

### Leaf encoding (critical — mismatch causes all claims to revert)
- **Solidity:** `keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))`
- **TypeScript:** `StandardMerkleTree.of([[wallet, amount]], ['address', 'uint256'])`
- Uses `abi.encode` (64-byte padded) — **NOT** `abi.encodePacked` (52 bytes)

---

## Referral System

**`ref_code` is always:** `"mw_" + address.slice(2, 8).toLowerCase()` — computed client-side, no DB needed.

**`useReferral(address)` hook:**
1. Captures `?ref=` param → `sessionStorage["mw_pending_ref"]`
2. Upserts `wallet_profiles` on connect
3. If new wallet + pending ref → inserts `referral_records`
4. Fetches `referral_stats` view
5. Subscribes to Supabase Realtime for live updates

**`InviteTab`** renders immediately from wallet address. Supabase stats load as enhancement.
**`ReferralSheet`** slides up 1.5s after first connect. Dismissed in `localStorage["mw_ref_sheet_dismissed"]`.

---

## Cron Jobs

| Route | Schedule | Purpose |
|-------|---------|---------|
| `/api/cron/pool-settle` | `0 2 * * *` ⚠️ | Settle claimable `pending_rewards` → Merkle distributions |
| `/api/cron/epoch-end` | `0 1 * * *` | Close active points epoch + publish distribution |
| `/api/cron/bridge-verify` | `0 0 * * *` | Verify Core DAO bridge txs (**BLOCKED** — `CORE_DAO_BRIDGE_CONTRACT` not set) |

All cron routes require `Authorization: Bearer {CRON_SECRET}`.

**⚠️ pool-settle is temporarily daily (2am UTC).** Intended schedule is `*/15 * * * *` (every 15 min). Vercel Hobby plan caps crons to daily. To restore: upgrade to Vercel Pro and change `pool-settle` cron in `vercel.json` back to `"*/15 * * * *"`.

---

## Navigation (`components/MwNav.tsx`)

- **Logged-out:** "Connect Wallet" button only
- **Logged-in:** "Earn" (→ /dashboard), "Swap" (→ /swap), "Leaderboard" (→ /leaderboard), "Profile" (→ /profile), wallet pill
- **Wallet pill:** hover reveals red "✕ disconnect" → calls `disconnect()` + `router.push('/')`

---

## CSS Conventions

**Landing page (`app/page.tsx`)** — Tailwind CSS v4 only.
**All other app pages** — inline `<style>` blocks only. Do not refactor to CSS modules or Tailwind unless asked.

**Design tokens:**
```
#F7F6FF   surface / background
#1A1A2E   ink (primary text)
#3A3C52   ink-2 (secondary text)
#8A8C9E   ink-3 (muted text)
#3A5CE8   primary blue
#C2537A   sharing/referral pink
#2A9E8A   green (success/active)
Plus Jakarta Sans — UI labels, body
DM Mono   — addresses, codes, numbers
```

---

## Dev Server

```bash
cd "/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build"
pnpm dev
```

**Preview tool (`.claude/launch.json`)** — must include nvm node in PATH:
```json
{
  "runtimeExecutable": "/bin/bash",
  "runtimeArgs": ["-c", "export PATH=/Users/nicolasrobinson/.nvm/versions/node/v22.22.1/bin:$PATH && node node_modules/next/dist/bin/next dev"]
}
```

**Common issues:**
- `Unable to acquire lock at .next/dev/lock` → `pkill -f "next dev"` then delete `.next/dev/lock`

---

## Contract Commands

```bash
pnpm hardhat:test                  # 32 tests, all passing
pnpm hardhat:compile               # Compile + typechain
pnpm hardhat:deploy:base           # Deploy to Base mainnet
pnpm hardhat:deploy:base-sepolia   # Deploy to Base Sepolia testnet
```
`TS_NODE_PROJECT=tsconfig.hardhat.json` is baked into all `hardhat:*` scripts.

---

## Pages Reference

| Route | File | Auth | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | No | Landing — Tailwind CSS v4 |
| `/explorer` | `app/explorer/page.tsx` | No | Redirects to `/explorer.html` (D3, not converted) |
| `/dashboard` | `app/dashboard/page.tsx` | Yes | Campaign list |
| `/leaderboard` | `app/leaderboard/page.tsx` | Yes | Campaign selector + leaderboard |
| `/swap` | `app/swap/page.tsx` | Yes | LI.FI swap, campaign rewards |
| `/campaign/[id]` | `app/campaign/[id]/page.tsx` | Yes | Detail + join + referral card |
| `/profile` | `app/profile/page.tsx` | Yes | Score, tier, Portfolio/Score/Badge/Invite tabs |
| `/create-campaign` | `app/create-campaign/page.tsx` | Yes | 5-step campaign creator wizard |
| `/manage/[campaign_id]` | `app/manage/[campaign_id]/page.tsx` | Yes | Creator campaign management |

---

## Pending Work

### Blocking (users can't claim rewards without these)
- [x] **Claim API — Ticket 6** — `GET /api/claim`, `GET /api/claim/status`, and `POST /api/claim` all implemented. Claim flow is complete end-to-end.

### Infrastructure
- [ ] **Oracle = Treasury alignment** — Oracle signer (`0xc75D4...`) ≠ Treasury (`0x3F95...`). Treasury platform fees from token pool campaigns require manual claiming from the `distributions` table using the stored `oracle_signature`. Long-term fix: rotate `DISTRIBUTOR_PRIVATE_KEY` to a key whose address equals the treasury wallet.
- [ ] **Vercel Pro plan** — restores pool-settle cron to `*/15 * * * *`. Currently daily at 2am UTC on Hobby plan.
- [ ] **`CORE_DAO_BRIDGE_CONTRACT`** — still `0x__PENDING_MOLTEN_CONFIRMATION__`. Blocks bridge actions + bridge-verify cron.
- [ ] **Molten webhook** — register `https://mintware-beta.vercel.app/api/campaigns/swap-event` in Molten dashboard + set matching `SWAP_WEBHOOK_SECRET`. See SWAP_WEBHOOK_SECRET note above before enabling.

### Configuration
- [ ] **Reown Cloud whitelist** — add `mintware-beta.vercel.app` + `localhost:3000` at cloud.reown.com (project `580f461c981a43d53fc25fe59b64306b`)
- [ ] **locallyJoined gap** — build `GET /api/campaigns/[id]` reading from Supabase `participants` so page refresh shows correct join state

### Minor
- [ ] **Waitlist form** — wire email capture on landing page (UI exists, not wired)
- [ ] **Explorer page** — `explorer.html` uses D3.js, deferred React conversion
- [ ] **MintwareDistributor — Core DAO** — deploy when bridge contract confirmed

---

## Key Design Decisions (Locked — do not re-debate)

1. **Our API for writes, Attribution Worker for reads.** Joins, rewards, claims → our Supabase. Scores, campaign list → Worker. Never write to the Worker.

2. **`locallyJoined` client-side flag** — the Worker's `GET /campaign` returns `participant: null` always. We set a boolean after join succeeds. Refresh = loses state (acceptable for now; proper fix tracked above).

3. **Cumulative Merkle model** — `daily_payouts` stores wallet's TOTAL earned to date (not per-epoch delta). Contract pays `cumulative - alreadyClaimed`. Users who miss epochs claim everything owed in one tx. Matches Curve/Convex/Aura pattern.

4. **Price locked at swap time** — `pending_rewards` stores `amount_usd` computed at tx time. Settlement never re-fetches price. Prevents oracle manipulation.

5. **ref_code is deterministic** — `"mw_" + address.slice(2, 8).toLowerCase()`. Never needs a DB round-trip. `InviteTab` renders immediately.

6. **`'use client'` on all pages** — RainbowKit/wagmi hooks require it. No server components in the app directory except the explorer redirect.

7. **Inline styles on app pages** — preserves design fidelity from HTML mockups. Landing page uses Tailwind v4 only. Do not mix.

8. **`NEXT_PUBLIC_MINTWARE_TREASURY`** is the LI.FI fee recipient wallet. **`NEXT_PUBLIC_DISTRIBUTOR_ADDRESS`** is the contract address. These are different things on different addresses. Do not conflate.

9. **`campaign_payouts` is legacy** — the canonical payout table is `daily_payouts`. Do not write new data to `campaign_payouts`.

10. **shadcn/ui is unused** — `components/ui/` was scaffolded at init. App pages use custom inline CSS. Do not add new shadcn components to app pages.

11. **LI.FI swap fee ≠ campaign fees** — The 0.5% LI.FI fee is Mintware platform revenue, collected on every swap regardless of campaigns. Campaign reward pool fees (`platform_fee_pct`, `buyer_reward_pct`, `referral_reward_pct`) come entirely from sponsor-funded pools via `pending_rewards`. These are two completely separate revenue streams.

12. **`use_score_multiplier` must be explicitly true** — Points campaigns do NOT apply Attribution/Sharing score multipliers unless `campaigns.use_score_multiplier = true`. Default is false. When false, all wallets get 1.0× combined.

13. **`SHARING_SCORE_MAX = 400`** — The Attribution API's `sharing` signal has a max of 400 (not 125). Percentile thresholds for multiplier tiers are computed relative to 400. This is in `epochProcessor.ts`. Do not change this constant without verifying the Attribution API spec.

14. **SWAP_WEBHOOK_SECRET must not be set for client-side events** — The swap page calls `/api/campaigns/swap-event` directly with no auth. Setting `SWAP_WEBHOOK_SECRET` in Vercel blocks all client-side reward credits with 401. Only set it when explicitly supporting the Molten server-side webhook path (and update the route to accept both authenticated and unauthenticated callers).
