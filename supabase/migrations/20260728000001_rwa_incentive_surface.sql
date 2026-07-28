-- ============================================================================
-- RWA Incentive Layer · R0 — surface foundation.
-- Additive only. Makes the campaign engine surface-aware.
--
-- No behaviour change to the DeFi path: every existing campaign is surface='defi'
-- and the new gates are inert until read by later tracks. These columns carry the
-- flag that R3 (KYC gate at credit + claim), R4 (hold-snapshot credit), and R5
-- (duration-match lock bonus) act on.
--
-- See docs/developers/rwa-incentive-layer.md §3–§6.
-- Requires vault_deals (rwa_deal_schema migration) to exist for the FK.
-- ============================================================================

-- ── surface: which vault surface this campaign incentivises ──────────────────
alter table campaigns add column if not exists surface text not null default 'defi';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_surface_chk') then
    alter table campaigns add constraint campaigns_surface_chk check (surface in ('defi','rwa'));
  end if;
end $$;

-- ── min_kyc_tier: KYC gate on credit + claim (enforced in R3) ────────────────
alter table campaigns add column if not exists min_kyc_tier text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_min_kyc_tier_chk') then
    alter table campaigns add constraint campaigns_min_kyc_tier_chk
      check (min_kyc_tier is null or min_kyc_tier in ('NONE','BASIC','ACCREDITED'));
  end if;
end $$;

-- ── linked_deal_id: the approved deal this campaign is attached to (RWA) ──────
alter table campaigns add column if not exists linked_deal_id uuid references vault_deals(id);

-- ── duration_match_days: lock ≥ this earns the duration-match bonus (R5) ──────
alter table campaigns add column if not exists duration_match_days integer
  check (duration_match_days is null or duration_match_days >= 0);

create index if not exists campaigns_surface_idx on campaigns (surface);

comment on column campaigns.surface is
  'defi | rwa — which vault surface this campaign incentivises. Default defi (all existing campaigns).';
comment on column campaigns.min_kyc_tier is
  'NULL|NONE|BASIC|ACCREDITED — KYC gate on credit + claim for RWA campaigns (enforced R3).';
comment on column campaigns.linked_deal_id is
  'vault_deals.id this campaign is attached to (RWA surface). NULL for DeFi.';
comment on column campaigns.duration_match_days is
  'Lock ≥ this many days earns the duration-match bonus (R5). Typically the deal settle_days.';
