-- =============================================================================
-- Migration: Add closed / closed_at columns to campaigns (M4 audit finding)
--
-- The MintwareDistributor v2 contract has a closeCampaign() function that sets
-- campaigns[id].closed = true on-chain. The off-chain DB needs a matching flag
-- so swapHook.ts can block new reward credits immediately when an event listener
-- syncs the closure — without waiting for campaign.status to be updated.
--
-- This gives a belt-and-suspenders check: both status = 'ended' AND closed = true
-- must be kept in sync by the event listener, but either alone is sufficient to
-- block new credits in swapHook.ts.
-- =============================================================================

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS closed    BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Index for quick lookup of all closed campaigns (e.g. for withdrawal eligibility checks)
CREATE INDEX IF NOT EXISTS campaigns_closed_idx ON campaigns (closed) WHERE closed = true;

COMMENT ON COLUMN campaigns.closed    IS 'Set true when operator calls closeCampaign() on MintwareDistributor. Blocks new reward credits.';
COMMENT ON COLUMN campaigns.closed_at IS 'Timestamp when the campaign was closed. Starts the 7-day withdrawal cooldown.';
