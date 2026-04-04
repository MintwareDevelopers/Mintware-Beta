-- =============================================================================
-- Migration: 20260319000001_participants_and_activity.sql
-- Date: 2026-03-19
--
-- Creates two tables that were listed as "NOT yet added (future tickets)"
-- in the CLAUDE.md but are required by swapHook.ts and the join flow.
--
-- participants  — one row per (campaign, wallet) pair that has joined
--                Required by swapHook step 4: participant lookup
--                Updated by processPoints (total_points, last_active_at)
--                and increment_earned_usd (total_earned_usd)
--
-- activity      — per-action event log for both campaign types
--                Used by swapHook idempotency check (step 1),
--                daily dedup (step 5), and referral_trade credit
--
-- NOTE: migration 20260318000003_reconcile_live_schema.sql contains
-- `ALTER TABLE participants ADD COLUMN IF NOT EXISTS ...` which requires
-- this table to already exist. Run this migration BEFORE 000003 if starting
-- from scratch, or run it now if 000003 was already applied (the IF NOT EXISTS
-- on all ALTER TABLE statements in 000003 means it's safe to re-apply).
-- =============================================================================


-- ── participants ──────────────────────────────────────────────────────────────
--
-- One row per wallet per campaign.
-- Created by the /join endpoint (Worker or local API).
-- attribution_score and sharing_score are snapshotted at join time
-- and refreshed periodically by the epoch processor.

CREATE TABLE IF NOT EXISTS participants (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       text        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet            text        NOT NULL,

  -- Snapshotted at join time; refreshed by epoch processor
  attribution_score int         NOT NULL DEFAULT 0,
  sharing_score     int         NOT NULL DEFAULT 0,

  -- Running tallies
  total_points      numeric     NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  total_earned_usd  numeric     NOT NULL DEFAULT 0 CHECK (total_earned_usd >= 0),

  -- Timestamps
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_active_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One participant per wallet per campaign
CREATE UNIQUE INDEX IF NOT EXISTS participants_campaign_wallet_uidx
  ON participants (campaign_id, wallet);

-- Wallet-centric lookup (leaderboard, profile page)
CREATE INDEX IF NOT EXISTS participants_wallet_idx
  ON participants (wallet);

-- Campaign-centric lookup (epoch processor, leaderboard)
CREATE INDEX IF NOT EXISTS participants_campaign_idx
  ON participants (campaign_id);

-- Auto-maintain updated_at on every write
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

-- Public read — leaderboard and campaign detail pages use anon key
DROP POLICY IF EXISTS "Participants are publicly readable" ON participants;
CREATE POLICY "Participants are publicly readable"
  ON participants FOR SELECT USING (true);

-- Writes go through service role (Worker API / swap-event route)
-- No INSERT/UPDATE policy needed for anon — service role bypasses RLS


-- ── activity ──────────────────────────────────────────────────────────────────
--
-- One row per credited action.
-- Dedup key: (wallet, tx_hash, action_type) — prevents double-credit on retries.
-- Used by swapHook idempotency check (step 1) and daily dedup (step 5).
-- points_earned is 0 for token_pool campaigns (rewards tracked in pending_rewards).

CREATE TABLE IF NOT EXISTS activity (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   text        NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  wallet        text        NOT NULL,
  action_type   text        NOT NULL
                  CHECK (action_type IN ('bridge', 'trade', 'referral_bridge', 'referral_trade')),
  points_earned numeric     NOT NULL DEFAULT 0,
  tx_hash       text        NOT NULL,
  referred_by   text,         -- referrer wallet address, NULL if no referrer
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Primary dedup: one credit per (wallet, tx_hash, action_type)
CREATE UNIQUE INDEX IF NOT EXISTS activity_wallet_tx_action_uidx
  ON activity (wallet, tx_hash, action_type);

-- Idempotency query (step 1): tx_hash + wallet + action_type
CREATE INDEX IF NOT EXISTS activity_tx_hash_wallet_idx
  ON activity (tx_hash, wallet, action_type);

-- Daily dedup query (step 5): campaign + wallet + action + time range
CREATE INDEX IF NOT EXISTS activity_campaign_wallet_action_time_idx
  ON activity (campaign_id, wallet, action_type, recorded_at);

-- Referral lookups
CREATE INDEX IF NOT EXISTS activity_referred_by_idx
  ON activity (referred_by)
  WHERE referred_by IS NOT NULL;

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Public read — leaderboard and stats panels use anon key
DROP POLICY IF EXISTS "Activity is publicly readable" ON activity;
CREATE POLICY "Activity is publicly readable"
  ON activity FOR SELECT USING (true);

-- Writes via service role only (swap-event route, cron)


-- =============================================================================
-- Summary
--
-- participants  — CREATED: join records with score snapshots and point tallies
-- activity      — CREATED: per-action event log, dedup by (wallet, tx_hash, action)
--
-- After applying this migration the following flow works end-to-end:
--   1. Wallet clicks "Join Campaign" → Worker inserts participants row
--   2. Wallet swaps on Base via LI.FI → swap-event webhook fires
--   3. processSwapEvent step 4 finds participant → proceeds to credit
--   4. For token_pool: writes pending_rewards + activity row
--   5. For points: updates participants.total_points + writes activity row
-- =============================================================================
