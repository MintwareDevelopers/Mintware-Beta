-- LP-gateway position performance snapshots (Krystal item 8). One row per (wallet, pool, chain) per
-- snapshot run (the gateway-snapshot cron). Powers historical PnL / APR + the fees-vs-IL-over-time view.
-- Pure observability — never a money-moving surface. Testnet/pre-audit.

CREATE TABLE IF NOT EXISTS gateway_position_snapshots (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet           text          NOT NULL,
  pool_address          text          NOT NULL,
  chain_id              integer       NOT NULL,
  taken_at              timestamptz   NOT NULL DEFAULT now(),
  shares                numeric(78,0) NOT NULL DEFAULT 0,
  position_value_atomic numeric(78,0) NOT NULL DEFAULT 0,   -- current IL-exposed mark (quote atomic)
  cost_basis_atomic     numeric(78,0) NOT NULL DEFAULT 0,   -- entry_nav at snapshot time
  pnl_atomic            numeric        NOT NULL DEFAULT 0    -- SIGNED: position_value − cost_basis
);

-- Fast "latest N for this wallet+pool" reads (the history query is wallet+pool, newest-first).
CREATE INDEX IF NOT EXISTS gateway_position_snapshots_wallet_idx
  ON gateway_position_snapshots (user_wallet, pool_address, chain_id, taken_at DESC);

-- Deny-all RLS (service-role only, mirrors the other gateway tables). Browser never reads it directly.
alter table if exists public.gateway_position_snapshots enable row level security;

COMMENT ON TABLE gateway_position_snapshots IS 'Time series of each LP-gateway depositor position (value, cost basis, signed PnL) written by the gateway-snapshot cron. Read-only observability for historical PnL/APR (Krystal item 8). Testnet/pre-audit.';
