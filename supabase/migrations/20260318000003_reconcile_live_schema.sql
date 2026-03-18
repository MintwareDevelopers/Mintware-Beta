-- =============================================================================
-- Migration: 20260318000003_reconcile_live_schema.sql
-- Date: 2026-03-18
--
-- Context
-- -------
-- Two parallel branches developed incompatible schemas:
--
--   feature/campaign-engine (main)
--     epoch_state:    id UUID PK, epoch_number INT, epoch_start/end, status
--                     state machine (active → settling → complete → error)
--     distributions:  epoch_number INT, total_amount_usd, ipfs_cid, tx_hash,
--                     tree_json (Merkle dump), total_amount_wei, onchain_id
--
--   claude/hungry-moore (worktree) — already pushed to live DB
--     epoch_state:    (campaign_id, epoch_date) PK — simple idempotency log
--     distributions:  epoch_date DATE, total_usd, recipient_count
--
-- The main branch cron (epoch-end), merkleBuilder, epochProcessor, and
-- onchainPublisher all require the full schema from feature/campaign-engine.
-- Only test data exists in the live tables — safe to drop and recreate.
--
-- What this migration does
-- ------------------------
--   1. DROP + RECREATE epoch_state      (test data only — safe to drop)
--   2. DROP + RECREATE distributions    (test data only — safe to drop)
--   3. CREATE pending_rewards           (new — not in live DB)
--   4. CREATE daily_payouts             (new — not in live DB)
--   5. ALTER campaigns                  (add ~10 missing columns)
--   6. ALTER participants               (add sharing_score, total_earned_usd, etc.)
--   7. CREATE OR REPLACE functions      (increment_epoch_points,
--                                        deduct_token_pool_reward,
--                                        increment_earned_usd)
--
-- IMPORTANT: After this migration, DO NOT push migrations 000001–000004.
-- They are fully superseded by this file. See the DO NOT PUSH headers in each.
-- =============================================================================


-- ── 1. epoch_state ────────────────────────────────────────────────────────────
--
-- Worktree schema: (campaign_id, epoch_date) composite PK, no status column.
-- Required schema: id UUID PK, epoch_number INT, status state machine,
--                  epoch_start/end, epoch_pool_usd, updated_at.
--
-- The cron claims epochs by CAS-updating status: active → settling.
-- This prevents double-processing when the cron fires more than once per hour.

DROP TABLE IF EXISTS epoch_state CASCADE;

CREATE TABLE epoch_state (
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

-- Only one active epoch per campaign at a time
CREATE UNIQUE INDEX epoch_state_campaign_active_uidx
  ON epoch_state (campaign_id)
  WHERE status = 'active';

-- History: look up any epoch by campaign + number
CREATE UNIQUE INDEX epoch_state_campaign_epoch_uidx
  ON epoch_state (campaign_id, epoch_number);

-- Auto-maintain updated_at
CREATE OR REPLACE FUNCTION update_epoch_state_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER epoch_state_updated_at_trigger
  BEFORE UPDATE ON epoch_state
  FOR EACH ROW EXECUTE FUNCTION update_epoch_state_updated_at();

ALTER TABLE epoch_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Epoch state is publicly readable" ON epoch_state;
CREATE POLICY "Epoch state is publicly readable"
  ON epoch_state FOR SELECT USING (true);


-- ── 2. distributions ──────────────────────────────────────────────────────────
--
-- Worktree schema: epoch_date DATE, total_usd, recipient_count,
--                  status IN ('pending','published','complete').
-- Required schema: epoch_number INT, total_amount_usd, ipfs_cid, tx_hash,
--                  tree_json (StandardMerkleTree.dump()), total_amount_wei,
--                  onchain_id (uint256 from createDistribution()),
--                  status IN ('pending','published','finalized').
--
-- merkleBuilder writes this row. onchainPublisher sets onchain_id + tx_hash.
-- Wallets read onchain_id via /api/claim to construct their claim call.

DROP TABLE IF EXISTS distributions CASCADE;

CREATE TABLE distributions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       text        NOT NULL,
  epoch_number      int         NOT NULL CHECK (epoch_number >= 1),
  merkle_root       text,                              -- NULL until published on-chain
  total_amount_usd  numeric     NOT NULL DEFAULT 0
                      CHECK (total_amount_usd >= 0),
  participant_count int         NOT NULL DEFAULT 0,
  ipfs_cid          text,                              -- IPFS CID of full tree data
  tx_hash           text,                              -- on-chain publish tx hash
  tree_json         jsonb,                             -- StandardMerkleTree.dump() output
  total_amount_wei  numeric     CHECK (total_amount_wei >= 0),
  onchain_id        numeric,                           -- uint256 from createDistribution()
  status            text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'published', 'finalized')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz
);

-- One distribution per campaign per epoch
CREATE UNIQUE INDEX distributions_campaign_epoch_uidx
  ON distributions (campaign_id, epoch_number);

-- Claim UI looks up by onchain_id
CREATE UNIQUE INDEX distributions_onchain_id_uidx
  ON distributions (onchain_id)
  WHERE onchain_id IS NOT NULL;

