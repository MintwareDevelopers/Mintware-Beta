-- Migration: epoch_state, distributions, campaign_payouts.status
--
-- epoch_state:       idempotency guard for the daily epoch cron.
--                    (campaign_id, epoch_date) is the unique key — cron checks
--                    this before processing and inserts after, preventing
--                    double-credit if the cron fires more than once per day.
--
-- distributions:     Merkle drop settlement records. One row per campaign per
--                    epoch once rewards are ready for on-chain publication.
--                    merkle_root is NULL until the root is published.
--
-- campaign_payouts:  Add status column (pending → distributed → claimed)
--                    to track reward lifecycle without a separate table.

-- ── epoch_state ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS epoch_state (
  campaign_id       TEXT        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  epoch_date        DATE        NOT NULL,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  participant_count INTEGER     NOT NULL DEFAULT 0,
  total_points      INTEGER     NOT NULL DEFAULT 0,
  total_payout_usd  NUMERIC     NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, epoch_date)
);

CREATE INDEX IF NOT EXISTS idx_epoch_state_campaign
  ON epoch_state (campaign_id, epoch_date DESC);

-- ── distributions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS distributions (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id      TEXT        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  epoch_date       DATE        NOT NULL,
  merkle_root      TEXT,                    -- NULL until published on-chain
  total_usd        NUMERIC     NOT NULL DEFAULT 0,
  recipient_count  INTEGER     NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL DEFAULT 'pending',
                               -- pending | published | complete
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, epoch_date)
);

CREATE INDEX IF NOT EXISTS idx_distributions_campaign
  ON distributions (campaign_id, epoch_date DESC);

ALTER TABLE distributions ENABLE ROW LEVEL SECURITY;

-- Public read (leaderboard / claim UI needs to read merkle roots)
DROP POLICY IF EXISTS "distributions_select_public" ON distributions;
CREATE POLICY "distributions_select_public"
  ON distributions FOR SELECT
  USING (true);

-- ── campaign_payouts: add status ──────────────────────────────────────────────

ALTER TABLE campaign_payouts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
  -- pending | distributed | claimed

CREATE INDEX IF NOT EXISTS idx_payouts_status
  ON campaign_payouts (campaign_id, status)
  WHERE status = 'pending';
