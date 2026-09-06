-- ============================================================================
-- LP GATEWAY (phase 1) — stage-and-earn → deploy into an existing third-party
-- Uniswap V4 pool → harvest fees (never principal) into a yield-first spend buffer.
--
-- Separate product surface from the vault/YPN-treasury stack; touches none of it.
-- Amounts are atomic units of the pool's quote asset (USDG on Robinhood Chain, 6dp) as
-- numeric(78,0) — the on-chain uint256 mirror. Quote asset is never assumed to be USDC.
-- Deny-all RLS (service-role only), matching every money-path table (20260819000001).
-- ============================================================================

CREATE TABLE IF NOT EXISTS gateway_positions (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet   text          NOT NULL,
  pool_address  text          NOT NULL,
  chain_id      integer       NOT NULL,
  shares        numeric(78,0) NOT NULL DEFAULT 0,
  -- entry-NAV share model (no fee-growth checkpointing): quote-asset-atomic NAV per share,
  -- marked to market at deposit time. Cost basis for the withdraw/IL read, never a par claim.
  entry_nav     numeric(78,0) NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz,
  UNIQUE (user_wallet, pool_address, chain_id)
);
CREATE INDEX IF NOT EXISTS gateway_positions_pool_idx ON gateway_positions (pool_address, chain_id);

CREATE TABLE IF NOT EXISTS harvest_events (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address            text          NOT NULL,
  chain_id                integer       NOT NULL,
  -- the zero-liquidity-delta modifyLiquidities collect that realizes fees without touching principal
  collect_tx              text,
  -- MW meta-router swap of the non-quote leg into the quote asset
  swap_tx                 text,
  amount_harvested_atomic numeric(78,0) NOT NULL DEFAULT 0,
  fee_skimmed_atomic      numeric(78,0) NOT NULL DEFAULT 0,
  amount_credited_atomic  numeric(78,0) NOT NULL DEFAULT 0,
  created_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS harvest_events_pool_idx ON harvest_events (pool_address, chain_id, created_at);
-- one harvest per collect tx — a cron retry can never double-credit buffers
CREATE UNIQUE INDEX IF NOT EXISTS harvest_events_collect_tx_uidx ON harvest_events (collect_tx) WHERE collect_tx IS NOT NULL;

-- Alternate buffer source: a card buffer funded from harvested LP-gateway fees instead of the
-- member's treasury-vault senior shares. Nullable + additive — the existing treasury card flow
-- (member_wallet + on-chain refillBuffer) is unchanged when this is null.
ALTER TABLE card_spend_buffers
  ADD COLUMN IF NOT EXISTS gateway_position_id uuid REFERENCES gateway_positions(id) ON DELETE SET NULL;

alter table if exists public.gateway_positions enable row level security;
alter table if exists public.harvest_events    enable row level security;

COMMENT ON TABLE gateway_positions IS 'Per-user share holding in an LP-gateway aggregate V4 pool position. Entry-NAV shares; no par claim. Testnet/pre-audit.';
COMMENT ON TABLE harvest_events IS 'One row per pool fee-harvest: collected, skimmed, and net credited pro-rata to spend buffers. Idempotent on collect_tx. Testnet/pre-audit.';
