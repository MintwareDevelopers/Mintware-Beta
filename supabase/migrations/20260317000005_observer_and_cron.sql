-- =============================================================================
-- Migration: 20260317000005_observer_and_cron
--
-- Adds observer mode + daily cron support fields to:
--   participants  — observer flag, daily_volume_usd, joined_at
--   campaigns              — payout_preset, referral_share_pct,
--                            min_daily_volume_usd, max_points_per_wallet_pct
--
-- Also creates:
--   campaign_payouts table  — daily epoch payout records
--   increment_earned_usd()  — RPC helper called by epoch cron
-- =============================================================================

-- ─── participants columns ───────────────────────────────────────────

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS observer           BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_volume_usd   NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS joined_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS referred_by        TEXT        REFERENCES wallet_profiles(address) ON DELETE SET NULL;

-- Index for epoch processor sort (rank by points, tiebreak by joined_at)
CREATE INDEX IF NOT EXISTS idx_participants_joined_at
  ON participants (campaign_id, joined_at ASC);

-- Index to quickly fetch non-observers with daily activity
CREATE INDEX IF NOT EXISTS idx_participants_daily_active
  ON participants (campaign_id, daily_volume_usd)
  WHERE observer = FALSE AND daily_volume_usd > 0;

-- ─── campaigns columns ────────────────────────────────────────────────────────

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS payout_preset             TEXT      DEFAULT 'top10'
    CHECK (payout_preset IN ('top3','top5','top10','top20')),
  ADD COLUMN IF NOT EXISTS referral_share_pct        NUMERIC   NOT NULL DEFAULT 0
    CHECK (referral_share_pct >= 0 AND referral_share_pct <= 100),
  ADD COLUMN IF NOT EXISTS min_daily_volume_usd      NUMERIC   NOT NULL DEFAULT 25
    CHECK (min_daily_volume_usd >= 0),
  ADD COLUMN IF NOT EXISTS max_points_per_wallet_pct NUMERIC   NOT NULL DEFAULT 20
    CHECK (max_points_per_wallet_pct > 0 AND max_points_per_wallet_pct <= 100);

-- ─── campaign_payouts table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaign_payouts (
  id           BIGSERIAL    PRIMARY KEY,
  campaign_id  TEXT         NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  wallet       TEXT         NOT NULL,
  epoch_date   DATE         NOT NULL,
  rank         INT          NOT NULL DEFAULT 0,   -- 0 = referral bonus
  points       INT          NOT NULL DEFAULT 0,
  amount_usd   NUMERIC      NOT NULL DEFAULT 0,
  type         TEXT         NOT NULL DEFAULT 'rank'
    CHECK (type IN ('rank','referral')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One record per wallet per type per day per campaign
  UNIQUE (campaign_id, wallet, epoch_date, type)
);

CREATE INDEX IF NOT EXISTS idx_payouts_campaign_epoch
  ON campaign_payouts (campaign_id, epoch_date DESC);

CREATE INDEX IF NOT EXISTS idx_payouts_wallet
  ON campaign_payouts (wallet, epoch_date DESC);

-- ─── RLS for campaign_payouts ─────────────────────────────────────────────────

ALTER TABLE campaign_payouts ENABLE ROW LEVEL SECURITY;

-- Anyone can read payouts (public leaderboard use)
DROP POLICY IF EXISTS "payouts_select_public" ON campaign_payouts;
CREATE POLICY "payouts_select_public"
  ON campaign_payouts FOR SELECT
  USING (true);

-- Only service role can insert/update (cron writes via service key)
DROP POLICY IF EXISTS "payouts_insert_service" ON campaign_payouts;
CREATE POLICY "payouts_insert_service"
  ON campaign_payouts FOR INSERT
  WITH CHECK (false);   -- anon/authenticated cannot insert directly

DROP POLICY IF EXISTS "payouts_update_service" ON campaign_payouts;
CREATE POLICY "payouts_update_service"
  ON campaign_payouts FOR UPDATE
  USING (false);

-- ─── increment_earned_usd RPC ─────────────────────────────────────────────────
--
-- Called by the epoch cron to atomically add to total_earned_usd.
-- Runs as SECURITY DEFINER so it bypasses RLS (cron uses service key but
-- this lets us avoid raw UPDATE in the API route).

CREATE OR REPLACE FUNCTION increment_earned_usd(
  p_campaign_id TEXT,
  p_wallet      TEXT,
  p_amount      NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE participants
  SET    total_earned_usd = COALESCE(total_earned_usd::NUMERIC, 0) + p_amount
  WHERE  campaign_id = p_campaign_id
    AND  wallet      = p_wallet;
END;
$$;

-- ─── Backfill joined_at for existing rows ─────────────────────────────────────
--
-- Existing rows have joined_at = DEFAULT (now), which is fine as a tiebreaker
-- baseline. No further backfill needed.
