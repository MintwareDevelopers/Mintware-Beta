-- =============================================================================
-- Migration: Campaign Columns — Ticket 6
-- Branch: feature/campaign-engine
-- Date: 2026-03-17
--
-- Adds:
--   campaigns.buyer_reward_pct     — % of swap value paid to buyer (max 1%)
--   campaigns.referral_reward_pct  — % of swap value paid to referrer (max 5%)
--   campaigns.platform_fee_pct     — Mintware platform fee (default 2%)
--   campaigns.daily_wallet_cap_usd — max USD reward per wallet per day
--   campaigns.daily_pool_cap_usd   — max USD drained from pool per day
--   campaigns.use_score_multiplier — whether MW Score gates reward multipliers
--   campaigns.contract_address     — deployed MintwareDistributor address for this campaign
--   campaigns.chain                — chain slug: 'base', 'base_sepolia', 'core_dao', 'bnb'
--
-- Note: buyer_reward_pct / referral_reward_pct / platform_fee_pct already
--       exist in the TypeScript Campaign type (lib/campaigns/types.ts) but may
--       not yet be present in Supabase. IF NOT EXISTS is safe — no-op if already there.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- campaigns: reward percentage columns
-- ---------------------------------------------------------------------------

-- Buyer reward — % of swap amount paid back to buyer
-- Stored as a fraction (0.01 = 1%). Max 1% enforced by check.
alter table campaigns
  add column if not exists buyer_reward_pct numeric default 0
    check (buyer_reward_pct >= 0 and buyer_reward_pct <= 1);

-- Referrer reward — % of swap amount paid to the referrer
-- Stored as a fraction (0.05 = 5%). Max 5% enforced by check.
alter table campaigns
  add column if not exists referral_reward_pct numeric default 0
    check (referral_reward_pct >= 0 and referral_reward_pct <= 5);

-- Mintware platform fee — taken from pool before distributing rewards
-- Stored as a fraction (0.02 = 2%). Default 2%.
alter table campaigns
  add column if not exists platform_fee_pct numeric default 2
    check (platform_fee_pct >= 0 and platform_fee_pct <= 100);

-- ---------------------------------------------------------------------------
-- campaigns: daily cap columns
-- ---------------------------------------------------------------------------

-- Maximum USD reward this wallet can earn from this campaign in any 24h window.
-- 0 = no cap (unlimited per wallet).
alter table campaigns
  add column if not exists daily_wallet_cap_usd numeric default 0
    check (daily_wallet_cap_usd >= 0);

-- Maximum USD drained from the campaign pool in any 24h window.
-- 0 = no cap (unlimited pool drain per day).
alter table campaigns
  add column if not exists daily_pool_cap_usd numeric default 0
    check (daily_pool_cap_usd >= 0);

-- ---------------------------------------------------------------------------
-- campaigns: MW Score multiplier flag
-- ---------------------------------------------------------------------------

-- When true, Attribution score and Sharing score produce reward multipliers
-- (1x–1.95x combined) that scale epoch payout for Points Campaigns.
-- Has no effect on Token Pool Campaigns (those use fixed percentages above).
alter table campaigns
  add column if not exists use_score_multiplier boolean default false;

-- ---------------------------------------------------------------------------
-- campaigns: on-chain settlement columns (Ticket 5 / Ticket 6)
-- ---------------------------------------------------------------------------

-- Deployed MintwareDistributor contract address for this campaign.
-- Set by operator after running scripts/deploy.ts against the target chain.
-- Used by the claim API (Ticket 6) to return the correct contract address.
alter table campaigns
  add column if not exists contract_address text;

-- Chain slug identifying where the distributor is deployed.
-- Values: 'base' | 'base_sepolia' | 'core_dao' | 'bnb'
-- Used by ClaimCard.tsx to determine which network to switch to before claiming.
alter table campaigns
  add column if not exists chain text;

-- Validate chain values — only known chains permitted
alter table campaigns
  drop constraint if exists campaigns_chain_check;

alter table campaigns
  add constraint campaigns_chain_check
    check (chain is null or chain in ('base', 'base_sepolia', 'core_dao', 'bnb', 'hardhat'));

-- ---------------------------------------------------------------------------
-- distributions: on-chain distribution ID
--
-- The MintwareDistributor contract auto-increments a uint256 distributionId
-- when createDistribution() is called. This is NOT the same as the Supabase
-- UUID (distributions.id). Wallets must pass this integer to claim().
--
-- Set by the operator or settlement script after calling createDistribution()
-- and recording the return value. Null until the distribution is published.
-- ---------------------------------------------------------------------------
alter table distributions
  add column if not exists onchain_id numeric; -- uint256 from createDistribution()

create unique index if not exists distributions_onchain_id_uidx
  on distributions (onchain_id)
  where onchain_id is not null;

-- =============================================================================
-- Summary
--
-- campaigns.buyer_reward_pct     — fraction, 0–1, default 0
-- campaigns.referral_reward_pct  — fraction, 0–5, default 0
-- campaigns.platform_fee_pct     — fraction, 0–100, default 2
-- campaigns.daily_wallet_cap_usd — USD cap per wallet per day, 0 = unlimited
-- campaigns.daily_pool_cap_usd   — USD pool drain cap per day, 0 = unlimited
-- campaigns.use_score_multiplier — enables MW Score multiplier gating
-- campaigns.contract_address     — MintwareDistributor deployment address
-- campaigns.chain                — target chain slug for claim UI
-- =============================================================================
