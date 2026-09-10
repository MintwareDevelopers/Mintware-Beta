-- Historical PM attribution recovery, atomic apply (user directive, 2026-09-10, following Codex's live
-- review of scripts/verify-gateway-pm-attribution.mjs): "Make recovery updates and recomputation atomic."
--
-- The recovery script previously did two SEPARATE round-trips per resolved row: an app-level UPDATE of
-- gateway_deposit_events (via supabase-js), then a SEPARATE call to recompute_gateway_position(). Each
-- was individually safe (the recompute step is itself lock-protected and idempotent, and the script's
-- own recomputeAllResolvedIdentities sweep re-derives from current DB state every run), but a crash
-- between the two steps left a real gap: the event row was already resolved (no longer an orphan) but
-- gateway_positions had not yet been recomputed to reflect it — a window where the two are inconsistent.
--
-- This migration closes that window with ONE function performing BOTH steps inside a single Postgres
-- transaction (a single RPC call is always one transaction) under the SAME advisory lock the recording
-- RPCs and recompute_gateway_position already use — so a crash either lands both writes or neither.
--
-- Still explicitly refuses (never guesses) exactly like recompute_gateway_position: an incomplete
-- history (this wallet/pool/chain has other, still-orphaned sibling rows; a resolved event is missing
-- its own shares_minted/shares_burned; a withdraw would burn more than was ever minted) skips or refuses
-- the recompute half while STILL durably recording the resolved attribution on the event row itself —
-- the caller gets back exactly how many orphaned siblings remain, so the recovery script can report
-- "resolved but not yet recomputed — N sibling row(s) still unattributed" honestly instead of silently
-- retrying forever.

