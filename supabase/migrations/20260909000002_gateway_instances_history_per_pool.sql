-- V1 second-pass audit fix (independent Codex review, 2026-09-09) — a pool can outlive more than one
-- PositionManager over its lifetime (an operator migrating to a new PM for the same pool), and every
-- past PM's depositors must remain able to find/withdraw from it forever (V1-01's fix). The original
-- UNIQUE(pool_address, chain_id) constraint made that architecturally impossible: re-registering a
-- DIFFERENT PositionManager for an already-retired pool had no choice but to UPDATE the existing row in
-- place, silently overwriting the retired PM's own identity — after which `listAllInstances`/
-- `resolveInstanceStrict({includeInactive:true})` had nothing left to find for it, even though its
-- depositors' on-chain shares were completely unaffected by this purely off-chain registry change.
--
-- Fix: relax the constraint to allow multiple rows per (pool_address, chain_id) — but still enforce
-- AT MOST ONE ACTIVE row per pool at a time (the actual invariant that matters: never advertise two
-- different deposit targets for the same pool simultaneously). `registerInstance` (lib/gateway/
-- registry.ts) now INSERTs a new row for a genuinely new/different PositionManager instead of updating
-- an existing retired row, and only updates a retired row in place when it's an EXACT reactivation
-- (identical PM + staging) — there's no identity to lose in that case, it's the same instance.

ALTER TABLE gateway_instances DROP CONSTRAINT IF EXISTS gateway_instances_pool_address_chain_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS gateway_instances_active_pool_uidx
  ON gateway_instances (pool_address, chain_id) WHERE status = 'active';

-- gateway_instances_active_idx (chain_id, status) WHERE status='active' from the original migration
-- already covers "list every active row for a chain" efficiently; no change needed there.

COMMENT ON TABLE gateway_instances IS 'Registry of curated LP-gateway instances. AT MOST ONE row per (pool_address, chain_id) may be status=active at a time (gateway_instances_active_pool_uidx); any number of RETIRED (inactive) rows may exist for the same pool — one per PositionManager it has ever fronted — so a depositor of a superseded PM can always be found via listAllInstances/resolveInstanceStrict(includeInactive). Testnet/pre-audit.';
