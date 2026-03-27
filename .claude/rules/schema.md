# Database Schema (Supabase)

Source of truth: `docs/schema.sql`

## Referral Tables

**`wallet_profiles`**
- `address` (pk), `ref_code`, `last_seen_at`

**`referral_records`**
- `referrer`, `referred`, `ref_code`, `status` (`pending` | `active`)

**`referral_stats`** — VIEW
- `address`, `ref_code`, `ref_link`, `tree_size`, `tree_quality`, `sharing_score`

**`waitlist`**
- Waitlist signups from landing page

## Campaign Engine Tables

**`pending_rewards`**
- `campaign_id`, `tx_hash`, `reward_type`, `amount_usd` (capped $10k), `wallet`
- `claimable_at`, `status` (`locked` | `claimable` | `claimed`)
- Unique: `(campaign_id, tx_hash, reward_type)` — campaign-scoped, prevents double-crediting

**`distributions`**
- `campaign_id`, `epoch_number`, `merkle_root`, `ipfs_cid`, `tx_hash`
- `deadline` (bigint, nullable) — required for v2 claim; 500 returned if null
- `status`: `pending → published → finalized`

**`epoch_state`**
- `campaign_id`, `total_points`, `status` (`active` | `settling` | `complete`)
- Unique partial index on `campaign_id where status = 'active'`
- `updated_at` auto-maintained by trigger

**`activity`**
- `campaign_id`, `tx_hash`, `wallet`, `action_type`, `points`
- Unique: `(campaign_id, tx_hash, wallet, action_type)`

**`participants`**
- Joined wallets per campaign

**`campaigns`** (Supabase-side)
- Includes `closed` (bool) and `closed_at` columns
- `contract_address` — set after contract deploy

## Applied Migrations

- `supabase/migrations/20260317000001_campaign_engine_schema.sql` — pending_rewards, distributions, epoch_state
- `pending_rewards` composite unique index (campaign-scoped)
- `campaigns.closed` + `campaigns.closed_at` columns
- `activity` unique constraint: `(campaign_id, tx_hash, wallet, action_type)`
- `distributions.deadline` bigint column (nullable, backward compat)