CREATE OR REPLACE FUNCTION apply_gateway_pm_attribution(
  p_event_id uuid,
  p_position_manager text,
  p_block_number bigint,
  p_tx_index integer,
  p_shares_minted numeric DEFAULT NULL,
  p_shares_burned numeric DEFAULT NULL
) RETURNS TABLE(
  updated boolean,           -- true iff this call's UPDATE actually ran (false = already resolved, idempotent no-op)
  complete boolean,          -- true iff the recompute below actually ran and gateway_positions was written
  cost_basis_atomic numeric, -- only set when complete = true
  shares_atomic numeric,     -- only set when complete = true
  event_count integer,       -- only set when complete = true
  remaining_orphans integer  -- > 0 explains why complete = false (this wallet/pool/chain has unresolved siblings)
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_address text;
  v_pool text;
  v_chain_id integer;
  v_kind text;
  v_existing_pm text;
  v_pm text := lower(p_position_manager);
  v_updated boolean := false;
  v_remaining_orphans integer;
  v_has_gap boolean;
  v_new_basis numeric(78,0) := 0;
  v_running_shares numeric(78,0) := 0;
  v_event_count integer := 0;
  v_ev record;
BEGIN
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'apply_gateway_pm_attribution: position_manager must be resolved (non-null) before applying';
  END IF;

  -- Look up the target row's own identity fields first — needed to compute the advisory-lock key. A
  -- missing row is a genuine caller error (a stale/bad event id), not a recoverable condition.
  SELECT lower(address), lower(pool_address), chain_id, kind, position_manager
    INTO v_address, v_pool, v_chain_id, v_kind, v_existing_pm
  FROM gateway_deposit_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_gateway_pm_attribution: no gateway_deposit_events row with id %', p_event_id;
  END IF;

  -- Same advisory lock the recording RPCs and recompute_gateway_position take — serializes every write
  -- path (record / recompute / apply-attribution) for this identity.
  PERFORM pg_advisory_xact_lock(hashtext(v_address || ':' || v_pool), v_chain_id);

  -- Re-read after acquiring the lock — another session may have resolved (or even re-resolved) this
  -- exact row while we were waiting.
  SELECT position_manager INTO v_existing_pm FROM gateway_deposit_events WHERE id = p_event_id;

  IF v_existing_pm IS NOT NULL AND v_existing_pm <> v_pm THEN
    RAISE EXCEPTION 'apply_gateway_pm_attribution: event % is already resolved to % — refusing to overwrite with a conflicting attribution (%)', p_event_id, v_existing_pm, v_pm;
  END IF;

  IF v_existing_pm IS NULL THEN
    UPDATE gateway_deposit_events
    SET position_manager = v_pm,
        block_number = p_block_number,
        tx_index = p_tx_index,
        shares_minted = CASE WHEN v_kind = 'deposit' THEN COALESCE(p_shares_minted, shares_minted) ELSE shares_minted END,
        shares_burned = CASE WHEN v_kind = 'withdraw' THEN COALESCE(p_shares_burned, shares_burned) ELSE shares_burned END
    WHERE id = p_event_id;
    v_updated := true;
  END IF; -- else: already resolved to this SAME position_manager — idempotent no-op, fall through to recompute

  -- Completeness gate (the core fix): this wallet/pool/chain must have NO remaining orphaned sibling
  -- rows before we publish ANY basis for it — an unresolved sibling (a different tx, still
  -- position_manager IS NULL) could genuinely belong to this exact PM, and recomputing without it would
  -- silently publish a basis from a known-incomplete history.
  SELECT count(*) INTO v_remaining_orphans
  FROM gateway_deposit_events
  WHERE address = v_address AND pool_address = v_pool AND chain_id = v_chain_id AND position_manager IS NULL;

  IF v_remaining_orphans > 0 THEN
    RETURN QUERY SELECT v_updated, false, NULL::numeric, NULL::numeric, NULL::integer, v_remaining_orphans;
    RETURN;
  END IF;

  -- Same gap-completeness gate as recompute_gateway_position — refuse rather than guess.
  SELECT EXISTS(
    SELECT 1 FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = v_chain_id AND position_manager = v_pm
      AND ((kind = 'withdraw' AND shares_burned IS NULL) OR (kind = 'deposit' AND shares_minted IS NULL))
  ) INTO v_has_gap;
  IF v_has_gap THEN
    RAISE EXCEPTION 'apply_gateway_pm_attribution: % / % / % / % still has events missing shares_minted/shares_burned — resolve them first, refusing to guess', v_address, v_pool, v_chain_id, v_pm;
  END IF;

  FOR v_ev IN
    SELECT kind, quote_in, shares_minted, shares_burned
    FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = v_chain_id AND position_manager = v_pm
    ORDER BY block_number NULLS FIRST, tx_index NULLS FIRST, created_at
  LOOP
    v_event_count := v_event_count + 1;
    IF v_ev.kind = 'deposit' THEN
      v_new_basis := v_new_basis + COALESCE(v_ev.quote_in, 0);
      v_running_shares := v_running_shares + COALESCE(v_ev.shares_minted, 0);
    ELSE
      IF v_running_shares < v_ev.shares_burned THEN
        RAISE EXCEPTION 'apply_gateway_pm_attribution: % / % / % / % has a withdraw burning more shares (%) than minted so far (%) — history is still incomplete, refusing to guess', v_address, v_pool, v_chain_id, v_pm, v_ev.shares_burned, v_running_shares;
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
    RAISE EXCEPTION 'apply_gateway_pm_attribution: no events found for % / % / % / % — nothing to recompute', v_address, v_pool, v_chain_id, v_pm;
  END IF;

  INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav, updated_at)
  VALUES (v_address, v_pool, v_chain_id, v_pm, v_running_shares, v_new_basis, now())
  ON CONFLICT (user_wallet, pool_address, chain_id, position_manager) DO UPDATE SET
    shares = EXCLUDED.shares, entry_nav = EXCLUDED.entry_nav, updated_at = now();

  RETURN QUERY SELECT v_updated, true, v_new_basis, v_running_shares, v_event_count, 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_gateway_pm_attribution(uuid, text, bigint, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION apply_gateway_pm_attribution(uuid, text, bigint, integer, numeric, numeric) IS
  'Atomically applies one orphaned gateway_deposit_events row''s resolved position_manager (from a verified on-chain receipt, see scripts/verify-gateway-pm-attribution.mjs) AND recomputes its identity''s gateway_positions row, in ONE transaction under the same advisory lock every gateway write path uses — closing the interrupted-apply gap where the two used to be separate round-trips. Refuses (raises) on a conflicting existing attribution or an incomplete event history; reports remaining_orphans > 0 rather than guessing when sibling rows for the same wallet/pool/chain are still unresolved. Service-role only.';
