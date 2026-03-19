-- =============================================================================
-- Mintware Phase 1 — Canonical Production Schema
--
-- Single source of truth. Last audited: 2026-03-19.
-- Reconstructed from all applied migrations (000003–000319).
--
-- USAGE: This file documents the FINAL target schema.
-- To apply to a fresh Supabase project, run each section in order.
-- For an existing project with migrations already applied, use only for reference.
--
-- MIGRATION ORDER (if applying from scratch):
--   1. This file (schema.sql) — creates all tables in dependency order
--   2. supabase/migrations/ — apply any new migrations on top
--
-- TABLE DEPENDENCY ORDER:
--   campaigns → participants, activity, epoch_state, distributions,
--               pending_rewards, daily_payouts, campaign_payouts, swap_events
--   wallet_profiles → referral_records, (participants.referred_by)
-- =============================================================================


-- =============================================================================
-- REFERRAL SYSTEM
-- =============================================================================

-- wallet_profiles
-- One row per connected wallet. Created on first connect.
-- ref_code is deterministic: "mw_" + address.slice(2,8).toLowerCase()
-- Never depends on this table to compute ref_code (computed client-side).

CREATE TABLE IF NOT EXISTS wallet_profiles (
  address       text        PRIMARY KEY,
  ref_code      text        UNIQUE NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wallet_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are publicly readable" ON wallet_profiles;
CREATE POLICY "Profiles are publicly readable"
  ON wallet_profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Wallet can insert own profile" ON wallet_profiles;
CREATE POLICY "Wallet can insert own profile"
  ON wallet_profiles FOR INSERT
  WITH CHECK (true);  -- enforced at API layer via service role

DROP POLICY IF EXISTS "Wallet can update own profile" ON wallet_profiles;
CREATE POLICY "Wallet can update own profile"
  ON wallet_profiles FOR UPDATE
  USING (true);


-- referral_records
-- One row per referred wallet. Status: pending → active.

CREATE TABLE IF NOT EXISTS referral_records (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer    text        NOT NULL REFERENCES wallet_profiles (address) ON DELETE CASCADE,
  referred    text        NOT NULL REFERENCES wallet_profiles (address) ON DELETE CASCADE,
  ref_code    text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active')),
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (referrer, referred)
);

CREATE INDEX IF NOT EXISTS referral_records_referrer_idx ON referral_records (referrer);
CREATE INDEX IF NOT EXISTS referral_records_referred_idx ON referral_records (referred);

ALTER TABLE referral_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Records readable by participant" ON referral_records;
CREATE POLICY "Records readable by participant"
  ON referral_records FOR SELECT USING (true);


-- referral_stats (VIEW)
-- Aggregated per-wallet referral stats. Read-only. Joins wallet_profiles + referral_records.
-- NOTE: Actual view definition is in Supabase. Columns:
--   address, ref_code, ref_link, tree_size, tree_quality, sharing_score


-- =============================================================================
-- CAMPAIGNS
-- =============================================================================

-- campaigns
-- Campaign metadata and configuration. Created via /create-campaign wizard.
-- Status transitions: draft → active → paused → ended → settled

CREATE TABLE IF NOT EXISTS campaigns (
  id                      text        PRIMARY KEY,  -- UUID string from Attribution Worker or our API

  -- Identity
  name                    text        NOT NULL,
  description             text,
  status                  text        NOT NULL DEFAULT 'active',
  creator                 text,       -- wallet address that created this campaign

  -- Type + token
  campaign_type           text        DEFAULT 'points'
                            CHECK (campaign_type IN ('token_pool', 'points')),
  token_contract          text,       -- ERC-20 contract for the reward token
  token_decimals          int         NOT NULL DEFAULT 18,

  -- Pool economics (token_pool campaigns)
  token_allocation_usd    numeric,    -- total pool value at campaign start
  pool_remaining_usd      numeric     CHECK (pool_remaining_usd >= 0),
  claim_duration_mins     int         CHECK (claim_duration_mins BETWEEN 1 AND 10080),
  buyer_reward_pct        numeric     DEFAULT 0
                            CHECK (buyer_reward_pct >= 0 AND buyer_reward_pct <= 1),
  referral_reward_pct     numeric     DEFAULT 0
                            CHECK (referral_reward_pct >= 0 AND referral_reward_pct <= 5),
  platform_fee_pct        numeric     DEFAULT 2
                            CHECK (platform_fee_pct >= 0 AND platform_fee_pct <= 100),
  daily_wallet_cap_usd    numeric     DEFAULT 0 CHECK (daily_wallet_cap_usd >= 0),
  daily_pool_cap_usd      numeric     DEFAULT 0 CHECK (daily_pool_cap_usd >= 0),

  -- Points campaign configuration
  use_score_multiplier    boolean     DEFAULT false,
  min_score               int         DEFAULT 0,   -- min Attribution score to join
  payout_preset           text        DEFAULT 'top10'
                            CHECK (payout_preset IN ('top3','top5','top10','top20')),
  referral_share_pct      numeric     NOT NULL DEFAULT 0
                            CHECK (referral_share_pct >= 0 AND referral_share_pct <= 100),
  min_daily_volume_usd    numeric     NOT NULL DEFAULT 25
                            CHECK (min_daily_volume_usd >= 0),
  max_points_per_wallet_pct numeric   NOT NULL DEFAULT 20
                            CHECK (max_points_per_wallet_pct > 0 AND max_points_per_wallet_pct <= 100),

  -- Chain + contract
  chain                   text,       -- 'base', 'core', 'bnb', etc.
  contract_address        text,       -- MintwareDistributor deployed for this campaign's chain

  -- Actions config (JSONB — array of action objects with points, type, limits)
  actions                 jsonb,

  -- Timestamps
  start_date              timestamptz,
  end_date                timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);
CREATE INDEX IF NOT EXISTS campaigns_creator_idx ON campaigns (creator);
CREATE INDEX IF NOT EXISTS campaigns_chain_idx ON campaigns (chain);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Campaigns are publicly readable" ON campaigns;
CREATE POLICY "Campaigns are publicly readable"
  ON campaigns FOR SELECT USING (true);


-- =============================================================================
-- PARTICIPANT STATE
-- =============================================================================

-- participants
-- One row per wallet per campaign. Created by POST /api/campaigns/join.
-- attribution_score + sharing_score snapshotted at join time; refreshed by epoch processor.

CREATE TABLE IF NOT EXISTS participants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       text        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet            text        NOT NULL,

  -- Score snapshots (at join time, refreshed periodically)
  attribution_score int         NOT NULL DEFAULT 0,
  sharing_score     int         NOT NULL DEFAULT 0,

  -- Observer mode (watches without counting toward rewards)
  observer          boolean     NOT NULL DEFAULT false,

  -- Running tallies
  total_points      numeric     NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  total_earned_usd  numeric     NOT NULL DEFAULT 0 CHECK (total_earned_usd >= 0),
  daily_volume_usd  numeric     NOT NULL DEFAULT 0,

  -- Referral attribution
  referred_by       text        REFERENCES wallet_profiles (address) ON DELETE SET NULL,

  -- Timestamps
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_active_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One participant per wallet per campaign
CREATE UNIQUE INDEX IF NOT EXISTS participants_campaign_wallet_uidx
  ON participants (campaign_id, wallet);

CREATE INDEX IF NOT EXISTS participants_wallet_idx ON participants (wallet);
CREATE INDEX IF NOT EXISTS participants_campaign_idx ON participants (campaign_id);

-- Epoch processor: rank active non-observers by points, tiebreak by joined_at
CREATE INDEX IF NOT EXISTS idx_participants_joined_at
  ON participants (campaign_id, joined_at ASC);

-- Daily active non-observers (for observer cron)
CREATE INDEX IF NOT EXISTS idx_participants_daily_active
  ON participants (campaign_id, daily_volume_usd)
  WHERE observer = false AND daily_volume_usd > 0;

-- Auto-maintain updated_at
CREATE OR REPLACE FUNCTION update_participants_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participants_updated_at_trigger ON participants;
CREATE TRIGGER participants_updated_at_trigger
  BEFORE UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION update_participants_updated_at();

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants are publicly readable" ON participants;
CREATE POLICY "Participants are publicly readable"
  ON participants FOR SELECT USING (true);
-- Writes via service role only


-- activity
-- Per-action event log. Dedup by (wallet, tx_hash, action_type).
-- For token_pool: points_earned = 0 (rewards tracked in pending_rewards).
-- For points: points_earned = the credited amount.

CREATE TABLE IF NOT EXISTS activity (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   text        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet        text        NOT NULL,
  action_type   text        NOT NULL
                  CHECK (action_type IN ('bridge', 'trade', 'referral_bridge', 'referral_trade')),
  points_earned numeric     NOT NULL DEFAULT 0,
  tx_hash       text        NOT NULL,
  referred_by   text,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Primary dedup: one credit per (wallet, tx_hash, action_type)
CREATE UNIQUE INDEX IF NOT EXISTS activity_wallet_tx_action_uidx
  ON activity (wallet, tx_hash, action_type);

-- Idempotency lookup
CREATE INDEX IF NOT EXISTS activity_tx_hash_wallet_idx
  ON activity (tx_hash, wallet, action_type);

-- Daily dedup: one trade action per wallet per day per campaign
CREATE INDEX IF NOT EXISTS activity_campaign_wallet_action_time_idx
  ON activity (campaign_id, wallet, action_type, recorded_at);

-- Referral credit lookups
CREATE INDEX IF NOT EXISTS activity_referred_by_idx
  ON activity (referred_by)
  WHERE referred_by IS NOT NULL;

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Activity is publicly readable" ON activity;
CREATE POLICY "Activity is publicly readable"
  ON activity FOR SELECT USING (true);
-- Writes via service role only


-- =============================================================================
-- REWARD PIPELINE — TOKEN POOL
-- =============================================================================

-- pending_rewards
-- Token pool reward locks. One row per tx_hash per reward_type.
-- Status flow: locked → claimable → claimed (or → expired)

CREATE TABLE IF NOT EXISTS pending_rewards (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         text        NOT NULL,
  wallet              text        NOT NULL,
  referrer            text,
  reward_type         text        NOT NULL
                        CHECK (reward_type IN ('buyer', 'referrer', 'platform_fee')),
  token_contract      text        NOT NULL,
  amount_wei          numeric     NOT NULL CHECK (amount_wei >= 0),
  reward_usd          numeric     NOT NULL DEFAULT 0 CHECK (reward_usd >= 0),
  purchase_amount_usd numeric     NOT NULL CHECK (purchase_amount_usd >= 0),
  tx_hash             text        NOT NULL,
  claimable_at        timestamptz NOT NULL,
  claimed_at          timestamptz,
  status              text        NOT NULL DEFAULT 'locked'
                        CHECK (status IN ('locked', 'claimable', 'claimed', 'expired')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Dedup: one reward entry per tx per type
CREATE UNIQUE INDEX IF NOT EXISTS pending_rewards_tx_type_uidx
  ON pending_rewards (tx_hash, reward_type);

CREATE INDEX IF NOT EXISTS pending_rewards_wallet_idx
  ON pending_rewards (wallet, status);

CREATE INDEX IF NOT EXISTS pending_rewards_campaign_idx
  ON pending_rewards (campaign_id, status);

ALTER TABLE pending_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Wallets read own pending rewards" ON pending_rewards;
CREATE POLICY "Wallets read own pending rewards"
  ON pending_rewards FOR SELECT
  USING (wallet = current_setting('request.jwt.claims', true)::json->>'address');


-- =============================================================================
-- REWARD PIPELINE — EPOCH / MERKLE (BOTH CAMPAIGN TYPES)
-- =============================================================================

-- epoch_state
-- Active epoch window and running point accumulator per campaign.
-- One active epoch per campaign at a time (enforced by partial unique index).
-- Status: active → settling → complete (or → error)

CREATE TABLE IF NOT EXISTS epoch_state (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     text        NOT NULL,
  epoch_number    int         NOT NULL CHECK (epoch_number >= 1),
  epoch_start     timestamptz NOT NULL,
  epoch_end       timestamptz NOT NULL,
  epoch_pool_usd  numeric     NOT NULL CHECK (epoch_pool_usd >= 0),
  total_points    numeric     NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'settling', 'complete', 'error')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One active epoch per campaign
CREATE UNIQUE INDEX IF NOT EXISTS epoch_state_campaign_active_uidx
  ON epoch_state (campaign_id)
  WHERE status = 'active';

-- History lookup
CREATE UNIQUE INDEX IF NOT EXISTS epoch_state_campaign_epoch_uidx
  ON epoch_state (campaign_id, epoch_number);

CREATE OR REPLACE FUNCTION update_epoch_state_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS epoch_state_updated_at_trigger ON epoch_state;
CREATE TRIGGER epoch_state_updated_at_trigger
  BEFORE UPDATE ON epoch_state
  FOR EACH ROW EXECUTE FUNCTION update_epoch_state_updated_at();

ALTER TABLE epoch_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Epoch state is publicly readable" ON epoch_state;
CREATE POLICY "Epoch state is publicly readable"
  ON epoch_state FOR SELECT USING (true);


-- distributions
-- Merkle tree publication records. One per campaign per epoch.
-- tree_json: StandardMerkleTree.dump() output (JSONB).
-- Status: pending → published → finalized

CREATE TABLE IF NOT EXISTS distributions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       text        NOT NULL,
  epoch_number      int         NOT NULL CHECK (epoch_number >= 1),
  merkle_root       text,                              -- NULL until published
  total_amount_usd  numeric     NOT NULL DEFAULT 0 CHECK (total_amount_usd >= 0),
  total_amount_wei  numeric     CHECK (total_amount_wei >= 0),
  participant_count int         NOT NULL DEFAULT 0,
  tree_json         jsonb,                             -- StandardMerkleTree.dump()
  ipfs_cid          text,                              -- IPFS CID of full tree
  oracle_signature  text,                              -- EIP-712 oracle signature
  onchain_id        numeric,                           -- uint256 from createDistribution()
  tx_hash           text,                              -- on-chain publish tx
  status            text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'published', 'finalized')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz
);

-- One distribution per campaign per epoch
CREATE UNIQUE INDEX IF NOT EXISTS distributions_campaign_epoch_uidx
  ON distributions (campaign_id, epoch_number);

-- Claim UI lookup by onchain_id
CREATE UNIQUE INDEX IF NOT EXISTS distributions_onchain_id_uidx
  ON distributions (onchain_id)
  WHERE onchain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS distributions_status_idx ON distributions (status);

ALTER TABLE distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Distributions are publicly readable" ON distributions;
CREATE POLICY "Distributions are publicly readable"
  ON distributions FOR SELECT USING (true);


-- daily_payouts
-- Per-wallet payout record per epoch. Stores Merkle proof for claim verification.
-- canonical payout table — use this, not campaign_payouts.

CREATE TABLE IF NOT EXISTS daily_payouts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     text        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  epoch_number    int         NOT NULL CHECK (epoch_number >= 1),
  wallet          text        NOT NULL,
  points          numeric     NOT NULL CHECK (points >= 0),
  multiplier      numeric     NOT NULL CHECK (multiplier >= 1),
  payout_usd      numeric     NOT NULL CHECK (payout_usd >= 0),
  amount_wei      numeric     NOT NULL CHECK (amount_wei >= 0),
  token_price_usd numeric     NOT NULL CHECK (token_price_usd > 0),
  merkle_proof    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One payout record per wallet per epoch per campaign
CREATE UNIQUE INDEX IF NOT EXISTS daily_payouts_campaign_epoch_wallet_uidx
  ON daily_payouts (campaign_id, epoch_number, wallet);

-- Claim status: unclaimed payouts for a wallet
CREATE INDEX IF NOT EXISTS daily_payouts_wallet_unclaimed_idx
  ON daily_payouts (wallet, claimed_at)
  WHERE claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS daily_payouts_campaign_epoch_idx
  ON daily_payouts (campaign_id, epoch_number);

ALTER TABLE daily_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Daily payouts are publicly readable" ON daily_payouts;
CREATE POLICY "Daily payouts are publicly readable"
  ON daily_payouts FOR SELECT USING (true);


-- =============================================================================
-- OBSERVER / LEGACY (DEPRECIATING — see ISSUES.md ISSUE-008)
-- =============================================================================

-- campaign_payouts
-- Daily rank + referral payout records. Created by observer cron.
-- Status: Superseded by daily_payouts for the primary claim flow.
-- Retained for historical leaderboard data only. Do not write new data here.

CREATE TABLE IF NOT EXISTS campaign_payouts (
  id           bigserial    PRIMARY KEY,
  campaign_id  text         NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet       text         NOT NULL,
  epoch_date   date         NOT NULL,
  rank         int          NOT NULL DEFAULT 0,
  points       int          NOT NULL DEFAULT 0,
  amount_usd   numeric      NOT NULL DEFAULT 0,
  type         text         NOT NULL DEFAULT 'rank'
                 CHECK (type IN ('rank', 'referral')),
  created_at   timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (campaign_id, wallet, epoch_date, type)
);

CREATE INDEX IF NOT EXISTS idx_payouts_campaign_epoch
  ON campaign_payouts (campaign_id, epoch_date DESC);

CREATE INDEX IF NOT EXISTS idx_payouts_wallet
  ON campaign_payouts (wallet, epoch_date DESC);

ALTER TABLE campaign_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payouts_select_public" ON campaign_payouts;
CREATE POLICY "payouts_select_public"
  ON campaign_payouts FOR SELECT USING (true);


-- =============================================================================
-- SWAP EVENTS (AUDIT LOG)
-- =============================================================================

-- swap_events
-- Append-only webhook log from Molten router.
-- Not used for reward logic — rewards are computed in processSwapEvent().
-- Used for audit, debugging, and replay.

CREATE TABLE IF NOT EXISTS swap_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash     text        NOT NULL UNIQUE,
  wallet      text        NOT NULL,
  campaign_id text,
  token_in    text,
  token_out   text,
  amount_usd  numeric,
  chain_id    int,
  raw_payload jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS swap_events_wallet_idx ON swap_events (wallet);
CREATE INDEX IF NOT EXISTS swap_events_campaign_idx ON swap_events (campaign_id);

ALTER TABLE swap_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Swap events are publicly readable" ON swap_events;
CREATE POLICY "Swap events are publicly readable"
  ON swap_events FOR SELECT USING (true);


-- =============================================================================
-- TEAM WHITELIST
-- =============================================================================

-- whitelisted_teams
-- Approved teams allowed to create points campaigns.
-- Inserted manually by admin or via approval of team_applications.

CREATE TABLE IF NOT EXISTS whitelisted_teams (
  wallet          text        PRIMARY KEY,
  protocol_name   text        NOT NULL,
  website         text,
  contact_email   text,
  approved_at     timestamptz NOT NULL DEFAULT now(),
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended'))
);

ALTER TABLE whitelisted_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Whitelist is publicly readable" ON whitelisted_teams;
CREATE POLICY "Whitelist is publicly readable"
  ON whitelisted_teams FOR SELECT USING (true);


-- team_applications
-- Inbound applications for whitelist access.

CREATE TABLE IF NOT EXISTS team_applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet          text        NOT NULL,
  protocol_name   text        NOT NULL,
  website         text,
  contact_email   text        NOT NULL,
  pool_size_usd   numeric,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE team_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Applications are publicly readable" ON team_applications;
CREATE POLICY "Applications are publicly readable"
  ON team_applications FOR SELECT USING (true);


-- =============================================================================
-- DATABASE FUNCTIONS
-- =============================================================================

-- increment_epoch_points
-- Called by swapHook after crediting trade/referral points.
-- Atomically adds delta to total_points on the active epoch.

CREATE OR REPLACE FUNCTION increment_epoch_points(
  p_campaign_id text,
  p_delta       numeric
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE epoch_state
     SET total_points = total_points + p_delta,
         updated_at   = now()
   WHERE campaign_id  = p_campaign_id
     AND status       = 'active';
END;
$$;


-- deduct_token_pool_reward
-- Atomically checks pool_remaining_usd >= required and decrements.
-- Returns TRUE on success, FALSE if pool insufficient or campaign not found.
-- Uses FOR UPDATE to prevent race conditions.

CREATE OR REPLACE FUNCTION deduct_token_pool_reward(
  p_campaign_id  text,
  p_required_usd numeric
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_remaining numeric;
BEGIN
  SELECT pool_remaining_usd
    INTO v_remaining
    FROM campaigns
   WHERE id = p_campaign_id
     AND campaign_type = 'token_pool'
   FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_remaining < p_required_usd THEN RETURN false; END IF;

  UPDATE campaigns
     SET pool_remaining_usd = pool_remaining_usd - p_required_usd
   WHERE id = p_campaign_id;

  RETURN true;
END;
$$;


-- increment_earned_usd
-- Called by epoch-end cron after writing each payout record.
-- Increments lifetime total_earned_usd on the participant row.

CREATE OR REPLACE FUNCTION increment_earned_usd(
  p_campaign_id text,
  p_wallet      text,
  p_amount      numeric
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE participants
     SET total_earned_usd = total_earned_usd + p_amount,
         updated_at       = now()
   WHERE campaign_id = p_campaign_id
     AND wallet      = p_wallet;
END;
$$;


-- =============================================================================
-- NOTES
-- =============================================================================
--
-- DEPRECATED TABLES: campaign_payouts is retained for historical data only.
-- New code should write to daily_payouts. campaign_payouts will be removed
-- once historical data is migrated. See ISSUES.md ISSUE-008.
--
-- REFERRAL_STATS VIEW: Defined in Supabase dashboard, not in this file.
-- It aggregates wallet_profiles + referral_records and computes:
--   address, ref_code, ref_link, tree_size, tree_quality, sharing_score
--
-- RLS NOTE: All tables have RLS enabled. Reads are public (anon key).
-- All writes go through service role (bypasses RLS). No direct client writes.
--
-- CHAIN CONSTRAINT: campaigns.chain has no CHECK constraint.
-- Validation happens at application layer (config/chains.ts).
-- Historic data includes non-standard chain names.
-- =============================================================================
