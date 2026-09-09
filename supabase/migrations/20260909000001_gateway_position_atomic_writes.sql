-- Round-4 multi-suite audit (2026-09-09), Medium finding — /api/gateway/deposit and /api/gateway/withdraw
-- claimed tx-hash idempotency by inserting into gateway_deposit_events first, then separately SELECTing
-- the prior entry_nav and UPSERTing gateway_positions in a second, unrelated round-trip. Two failure
-- modes followed:
--   (1) a process crash/error BETWEEN the two writes permanently marks the tx 'recorded' (UNIQUE tx_hash)
--       but the cost-basis delta was never applied, and no retry can ever apply it (a retry sees
--       alreadyRecorded=true and deliberately leaves the basis unchanged).
--   (2) two concurrent calls for the SAME wallet+pool (a UI double-submit, or two txs firing back-to-back)
--       both read the same priorBasis before either upserts — a classic lost update, whichever write
--       lands second silently overwrites the first's contribution.
-- Funds/shares were never at risk (shares always resync from sharesOf() on every call), but the displayed
-- cost-basis/P&L can drift from on-chain truth.
--
-- Fix, mirroring the already-proven record_gateway_harvest pattern (20260908000002): one atomic RPC per
-- direction. The event-idempotency insert and the position write happen inside ONE function invocation
-- (Postgres wraps a single statement — and a single plpgsql function call — in an implicit transaction),
-- and the entry_nav update is expressed as `gateway_positions.entry_nav <op> p_delta` INSIDE the INSERT
-- .. ON CONFLICT DO UPDATE / UPDATE statement itself, referencing the row's CURRENT value at conflict-
-- resolution/update time rather than a value read in a separate prior statement — Postgres serializes
-- concurrent writers on the same conflict key / row internally, so this is race-free without an explicit
-- application-level lock.
--
-- Deny-all RLS + EXECUTE revoked from anon/authenticated/PUBLIC, matching every other mutating gateway RPC
-- (round-3 F-1/F-7, 20260908000003) — these are service-role-only surfaces, called from the deposit/
-- withdraw ROUTES (which already gate on signed-message auth), never directly by a client.

CREATE OR REPLACE FUNCTION record_gateway_deposit_event(
  p_tx_hash text,
  p_address text,
  p_pool_address text,
  p_chain_id integer,
  p_quote_in numeric,
  p_on_chain_shares numeric
) RETURNS TABLE(cost_basis_atomic numeric, already_recorded boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx text := lower(p_tx_hash);
  v_address text := lower(p_address);
  v_pool text := lower(p_pool_address);
  v_inserted_id uuid;
  v_already boolean;
  v_new_basis numeric(78,0);
BEGIN
  -- Claim the idempotency key first. A conflict means this tx was already recorded by an earlier call
  -- (or an earlier, since-completed run of this same function) — the basis mutation below is then a
  -- no-op, so a replayed txHash can never inflate entry_nav twice.
  INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in)
  VALUES (v_tx, v_address, 'deposit', v_pool, p_chain_id, p_quote_in)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  -- Atomic increment: `gateway_positions.entry_nav` on the right-hand side is the row's value AT THE
  -- MOMENT this statement resolves the conflict (Postgres locks the conflicting row for the duration),
  -- not a value read by an earlier, separate SELECT — so two concurrent deposits for the same wallet+pool
  -- can never lose one contribution to the other.
  INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, shares, entry_nav, updated_at)
  VALUES (v_address, v_pool, p_chain_id, p_on_chain_shares, CASE WHEN v_already THEN 0 ELSE p_quote_in END, now())
  ON CONFLICT (user_wallet, pool_address, chain_id) DO UPDATE SET
    shares = EXCLUDED.shares,
    entry_nav = CASE WHEN v_already THEN gateway_positions.entry_nav ELSE gateway_positions.entry_nav + p_quote_in END,
    updated_at = now()
  RETURNING entry_nav INTO v_new_basis;

  RETURN QUERY SELECT v_new_basis, v_already;
END;
$$;

CREATE OR REPLACE FUNCTION record_gateway_withdraw_event(
  p_tx_hash text,
  p_address text,
  p_pool_address text,
  p_chain_id integer,
  p_quote_out numeric,
  p_on_chain_shares numeric,
  p_shares_burned numeric
) RETURNS TABLE(cost_basis_atomic numeric, already_recorded boolean, position_found boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx text := lower(p_tx_hash);
  v_address text := lower(p_address);
  v_pool text := lower(p_pool_address);
  v_inserted_id uuid;
  v_already boolean;
  v_new_basis numeric(78,0);
  v_found boolean;
BEGIN
  INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_out)
  VALUES (v_tx, v_address, 'withdraw', v_pool, p_chain_id, p_quote_out)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  -- Same atomic-current-value pattern as the deposit RPC, proportional instead of additive. No matching
  -- row ⇒ this position's deposit was never recorded (a legacy/O-1 case) — deliberately NOT synthesizing
  -- one here (entry_nav defaults to 0, so a synthetic row would fabricate a fictitious "gain" equal to
  -- the whole position); a plain UPDATE just no-ops for a nonexistent row, matching the prior route
  -- behavior exactly. `RETURNING ... INTO` leaves v_new_basis/v_found NULL when nothing matched.
  UPDATE gateway_positions SET
    shares = p_on_chain_shares,
    entry_nav = CASE
      WHEN v_already THEN entry_nav
      WHEN p_on_chain_shares = 0 THEN 0
      WHEN (p_on_chain_shares + p_shares_burned) = 0 THEN 0
      ELSE (entry_nav * p_on_chain_shares) / (p_on_chain_shares + p_shares_burned)
    END,
    updated_at = now()
  WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id
  RETURNING entry_nav INTO v_new_basis;
  v_found := v_new_basis IS NOT NULL;

  RETURN QUERY SELECT v_new_basis, v_already, COALESCE(v_found, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric) IS
  'Atomic deposit-event idempotency claim + cost-basis increment (round-4 audit fix). Service-role only, called from POST /api/gateway/deposit.';
COMMENT ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric) IS
  'Atomic withdraw-event idempotency claim + proportional cost-basis reduction (round-4 audit fix). Service-role only, called from POST /api/gateway/withdraw.';
