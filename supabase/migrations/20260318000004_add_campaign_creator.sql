-- =============================================================================
-- Migration: Add creator column to campaigns
-- Adds a wallet address field to track which wallet created each campaign.
-- Used by /api/campaigns/mine and the campaign manage page.
-- =============================================================================

alter table campaigns
  add column if not exists creator text;

-- Index for fast lookup of campaigns by creator wallet
create index if not exists campaigns_creator_idx
  on campaigns (creator)
  where creator is not null;

comment on column campaigns.creator is
  'Wallet address (lowercase) of the account that created this campaign. '
  'Used to gate the manage page — only the creator can pause/resume/end.';
