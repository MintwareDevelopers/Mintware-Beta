-- =============================================================================
-- Migration: 20260329000003_sol_distributions
-- Phase 7 — Solana distributor: sol_distributions table
--
-- Tracks published epochs for Solana campaigns.
-- Mirrors the structure of `distributions` but for the Solana program.
-- =============================================================================

create table if not exists sol_distributions (
  id              bigint generated always as identity primary key,
  campaign_id     text        not null,
  epoch_number    integer     not null,
  merkle_root     text        not null,  -- hex-encoded 32-byte root
  tree_json       jsonb       not null,  -- { root, leaves: [{wallet, amount, proof}] }
  ipfs_cid        text,                  -- optional IPFS pin of tree_json
  oracle_sig      text        not null,  -- hex-encoded 64-byte Ed25519 signature (truncated in logs)
  deadline        bigint      not null,  -- unix timestamp i64 — must be set (no fallback)
  status          text        not null default 'pending'
                              check (status in ('pending', 'published', 'finalized')),
  tx_signature    text,                  -- Solana tx signature confirming on-chain settlement
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, epoch_number)
);

-- Auto-update updated_at
create or replace function update_sol_distributions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sol_distributions_updated_at
  before update on sol_distributions
  for each row execute function update_sol_distributions_updated_at();

-- Index for fast lookup by campaign
create index if not exists sol_distributions_campaign_epoch
  on sol_distributions (campaign_id, epoch_number);

comment on table sol_distributions is
  'Phase 7: Published Merkle epochs for Solana reward distribution via Anchor program';
