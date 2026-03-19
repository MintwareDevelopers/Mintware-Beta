# Mintware Phase 1 — System Architecture

> Single source of truth. Last audited: 2026-03-19.

---

## System Overview

```
User (browser)
  │
  ├── Next.js App (Vercel)          — all UI + serverless API routes
  │     ├── /app/...                — pages (React, 'use client')
  │     └── /app/api/...           — serverless functions (Node.js)
  │
  ├── Supabase                      — our database (campaigns, participants, rewards)
  │
  ├── Attribution Worker            — EXTERNAL, READ-ONLY (not our code)
  │   attribution-scorer.ceo-1f9.workers.dev
  │   Used for: /score, /campaigns list, /leaderboard
  │   NOT used for: joins, writes, reward tracking
  │
  ├── LI.FI SDK                     — swap routing (client-side)
  │
  └── MintwareDistributor.sol       — on-chain Merkle claim contract
        Base mainnet: 0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE
        Base Sepolia: 0xcf2EA99639C038a475B710b2Be82b974D777C306
```

---

## Responsibility Boundary (Critical)

| System | Owns | Does NOT own |
|--------|------|--------------|
| **Attribution Worker** (external) | Wallet scores, chain analytics, campaign list display data | Joins, participant state, reward tracking |
| **Our Next.js API** | Joins, reward credits, claims, cron jobs, referrals | Wallet scoring (reads from Worker) |
| **Supabase** | Campaign state, participants, rewards, distributions | Nothing client-side |
| **MintwareDistributor contract** | On-chain Merkle claim settlement | Any off-chain logic |

This boundary is the #1 source of past confusion. If you're writing to data about a user — it goes through our API → Supabase. Never through the Attribution Worker.

---

## Data Flow by User Action

### 1. Connect Wallet
```
User connects → wagmi/RainbowKit
  → useReferral hook fires
  → POST /api/referral (upsert wallet_profiles)
  → capture ?ref= param → insert referral_records if new referral
  → ReferralSheet slides up after 1.5s (first time only)
```

### 2. View Campaign List
```
GET attribution-scorer.ceo-1f9.workers.dev/campaigns
  → returns campaign metadata + pool sizes
  → displayed in /dashboard page
```

### 3. Join a Campaign
```
User clicks "Join Campaign"
  → JoinButton → POST /api/campaigns/join (our route, not the Worker)
  → Validates ETH address
  → Fetches Attribution score (4s timeout, defaults to 0)
  → Checks min_score gate (points campaigns only; token_pool is open)
  → Upserts participants row (campaign_id, wallet, attribution_score)
  → Returns { ok: true }
  → locallyJoined flag set client-side (Worker's GET /campaign still returns null — known gap)
  → ReferralCard shown immediately
```

### 4. Execute a Swap (Token Pool Campaign)
```
User swaps via LI.FI widget
  → LI.FI routes through DEX aggregators
  → On completion: tx confirmed on Base
  → Molten router (when live) sends webhook → POST /api/campaigns/swap-event
  → swapHook.processSwapEvent():
      1. Parse event (wallet, amount_usd, tx_hash, campaign_id)
      2. Load campaign + verify active + token_pool type
      3. Verify participant in our Supabase participants table
      4. Calculate rewards: buyer_rebate + referrer_reward + platform_fee
         (using calcBuyerReward() / calcReferrerReward() from lib/rewards.ts)
      5. Lock price via priceFeed.getTokenPrice()
      6. Insert pending_rewards rows (buyer, referrer, platform_fee)
         with claimable_at = now() + campaign.claim_duration_mins
      7. Insert activity row (dedup by tx_hash + action_type)
  → User sees pending reward in /profile
```

### 5. Swap Reward Settlement (Cron)
```
Every 15 minutes: GET /api/cron/pool-settle (auth: Bearer CRON_SECRET)
  → poolSettler.settleTokenPoolBatch()
  → Loads all pending_rewards WHERE claimable_at <= now() AND status='locked'
  → Groups by campaign_id
  → Builds Merkle tree (StandardMerkleTree from @openzeppelin/merkle-tree)
  → Signs oracle signature (EIP-712)
  → Calls MintwareDistributor.createDistribution() on-chain
  → Saves distribution row (merkle_root, tree_json, oracle_signature, tx_hash)
  → Updates pending_rewards.status = 'claimable'
  → Saves daily_payouts rows for each wallet
```

### 6. Claim Rewards
```
User opens ClaimCard → GET /api/claim?address=&distribution_id=
  → Loads distribution (merkle_root + tree_json)
  → Reconstructs tree, computes proof for wallet
  → Returns { amount_wei, proof[], leaf_index }
  → Client calls MintwareDistributor.claim(distributionId, amount, proof)
  → Contract verifies Merkle proof + oracle signature
  → Transfers tokens to wallet
  → POST /api/claim (marks daily_payouts.claimed_at)
```

### 7. Points Campaign — Trade Action
```
User swaps → swap-event fires
  → swapHook detects campaign_type = 'points'
  → Credits 8 points to participants.total_points
  → Inserts activity row (action_type='trade', dedup: one per wallet per day)
  → If referred_by is set: credits referral_trade points to referrer
```

