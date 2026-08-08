-- =============================================================================
-- Weighted vault epoch schema — backs the reputation+referral weighted reward path
-- (MintwareWeightedDistributor + vault-weighted-epoch-close cron + weighted-claim route).
-- Idempotent: safe to re-run.
-- =============================================================================

-- Wiring columns on the vault record (nullable → un-wired vaults keep the legacy accrual).
alter table if exists social_vaults
  add column if not exists weighted_distributor_address   text,
  add column if not exists weighted_distributor_vault_id  text,       -- bytes32 hex
  add column if not exists token0_decimals                smallint default 18,
  add column if not exists token1_decimals                smallint default 18,
  add column if not exists current_epoch                  integer  default 1,
  add column if not exists epoch_ends_at                  timestamptz,
  add column if not exists fees0                          numeric  default 0,  -- token0 fee pot (nominal)
  add column if not exists fees1                          numeric  default 0;  -- token1 fee pot (nominal)

-- Off-chain mirror of pair-vault LP positions the cron weights each epoch. Populated by
-- an indexer of the vault's Deposited/Redeemed events (liquidity_units == vault shares).
create table if not exists vault_lp_positions (
  id             uuid primary key default gen_random_uuid(),
  vault_id       text not null,
  wallet         text not null,
  liquidity_units numeric not null default 0,
  lock_tier      text not null default 'flex',   -- flex | committed | aligned | core
  deposited_at   timestamptz not null default now(),
  status         text not null default 'active', -- active | exited
  updated_at     timestamptz not null default now(),
  unique (vault_id, wallet)
);
create index if not exists idx_vault_lp_positions_active
  on vault_lp_positions (vault_id) where status = 'active';

-- Persisted signed epoch: the Merkle tree + per-wallet claim index the claim route serves.
create table if not exists vault_weighted_epochs (
  vault_id          text not null,
  epoch_number      integer not null,
  merkle_root       text not null,
  total0_wei        text not null,
  total1_wei        text not null,
  deadline          bigint not null,
  tx_hash           text,
  claim_index       jsonb not null,   -- { "<wallet>": { amount0Wei, amount1Wei, proof: [...] } }
  tree_json         jsonb,            -- full OZ StandardMerkleTree dump (audit/rebuild)
  margin_required0  numeric default 0,
  margin_required1  numeric default 0,
  created_at        timestamptz not null default now(),
  primary key (vault_id, epoch_number)
);
