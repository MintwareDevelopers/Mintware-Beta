# Mintware Phase 1 — API Map
> Single source of truth for all API routes. Last audited: 2026-03-19.

---

## Our API Routes (`/app/api/`)

### Referral

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/referral` | GET | Anon (RLS) | Fetch referral stats for a wallet. Query: `?address=0x...` Reads `referral_stats` view. |
| `/api/referral/generate` | POST | None | Upsert `wallet_profiles` row, return stats. Body: `{ address }` |

### Campaigns — Join

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/campaigns/join` | POST | None | Join a campaign. Validates address, fetches Attribution score (4s timeout, defaults 0), checks `min_score` gate for points campaigns, upserts `participants` row. Body: `{ campaign_id, address }` Response: `{ ok, campaign_id, wallet, attribution_score }` |

### Campaigns — Management

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/campaigns/manage` | GET | Service role | Fetch campaigns created by a wallet. Query: `?wallet=0x...` |
| `/api/campaigns/manage` | POST | Service role | Update campaign metadata. Body: `{ campaign_id, ...fields }` |
| `/api/campaigns/mine` | GET | Service role | List campaigns where `campaigns.creator = address`. Query: `?address=0x...` |

### Campaigns — Swap Events

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/campaigns/swap-event` | POST | `x-webhook-secret: {SWAP_WEBHOOK_SECRET}` | Webhook from Molten router. Calls `swapHook.processSwapEvent()`. Body: `{ tx_hash, wallet, campaign_id, token_in, token_out, amount_usd, chain_id }` Response: `{ ok, rewards }` |

### Claims

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/claim` | GET | Service role | Fetch Merkle proof + amount for a wallet's claimable distribution. Query: `?address=0x...&distribution_id=uuid` Returns: `{ amount_wei, proof[], leaf_index }` |
| `/api/claim` | POST | Service role | Mark a distribution as claimed after on-chain tx. Body: `{ address, distribution_id, tx_hash }` |
| `/api/claim/status` | GET | Service role | All claimable distributions for a wallet. Query: `?address=0x...` Returns: `[{ distribution_id, campaign_name, amount_wei, status, claimed_at }]` |

### Rewards

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/rewards/pending` | GET | Service role | Pending (locked) rewards for a wallet. Query: `?address=0x...` Returns: `[{ campaign_id, amount_usd, claimable_at, status }]` |

### Teams

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/teams/apply` | POST | None | Submit whitelist application for points campaign access. Body: `{ wallet, protocol_name, website, contact_email, pool_size_usd }` |
| `/api/teams/whitelist` | GET | Anon (RLS) | Check if a wallet is approved. Query: `?address=0x...` Returns: `{ approved: boolean, status }` |

### Cron Jobs

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/cron/pool-settle` | GET | `Bearer {CRON_SECRET}` | Settle all claimable `pending_rewards` into Merkle distributions. Runs every 15 min. Max duration: 300s. |
| `/api/cron/epoch-end` | GET | `Bearer {CRON_SECRET}` | Close active epoch for points campaigns, publish distribution. |
| `/api/cron/bridge-verify` | GET | `Bearer {CRON_SECRET}` | Poll Core DAO bridge for completed bridge txs. **BLOCKED** — `CORE_DAO_BRIDGE_CONTRACT` not set. |

---

## External APIs (Not Our Code)

### Attribution Worker
**Base URL:** `https://attribution-scorer.ceo-1f9.workers.dev`
Defined as `export const API` in `lib/api.ts`.

| Endpoint | Method | Used In | Description |
|----------|--------|---------|-------------|
| `/score?address=` | GET | `join/route.ts`, `profile/page.tsx` | Full Attribution score profile for a wallet |
| `/campaigns` | GET | `dashboard/page.tsx` | List all campaigns |
| `/campaign?id=&address=` | GET | `campaign/[id]/page.tsx` | Single campaign + participant data |
| `/leaderboard?campaign_id=` | GET | `leaderboard/page.tsx` | Campaign leaderboard |
| `/join` | POST | ~~JoinButton.tsx~~ | **DEPRECATED.** Returns "Invalid wallet". Replaced by our `/api/campaigns/join`. |

**Important:** The Worker's `GET /campaign` always returns `participant: null` for wallets in our Supabase. This is expected — it reads its own DB, not ours. Do not use it to determine join state.

### LI.FI
**SDK:** `@lifi/sdk`, `@lifi/widget`
Used for: swap routing (all chains). Integrator ID: `mintware`. Fee recipient: `NEXT_PUBLIC_MINTWARE_TREASURY`.

### CoinGecko
**Base URL:** `https://api.coingecko.com/api/v3`
Used in: `lib/campaigns/priceFeed.ts`. Fallback if `PRICE_FEED_URL` not set. Pro plan key via `COINGECKO_API_KEY`.

---

## On-Chain — MintwareDistributor Contract

| Function | Called From | Description |
|----------|------------|-------------|
| `createDistribution(merkleRoot, token, totalAmount, oracleSig)` | `lib/campaigns/onchainPublisher.ts` (cron) | Publish a new Merkle distribution on-chain |
| `claim(distributionId, amount, proof[])` | Client (`ClaimCard.tsx`) | User claims their allocation with Merkle proof |
| `computeLeaf(address, amount)` | Verification | View function to verify leaf hash before claiming |

**Addresses:**
- Base mainnet: `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE`
- Base Sepolia: `0xcf2EA99639C038a475B710b2Be82b974D777C306`
- Core DAO: Not yet deployed
- BNB Chain: Not yet deployed

---

## Deprecated / Do Not Use

| Endpoint | Status | Replacement |
|----------|--------|-------------|
| `attribution-scorer.ceo-1f9.workers.dev/join` | DEPRECATED — returns "Invalid wallet" | `POST /api/campaigns/join` |
| `mintware-campaigns.ceo-1f9.workers.dev/*` | UNUSED — dead env var | No replacement needed; not used |
