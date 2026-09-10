-- Event-order cost-basis fix (independent Codex audit, round-4 pass-2, 2026-09-09 — flagged in the
-- pass-2 review, confirmed still outstanding by Codex's live review after this session's earlier fixes).
--
-- 20260909000001 made record_gateway_deposit_event / record_gateway_withdraw_event ATOMIC (idempotency
-- claim + basis write in one transaction) but each still applied a single incremental delta against
-- gateway_positions.entry_nav's CURRENT value AT CALL TIME. That is correct only if recording calls for
-- one position always arrive in the same order their underlying on-chain txs were mined — nothing
-- enforced that. A deposit's and a withdraw's recording calls are two independent HTTP requests (client
-- retry, network jitter, a user acting from two tabs); if the WITHDRAW's call reaches this RPC before an
-- earlier (lower-block) DEPOSIT's call has recorded, the proportional reduction applies to a basis that
-- hasn't yet incorporated that deposit — and the deposit's own later call then just adds quoteIn on top,
-- landing on a final entry_nav that matches neither transaction's real on-chain order. Display-only (no
-- shares/funds at risk — `gateway_positions.shares` and every real balance read always resync live from
-- `sharesOf()` on-chain), but the cost-basis/P&L number shown to a depositor could be wrong.
--
-- Fix: every recording call now stores the RAW event (this migration adds the columns needed to fully
-- describe each one) and then RECOMPUTES entry_nav for that (address, pool, chain) by REPLAYING every
-- stored event for it, ordered by the event's own on-chain block_number — never by call-arrival order.
-- This makes entry_nav a pure function of on-chain history, immune to HTTP recording-call race/retry
-- order. Mirrors `replayCostBasis` in lib/gateway/basisMath.ts (that file's `nextDepositBasis`/
-- `nextWithdrawBasis` are the same single-step formulas these CASE expressions still use per iteration).

ALTER TABLE gateway_deposit_events
  ADD COLUMN IF NOT EXISTS block_number   bigint,         -- the recorded tx's own block — the replay's sort key
  ADD COLUMN IF NOT EXISTS on_chain_shares numeric(78,0), -- withdraw: post-burn balance; deposit: unused (NULL)
  ADD COLUMN IF NOT EXISTS shares_burned   numeric(78,0); -- withdraw: shares burned this tx; deposit: unused (NULL)

