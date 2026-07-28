-- ============================================================================
-- Phase 3 · Threshold seeding — off-chain coordination for MintwareSeedPool.
-- Additive only.
--
-- The escrow + funds live on-chain in MintwareSeedPool.sol; these tables hold
-- the seed CONFIG (so a vault card/panel can render the raise) and a mirror of
-- on-chain progress (quote_raised / phase) synced from events. Contributions
-- are a ledger keyed to on-chain txs — never custody.
--
-- See contracts-v4/src/MintwareSeedPool.sol + docs/developers/phase3-rwa-create-seed-design.md §2
-- ============================================================================

-- ─── vault_seeding ──────────────────────────────────────────────────────────
-- One active raise per vault. Mirrors the on-chain Seed struct.
create table if not exists vault_seeding (
  id                    uuid        primary key default gen_random_uuid(),
  vault_id              uuid        references social_vaults(id) on delete cascade,
  seed_id               text,                              -- on-chain bytes32 seedId (hex)
  project_token         text        not null,              -- token side (team escrows)
  quote_token           text        not null,              -- quote side (public co-seeds)
  target_address        text,                              -- ISeedTarget (vault/adapter)
  token_reserve         numeric     not null,              -- full project-token side
  team_quote            numeric     not null default 0,    -- quote the team pre-funds
  public_quote_target   numeric     not null,              -- quote left for the public
  quote_target          numeric     not null,              -- team_quote + public_quote_target
  quote_raised          numeric     not null default 0,    -- mirror of on-chain
  deployed_token        numeric     not null default 0,    -- mirror of on-chain
  deployed_quote        numeric     not null default 0,    -- mirror of on-chain
  deploy_threshold_bps  integer     not null,              -- 5000 = 50%
  threshold             numeric     not null,              -- quote_target * bps / 10000
  raise_deadline        timestamptz not null,
  sqrt_price            text,                              -- pool init price (uint160)
  chain_id              integer     not null default 8453,
  contract_address      text,                              -- deployed MintwareSeedPool
  phase                 text        not null default 'seeding', -- seeding|live|grown|refunding
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vault_seeding_phase_chk') then
    alter table vault_seeding
      add constraint vault_seeding_phase_chk check (phase in ('seeding','live','grown','refunding'));
  end if;
end $$;

-- one active seeding row per vault
create unique index if not exists vault_seeding_vault_id_uniq on vault_seeding (vault_id);
create index if not exists vault_seeding_phase_idx on vault_seeding (phase);

-- ─── seed_contributions ─────────────────────────────────────────────────────
-- Public quote contributions, keyed to on-chain txs. Ledger only — no custody.
create table if not exists seed_contributions (
  id            uuid        primary key default gen_random_uuid(),
  seeding_id    uuid        references vault_seeding(id) on delete cascade,
  contributor   text        not null,
  amount        numeric     not null,
  tx_hash       text,
  refunded      boolean     not null default false,
  created_at    timestamptz default now()
);

create index if not exists seed_contributions_seeding_idx on seed_contributions (seeding_id);
create index if not exists seed_contributions_contributor_idx on seed_contributions (contributor);

-- updated_at trigger (reuses touch_updated_at from the rwa_deal_schema migration)
drop trigger if exists trg_vault_seeding_updated_at on vault_seeding;
create trigger trg_vault_seeding_updated_at
  before update on vault_seeding
  for each row execute function touch_updated_at();

comment on table vault_seeding is 'Off-chain config + on-chain progress mirror for MintwareSeedPool fair-launch raises. Escrow is on-chain, not here.';
comment on table seed_contributions is 'Ledger of public quote contributions keyed to on-chain txs; never custody.';
