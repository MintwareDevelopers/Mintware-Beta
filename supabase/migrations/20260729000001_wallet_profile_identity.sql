-- Profile 2.0 · Slice 1 — custom identity fields on wallet_profiles.
-- Additive + nullable (no backfill). Powers GET/POST /api/profile:
--   name, bio, avatar, social links, and the on-chain EAS attestation pointer.
-- Public SELECT is already allowed by the existing "Profiles are publicly readable" policy.

ALTER TABLE wallet_profiles
  ADD COLUMN IF NOT EXISTS display_name    varchar(40),
  ADD COLUMN IF NOT EXISTS bio             varchar(200),
  ADD COLUMN IF NOT EXISTS avatar_type     text,           -- 'basename' | 'nft' | 'upload' | 'default'
  ADD COLUMN IF NOT EXISTS avatar_ref      text,           -- resolved url / nft ref / null
  ADD COLUMN IF NOT EXISTS twitter         varchar(64),
  ADD COLUMN IF NOT EXISTS farcaster       varchar(64),
  ADD COLUMN IF NOT EXISTS telegram        varchar(64),
  ADD COLUMN IF NOT EXISTS website         varchar(200),
  ADD COLUMN IF NOT EXISTS attestation_uid text,           -- EAS AttributionScore attestation UID (Base)
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

COMMENT ON COLUMN wallet_profiles.display_name    IS 'User-set display name; UI falls back to basename. Profile 2.0.';
COMMENT ON COLUMN wallet_profiles.avatar_type     IS 'basename | nft | upload | default';
COMMENT ON COLUMN wallet_profiles.attestation_uid IS 'EAS AttributionScore attestation UID, set on /api/eas/attest-score success.';