-- Rows recorded before this migration have no block_number, and a legacy WITHDRAW row has no
-- on_chain_shares/shares_burned either (the old schema never stored them, only used them transiently to
-- compute a delta) — there is no way to replay a legacy withdraw's contribution from scratch; the data
-- to do so was never persisted. A position with such a row in its history therefore CANNOT be safely
-- full-replayed — doing so anyway would misread "missing data" as "full exit" and zero a real depositor's
-- basis. Both RPCs below detect this (`v_has_legacy_gap`) and, only for an affected position, fall back
-- to the OLD single-delta-against-current-value behavior for this call (safe: it reproduces exactly
-- what the pre-this-migration RPC would have done, so no existing basis is corrupted or silently
-- shifted). A position whose ENTIRE history was recorded under 20260909000001+ (every row carries
-- on_chain_shares/shares_burned when it's a withdraw) gets the full on-chain-order replay.
CREATE INDEX IF NOT EXISTS gateway_deposit_events_replay_idx
  ON gateway_deposit_events (address, pool_address, chain_id, block_number NULLS FIRST, created_at);

-- Postgres identifies a function by (name, arg types) — adding `p_block_number` is a DIFFERENT
-- signature, so a bare CREATE OR REPLACE would leave the OLD 20260909000001 6-arg version registered
-- alongside this one as a separate overload (directly callable, still with the incremental-delta bug).
-- Drop it explicitly so exactly one signature exists per function name going forward.
DROP FUNCTION IF EXISTS record_gateway_deposit_event(text, text, text, integer, numeric, numeric);
DROP FUNCTION IF EXISTS record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION record_gateway_deposit_event(
  p_tx_hash text,
  p_address text,
  p_pool_address text,
  p_chain_id integer,
  p_quote_in numeric,
  p_on_chain_shares numeric,
  p_block_number bigint DEFAULT NULL
) RETURNS TABLE(cost_basis_atomic numeric, already_recorded boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx text := lower(p_tx_hash);
  v_address text := lower(p_address);
  v_pool text := lower(p_pool_address);
  v_inserted_id uuid;
  v_already boolean;
  v_new_basis numeric(78,0) := 0;
  v_prior_basis numeric(78,0) := 0;
  v_has_legacy_gap boolean;
  v_ev record;
BEGIN
  -- Claim the idempotency key first, now storing the full event (kind + block_number + quote_in) so a
  -- later replay (from this call OR any future call for this identity) can reconstruct it.
  INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, block_number)
  VALUES (v_tx, v_address, 'deposit', v_pool, p_chain_id, p_quote_in, p_block_number)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  IF v_already THEN
    -- Nothing changed — return the position's CURRENT basis as-is (no replay needed).
    SELECT entry_nav INTO v_new_basis FROM gateway_positions
      WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id;
    RETURN QUERY SELECT COALESCE(v_new_basis, 0::numeric(78,0)), true;
    RETURN;
  END IF;

  SELECT entry_nav INTO v_prior_basis FROM gateway_positions
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id;
  v_prior_basis := COALESCE(v_prior_basis, 0);

  -- A legacy withdraw row (recorded before 20260909000004) has no on_chain_shares/shares_burned — that
  -- data was never persisted, only used transiently — so this identity's history can't be safely
  -- replayed from scratch. Fall back to the OLD single-delta behavior for this call only (reproduces
  -- exactly what the pre-this-migration RPC would have done; a deposit's delta is purely additive, so
  -- this is always safe regardless of the gap).
  SELECT EXISTS(
    SELECT 1 FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      AND kind = 'withdraw' AND on_chain_shares IS NULL
  ) INTO v_has_legacy_gap;

  IF v_has_legacy_gap THEN
    v_new_basis := v_prior_basis + p_quote_in;
  ELSE
    -- Replay EVERY stored event for this identity, in ON-CHAIN order (block_number, then created_at as
    -- a same-block tiebreak) — never by call-arrival order. Mirrors basisMath.ts#replayCostBasis.
    v_new_basis := 0;
    FOR v_ev IN
      SELECT kind, quote_in, on_chain_shares, shares_burned
      FROM gateway_deposit_events
      WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      ORDER BY block_number NULLS FIRST, created_at
    LOOP
      IF v_ev.kind = 'deposit' THEN
        v_new_basis := v_new_basis + COALESCE(v_ev.quote_in, 0);
      ELSE
        IF v_ev.on_chain_shares = 0 OR (v_ev.on_chain_shares + COALESCE(v_ev.shares_burned, 0)) = 0 THEN
          v_new_basis := 0;
        ELSE
          v_new_basis := (v_new_basis * v_ev.on_chain_shares) / (v_ev.on_chain_shares + v_ev.shares_burned);
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, shares, entry_nav, updated_at)
  VALUES (v_address, v_pool, p_chain_id, p_on_chain_shares, v_new_basis, now())
  ON CONFLICT (user_wallet, pool_address, chain_id) DO UPDATE SET
    shares = EXCLUDED.shares, entry_nav = v_new_basis, updated_at = now();

  RETURN QUERY SELECT v_new_basis, false;
END;
$$;

