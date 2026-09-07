-- ============================================================================
-- LP GATEWAY — off-chain hardening (security review 2026-09-06).
--
-- Two idempotency ledgers that close replay / double-action gaps in the
-- off-chain money-path (docs/developers/lp-gateway-v1-security-review.md):
--   * gateway_deposit_events (M-04) — one row per verified deposit/withdraw tx,
--     UNIQUE on tx_hash, so replaying a real txHash into
--     /api/gateway/{deposit,withdraw} can never inflate/deflate entry_nav twice.
--   * gateway_deploy_events (L-02) — one claim row per (position_manager, chain,
--     window), so a concurrent/retried deploy cron can't compound-deploy staged
--     capital into the LP.
--
-- Deny-all RLS (service-role only), matching every money-path table
-- (20260819000001 + the two prior gateway migrations). Amounts are atomic units
-- of the pool's quote asset (USDG on Robinhood Chain, 6dp) as numeric(78,0).
-- Testnet/pre-audit.
-- ============================================================================

-- M-04 — deposit/withdraw cost-basis idempotency ledger -----------------------
CREATE TABLE IF NOT EXISTS gateway_deposit_events (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash       text          NOT NULL,
  address       text          NOT NULL,                       -- the on-chain event's user (== signer)
  kind          text          NOT NULL CHECK (kind IN ('deposit', 'withdraw')),
  pool_address  text          NOT NULL,
  chain_id      integer       NOT NULL,
  quote_in      numeric(78,0),                                -- deposit: quoteIn recorded into basis
  quote_out     numeric(78,0),                                -- withdraw: quoteOut returned to the user
  created_at    timestamptz   NOT NULL DEFAULT now()
);
-- one basis mutation per on-chain tx — a replayed txHash conflicts and no-ops
CREATE UNIQUE INDEX IF NOT EXISTS gateway_deposit_events_tx_uidx ON gateway_deposit_events (tx_hash);
CREATE INDEX IF NOT EXISTS gateway_deposit_events_addr_idx ON gateway_deposit_events (address, pool_address, chain_id);

-- L-02 — deploy cron idempotency (per-pool-per-window claim) -------------------
CREATE TABLE IF NOT EXISTS gateway_deploy_events (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  position_manager       text          NOT NULL,
  chain_id               integer       NOT NULL,
  window_key             bigint        NOT NULL,              -- floor(unix_secs / LP_GATEWAY_DEPLOY_WINDOW_SECS)
  deploy_tx              text,                                -- set after a successful deploy tx
  quote_deployed_atomic  numeric(78,0),
  paired_deployed_atomic numeric(78,0),
  created_at             timestamptz   NOT NULL DEFAULT now()
);
-- one deploy claim per pool per window — a concurrent/retried run conflicts and no-ops
CREATE UNIQUE INDEX IF NOT EXISTS gateway_deploy_events_window_uidx
  ON gateway_deploy_events (position_manager, chain_id, window_key);
-- a deploy tx is recorded at most once
CREATE UNIQUE INDEX IF NOT EXISTS gateway_deploy_events_tx_uidx
  ON gateway_deploy_events (deploy_tx) WHERE deploy_tx IS NOT NULL;

alter table if exists public.gateway_deposit_events enable row level security;
alter table if exists public.gateway_deploy_events  enable row level security;

COMMENT ON TABLE gateway_deposit_events IS 'One row per verified LP-gateway deposit/withdraw tx. UNIQUE(tx_hash) makes the entry_nav cost-basis update idempotent (M-04). Testnet/pre-audit.';
COMMENT ON TABLE gateway_deploy_events  IS 'Per-(pool,chain,window) deploy claim + record. UNIQUE(position_manager,chain_id,window_key) prevents compound-deploy on concurrent/retried cron runs (L-02). Testnet/pre-audit.';
