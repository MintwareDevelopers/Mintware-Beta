-- !! DO NOT PUSH TO LIVE DB !!
-- Superseded by 20260318000003_reconcile_live_schema.sql
-- These tables/columns already exist in the live DB via the reconcile migration.
-- Pushing this file will fail or silently corrupt the schema.
--
-- =============================================================================
-- Migration: Campaign Engine — Participants, Activity, Campaigns
-- Ticket 2: Real-time trading attribution
-- Branch: feature/campaign-engine
-- Date: 2026-03-17
--
-- Adds: campaigns, participants, activity tables.
-- Alters: pending_rewards — adds reward_usd column (USD value computed at swap
--         time; amount_wei resolved later by price oracle / claim contract).
-- Adds: deduct_token_pool_reward() atomic Postgres function.
-- Does NOT touch: wallet_profiles, referral_records, referral_stats.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Alter pending_rewards: add reward_usd
-- amount_wei = 0 placeholder until price oracle resolves token amount.
-- reward_usd = the computed dollar value of the reward at swap time.
-- ---------------------------------------------------------------------------
alter table pending_rewards
  add column if not exists reward_usd numeric not null default 0
    check (reward_usd >= 0);


-- ---------------------------------------------------------------------------
-- campaigns
--
-- Canonical campaign config. Populated by Mintware admin at campaign creation
-- (or synced from the campaign worker). Single source of truth for the
-- attribution engine — swap hook reads from here, not the external API.
--
-- campaign_type:
--   'token_pool'  — self-serve, per-tx rewards, pool depletes
--   'points'      — curated, epoch-based, score-multiplied
--
-- Token pool fields (null for points campaigns):
--   token_contract, token_allocation_usd, buyer_reward_pct,
--   referral_reward_pct, platform_fee_pct, claim_duration_mins,
--   pool_remaining_usd
--
-- Points campaign fields (null for token pool):
--   pool_usd, token_symbol, epoch_duration_days, epoch_count,
--   actions (jsonb), min_score, sponsorship_fee
-- ---------------------------------------------------------------------------
create table if not exists campaigns (
  id                    text        primary key,  -- matches external API campaign id
  campaign_type         text        not null
                          check (campaign_type in ('token_pool', 'points')),
  name                  text        not null,
  status                text        not null default 'upcoming'
                          check (status in ('upcoming', 'live', 'ended', 'paused')),
  start_date            timestamptz,
  end_date              timestamptz,

  -- Token pool config
  token_contract        text,
  token_allocation_usd  numeric,
  buyer_reward_pct      numeric     check (buyer_reward_pct between 0.1 and 10),
  referral_reward_pct   numeric     check (referral_reward_pct between 0.1 and 10),
  platform_fee_pct      numeric     not null default 2.0,
  claim_duration_mins   int         check (claim_duration_mins between 1 and 10080),
  pool_remaining_usd    numeric     check (pool_remaining_usd >= 0),

  -- Points campaign config
  pool_usd              numeric,
  token_symbol          text,
  epoch_duration_days   int,
  epoch_count           int,
  actions               jsonb,      -- { bridge: 15, trade: 8, referral_bridge: 60, referral_trade: 8 }
  min_score             int         default 0,
  sponsorship_fee       numeric,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists campaigns_status_idx on campaigns (status);
create index if not exists campaigns_type_idx   on campaigns (campaign_type);

create or replace function update_campaigns_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger campaigns_updated_at_trigger
  before update on campaigns
  for each row execute function update_campaigns_updated_at();

alter table campaigns enable row level security;

create policy "Campaigns are publicly readable"
  on campaigns for select using (true);


-- ---------------------------------------------------------------------------
-- participants
--
-- One row per (campaign_id, wallet) join. Created when a wallet calls POST /join.
-- joined_at is the hard cutoff — actions before this timestamp are never credited.
-- attribution_score and sharing_score are cached at join time and refreshed
-- at epoch distribution for multiplier calculation.
-- total_points accumulates within the current epoch (reset at epoch end).
-- total_earned_usd is a lifetime tally across all epochs.
-- ---------------------------------------------------------------------------
create table if not exists participants (
  id                  uuid        primary key default gen_random_uuid(),
  campaign_id         text        not null references campaigns (id) on delete cascade,
  wallet              text        not null,
  joined_at           timestamptz not null default now(),
  attribution_score   int         not null default 0,
  sharing_score       int         not null default 0,
  total_points        numeric     not null default 0 check (total_points >= 0),
  total_earned_usd    numeric     not null default 0 check (total_earned_usd >= 0),
  last_active_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One participant record per wallet per campaign
create unique index if not exists participants_campaign_wallet_uidx
  on participants (campaign_id, wallet);

create index if not exists participants_wallet_idx
  on participants (wallet);

create or replace function update_participants_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger participants_updated_at_trigger
  before update on participants
  for each row execute function update_participants_updated_at();

alter table participants enable row level security;

create policy "Participants are publicly readable"
  on participants for select using (true);


-- ---------------------------------------------------------------------------
-- activity
--
-- Immutable event ledger. One row per credited action.
-- tx_hash + wallet + action is the deduplication key — the same wallet
-- cannot receive the same action credit for the same transaction twice.
-- A single swap tx_hash can appear in two rows:
--   wallet = swapper,  action = 'trade'
--   wallet = referrer, action = 'referral_trade'
-- points = null for token_pool campaigns (rewards tracked in pending_rewards).
-- reward_usd = null for points campaigns (value tracked in distributions).
-- ---------------------------------------------------------------------------
create table if not exists activity (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     text        not null references campaigns (id) on delete cascade,
  wallet          text        not null,
  action          text        not null
                    check (action in ('bridge', 'trade', 'referral_bridge', 'referral_trade')),
  points          numeric,    -- null for token_pool campaigns
  reward_usd      numeric,    -- null for points campaigns
  tx_hash         text        not null,
  referrer        text,       -- populated on referral_trade / referral_bridge rows
  credited_at     timestamptz not null default now()
);

-- Core dedup: same wallet cannot earn the same action twice per tx
create unique index if not exists activity_tx_wallet_action_uidx
  on activity (tx_hash, wallet, action);

create index if not exists activity_campaign_wallet_idx
  on activity (campaign_id, wallet, credited_at desc);

create index if not exists activity_campaign_action_idx
  on activity (campaign_id, action, credited_at desc);

alter table activity enable row level security;

create policy "Activity is publicly readable"
  on activity for select using (true);


-- ---------------------------------------------------------------------------
-- deduct_token_pool_reward(campaign_id, required_usd)
--
-- Atomically checks pool_remaining_usd >= required_usd and decrements.
-- Returns TRUE if deduction succeeded, FALSE if pool is insufficient.
-- Called inside a transaction to prevent race conditions between concurrent
-- swap attributions hitting the same campaign simultaneously.
-- ---------------------------------------------------------------------------
create or replace function deduct_token_pool_reward(
  p_campaign_id  text,
  p_required_usd numeric
) returns boolean language plpgsql as $$
declare
  v_remaining numeric;
begin
  -- Lock the campaign row for this transaction
  select pool_remaining_usd
    into v_remaining
    from campaigns
   where id = p_campaign_id
     and campaign_type = 'token_pool'
   for update;

  if not found then
    return false;
  end if;

  if v_remaining < p_required_usd then
    return false;
  end if;

  update campaigns
     set pool_remaining_usd = pool_remaining_usd - p_required_usd
   where id = p_campaign_id;

  return true;
end;
$$;


-- =============================================================================
-- Summary
--
-- campaigns     — canonical campaign config, both types, single source of truth
-- participants  — wallet × campaign join records; joined_at is eligibility cutoff
-- activity      — immutable action credit ledger; (tx_hash, wallet, action) dedup
-- pending_rewards.reward_usd — USD value at swap time (amount_wei = oracle TBD)
-- deduct_token_pool_reward() — atomic pool balance check-and-decrement
-- =============================================================================


-- ---------------------------------------------------------------------------
-- increment_epoch_points(campaign_id, delta)
--
-- Atomically increments total_points on the active epoch for a campaign.
-- Called by swapHook after crediting trade + referral_trade points.
-- No-op if no active epoch found (bridge cron handles epoch creation).
-- ---------------------------------------------------------------------------
create or replace function increment_epoch_points(
  p_campaign_id text,
  p_delta       numeric
) returns void language plpgsql as $$
begin
  update epoch_state
     set total_points = total_points + p_delta,
         updated_at   = now()
   where campaign_id  = p_campaign_id
     and status       = 'active';
end;
$$;