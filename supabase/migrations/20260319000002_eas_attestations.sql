-- =============================================================================
-- Migration: EAS Attestations
-- Created: 2026-03-19
--
-- Creates the eas_attestations table to store offchain EAS attestation UIDs
-- for all four Mintware schema types:
--   - AttributionScore  (revocable)
--   - SwapActivity      (permanent)
--   - ReferralLink      (permanent)
--   - CampaignReward    (permanent)
--
-- Also adds eas_uid to daily_payouts to link reward payouts to their
-- CampaignReward attestation after it's published.
-- =============================================================================

-- ─── eas_attestations ────────────────────────────────────────────────────────

create table if not exists eas_attestations (
  id           uuid        default gen_random_uuid() primary key,
  wallet       text        not null,
  schema_name  text        not null,  -- 'AttributionScore' | 'SwapActivity' | 'ReferralLink' | 'CampaignReward'
  eas_uid      text        not null,
  attested_at  timestamptz not null default now(),
  metadata     jsonb       default '{}'
);

-- Enforce globally unique UIDs (EAS UIDs are deterministic — same inputs = same UID)
alter table eas_attestations
  add constraint eas_attestations_uid_unique unique (eas_uid);

-- Lookup by wallet + schema (most common query: "is this wallet attested?")
create index if not exists eas_attestations_wallet_schema
  on eas_attestations (wallet, schema_name);

-- Recency index for AttributionScore stale-check (the only schema we re-attest)
create index if not exists eas_attestations_score_recency
  on eas_attestations (wallet, attested_at desc)
  where schema_name = 'AttributionScore';

-- ─── daily_payouts.eas_uid ───────────────────────────────────────────────────
-- Added as nullable — populated after the event indexer fires attestReward()

alter table daily_payouts
  add column if not exists eas_uid text;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Read-only for anon (public attestation data), writes from service role only

alter table eas_attestations enable row level security;

create policy "eas_attestations_select_public"
  on eas_attestations for select
  using (true);

-- No insert/update/delete policies for anon — all writes via service-role API routes
