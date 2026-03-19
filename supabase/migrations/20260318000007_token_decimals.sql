-- =============================================================================
-- Migration: add token_decimals to campaigns
--
-- Needed to lock in the exact token amount at the time of a referral swap.
-- Without this, amount_wei can't be calculated until claim time — which means
-- a token price pump between swap and claim changes what the referrer is owed.
--
-- Default 18 covers all standard EVM tokens (ETH, CORE, BNB, etc.).
-- Teams must set this correctly for non-18 decimal tokens (e.g. USDC = 6).
-- =============================================================================

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS token_decimals INTEGER NOT NULL DEFAULT 18;

COMMENT ON COLUMN campaigns.token_decimals IS
  'ERC-20 decimals for the reward token. Default 18. '
  'Set to 6 for USDC/USDT, 8 for WBTC, etc. '
  'Used to convert reward_usd → amount_wei at swap time (price-locked).';