CREATE OR REPLACE FUNCTION record_gateway_withdraw_event(
  p_tx_hash text,
  p_address text,
  p_pool_address text,
  p_chain_id integer,
  p_quote_out numeric,
  p_on_chain_shares numeric,
  p_shares_burned numeric,
  p_block_number bigint DEFAULT NULL
) RETURNS TABLE(cost_basis_atomic numeric, already_recorded boolean, position_found boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx text := lower(p_tx_hash);
  v_address text := lower(p_address);
  v_pool text := lower(p_pool_address);
  v_inserted_id uuid;
  v_already boolean;
  v_new_basis numeric(78,0) := 0;
  v_prior_basis numeric(78,0) := 0;
  v_has_legacy_gap boolean;
  v_found boolean;
  v_ev record;
BEGIN
  INSERT INTO gateway_deposit_events (
    tx_hash, address, kind, pool_address, chain_id, quote_out, on_chain_shares, shares_burned, block_number
  )
  VALUES (v_tx, v_address, 'withdraw', v_pool, p_chain_id, p_quote_out, p_on_chain_shares, p_shares_burned, p_block_number)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  -- No matching position row ⇒ this depositor's original deposit was never recorded (a legacy/O-1 case) —
  -- deliberately NOT synthesizing one (would fabricate a fictitious "gain" equal to the whole position);
  -- matches the prior route behavior exactly.
  SELECT EXISTS(
    SELECT 1 FROM gateway_positions WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id
  ) INTO v_found;
  IF NOT v_found THEN
    RETURN QUERY SELECT NULL::numeric(78,0), v_already, false;
    RETURN;
  END IF;

  IF v_already THEN
    SELECT entry_nav INTO v_new_basis FROM gateway_positions
      WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id;
    RETURN QUERY SELECT v_new_basis, true, true;
    RETURN;
  END IF;

  SELECT entry_nav INTO v_prior_basis FROM gateway_positions
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id;
  v_prior_basis := COALESCE(v_prior_basis, 0);

  -- Same legacy-gap detection as the deposit RPC (see its comment) — EXCLUDING the row this call just
  -- inserted (it always carries on_chain_shares, being new), so only a genuinely PRE-existing legacy row
  -- triggers the fallback.
  SELECT EXISTS(
    SELECT 1 FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      AND kind = 'withdraw' AND on_chain_shares IS NULL AND id <> v_inserted_id
  ) INTO v_has_legacy_gap;

  IF v_has_legacy_gap THEN
    IF p_on_chain_shares = 0 OR (p_on_chain_shares + p_shares_burned) = 0 THEN
      v_new_basis := 0;
    ELSE
      v_new_basis := (v_prior_basis * p_on_chain_shares) / (p_on_chain_shares + p_shares_burned);
    END IF;
  ELSE
    v_new_basis := 0;
    FOR v_ev IN
      SELECT kind, quote_in, on_chain_shares, shares_burned
      FROM gateway_deposit_events
      WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      ORDER BY block_number NULLS FIRST, created_at
    LOOP
      IF v_ev.kind = 'deposit' THEN
        v_new_basis := v_new_basis + COALESCE(v_ev.quote_in, 0);
      ELSE
        IF v_ev.on_chain_shares = 0 OR (v_ev.on_chain_shares + COALESCE(v_ev.shares_burned, 0)) = 0 THEN
          v_new_basis := 0;
        ELSE
          v_new_basis := (v_new_basis * v_ev.on_chain_shares) / (v_ev.on_chain_shares + v_ev.shares_burned);
        END IF;
      END IF;
    END LOOP;
  END IF;

  UPDATE gateway_positions SET shares = p_on_chain_shares, entry_nav = v_new_basis, updated_at = now()
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id;

  RETURN QUERY SELECT v_new_basis, false, true;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric, bigint) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric, bigint) IS
  'Atomic deposit-event idempotency claim + FULL-HISTORY REPLAY cost-basis recompute, ordered by on-chain block_number (round-4 pass-2 event-order fix). Service-role only, called from POST /api/gateway/deposit.';
COMMENT ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric, bigint) IS
  'Atomic withdraw-event idempotency claim + FULL-HISTORY REPLAY cost-basis recompute, ordered by on-chain block_number (round-4 pass-2 event-order fix). Service-role only, called from POST /api/gateway/withdraw.';
