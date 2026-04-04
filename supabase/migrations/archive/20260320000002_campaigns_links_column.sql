-- Add links JSONB column to campaigns for manual social link overrides.
-- For campaigns with a token_contract, links are auto-fetched from DexScreener.
-- For campaigns without a token_contract (e.g. Core DAO points), links are stored here.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS links jsonb;

COMMENT ON COLUMN campaigns.links IS
  'Optional manual social links: { dex, twitter, website, telegram }.
   Takes precedence over auto-fetched DexScreener data.
   For campaigns with token_contract, DexScreener is the automatic source.';