### 8. Epoch Close (Points Campaign Cron)
```
Scheduled: GET /api/cron/epoch-end (auth: Bearer CRON_SECRET)
  → epochProcessor.processEpochClose(campaignId)
  → Fetches epoch_state WHERE status='active' AND ends_at <= now()
  → Atomically sets status = 'settling' (CAS to prevent double-run)
  → Calculates wallet_payout per wallet using epoch formula:
      wallet_payout = (epoch_pool / epoch_count) × (wallet_points / total_points) × multiplier
      multiplier = attribution_multiplier × sharing_multiplier (max 1.95×)
  → merkleBuilder.buildMerkleTree() → distribution
  → onchainPublisher.publishDistribution()
  → Creates distributions row + daily_payouts rows
  → Sets epoch_state.status = 'complete'
  → Creates next epoch_state row (status='active')
```

---

## Database Tables (Canonical)

| Table | Purpose | Written by |
|-------|---------|-----------|
| `campaigns` | Campaign config + state | Admin / create-campaign UI |
| `participants` | One row per wallet per campaign | POST /api/campaigns/join |
| `activity` | Per-action event log (dedup by tx_hash) | swap-event webhook |
| `pending_rewards` | Locked rewards awaiting claim window | swapHook (token_pool) |
| `distributions` | Merkle tree publication records | pool-settle cron / epoch-end cron |
| `epoch_state` | Active epoch window + point accumulator | epoch-end cron |
| `daily_payouts` | Per-wallet payout per distribution | pool-settle / epoch-end cron |
| `campaign_payouts` | Daily rank payout log (legacy — see ISSUES) | observer cron (deprecated path) |
| `swap_events` | Webhook audit log | swap-event webhook |
| `wallet_profiles` | One row per connected wallet | POST /api/referral |
| `referral_records` | Referral link conversions | useReferral hook |
| `referral_stats` | VIEW: aggregated referral stats | Auto-computed |
| `whitelisted_teams` | Approved teams for points campaigns | Manual admin |
| `team_applications` | Inbound whitelist applications | POST /api/teams/apply |

---

## Campaign Types

### Token Reward Pool
- Anyone can create (self-serve via /create-campaign)
- Rewards: buyer_rebate_pct + referral_reward_pct per swap transaction
- Pool depletes over time; no epochs
- Settlement: pool-settle cron (every 15 min)
- Claim: MintwareDistributor.claim() with Merkle proof
- Platform fee: 2% per tx deducted from pool

### Points Campaign
- Whitelisted teams only (requires entry in `whitelisted_teams`)
- Actions: trade (8 pts/day), referral_trade (8 pts per referral/day)
- Bridge/referral_bridge: defined in schema, blocked pending Core DAO contract
- Multipliers: attribution (1.0–1.5×) × sharing (1.0–1.3×) = max 1.95×
- Settlement: epoch-end cron; on-chain Merkle claim via MintwareDistributor

---

## Deployment

| Component | Platform | Notes |
|-----------|---------|-------|
| Web app | Vercel | Next.js 16, Turbopack |
| Database | Supabase (bqwcwrnqpayfndgmceal) | PostgreSQL + Realtime + RLS |
| Contracts | Base mainnet (primary) | MintwareDistributor.sol |
| Contracts | Base Sepolia | Testnet |
| Scoring | Cloudflare Workers (external) | attribution-scorer.ceo-1f9.workers.dev |
| CDN/Edge | Vercel Edge Network | No separate Cloudflare layer needed |

---

## Cron Jobs (vercel.json)

| Route | Schedule | Purpose |
|-------|---------|---------|
| `/api/cron/pool-settle` | `*/15 * * * *` | Settle token pool rewards → Merkle distributions |
| `/api/cron/epoch-end` | TBD | Close points epoch + publish distribution |
| `/api/cron/bridge-verify` | TBD | Verify Core DAO bridge txs (blocked: awaiting contract) |

All cron routes require `Authorization: Bearer {CRON_SECRET}` header.

---

## Key Design Decisions

1. **Joins write to Supabase, not the Attribution Worker.** The Worker's `GET /campaign` returns `participant: null` for our wallets — it doesn't read our DB. This is by design; the Worker is read-only external infrastructure.

2. **locallyJoined client-side flag.** Because the Worker always returns `participant: null`, after joining we set a client-side boolean so the UI doesn't revert. Long-term fix: build our own campaign detail endpoint that reads from Supabase.

3. **Reward price locked at swap time.** `pending_rewards` stores `amount_usd` (computed at tx time) + `amount_wei` (converted at lock time). Settlement doesn't re-fetch price — avoids oracle manipulation.

4. **Merkle double-hash.** Both Solidity (`keccak256(bytes.concat(keccak256(abi.encode(...))))`) and TypeScript (`StandardMerkleTree`) use the same standard leaf encoding. Uses `abi.encode` (64-byte padded), NOT `abi.encodePacked`.

5. **Referral code is deterministic.** `"mw_" + address.slice(2, 8).toLowerCase()` — never depends on a DB round-trip. InviteTab renders immediately.

6. **Inline styles on app pages.** Preserves design fidelity from original HTML mockups. Landing page uses Tailwind v4. Not to be mixed.
