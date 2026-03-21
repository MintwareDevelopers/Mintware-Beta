-- =============================================================================
-- Mintware Phase 1 — Canonical Production Schema
--
-- Single source of truth. Last audited: 2026-03-21.
-- Reflects the ACTUAL live Supabase DB as confirmed by information_schema query.
--
-- USAGE: Reference only. Do NOT run this against an existing DB —
-- use the migration files in supabase/migrations/ instead.
--
-- Live DB confirmed tables (2026-03-21):
--   activity, auth_nonces*, campaign_payouts, campaigns, daily_payouts,
--   distributions, eas_attestations, epoch_state, participants,
--   pending_rewards, referral_records, swap_events, team_applications,
--   waitlist, wallet_activity*, wallet_profiles, whitelisted_teams
--
-- * auth_nonces and wallet_activity exist in the live DB but have no
--   migration files and are not referenced by any app code. Treat as
--   legacy/unknown — do not touch.
--
-- Live DB confirmed functions (2026-03-21):
--   check_activation_threshold*  — no migration file, not in app code
--   deduct_token_pool_reward     — migration 000003
--   increment_earned_usd         — migration 000003
--   increment_epoch_points       — migration 000003
--   increment_participant_points — migration 20260321000001
--   sync_referral_counts*        — no migration file; probably maintains
--                                   wallet_profiles.total_referred / active_referred
--   touch_wallet_last_seen*      — no migration file; probably updates last_seen_at
--   update_epoch_state_updated_at — migration 000003 (trigger function)
--
-- * These functions exist in live DB but have no migration files.
--   Do not recreate or modify them without investigation.
-- =============================================================================


-- =============================================================================
-- REFERRAL SYSTEM
-- =============================================================================

-- wallet_profiles
-- One row per connected wallet. Created on first connect via POST /api/auth/connect.
-- ref_code is basename-first (e.g. "jake") or base58-encoded address fragment fallback.
-- Legacy mw_xxxxxx codes still valid for wallets that connected before 2026-03-19.
-- Extra columns in live DB (legacy, maintained by sync_referral_counts trigger):
--   total_referred integer DEFAULT 0
--   active_referred integer DEFAULT 0

CREATE TABLE IF NOT EXISTS wallet_profiles (
  address         text          PRIMARY KEY,
  ref_code        varchar(32)   NOT NULL UNIQUE,
  last_seen_at    timestamptz   NOT NULL DEFAULT now(),
  created_at      timestamptz   DEFAULT now()
);

ALTER TABLE wallet_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are publicly readable"
  ON wallet_profiles FOR SELECT USING (true);


-- referral_records
-- One row per referred wallet. Status: pending → active.
-- Extra column in live DB: activated_at timestamptz

CREATE TABLE IF NOT EXISTS referral_records (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer      text        NOT NULL REFERENCES wallet_profiles (address) ON DELETE CASCADE,
  referred      text        NOT NULL REFERENCES wallet_profiles (address) ON DELETE CASCADE,
  ref_code      text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active')),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (referrer, referred)
);

CREATE INDEX IF NOT EXISTS referral_records_referrer_idx ON referral_records (referrer);
CREATE INDEX IF NOT EXISTS referral_records_referred_idx ON referral_records (referred);

ALTER TABLE referral_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Records readable by participant"
  ON referral_records FOR SELECT USING (true);


-- referral_stats (VIEW — defined in Supabase dashboard, not here)
-- Columns: address, ref_code, ref_link, tree_size, tree_quality, sharing_score


-- =============================================================================
-- CAMPAIGNS
-- =============================================================================

-- campaigns
-- NOTE: Live DB has 3 extra legacy columns not in any migration:
--   protocol text NOT NULL     — original field from Attribution Worker era
--   pool_usd integer NOT NULL  — original pool amount field
--   daily_payout_usd integer   — original daily payout field
-- These are read by the Attribution Worker and should not be dropped.

