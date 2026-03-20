-- Add links JSONB column to campaigns for social/dex links
-- Used for manual overrides (e.g. Core DAO which has no token_contract)
-- Base token campaigns auto-fetch from DexScreener via the UI

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS links jsonb;

COMMENT ON COLUMN campaigns.links IS
  'Optional social/dex links. Keys: dex, website, twitter, telegram.
   If absent, UI auto-fetches from DexScreener using token_contract.';

-- Set Core DAO links manually (no token_contract for auto-fetch)
UPDATE campaigns
SET links = '{"dex": "https://dexscreener.com/search?q=CORE", "twitter": "https://x.com/Coredao_Org", "website": "https://coredao.org"}'::jsonb
WHERE id = 'core-dao-march-2026';
