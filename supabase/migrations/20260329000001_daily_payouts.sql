-- =============================================================================
-- Migration: 20260329000001_daily_payouts.sql
-- Date: 2026-03-29
--
-- Creates the daily_payouts table — per-wallet epoch payout history.
--
-- Records the final payout each wallet received per epoch after the
-- epoch processor runs the distribution formula:
--   wallet_payout = (epoch_pool / epoch_count)
--                 × (wallet_points / total_points)
--                 × combined_multiplier
--
-- Used by:
--   - Profile page Rewards tab — "Your payout history"
--   - Campaign detail — per-epoch breakdown
--   - Admin dashboard — epoch settlement audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_payouts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     text        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet          text        NOT NULL,
  epoch_number    int         NOT NULL,

  -- Points this wallet accumulated during the epoch
  points_earned   numeric     NOT NULL DEFAULT 0 CHECK (points_earned >= 0),

  -- Multipliers snapshotted at epoch close
  attribution_multiplier  numeric NOT NULL DEFAULT 1.0,
  sharing_multiplier      numeric NOT NULL DEFAULT 1.0,
  combined_multiplier     numeric NOT NULL DEFAULT 1.0,

  -- Payout in token units (raw, before decimals) and USD equivalent
  payout_amount   numeric     NOT NULL DEFAULT 0 CHECK (payout_amount >= 0),
  payout_usd      numeric,    -- NULL if token price unavailable at settlement

  -- Token info snapshot (denormalised for audit readability)
  token_symbol    text,
  token_address   text,

  -- Distribution reference
  distribution_id uuid        REFERENCES distributions (id) ON DELETE SET NULL,

  -- Timestamps
  epoch_start_at  timestamptz,
  epoch_end_at    timestamptz,
  paid_at         timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One payout record per wallet per epoch per campaign
CREATE UNIQUE INDEX IF NOT EXISTS daily_payouts_campaign_wallet_epoch_uidx
  ON daily_payouts (campaign_id, wallet, epoch_number);

-- Wallet-centric lookup (profile Rewards tab)
CREATE INDEX IF NOT EXISTS daily_payouts_wallet_idx
  ON daily_payouts (wallet);

-- Campaign-centric lookup (epoch processor, admin)
CREATE INDEX IF NOT EXISTS daily_payouts_campaign_epoch_idx
  ON daily_payouts (campaign_id, epoch_number);

-- Distribution reference
CREATE INDEX IF NOT EXISTS daily_payouts_distribution_idx
  ON daily_payouts (distribution_id)
  WHERE distribution_id IS NOT NULL;

ALTER TABLE daily_payouts ENABLE ROW LEVEL SECURITY;

-- Public read — profile and campaign detail pages use anon key
DROP POLICY IF EXISTS "Daily payouts are publicly readable" ON daily_payouts;
CREATE POLICY "Daily payouts are publicly readable"
  ON daily_payouts FOR SELECT USING (true);

-- Writes via service role only (epoch processor cron)

-- =============================================================================
-- Summary
--
-- daily_payouts — CREATED
--   One row per (campaign, wallet, epoch) written by the epoch processor
--   after each epoch settles. Stores points, multipliers, token amount,
--   and USD equivalent for the profile Rewards tab and audit trail.
-- =============================================================================