CREATE TABLE IF NOT EXISTS campaigns (
  id                      text        PRIMARY KEY,
  name                    text        NOT NULL,
  status                  text        DEFAULT 'live',
  creator                 text,

  -- Type + token
  campaign_type           text        DEFAULT 'points'
                            CHECK (campaign_type IN ('token_pool', 'points')),
  token_contract          text,
  token_symbol            text,
  token_decimals          int         NOT NULL DEFAULT 18,

  -- Pool economics (token_pool campaigns)
  token_allocation_usd    numeric,
  pool_remaining_usd      numeric     CHECK (pool_remaining_usd >= 0),
  claim_duration_mins     int         CHECK (claim_duration_mins BETWEEN 1 AND 10080),
  buyer_reward_pct        numeric     DEFAULT 0,
  referral_reward_pct     numeric     DEFAULT 0,
  platform_fee_pct        numeric     DEFAULT 2,
  daily_wallet_cap_usd    numeric     DEFAULT 0,
  daily_pool_cap_usd      numeric     DEFAULT 0,

  -- Points campaign config
  use_score_multiplier    boolean     DEFAULT false,
  min_score               int         DEFAULT 0,
  payout_preset           text        DEFAULT 'top10'
                            CHECK (payout_preset IN ('top3','top5','top10','top20')),
  referral_share_pct      numeric     NOT NULL DEFAULT 0,
  min_daily_volume_usd    numeric     NOT NULL DEFAULT 25,
  max_points_per_wallet_pct numeric   NOT NULL DEFAULT 20,

  -- Chain + contract
  chain                   text,
  contract_address        text,

  -- Actions config
  actions                 jsonb,

  -- Social links (manual override; DexScreener auto-fetched by UI when token_contract set)
  links                   jsonb,

  -- Timestamps
  start_date              timestamptz,
  end_date                timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_status_idx  ON campaigns (status);
CREATE INDEX IF NOT EXISTS campaigns_creator_idx ON campaigns (creator);
CREATE INDEX IF NOT EXISTS campaigns_chain_idx   ON campaigns (chain);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Campaigns are publicly readable"
  ON campaigns FOR SELECT USING (true);


-- =============================================================================
-- PARTICIPANT STATE
-- =============================================================================

-- participants
-- One row per wallet per campaign. Created by POST /api/campaigns/join.
--
-- NOTE: Live DB has additional legacy columns (NOT written by any current code):
--   score_multiplier numeric DEFAULT 1.0   — old pre-computed multiplier, stale for new rows
--   bridge_points integer DEFAULT 0        — old per-type breakdown, use activity table instead
--   trading_points integer DEFAULT 0
--   referral_bridge_points integer DEFAULT 0
--   referral_trade_points integer DEFAULT 0
--   active_trading_days integer DEFAULT 0
--   last_active timestamptz                — replaced by last_active_at
-- These columns are 0/null for all participants joined after 2026-03-18.
-- Do not write to them. Do not drop them yet.
--
-- NOTE: total_points is integer in live DB (migration declared numeric).
-- increment_participant_points() uses numeric arithmetic — implicit cast works
-- since points are always whole numbers.

CREATE TABLE IF NOT EXISTS participants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       text        REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet            text        NOT NULL,

  attribution_score int         NOT NULL DEFAULT 0,
  sharing_score     int         NOT NULL DEFAULT 0,
  observer          boolean     NOT NULL DEFAULT false,

  total_points      int         NOT NULL DEFAULT 0,
  total_earned_usd  numeric     NOT NULL DEFAULT 0,
  daily_volume_usd  numeric     NOT NULL DEFAULT 0,

  referred_by       text        REFERENCES wallet_profiles (address) ON DELETE SET NULL,

  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_active_at    timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS participants_campaign_wallet_uidx
  ON participants (campaign_id, wallet);
CREATE INDEX IF NOT EXISTS participants_wallet_idx   ON participants (wallet);
CREATE INDEX IF NOT EXISTS participants_campaign_idx ON participants (campaign_id);

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants are publicly readable"
  ON participants FOR SELECT USING (true);


-- activity
-- Per-action event log. Dedup by (wallet, tx_hash, action_type).
-- NOTE: Live DB has extra columns not in migration: metadata jsonb, amount_usd numeric
-- NOTE: points_earned is integer in live DB (migration declared numeric) — fine in practice
-- NOTE: campaign_id and tx_hash are nullable in live DB (migration declared NOT NULL)

CREATE TABLE IF NOT EXISTS activity (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   text        REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet        text        NOT NULL,
  action_type   text        NOT NULL
                  CHECK (action_type IN ('bridge', 'trade', 'referral_bridge', 'referral_trade')),
  points_earned int         NOT NULL DEFAULT 0,
  tx_hash       text,
  referred_by   text,
  recorded_at   timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_wallet_tx_action_uidx
  ON activity (wallet, tx_hash, action_type);
CREATE INDEX IF NOT EXISTS activity_tx_hash_wallet_idx
  ON activity (tx_hash, wallet, action_type);
CREATE INDEX IF NOT EXISTS activity_campaign_wallet_action_time_idx
  ON activity (campaign_id, wallet, action_type, recorded_at);
CREATE INDEX IF NOT EXISTS activity_referred_by_idx
  ON activity (referred_by) WHERE referred_by IS NOT NULL;

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Activity is publicly readable"
  ON activity FOR SELECT USING (true);


-- =============================================================================
-- REWARD PIPELINE — TOKEN POOL
-- =============================================================================

CREATE TABLE IF NOT EXISTS pending_rewards (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         text        NOT NULL,
  wallet              text        NOT NULL,
  referrer            text,
  reward_type         text        NOT NULL
                        CHECK (reward_type IN ('buyer', 'referrer', 'platform_fee')),
  token_contract      text        NOT NULL,
  amount_wei          numeric     NOT NULL CHECK (amount_wei >= 0),
  reward_usd          numeric     NOT NULL DEFAULT 0,
  purchase_amount_usd numeric     NOT NULL,
  tx_hash             text        NOT NULL,
  claimable_at        timestamptz NOT NULL,
  claimed_at          timestamptz,
  status              text        NOT NULL DEFAULT 'locked'
                        CHECK (status IN ('locked', 'claimable', 'claimed', 'expired')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_rewards_tx_type_uidx
  ON pending_rewards (tx_hash, reward_type);
CREATE INDEX IF NOT EXISTS pending_rewards_wallet_idx
  ON pending_rewards (wallet, status);
CREATE INDEX IF NOT EXISTS pending_rewards_campaign_idx
  ON pending_rewards (campaign_id, status);

ALTER TABLE pending_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wallets read own pending rewards"
  ON pending_rewards FOR SELECT
  USING (wallet = current_setting('request.jwt.claims', true)::json->>'address');


-- =============================================================================
-- REWARD PIPELINE — EPOCH / MERKLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS epoch_state (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     text        NOT NULL,
  epoch_number    int         NOT NULL CHECK (epoch_number >= 1),
  epoch_start     timestamptz NOT NULL,
  epoch_end       timestamptz NOT NULL,
  epoch_pool_usd  numeric     NOT NULL CHECK (epoch_pool_usd >= 0),
  total_points    numeric     NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'settling', 'complete', 'error')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS epoch_state_campaign_active_uidx
  ON epoch_state (campaign_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS epoch_state_campaign_epoch_uidx
  ON epoch_state (campaign_id, epoch_number);

ALTER TABLE epoch_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Epoch state is publicly readable"
  ON epoch_state FOR SELECT USING (true);


-- distributions
-- oracle_signature: EIP-712 over (campaignId, epochNumber, merkleRoot, deadline)
-- deadline: unix timestamp (bigint) — included in oracle signature, passed to claim()

CREATE TABLE IF NOT EXISTS distributions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       text        NOT NULL,
  epoch_number      int         NOT NULL CHECK (epoch_number >= 1),
  merkle_root       text,
  total_amount_usd  numeric     NOT NULL DEFAULT 0,
  total_amount_wei  numeric,
  participant_count int         NOT NULL DEFAULT 0,
  tree_json         jsonb,
  ipfs_cid          text,
  oracle_signature  text,
  deadline          bigint,     -- unix timestamp passed to claim(); NULL until oracle signs
  onchain_id        numeric,    -- DEPRECATED: old createDistribution() ID, no longer written
  tx_hash           text,
  status            text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'published', 'finalized')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS distributions_campaign_epoch_uidx
  ON distributions (campaign_id, epoch_number);
CREATE INDEX IF NOT EXISTS distributions_status_idx ON distributions (status);

ALTER TABLE distributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Distributions are publicly readable"
  ON distributions FOR SELECT USING (true);


-- daily_payouts
-- Per-wallet Merkle payout per epoch. Merkle proof stored for claim verification.
-- eas_uid: linked after CampaignReward EAS attestation fires (nullable)

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
  eas_uid         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_payouts_campaign_epoch_wallet_uidx
  ON daily_payouts (campaign_id, epoch_number, wallet);
CREATE INDEX IF NOT EXISTS daily_payouts_wallet_unclaimed_idx
  ON daily_payouts (wallet, claimed_at) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS daily_payouts_campaign_epoch_idx
  ON daily_payouts (campaign_id, epoch_number);

ALTER TABLE daily_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily payouts are publicly readable"
  ON daily_payouts FOR SELECT USING (true);


-- =============================================================================
-- EAS ATTESTATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS eas_attestations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet       text        NOT NULL,
  schema_name  text        NOT NULL,  -- 'AttributionScore'|'SwapActivity'|'ReferralLink'|'CampaignReward'
  eas_uid      text        NOT NULL UNIQUE,
  attested_at  timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS eas_attestations_wallet_schema
  ON eas_attestations (wallet, schema_name);
CREATE INDEX IF NOT EXISTS eas_attestations_score_recency
  ON eas_attestations (wallet, attested_at desc) WHERE schema_name = 'AttributionScore';

ALTER TABLE eas_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eas_attestations_select_public"
  ON eas_attestations FOR SELECT USING (true);


-- =============================================================================
-- WAITLIST
-- =============================================================================

CREATE TABLE IF NOT EXISTS waitlist (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email     text        NOT NULL UNIQUE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  source    text        DEFAULT 'landing'
);


-- =============================================================================
-- TEAM WHITELIST
-- =============================================================================

CREATE TABLE IF NOT EXISTS whitelisted_teams (
  wallet          text        PRIMARY KEY,
  protocol_name   text        NOT NULL,
  website         text,
  contact_email   text        NOT NULL,
  approved_at     timestamptz,
  approved_by     text,
  created_at      timestamptz DEFAULT now(),
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected'))
);

ALTER TABLE whitelisted_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet sees own whitelist status"
  ON whitelisted_teams FOR SELECT
  USING (wallet = current_setting('app.current_wallet', true));


CREATE TABLE IF NOT EXISTS team_applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet          text        NOT NULL,
  protocol_name   text        NOT NULL,
  website         text,
  contact_email   text        NOT NULL,
  pool_size_usd   text,
  description     text,
  submitted_at    timestamptz DEFAULT now(),
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'reviewed', 'approved', 'rejected'))
);

ALTER TABLE team_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet sees own application"
  ON team_applications FOR SELECT
  USING (wallet = current_setting('app.current_wallet', true));


-- =============================================================================
-- SWAP EVENTS (AUDIT LOG)
-- =============================================================================

CREATE TABLE IF NOT EXISTS swap_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash     text        NOT NULL UNIQUE,
  wallet      text        NOT NULL,
  chain       text,
  token_in    text,
  token_out   text,
  amount_usd  numeric,
  is_bridge   boolean     NOT NULL DEFAULT false,
  occurred_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE swap_events ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- LEGACY / DEPRECATED TABLES (still in live DB, not written by current code)
-- =============================================================================

-- campaign_payouts: superseded by daily_payouts. Retained for historical data.
-- Do not write new data here.

CREATE TABLE IF NOT EXISTS campaign_payouts (
  id          bigserial   PRIMARY KEY,
  campaign_id text        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet      text        NOT NULL,
  epoch_date  date        NOT NULL,
  rank        int         NOT NULL DEFAULT 0,
  points      int         NOT NULL DEFAULT 0,
  amount_usd  numeric     NOT NULL DEFAULT 0,
  type        text        NOT NULL DEFAULT 'rank' CHECK (type IN ('rank', 'referral')),
  status      text        NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, wallet, epoch_date, type)
);

