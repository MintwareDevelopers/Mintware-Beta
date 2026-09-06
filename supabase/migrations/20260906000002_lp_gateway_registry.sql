-- ============================================================================
-- LP GATEWAY — multi-pool registry + curated add-request queue.
--
-- The gateway is many pools, self-serve: any client can REQUEST a pool; a curator approves (a human
-- decision, NOT an automated TVL gate); approval spins up an isolated gateway via the on-chain factory
-- and records it here. The app + crons discover every live gateway from `gateway_instances` instead of
-- a single env instance. Deny-all RLS (service-role only), matching every money-path table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS gateway_instances (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address     text        NOT NULL,      -- label / poolId the DB keys by (matches gateway_positions.pool_address)
  chain_id         integer     NOT NULL,
  pair_label       text,                       -- e.g. "PONS/USDG" (display)
  position_manager text        NOT NULL,       -- deployed MintwareLpGatewayPositionManager
  staging          text        NOT NULL,       -- deployed MintwareLpGatewayStaging
  quote_asset      text        NOT NULL,
  paired_asset     text,
  tick_lower       integer,
  tick_upper       integer,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       text,                        -- curator wallet
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz,
  UNIQUE (pool_address, chain_id)
);
CREATE INDEX IF NOT EXISTS gateway_instances_active_idx ON gateway_instances (chain_id, status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS gateway_pool_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address     text        NOT NULL,
  chain_id         integer     NOT NULL,
  pair_label       text,
  quote_asset      text,
  requester_wallet text,
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  curator_note     text,
  reviewed_by      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS gateway_pool_requests_status_idx ON gateway_pool_requests (status, created_at);
-- one open request per pool/chain — a curator resolves it before another can be filed
CREATE UNIQUE INDEX IF NOT EXISTS gateway_pool_requests_pending_uidx
  ON gateway_pool_requests (pool_address, chain_id) WHERE status = 'pending';

alter table if exists public.gateway_instances     enable row level security;
alter table if exists public.gateway_pool_requests enable row level security;

COMMENT ON TABLE gateway_instances IS 'Registry of live curated LP-gateway instances (one per pool). Crons + app discover pools here. Testnet/pre-audit.';
COMMENT ON TABLE gateway_pool_requests IS 'Curated add-request queue: client requests a pool → curator approves → gateway spun up. Human gate, not TVL. Testnet/pre-audit.';
