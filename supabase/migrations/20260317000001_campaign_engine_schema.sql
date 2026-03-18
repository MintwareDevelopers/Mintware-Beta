-- =============================================================================
-- Migration: Campaign Engine Schema — Ticket 1
-- Tables: pending_rewards, distributions, epoch_state
-- Branch: feature/campaign-engine
-- Date: 2026-03-17
--
-- Adds three new tables to support the Mintware campaign reward system.
-- Does NOT touch existing tables (wallet_profiles, referral_records, referral_stats).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- pending_rewards
--
-- Tracks per-transaction reward locks for the Token Reward Pool campaign type.
-- Each swap event on Mintware generates up to three rows: buyer reward,
-- referrer reward, and platform fee. Rewards are locked for claim_duration_mins
-- before becoming claimable.
--
-- reward_type values:
--   'buyer'        — buyer_reward_pct of purchase_amount_usd
--   'referrer'     — referral_reward_pct of purchase_amount_usd (null if no referrer)
--   'platform_fee' — fixed 2% Mintware fee
--
-- status flow: locked → claimable → claimed
--              locked → expired (if never claimed after a grace window)
-- ---------------------------------------------------------------------------
create table if not exists pending_rewards (
  id                  uuid        primary key default gen_random_uuid(),
  campaign_id         text        not null,
  wallet              text        not null,              -- reward recipient
  referrer            text,                              -- null if no referrer
  reward_type         text        not null               -- 'buyer' | 'referrer' | 'platform_fee'
                        check (reward_type in ('buyer', 'referrer', 'platform_fee')),
  token_contract      text        not null,              -- ERC-20 contract of reward token
  amount_wei          numeric     not null check (amount_wei >= 0),  -- reward in token base units
  purchase_amount_usd numeric     not null check (purchase_amount_usd >= 0),
  tx_hash             text        not null,              -- on-chain swap tx that triggered this
  claimable_at        timestamptz not null,              -- now() + claim_duration_mins
  claimed_at          timestamptz,                       -- null = not yet claimed
  status              text        not null default 'locked'
                        check (status in ('locked', 'claimable', 'claimed', 'expired')),
  created_at          timestamptz not null default now()
);

-- Prevent double-crediting: one reward row per tx_hash per reward_type
create unique index if not exists pending_rewards_tx_type_uidx
  on pending_rewards (tx_hash, reward_type);

-- Fast lookups by wallet for claim UI
create index if not exists pending_rewards_wallet_idx
  on pending_rewards (wallet, status);

-- Fast lookups by campaign for pool depletion monitoring
create index if not exists pending_rewards_campaign_idx
  on pending_rewards (campaign_id, status);

-- Enable RLS — policy will allow wallets to read their own rewards only
alter table pending_rewards enable row level security;

create policy "Wallets read own pending rewards"
  on pending_rewards for select
  using (wallet = current_setting('request.jwt.claims', true)::json->>'address');


-- ---------------------------------------------------------------------------
-- distributions
--
-- Tracks Merkle-tree epoch distributions for Points Campaign payouts.
-- At epoch end, a cron job computes wallet_payout for every participant,
-- builds a Merkle tree, publishes the root on-chain, and writes a row here.
--
-- status flow: pending → published → finalized
--   pending   — computed off-chain, not yet on-chain
--   published — merkle_root written to contract, wallets can claim
--   finalized — claim window closed, tx confirmed settled
-- ---------------------------------------------------------------------------
create table if not exists distributions (
  id                uuid        primary key default gen_random_uuid(),
  campaign_id       text        not null,
  epoch_number      int         not null check (epoch_number >= 1),
  merkle_root       text,                               -- null until published on-chain
  total_amount_usd  numeric     not null check (total_amount_usd >= 0),
  participant_count int         not null default 0,
  ipfs_cid          text,                               -- IPFS content ID of full Merkle tree data
  tx_hash           text,                               -- on-chain tx that set the merkle root
  status            text        not null default 'pending'
                      check (status in ('pending', 'published', 'finalized')),
  created_at        timestamptz not null default now(),
  published_at      timestamptz
);

-- One distribution row per campaign per epoch
create unique index if not exists distributions_campaign_epoch_uidx
  on distributions (campaign_id, epoch_number);

create index if not exists distributions_status_idx
  on distributions (status);

-- Enable RLS — distributions are read-only public data
alter table distributions enable row level security;

create policy "Distributions are publicly readable"
  on distributions for select
  using (true);


-- ---------------------------------------------------------------------------
-- epoch_state
--
-- One row per active Points Campaign. Tracks the current epoch window,
-- accumulated total_points across all participants, and the epoch status.
-- Updated in real-time as action points are credited; finalized by cron.
--
-- status flow: active → settling → complete
--   active    — epoch open, actions being credited
--   settling  — epoch_end passed, cron is computing payouts
--   complete  — distribution written, points reset, next epoch started
-- ---------------------------------------------------------------------------
create table if not exists epoch_state (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     text        not null,
  epoch_number    int         not null check (epoch_number >= 1),
  epoch_start     timestamptz not null,
  epoch_end       timestamptz not null,
  epoch_pool_usd  numeric     not null check (epoch_pool_usd >= 0),  -- pool_usd / epoch_count
  total_points    numeric     not null default 0 check (total_points >= 0),
  status          text        not null default 'active'
                    check (status in ('active', 'settling', 'complete')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Only one active epoch per campaign at any time
create unique index if not exists epoch_state_campaign_active_uidx
  on epoch_state (campaign_id)
  where status = 'active';

-- Lookup by campaign + epoch number (for cron and history)
create unique index if not exists epoch_state_campaign_epoch_uidx
  on epoch_state (campaign_id, epoch_number);

-- Auto-update updated_at on any row change
create or replace function update_epoch_state_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger epoch_state_updated_at_trigger
  before update on epoch_state
  for each row execute function update_epoch_state_updated_at();

-- Enable RLS — epoch state is publicly readable, written only by service role
alter table epoch_state enable row level security;

create policy "Epoch state is publicly readable"
  on epoch_state for select
  using (true);


-- =============================================================================
-- Summary
--
-- pending_rewards  — Token Reward Pool: per-tx buyer/referrer/fee locks
-- distributions    — Points Campaign: Merkle epoch distribution records
-- epoch_state      — Points Campaign: current epoch window + point accumulator
--
-- Not included in this ticket (future migrations):
--   participants         — joined wallets per campaign
--   activity             — per-action point credit ledger
--   daily_payouts        — per-wallet epoch payout history
-- =============================================================================
