-- ============================================================================
-- x402 settle events — observability log for every x402 settle attempt.
--
-- Nothing in this app persisted a settle outcome before this migration: the result of
-- `Facilitator.settle()` (success/fail/txHash) was serialized straight into the HTTP
-- response and then discarded. This table is a pure, best-effort log written from the
-- two facilitator implementations (lib/x402/facilitator.ts YpnFacilitator.settle,
-- lib/x402/directFacilitator.ts DirectFacilitator.settle) — the single choke point every
-- settle call funnels through regardless of which route triggered it
-- (/api/x402/settle, /api/x402/score, /api/x402/scores).
--
-- Nothing reads this table today. It's basic observability first, and the future data
-- source for an agent-reputation "behavior"/"contribution" signal IF that gets built —
-- see the attribution_review_2026_08_28 session notes. Logging here must never block or
-- fail a real settlement; writers wrap the insert in best-effort try/catch.
-- ============================================================================

CREATE TABLE IF NOT EXISTS x402_settle_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payer          text        NOT NULL,             -- payload.payload.authorization.from (lowercased)
  payee          text        NOT NULL,              -- reqs.payTo (lowercased)
  resource       text        NOT NULL,              -- reqs.resource — which paywalled endpoint/resource
  network        text        NOT NULL,              -- reqs.network
  asset          text        NOT NULL,              -- reqs.asset — USDC contract on `network`
  amount_atomic  text        NOT NULL,              -- payload.payload.authorization.value, atomic units
  provider       text        NOT NULL,              -- 'direct' | 'relayer' | 'oracle' | 'deferred'
  success        boolean     NOT NULL,
  tx_hash        text,                              -- null when deferred / not yet submitted on-chain
  error_reason   text,
  hold_id        text,                              -- YpnFacilitator path only; null on the direct model
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS x402_settle_events_payer_idx ON x402_settle_events (payer, created_at DESC);
CREATE INDEX IF NOT EXISTS x402_settle_events_payee_idx ON x402_settle_events (payee, created_at DESC);

-- Deny-all RLS, service-role only — mirrors 20260819000001_rls_backfill_hardening /
-- 20260824000001_x402_standing_permits. Written exclusively by server-side lib code through
-- the service-role client (BYPASSRLS); never read by the browser. Do NOT add an anon policy.
ALTER TABLE x402_settle_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE x402_settle_events IS 'Best-effort log of every x402 settle attempt (success or fail), written from the two Facilitator.settle() implementations. Pure observability today; deny-all RLS, service-role only.';
