-- LP-gateway operational alerts (Krystal item 11). Currently one kind: 'out_of_range' — the pool's spot
-- tick has left the gateway's fixed [tickLower, tickUpper], so the deployed leg has stopped earning fees.
-- Debounced: an alert only "fires" once it has been continuously open past a threshold (anti-whipsaw,
-- Krystal's time-buffer idea). In-app only (curator banner); external channels are a later add.
-- Read-only observability — never a money surface. Testnet/pre-audit.

CREATE TABLE IF NOT EXISTS gateway_alerts (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address  text          NOT NULL,
  chain_id      integer       NOT NULL,
  kind          text          NOT NULL DEFAULT 'out_of_range',
  first_seen_at timestamptz   NOT NULL DEFAULT now(),   -- when the condition first appeared (debounce anchor)
  last_seen_at  timestamptz   NOT NULL DEFAULT now(),   -- most recent run that still saw it
  firing        boolean       NOT NULL DEFAULT false,   -- open past the debounce threshold
  resolved_at   timestamptz,                            -- set when the condition clears (back in range)
  detail        jsonb                                    -- e.g. { currentTick, tickLower, tickUpper }
);

-- One OPEN alert per (pool, chain, kind); a resolved one can coexist as history.
CREATE UNIQUE INDEX IF NOT EXISTS gateway_alerts_open_uidx
  ON gateway_alerts (pool_address, chain_id, kind) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS gateway_alerts_pool_idx
  ON gateway_alerts (pool_address, chain_id, resolved_at);

alter table if exists public.gateway_alerts enable row level security;

COMMENT ON TABLE gateway_alerts IS 'Debounced operational alerts for curated LP gateways (out-of-range = fees paused). Written by the gateway-snapshot cron, surfaced in-app to the curator (Krystal item 11). Testnet/pre-audit.';
