-- WS1 (RWA three-role model) — KYC records for the trader gate.
--
-- The KYC oracle (backend) writes a row here when a Persona inquiry resolves, then pushes
-- the verification on-chain to SPVBeneficiaryRegistry.verifyBeneficiary (the `kycProvider`).
-- The RWA UI reads `verified` (via GET /api/kyc/status) to gate the "trade vRWA" action.
-- On-chain enforcement is the source of truth; this table mirrors it for UX + auditing.
--
-- Reg D deals require a verified holder to receive vRWA; Reg A+ deals trade openly.
-- See docs/developers/rwa-three-role-build-plan.md (WS1) + rwa-compliance-three-role-model.md.

create table if not exists public.kyc_records (
  address        text primary key,                    -- lowercased EVM wallet (Persona reference-id)
  status         text        not null default 'pending', -- pending | verified | declined | revoked
  level          smallint    not null default 0,       -- KYCLevel: 0 NONE 1 BASIC 2 ACCREDITED 3 INSTITUTIONAL
  provider       text,                                 -- 'persona'
  inquiry_id     text,                                 -- Persona inquiry id
  provider_hash  text,                                 -- keccak256(inquiryId) — the on-chain providerHash (no PII)
  country_code   text,                                 -- ISO 3166-1 alpha-2
  restricted     boolean     not null default false,   -- sanctioned / restricted jurisdiction
  expires_at     bigint,                               -- unix seconds; null/0 = no expiry
  onchain_status text        not null default 'none',  -- none | pending | written | failed | skipped
  onchain_tx     text,                                 -- verifyBeneficiary tx hash
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Service-role only (matches the other RWA tables): RLS enabled with no policies.
alter table public.kyc_records enable row level security;

comment on table  public.kyc_records is 'KYC verification mirror for the RWA trader gate; on-chain SPVBeneficiaryRegistry is the source of truth';
comment on column public.kyc_records.provider_hash is 'keccak256(inquiryId) written on-chain as providerHash — deliberately no PII';
