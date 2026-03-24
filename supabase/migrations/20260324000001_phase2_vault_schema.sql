-- Phase 2: Social Vault schema
-- Additive only — zero modifications to Phase 1 tables
-- Applied: 2026-03-24

-- ─── social_vaults ────────────────────────────────────────────────────────────
create table if not exists social_vaults (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null,
  team_wallet      text        not null,
  project_token    text        not null,   -- ERC-20 address of seeded project token
  seed_amount      numeric     not null,
  pool_key         jsonb       not null,   -- V4 PoolKey: {token0,token1,fee,tickSpacing,hooks}
  contract_address text,                  -- SocialVault.sol deployed address
  status           text        not null default 'seeding', -- seeding|active|paused|closed
  chain_id         integer     not null default 8453,
  tick_lower       integer,
  tick_upper       integer,
  tvl_usdc         numeric     default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- auto-update updated_at
create or replace function touch_social_vault()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_social_vaults_updated_at
  before update on social_vaults
  for each row execute function touch_social_vault();

-- ─── lp_deposits ──────────────────────────────────────────────────────────────
create table if not exists lp_deposits (
  id                uuid        primary key default gen_random_uuid(),
  vault_id          uuid        references social_vaults(id) on delete restrict,
  wallet            text        not null,
  usdc_amount       numeric     not null,
  lock_tier         text        not null, -- flex|committed|aligned|core
  locked_until      timestamptz,          -- null for flex tier
  deposited_at      timestamptz default now(),
  compounded_amount numeric     default 0,
  status            text        not null default 'active' -- active|withdrawal_pending|withdrawn
);

create index if not exists lp_deposits_vault_id_idx  on lp_deposits(vault_id);
create index if not exists lp_deposits_wallet_idx     on lp_deposits(wallet);

-- ─── withdrawal_queue ─────────────────────────────────────────────────────────
create table if not exists withdrawal_queue (
  id               uuid        primary key default gen_random_uuid(),
  deposit_id       uuid        references lp_deposits(id) on delete restrict,
  wallet           text        not null,
  vault_id         uuid        references social_vaults(id) on delete restrict,
  requested_amount numeric     not null,
  notice_given_at  timestamptz default now(),
  executable_at    timestamptz not null,  -- notice_given_at + 7 days
  penalty_pct      numeric     default 0,
  penalty_amount   numeric     default 0,
  status           text        not null default 'pending', -- pending|executed|cancelled
  executed_at      timestamptz
);

create index if not exists withdrawal_queue_wallet_idx   on withdrawal_queue(wallet);
create index if not exists withdrawal_queue_vault_id_idx on withdrawal_queue(vault_id);

-- ─── vault_referrals ──────────────────────────────────────────────────────────
create table if not exists vault_referrals (
  id               uuid        primary key default gen_random_uuid(),
  vault_id         uuid        references social_vaults(id) on delete restrict,
  referrer         text        not null,
  referred_wallet  text        not null,
  deposit_id       uuid        references lp_deposits(id),
  net_liquidity    numeric     default 0,   -- updated on withdrawals
  retention_score  numeric     default 1.0,
  created_at       timestamptz default now(),
  unique(vault_id, referred_wallet)
);

create index if not exists vault_referrals_referrer_idx on vault_referrals(referrer);

-- ─── vault_epochs ─────────────────────────────────────────────────────────────
create table if not exists vault_epochs (
  id             uuid        primary key default gen_random_uuid(),
  vault_id       uuid        references social_vaults(id) on delete restrict,
  epoch_number   integer     not null,
  total_pool     numeric     default 0,  -- trading fees + MEV + penalties + bonus
  bonus_pool     numeric     default 0,  -- swept from prior epoch
  total_claimed  numeric     default 0,
  deadline       timestamptz,            -- epoch_close + 90 days
  merkle_root    text,
  ipfs_cid       text,
  tx_hash        text,
  status         text        not null default 'active', -- active|settling|published|finalized|swept
  opened_at      timestamptz default now(),
  closed_at      timestamptz,
  unique(vault_id, epoch_number)
);

create index if not exists vault_epochs_vault_id_idx on vault_epochs(vault_id);

-- partial index: enforce one active epoch per vault
create unique index if not exists vault_epochs_one_active_per_vault
  on vault_epochs(vault_id)
  where status = 'active';

-- ─── team_seeds ───────────────────────────────────────────────────────────────
create table if not exists team_seeds (
  id            uuid        primary key default gen_random_uuid(),
  vault_id      uuid        references social_vaults(id) on delete restrict,
  team_wallet   text        not null,
  project_token text        not null,
  seed_amount   numeric     not null,
  tx_hash       text,
  seeded_at     timestamptz default now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- social_vaults: public reads, no client writes
alter table social_vaults    enable row level security;
create policy "public read social_vaults"
  on social_vaults for select using (true);

-- vault_epochs: public reads, no client writes
alter table vault_epochs     enable row level security;
create policy "public read vault_epochs"
  on vault_epochs for select using (true);

-- lp_deposits: wallet-scoped reads only
alter table lp_deposits      enable row level security;
create policy "wallet read lp_deposits"
  on lp_deposits for select
  using (wallet = current_setting('request.jwt.claims', true)::jsonb->>'sub');

-- withdrawal_queue: wallet-scoped reads only
alter table withdrawal_queue enable row level security;
create policy "wallet read withdrawal_queue"
  on withdrawal_queue for select
  using (wallet = current_setting('request.jwt.claims', true)::jsonb->>'sub');

-- vault_referrals: wallet-scoped reads (referrer or referred)
alter table vault_referrals  enable row level security;
create policy "wallet read vault_referrals"
  on vault_referrals for select
  using (
    referrer        = current_setting('request.jwt.claims', true)::jsonb->>'sub'
    or referred_wallet = current_setting('request.jwt.claims', true)::jsonb->>'sub'
  );

-- team_seeds: public reads
alter table team_seeds       enable row level security;
create policy "public read team_seeds"
  on team_seeds for select using (true);
