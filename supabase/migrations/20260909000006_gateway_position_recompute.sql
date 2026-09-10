-- Historical PM attribution recovery, part 2 of 2 (independent Codex audit, to-do items 3/4, 2026-09-10).
-- Migration 20260909000005 stopped GUESSING at ambiguous pre-existing (position_manager IS NULL)
-- gateway_deposit_events rows — they now sit untouched and invisible to every generation's read/write
-- path, rather than being silently (and possibly wrongly) merged into whichever PM asks first. This
-- migration adds the OTHER half: a function `scripts/verify-gateway-pm-attribution.mjs` calls, AFTER it
-- has resolved an orphaned row's TRUE position_manager from real on-chain receipt data (never a guess —
-- `receipt.to`, the actual verified destination of that specific historical transaction), to recompute
-- that identity's gateway_positions row from its now-correctly-attributed event history. This is the
-- SAME replay algorithm record_gateway_deposit_event/record_gateway_withdraw_event already run inline —
-- exposed here as its own callable step because the script resolves events WITHOUT a fresh recording call
-- (there is no new deposit/withdraw transaction — only historical data being corrected).
--
-- Read-only w.r.t. gateway_deposit_events (the script's own UPDATE already set position_manager there,
-- separately) — this function only reads events and writes gateway_positions. Same advisory-lock
-- discipline as the recording RPCs, for the same reason (concurrent recompute/record calls for the same
-- identity must not race).

CREATE OR REPLACE FUNCTION recompute_gateway_position(
  p_address text,
  p_pool_address text,
  p_chain_id integer,
  p_position_manager text
) RETURNS TABLE(cost_basis_atomic numeric, shares_atomic numeric, event_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_address text := lower(p_address);
  v_pool text := lower(p_pool_address);
  v_pm text := lower(p_position_manager);
  v_new_basis numeric(78,0) := 0;
  v_running_shares numeric(78,0) := 0;
  v_event_count integer := 0;
  v_has_gap boolean;
  v_ev record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_address || ':' || v_pool), p_chain_id);

  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'recompute_gateway_position: position_manager must be resolved (non-null) before recomputing';
  END IF;

  -- Same data-completeness gate as the recording RPCs — refuse to (mis)compute a from-scratch replay
  -- over a history that still has gaps (e.g. the receipt lookup couldn't recover every needed field for
  -- every event); the caller should re-run the recovery pass rather than get a silently-wrong number.
  SELECT EXISTS(
    SELECT 1 FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      AND position_manager = v_pm
      AND ((kind = 'withdraw' AND shares_burned IS NULL) OR (kind = 'deposit' AND shares_minted IS NULL))
  ) INTO v_has_gap;
  IF v_has_gap THEN
    RAISE EXCEPTION 'recompute_gateway_position: % / % / % / % still has events missing shares_minted/shares_burned — resolve them first, refusing to guess', v_address, v_pool, p_chain_id, v_pm;
  END IF;

  FOR v_ev IN
    SELECT kind, quote_in, shares_minted, shares_burned
    FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager = v_pm
    ORDER BY block_number NULLS FIRST, tx_index NULLS FIRST, created_at
  LOOP
    v_event_count := v_event_count + 1;
    IF v_ev.kind = 'deposit' THEN
      v_new_basis := v_new_basis + COALESCE(v_ev.quote_in, 0);
      v_running_shares := v_running_shares + COALESCE(v_ev.shares_minted, 0);
    ELSE
      IF v_running_shares < v_ev.shares_burned THEN
        RAISE EXCEPTION 'recompute_gateway_position: % / % / % / % has a withdraw burning more shares (%) than minted so far (%) — history is still incomplete, refusing to guess', v_address, v_pool, p_chain_id, v_pm, v_ev.shares_burned, v_running_shares;
      END IF;
      v_running_shares := v_running_shares - v_ev.shares_burned;
      IF v_running_shares = 0 THEN
        v_new_basis := 0;
      ELSE
        v_new_basis := (v_new_basis * v_running_shares) / (v_running_shares + v_ev.shares_burned);
      END IF;
    END IF;
  END LOOP;

  IF v_event_count = 0 THEN
    RAISE EXCEPTION 'recompute_gateway_position: no events found for % / % / % / % — nothing to recompute', v_address, v_pool, p_chain_id, v_pm;
  END IF;

  INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav, updated_at)
  VALUES (v_address, v_pool, p_chain_id, v_pm, v_running_shares, v_new_basis, now())
  ON CONFLICT (user_wallet, pool_address, chain_id, position_manager) DO UPDATE SET
    shares = EXCLUDED.shares, entry_nav = EXCLUDED.entry_nav, updated_at = now();

  -- REVISED same-day (user directive, following a third Codex live-review pass on the atomic-apply work
  -- in migration 20260909000007): this function is the ONE that scripts/verify-gateway-pm-attribution.mjs's
  -- backstop sweep (recomputeAllResolvedIdentities) calls for identities NOT touched by this run's own
  -- apply_gateway_pm_attribution calls. If one of those identities had previously been recorded in
  -- gateway_position_recompute_issues (added by _007 — a forward dependency: this DELETE is inert until
  -- _007 is applied, since PL/pgSQL doesn't validate referenced tables until first execution, and both
  -- migrations ship together) as a stuck sibling (an over-burn or data-gap skip), and THIS call now
  -- succeeds for it — proving whatever was wrong has resolved — the stale issue record must be cleared
  -- here too, not only inside apply_gateway_pm_attribution's own cross-PM loop. Without this, an identity
  -- recomputed successfully via the backstop sweep specifically (rather than via apply_gateway_pm_attribution
  -- directly) would keep reading as costBasisComplete:false forever, even once its basis is fully accurate.
  DELETE FROM gateway_position_recompute_issues
  WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager = v_pm;

  RETURN QUERY SELECT v_new_basis, v_running_shares, v_event_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION recompute_gateway_position(text, text, integer, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION recompute_gateway_position(text, text, integer, text) IS
  'Recomputes a gateway_positions row from its already-resolved (real, non-null position_manager) event history — the second half of the historical-PM-attribution recovery process (round-4 pass-2 to-do items 3/4). Called by scripts/verify-gateway-pm-attribution.mjs after it resolves an orphaned event''s position_manager from a verified on-chain receipt. Refuses (raises) rather than guesses when the history is still incomplete. Service-role only.';
