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
- **Unique: `(wallet, tx_hash, action_type)` — NOT campaign-scoped.** Any per-campaign idempotency
  key must therefore encode the campaign id *inside* `tx_hash` (see `holdSnapshot.ts` — `hold:<campaignId>:<epoch>:<date>`).
- `action_type` CHECK: `trade | referral_trade | subscribe | hold | referral_subscribe`
  (RWA action types added in `20260728000002`).

**`participants`**
- Joined wallets per campaign

**`campaigns`** (Supabase-side)
- Includes `closed` (bool) and `closed_at` columns
- `contract_address` — set after contract deploy
- RWA incentive layer: `surface` (`defi`|`rwa`), `linked_deal_id` (→ `vault_deals`), `duration_match_days` (`20260728000001`)

**`token_pool_deductions`** — idempotency guard for token-pool swap deductions
- PK: `(campaign_id, tx_hash)` — one deduction per swap tx
- Written atomically by `deduct_token_pool_reward_idempotent(campaign_id, tx_hash, required_usd)` RPC,
  which guards the pool decrement so concurrent/replay same-tx requests can't drain the pool twice
  (returns `'ok'|'duplicate'|'insufficient'|'not_found'`). Supersedes the non-idempotent
  `deduct_token_pool_reward()` in the swap-reward hot path (`swapHook.ts` → `processTokenPool`).

## Applied Migrations

- `supabase/migrations/20260317000001_campaign_engine_schema.sql` — pending_rewards, distributions, epoch_state
- `pending_rewards` composite unique index (campaign-scoped)
- `campaigns.closed` + `campaigns.closed_at` columns
- `activity` unique constraint: `(wallet, tx_hash, action_type)` (migration `20260319000003`)
- `distributions.deadline` bigint column (nullable, backward compat)
- `20260728000001_rwa_incentive_surface.sql` — `campaigns.surface` / `linked_deal_id` / `duration_match_days` (applied)
- `20260728000002_activity_action_types.sql` — widens `activity.action_type` CHECK for RWA (`subscribe`/`hold`/`referral_subscribe`)
- `20260728000003_credit_hold_points.sql` — campaign-scoped unique index `(campaign_id, tx_hash, wallet, action_type)` + atomic idempotent `credit_hold_points()` RPC (guard-insert + participant-increment in one tx; ON CONFLICT DO NOTHING → no double-credit). The global `(wallet, tx_hash, action_type)` index stays for the DeFi path.
