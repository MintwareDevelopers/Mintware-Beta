-- Migration: swap_events table
-- Deduplicated log of all swap/bridge events received by the swap-event webhook.
-- tx_hash is the dedup key — unique constraint prevents double-credit.

CREATE TABLE IF NOT EXISTS swap_events (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tx_hash      TEXT        NOT NULL UNIQUE,
  wallet       TEXT        NOT NULL,
  chain        TEXT,
  token_in     TEXT,
  token_out    TEXT,
  amount_usd   NUMERIC,
  is_bridge    BOOLEAN     NOT NULL DEFAULT false,
  occurred_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swap_events_wallet  ON swap_events (wallet);
CREATE INDEX IF NOT EXISTS idx_swap_events_created ON swap_events (created_at DESC);

-- RLS: service role only (webhook writes, no public reads needed)
ALTER TABLE swap_events ENABLE ROW LEVEL SECURITY;