CREATE INDEX distributions_status_idx ON distributions (status);

ALTER TABLE distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Distributions are publicly readable" ON distributions;
CREATE POLICY "Distributions are publicly readable"
  ON distributions FOR SELECT USING (true);


-- ── 3. pending_rewards ────────────────────────────────────────────────────────
--
-- Token Reward Pool campaign type. One row per tx per reward type.
-- status flow: locked → claimable → claimed (or → expired if unclaimed too long)

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


-- ── 4. daily_payouts ──────────────────────────────────────────────────────────
--
-- Live DB has a pre-existing daily_payouts with: date, points_that_day,
-- total_points_all_wallets, payout_usd, payout_token_amount, paid_at.
-- Required schema: epoch_number INT, multiplier, amount_wei, token_price_usd,
--                  merkle_proof jsonb, claimed_at (for claim contract).
-- Only historical test data — safe to drop and recreate.

DROP TABLE IF EXISTS daily_payouts CASCADE;

CREATE TABLE daily_payouts (
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

CREATE UNIQUE INDEX daily_payouts_campaign_epoch_wallet_uidx
  ON daily_payouts (campaign_id, epoch_number, wallet);

CREATE INDEX daily_payouts_wallet_unclaimed_idx
  ON daily_payouts (wallet, claimed_at)
  WHERE claimed_at IS NULL;

CREATE INDEX daily_payouts_campaign_epoch_idx
  ON daily_payouts (campaign_id, epoch_number);

ALTER TABLE daily_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Daily payouts are publicly readable" ON daily_payouts;
CREATE POLICY "Daily payouts are publicly readable"
  ON daily_payouts FOR SELECT USING (true);


-- ── 5. campaigns — add missing columns ───────────────────────────────────────
--
-- The live campaigns table was created before the feature branch and is missing
-- columns defined in migrations 000002, 000003, 000004. All use IF NOT EXISTS.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS campaign_type        text        DEFAULT 'points'
    CHECK (campaign_type IN ('token_pool', 'points')),
  ADD COLUMN IF NOT EXISTS token_contract       text,
  ADD COLUMN IF NOT EXISTS token_allocation_usd numeric,
  ADD COLUMN IF NOT EXISTS claim_duration_mins  int
    CHECK (claim_duration_mins BETWEEN 1 AND 10080),
  ADD COLUMN IF NOT EXISTS pool_remaining_usd   numeric
    CHECK (pool_remaining_usd >= 0),
  ADD COLUMN IF NOT EXISTS token_decimals       int         NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS buyer_reward_pct     numeric     DEFAULT 0
    CHECK (buyer_reward_pct >= 0 AND buyer_reward_pct <= 1),
  ADD COLUMN IF NOT EXISTS referral_reward_pct  numeric     DEFAULT 0
    CHECK (referral_reward_pct >= 0 AND referral_reward_pct <= 5),
  ADD COLUMN IF NOT EXISTS platform_fee_pct     numeric     DEFAULT 2
    CHECK (platform_fee_pct >= 0 AND platform_fee_pct <= 100),
  ADD COLUMN IF NOT EXISTS daily_wallet_cap_usd numeric     DEFAULT 0
    CHECK (daily_wallet_cap_usd >= 0),
  ADD COLUMN IF NOT EXISTS daily_pool_cap_usd   numeric     DEFAULT 0
    CHECK (daily_pool_cap_usd >= 0),
  ADD COLUMN IF NOT EXISTS use_score_multiplier boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_address     text,
  ADD COLUMN IF NOT EXISTS chain                text,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

-- Note: chain check constraint intentionally omitted.
-- Live DB has rows with chain values outside the standard set (e.g. 'Bitcoin L1').
-- Chain validation is enforced at the application layer (config/chains.ts).


-- ── 6. participants — add missing columns ─────────────────────────────────────
--
-- sharing_score: fallback used by epochProcessor when Attribution API is down
-- total_earned_usd: lifetime tally across all epochs, incremented per payout
-- last_active_at: updated when participant earns points (optional, for UI)
-- updated_at: auto-maintained timestamp

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS sharing_score    int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earned_usd numeric     NOT NULL DEFAULT 0
    CHECK (total_earned_usd >= 0),
  ADD COLUMN IF NOT EXISTS last_active_at   timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();


-- ── 7. Functions ──────────────────────────────────────────────────────────────

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
-- Summary
--
-- epoch_state      — RECREATED: id/epoch_number/status state machine
-- distributions    — RECREATED: epoch_number, tree_json, onchain_id, finalized status
-- pending_rewards  — CREATED: token_pool per-tx reward locks
-- daily_payouts    — CREATED: per-wallet Merkle proofs per epoch
-- campaigns        — 14 columns added (campaign_type, reward pcts, caps, chain, etc.)
-- participants     — 4 columns added (sharing_score, total_earned_usd, last_active_at, updated_at)
-- Functions        — increment_epoch_points, deduct_token_pool_reward, increment_earned_usd
--
-- Migrations 000001–000004: DO NOT PUSH. Superseded by this file.
-- =============================================================================