ALTER TABLE campaign_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payouts_select_public"
  ON campaign_payouts FOR SELECT USING (true);


-- =============================================================================
-- DATABASE FUNCTIONS
-- =============================================================================

-- increment_epoch_points: atomic total_points increment on active epoch
CREATE OR REPLACE FUNCTION increment_epoch_points(p_campaign_id text, p_delta numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE epoch_state
     SET total_points = total_points + p_delta, updated_at = now()
   WHERE campaign_id = p_campaign_id AND status = 'active';
END;
$$;

-- deduct_token_pool_reward: atomic pool_remaining_usd check + decrement
CREATE OR REPLACE FUNCTION deduct_token_pool_reward(p_campaign_id text, p_required_usd numeric)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_remaining numeric;
BEGIN
  SELECT pool_remaining_usd INTO v_remaining
    FROM campaigns WHERE id = p_campaign_id AND campaign_type = 'token_pool' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_remaining < p_required_usd THEN RETURN false; END IF;
  UPDATE campaigns SET pool_remaining_usd = pool_remaining_usd - p_required_usd WHERE id = p_campaign_id;
  RETURN true;
END;
$$;

-- increment_earned_usd: atomic lifetime total_earned_usd increment per participant
CREATE OR REPLACE FUNCTION increment_earned_usd(p_campaign_id text, p_wallet text, p_amount numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE participants SET total_earned_usd = total_earned_usd + p_amount, updated_at = now()
   WHERE campaign_id = p_campaign_id AND wallet = p_wallet;
END;
$$;

-- increment_participant_points: atomic total_points increment per wallet per campaign
CREATE OR REPLACE FUNCTION increment_participant_points(p_campaign_id text, p_wallet text, p_delta numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE participants
     SET total_points = total_points + p_delta, last_active_at = now(), updated_at = now()
   WHERE campaign_id = p_campaign_id AND wallet = p_wallet;
END;
$$;

-- update_epoch_state_updated_at: trigger function for epoch_state.updated_at
CREATE OR REPLACE FUNCTION update_epoch_state_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


-- =============================================================================
-- NOTES
-- =============================================================================
--
-- UNKNOWN OBJECTS (live DB, no migration file, not in app code):
--   auth_nonces table          — unknown origin, do not touch
--   wallet_activity table      — unknown origin, do not touch
--   check_activation_threshold() — unknown origin, do not touch
--   sync_referral_counts()     — probably maintains wallet_profiles.total_referred
--   touch_wallet_last_seen()   — probably updates wallet_profiles.last_seen_at
--
-- CHAIN CONSTRAINT: campaigns.chain has no CHECK constraint.
-- Chain validation is at application layer. Historic data has non-standard names.
--
-- RLS: All tables have RLS enabled. Reads are public (anon key).
-- All writes go through service role (bypasses RLS). No direct client writes.
-- =============================================================================
