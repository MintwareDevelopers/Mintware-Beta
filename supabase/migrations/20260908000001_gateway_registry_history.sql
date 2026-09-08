-- ============================================================================
-- LP GATEWAY — registry trust-root hardening (audit closeout 2026-09-08: O-3 / R-2 / HO-7 / A-7).
--
-- `gateway_instances` is the deposit-routing trust root (the app advertises `position_manager` as the
-- deposit target and verifies user txs against it). This migration adds:
--   * `gateway_instance_history` — APPEND-ONLY log of every register / deactivate / refused write,
--     with the verification evidence (factory | codehash | operator attestation) and the acting
--     curator wallet. A hot-swap of an active pool can no longer happen silently: `registerInstance`
--     now refuses to write over an ACTIVE row (read-before-write) — replacing one requires an
--     explicit `deactivateInstance` first, and both steps land here.
--   * `gateway_instances.verification` / `verified_by` / `deactivated_at` / `deactivated_by` /
--     `deactivate_reason` — the evidence + audit trail on the live row itself.
--   * a trigger that forbids UPDATE/DELETE on the history table (append-only even for service role).
--
-- Deny-all RLS (service-role only), matching every gateway table. Testnet/pre-audit.
-- ============================================================================

ALTER TABLE gateway_instances
  ADD COLUMN IF NOT EXISTS verification      text,          -- 'factory' | 'codehash' | 'operator_attested'
  ADD COLUMN IF NOT EXISTS verified_by       text,          -- curator wallet (signed-message) or 'operator:<name>'
  ADD COLUMN IF NOT EXISTS verification_meta jsonb,         -- e.g. { factory, codeHash } / { attestedBy, reason }
  ADD COLUMN IF NOT EXISTS deactivated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by    text,
  ADD COLUMN IF NOT EXISTS deactivate_reason text;

CREATE TABLE IF NOT EXISTS gateway_instance_history (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address     text        NOT NULL,
  chain_id         integer     NOT NULL,
  action           text        NOT NULL CHECK (action IN ('register', 'deactivate', 'refused')),
  position_manager text,                       -- candidate / affected PM
  staging          text,
  prev_position_manager text,                  -- what the row pointed at before (deactivate / refused-over-active)
  verification     text,                       -- 'factory' | 'codehash' | 'operator_attested' | null (refused)
  actor            text,                       -- curator wallet or 'server:bearer' / 'operator:<name>'
  reason           text,                       -- refusal code / deactivate reason
  meta             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gateway_instance_history_pool_idx
  ON gateway_instance_history (pool_address, chain_id, created_at);

-- Append-only: even the service role cannot rewrite history.
CREATE OR REPLACE FUNCTION gateway_instance_history_readonly() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gateway_instance_history is append-only';
END $$;
DROP TRIGGER IF EXISTS gateway_instance_history_no_rewrite ON gateway_instance_history;
CREATE TRIGGER gateway_instance_history_no_rewrite
  BEFORE UPDATE OR DELETE ON gateway_instance_history
  FOR EACH ROW EXECUTE FUNCTION gateway_instance_history_readonly();

alter table if exists public.gateway_instance_history enable row level security;

COMMENT ON TABLE gateway_instance_history IS 'Append-only audit log of LP-gateway registry writes (register / deactivate / refused) with the on-chain verification evidence and acting curator. O-3 / A-7 closeout. Testnet/pre-audit.';
COMMENT ON COLUMN gateway_instances.verification IS 'How the position_manager was tied to audited bytecode: factory (instanceForPool match), codehash (LP_GATEWAY_PM_CODEHASHES allowlist), or operator_attested (explicit, logged backfill).';
