# Rewards & Campaign Engine

## Two Campaign Types

| | Token Reward Pool | Points Campaign |
|---|---|---|
| Created by | Anyone (self-serve) | Whitelisted teams only |
| Reward trigger | Per swap transaction | Per epoch distribution |
| Score multipliers | No | Yes — Attribution + Sharing |
| Platform fee | 2% per tx | Flat sponsorship fee (B2B) |
| Pool | Depletes until empty | Fixed, epoch-split |
| Access | Open | `min_score` gated |

## Score Multipliers (Points Campaign only)

| Percentile | Attribution | Sharing |
|---|---|---|
| 0–33% | 1.0× | 1.0× |
| 34–66% | 1.25× | 1.15× |
| 67–100% | 1.5× | 1.3× |

Combined = `attribution_multiplier × sharing_multiplier` (max 1.95×)
Applied at point-credit time in `processPoints` (`swapHook.ts`) when `use_score_multiplier = true`.
**Not** applied at payout calculation time (audit fix C2).

## Campaign Actions

| Action | Points | Frequency |
|---|---|---|
| `bridge` | 15 | One-time per wallet |
| `trade` | 8 | Once per calendar day |
| `referral_bridge` | 60 | Per referred wallet that bridges |
| `referral_trade` | 8 | Per referred wallet per trading day |

## Epoch Reward Formula

```
wallet_payout = (epoch_pool / epoch_count) × (wallet_points / total_points) × combined_multiplier
```

## Supabase Tables (Campaign Engine)

**`pending_rewards`** — Token Reward Pool per-tx reward locks
- Unique index: `(campaign_id, tx_hash, reward_type)` — prevents double-crediting (campaign-scoped)
- `claimable_at = now() + claim_duration_mins`
- Status: `locked → claimable → claimed`
- `amount_usd` capped at $10k

**`distributions`** — Points Campaign Merkle epoch distribution records
- `merkle_root`, `ipfs_cid`, `tx_hash`, `deadline` (bigint, nullable)
- Status: `pending → published → finalized`

**`epoch_state`** — Current epoch window + running point accumulator
- Unique partial index on `campaign_id where status = 'active'` — enforces one active epoch
- Status: `active → settling → complete`

**`activity`** — Per-action point credit ledger
- Unique constraint: `(campaign_id, tx_hash, wallet, action_type)`

**`participants`** — Joined wallets per campaign

## Claim Flow (v2)

1. `/api/claim` fetches `deadline` from `distributions.deadline` — returns 500 if null (no fallback)
2. Oracle signs EIP-712 `{ campaignId, epochNumber, merkleRoot, deadline }`
3. `ClaimCard.tsx` passes `BigInt(deadline)` as 5th of 7 params to `claim()`
4. "Claim All (N)" batch button when 2+ claimable rewards share a contract (`batchClaim`)
5. `/api/claim/mark-claimed` — Bearer-auth, marks `pending_rewards` as claimed

## Cron Jobs (Vercel Hobby — max once/day)

| Path | Schedule |
|---|---|
| `/api/cron/bridge-verify` | `0 0 * * *` |
| `/api/cron/epoch-end` | `0 1 * * *` |
| `/api/cron/pool-settle` | `0 2 * * *` |
| `/api/treasury/sweep` | `0 3 * * *` |
| `/api/cron/vault-epoch-close` | `0 0 * * 1` (Monday) |
