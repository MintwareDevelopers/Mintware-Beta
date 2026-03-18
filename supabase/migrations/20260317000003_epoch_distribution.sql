-- =============================================================================
-- Migration: Epoch Distribution — Ticket 4
-- Branch: feature/campaign-engine
-- Date: 2026-03-17
--
-- Adds:
--   campaigns.token_decimals         — needed for USD → wei conversion
--   distributions.tree_json          — full StandardMerkleTree dump
--   distributions.total_amount_wei   — total payout in token base units
--   daily_payouts table              — per-wallet epoch payout records + Merkle proofs
--   epoch_state 'error' status       — allows cron to mark failed epochs for retry
-- =============================================================================

-- ---------------------------------------------------------------------------
-- campaigns: add token_decimals
-- Default 18 covers ERC-20 standard. Override for USDC (6), etc.
-- ---------------------------------------------------------------------------
alter table campaigns
  add column if not exists token_decimals int not null default 18;

-- ---------------------------------------------------------------------------
-- distributions: add Merkle tree storage columns
--
-- tree_json: StandardMerkleTree.dump() output. Allows reconstructing the tree
-- without rebuilding it (needed for proof queries and verification).
-- Stored in Supabase for now. Move to IPFS + set ipfs_cid in Ticket 5.
--
-- total_amount_wei: sum of all wallet payouts in token base units.
-- May exceed epoch_pool_usd equivalent due to score multipliers (by design).
-- ---------------------------------------------------------------------------
alter table distributions
  add column if not exists tree_json         jsonb,
  add column if not exists total_amount_wei  numeric check (total_amount_wei >= 0);

-- ---------------------------------------------------------------------------
-- epoch_state: add 'error' status
-- Allows cron to mark a failed epoch so operators can inspect and retry.
-- The epoch-end cron reverts 'settling' → 'active' on transient errors,
-- but persistent failures (e.g. price feed down) can be manually set to 'error'.
-- ---------------------------------------------------------------------------
alter table epoch_state
  drop constraint if exists epoch_state_status_check;

alter table epoch_state
  add constraint epoch_state_status_check
    check (status in ('active', 'settling', 'complete', 'error'));

-- ---------------------------------------------------------------------------
-- daily_payouts
--
-- One row per (campaign_id, epoch_number, wallet).
-- Written at epoch end after Merkle tree is built.
-- merkle_proof is the inclusion proof for this wallet's leaf.
-- claimed_at is set on-chain in Ticket 5 (contract claim flow).
--
-- Naming: "daily_payouts" follows the convention in the campaign logic doc.
-- In practice, epochs may be longer than a day — the table covers any epoch length.
-- ---------------------------------------------------------------------------
create table if not exists daily_payouts (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     text        not null references campaigns (id) on delete cascade,
  epoch_number    int         not null check (epoch_number >= 1),
  wallet          text        not null,
  points          numeric     not null check (points >= 0),   -- points earned this epoch
  multiplier      numeric     not null check (multiplier >= 1),  -- combined_multiplier applied
  payout_usd      numeric     not null check (payout_usd >= 0),  -- USD value at distribution time
  amount_wei      numeric     not null check (amount_wei >= 0),  -- token base units
  token_price_usd numeric     not null check (token_price_usd > 0),  -- price used for conversion
  merkle_proof    jsonb       not null default '[]'::jsonb,  -- string[] inclusion proof
  claimed_at      timestamptz,                               -- null = unclaimed (set in Ticket 5)
  created_at      timestamptz not null default now()
);

-- One payout record per wallet per epoch per campaign
create unique index if not exists daily_payouts_campaign_epoch_wallet_uidx
  on daily_payouts (campaign_id, epoch_number, wallet);

-- Fast lookup for a wallet's unclaimed payouts (claim UI, Ticket 5)
create index if not exists daily_payouts_wallet_unclaimed_idx
  on daily_payouts (wallet, claimed_at)
  where claimed_at is null;

create index if not exists daily_payouts_campaign_epoch_idx
  on daily_payouts (campaign_id, epoch_number);

alter table daily_payouts enable row level security;

create policy "Daily payouts are publicly readable"
  on daily_payouts for select using (true);

-- =============================================================================
-- Summary
--
-- campaigns.token_decimals      — ERC-20 decimals for wei conversion (default 18)
-- distributions.tree_json       — full Merkle tree dump (StandardMerkleTree.dump())
-- distributions.total_amount_wei — total distributed in token base units
-- epoch_state: 'error' status   — added for persistent failure marking
-- daily_payouts                 — per-wallet epoch payouts + Merkle proofs for claiming
-- =============================================================================
