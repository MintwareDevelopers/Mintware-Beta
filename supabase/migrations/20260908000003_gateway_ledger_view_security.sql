-- Round-3 audit (off-chain exploit replay) F-1 / F-7 — the fee-ledger VIEWS and the ledger RPC were reachable
-- with the anon key.
--
-- * `gateway_fee_balances` and `gateway_fee_ledger_reconciliation` were created as plain views. In Postgres a
--   plain view runs with the DEFINER's privileges, so RLS on the underlying tables (deny-all) is bypassed and the
--   anon role got HTTP 200 against them on prod (0 rows only because the ledger is still empty). Once harvest
--   indexing runs, every depositor wallet <-> owed amount and the seat expectations would be world-readable.
--   Fix: `security_invoker = on` (the view is evaluated with the CALLER's privileges, so deny-all RLS applies)
--   AND revoke the grants outright — these are operator/service-role surfaces, never client-read.
-- * `record_gateway_harvest(jsonb, jsonb, text)` was EXECUTE-able by anon/authenticated. RLS inside refused the
--   writes (verified), but a mutating RPC has no business being callable by anyone except the service role.
--   Fix: revoke EXECUTE from PUBLIC/anon/authenticated (service_role bypasses grants by definition).

ALTER VIEW IF EXISTS gateway_fee_balances SET (security_invoker = on);
ALTER VIEW IF EXISTS gateway_fee_ledger_reconciliation SET (security_invoker = on);

REVOKE ALL ON TABLE gateway_fee_balances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE gateway_fee_ledger_reconciliation FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION record_gateway_harvest(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW gateway_fee_balances IS
  'Operator/service-role only (security_invoker; grants revoked from anon/authenticated — round-3 audit F-1).';
COMMENT ON VIEW gateway_fee_ledger_reconciliation IS
  'Operator/service-role only (security_invoker; grants revoked from anon/authenticated — round-3 audit F-1).';
