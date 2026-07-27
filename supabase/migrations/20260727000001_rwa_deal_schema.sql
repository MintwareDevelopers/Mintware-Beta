-- ============================================================================
-- Phase 3 · RWA deal flow — persistence for issuers, deals, data-room docs,
-- and redemption requests. Additive only.
--
-- Backs the previously-mock RWA surface (lib/rwa/issuer.ts, lib/rwa/redemptions.ts,
-- the RWA deal page). Mirrors the on-chain trust surface (SPVAssetProviderRegistry,
-- SPVBeneficiaryRegistry, MintwareRWAVault4626) with off-chain deal metadata that
-- issuers author and Mintware reviews before publish.
--
-- See docs/developers/phase3-rwa-create-seed-design.md
-- ============================================================================

-- ─── social_vaults: RWA drafts have no project token / seed / pool yet ───────
-- Relax DeFi-only NOT NULLs so an RWA deal can be created before any on-chain
-- seed. Loosening a constraint is safe for existing rows.
alter table social_vaults alter column project_token drop not null;
alter table social_vaults alter column seed_amount   drop not null;
alter table social_vaults alter column pool_key      drop not null;

-- ─── vault_issuers ──────────────────────────────────────────────────────────
-- Asset-provider (issuer) profile. `status` mirrors SPVAssetProviderRegistry
-- (REGISTERED → VERIFIED → SUSPENDED); only VERIFIED issuers may publish a deal.
create table if not exists vault_issuers (
  id                      text        primary key,               -- slug, e.g. 'liquidhectar'
  name                    text        not null,
  address                 text        not null,                  -- issuer wallet / SPV signer
  status                  text        not null default 'REGISTERED', -- REGISTERED|VERIFIED|SUSPENDED
  since                   text,                                   -- 'YYYY-MM' first registered
  attribution_score       integer     default 0,
  deals_completed         integer     default 0,
  total_raised_usd        numeric     default 0,
  default_rate_pct        numeric     default 0,
  on_time_settlement_pct  numeric     default 100,
  transparency            jsonb       not null default '[]'::jsonb, -- [{label,value}]
  links                   jsonb       not null default '[]'::jsonb, -- [{label,url}]
  metadata_hash           text,                                   -- on-chain SPVAssetProviderRegistry ref
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vault_issuers_status_chk') then
    alter table vault_issuers
      add constraint vault_issuers_status_chk check (status in ('REGISTERED','VERIFIED','SUSPENDED'));
  end if;
end $$;

-- ─── vault_deals ────────────────────────────────────────────────────────────
-- One deal per RWA vault. Team-authored narrative + terms. `review_status` gates
-- public visibility (draft → in_review → approved). Only approved deals show live.
create table if not exists vault_deals (
  id                     uuid        primary key default gen_random_uuid(),
  vault_id               uuid        references social_vaults(id) on delete cascade,
  issuer_id              text        references vault_issuers(id) on delete restrict,
  description            text,                                    -- markdown overview
  yield_source_explainer text,                                   -- where the yield comes from
  price_explainer        text,                                   -- how the token is valued / NAV
  underlying_asset_class text,                                   -- 'private-credit'|'real-estate'|'energy'|...
  target_apy_pct         numeric,
  min_investment_usd     numeric     default 0,
  reserve_pct            integer     default 40,                 -- reserve / yield split (40/60)
  yield_pct              integer     default 60,
  price_band             text        default '±15/±45',          -- MintwareOracleHook core/spec bands
  settle_days            integer     default 30,                 -- MintwareRWAVault4626 redemption window
  kyc_tier_required      text        default 'BASIC',            -- NONE|BASIC|ACCREDITED|INSTITUTIONAL
  review_status          text        not null default 'draft',   -- draft|in_review|approved|rejected
  review_note            text,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vault_deals_review_chk') then
    alter table vault_deals
      add constraint vault_deals_review_chk check (review_status in ('draft','in_review','approved','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vault_deals_kyc_chk') then
    alter table vault_deals
      add constraint vault_deals_kyc_chk check (kyc_tier_required in ('NONE','BASIC','ACCREDITED','INSTITUTIONAL'));
  end if;
end $$;

-- one deal per vault
create unique index if not exists vault_deals_vault_id_uniq on vault_deals (vault_id);
create index if not exists vault_deals_issuer_idx on vault_deals (issuer_id);

-- ─── vault_deal_documents ───────────────────────────────────────────────────
-- Data-room entries (external links + documents). Each is individually reviewed.
create table if not exists vault_deal_documents (
  id             uuid        primary key default gen_random_uuid(),
  deal_id        uuid        references vault_deals(id) on delete cascade,
  label          text        not null,
  url            text        not null,
  kind           text        not null default 'other', -- term_sheet|legal_opinion|spv_structure|audit|data_room|other
  review_status  text        not null default 'pending', -- pending|approved|rejected
  sort_order     integer     default 0,
  created_at     timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vault_deal_documents_kind_chk') then
    alter table vault_deal_documents
      add constraint vault_deal_documents_kind_chk
      check (kind in ('term_sheet','legal_opinion','spv_structure','audit','data_room','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vault_deal_documents_review_chk') then
    alter table vault_deal_documents
      add constraint vault_deal_documents_review_chk
      check (review_status in ('pending','approved','rejected'));
  end if;
end $$;

create index if not exists vault_deal_documents_deal_idx on vault_deal_documents (deal_id);

-- ─── vault_redemptions ──────────────────────────────────────────────────────
-- Async redemption requests mirroring MintwareRWAVault4626.requestRedeem →
-- 30-day window → confirmSettlement. `status` derived off-chain from settles_at.
create table if not exists vault_redemptions (
  id            uuid        primary key default gen_random_uuid(),
  vault_id      uuid        references social_vaults(id) on delete cascade,
  holder        text        not null,                   -- redeeming wallet
  shares_usd    numeric     not null,
  requested_at  date        not null default current_date,
  settles_at    date        not null,                   -- requested_at + settle_days
  status        text        not null default 'pending', -- pending|ready|settled
  kyc_verified  boolean     not null default false,     -- SPVBeneficiaryRegistry check at settlement
  tx_hash       text,                                   -- confirmSettlement tx
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vault_redemptions_status_chk') then
    alter table vault_redemptions
      add constraint vault_redemptions_status_chk check (status in ('pending','ready','settled'));
  end if;
end $$;

create index if not exists vault_redemptions_vault_idx on vault_redemptions (vault_id);
create index if not exists vault_redemptions_status_idx on vault_redemptions (status);

-- ─── updated_at triggers ─────────────────────────────────────────────────────
-- Reuse the touch_social_vault() function shape for the new tables.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_vault_issuers_updated_at on vault_issuers;
create trigger trg_vault_issuers_updated_at
  before update on vault_issuers
  for each row execute function touch_updated_at();

drop trigger if exists trg_vault_deals_updated_at on vault_deals;
create trigger trg_vault_deals_updated_at
  before update on vault_deals
  for each row execute function touch_updated_at();

drop trigger if exists trg_vault_redemptions_updated_at on vault_redemptions;
create trigger trg_vault_redemptions_updated_at
  before update on vault_redemptions
  for each row execute function touch_updated_at();

comment on table vault_issuers is 'RWA asset-provider profiles; status mirrors SPVAssetProviderRegistry. Only VERIFIED may publish.';
comment on table vault_deals is 'Per-RWA-vault deal metadata (team-authored, Mintware-reviewed). review_status gates public visibility.';
comment on table vault_deal_documents is 'Data-room links + documents for a deal; each individually reviewed.';
comment on table vault_redemptions is 'Async redemption requests mirroring MintwareRWAVault4626 30-day settlement flow.';
