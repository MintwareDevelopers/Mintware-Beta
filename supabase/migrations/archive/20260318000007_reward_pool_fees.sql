-- =============================================================================
-- Migration: 20260318000007_reward_pool_fees
--
-- Adds reward pool campaign fee configuration and referral fee tracking.
--
-- Fee model:
--   Points campaigns:      no fee logic, period.
--   Reward pool campaigns: fees come OUT of the pool (never additive).
--     mintware_fee_pct  — Mintware's cut of referred swap volume (e.g. 2.0)
--     referrer_fee_pct  — referrer's reward on volume they drive  (e.g. 3.0)
--     buyer_rebate_pct  — rebate paid to the referred buyer       (e.g. 0.5)
--
-- All three are percentages of the referred swap amount_usd.
-- They are credited off-chain in the swap-event webhook and flow through
-- as normal Merkle leaves at epoch settlement.
-- The Mintware treasury wallet auto-claims its share at settlement.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- campaigns: campaign_type + fee configuration columns
-- ---------------------------------------------------------------------------

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS campaign_type      TEXT    NOT NULL DEFAULT 'points'
                                              CHECK (campaign_type IN ('points','reward_pool')),
  ADD COLUMN IF NOT EXISTS mintware_fee_pct   NUMERIC(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer_fee_pct   NUMERIC(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_rebate_pct   NUMERIC(6,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN campaigns.campaign_type IS
  'points = standard LP points campaign (no fee logic). '
  'reward_pool = referral-driven campaign; fee percentages apply to referred volume.';

COMMENT ON COLUMN campaigns.mintware_fee_pct IS
  'Percentage of referred swap USD that goes to Mintware treasury. '
  'Only applies when campaign_type = reward_pool. Example: 2.0 = 2%.';

COMMENT ON COLUMN campaigns.referrer_fee_pct IS
  'Percentage of referred swap USD paid to the referrer wallet. '
  'Only applies when campaign_type = reward_pool. Example: 3.0 = 3%.';

COMMENT ON COLUMN campaigns.buyer_rebate_pct IS
  'Percentage of referred swap USD rebated to the buyer wallet. '
  'Only applies when campaign_type = reward_pool. Example: 0.5 = 0.5%.';

-- ---------------------------------------------------------------------------
-- swap_events: track fee credits per event for audit trail
-- ---------------------------------------------------------------------------

ALTER TABLE swap_events
  ADD COLUMN IF NOT EXISTS mintware_fee_usd  NUMERIC(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer_fee_usd  NUMERIC(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_rebate_usd  NUMERIC(18,8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN swap_events.mintware_fee_usd IS
  'USD value of Mintware fee credited from this swap (reward_pool campaigns only).';

COMMENT ON COLUMN swap_events.referrer_fee_usd IS
  'USD value of referrer reward credited from this swap.';

COMMENT ON COLUMN swap_events.buyer_rebate_usd IS
  'USD value of buyer rebate credited from this swap.';

-- ---------------------------------------------------------------------------
-- participants: fee accumulator columns
-- These are reset to 0 at each epoch settlement (same as trading_points).
-- ---------------------------------------------------------------------------

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS mintware_fee_usd_pending  NUMERIC(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer_fee_usd_pending  NUMERIC(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_rebate_usd_pending  NUMERIC(18,8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN participants.mintware_fee_usd_pending IS
  'Accumulated Mintware fee USD for this epoch (reward_pool only). '
  'Reset to 0 after each epoch settlement. '
  'The treasury wallet address is the participant.wallet for Mintware fee rows.';

COMMENT ON COLUMN participants.referrer_fee_usd_pending IS
  'Accumulated referrer reward USD for this epoch.';

COMMENT ON COLUMN participants.buyer_rebate_usd_pending IS
  'Accumulated buyer rebate USD for this epoch.';

-- ---------------------------------------------------------------------------
-- Index: find reward_pool campaigns quickly
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_campaigns_type
  ON campaigns (campaign_type)
  WHERE campaign_type = 'reward_pool';
