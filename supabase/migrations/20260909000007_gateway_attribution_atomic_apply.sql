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
--
-- REVISED same-day, following a second Codex live-review pass ("cross-PM crash-before-final-sweep still
-- falsely complete"): the FIRST version of this function only recomputed the ONE identity
-- (p_position_manager) passed to it. That is correct for a wallet/pool/chain with a SINGLE PM generation,
-- but when TWO orphaned rows for the same wallet/pool/chain resolve to TWO DIFFERENT position managers,
-- the identity resolved FIRST (say PM_A, while a sibling row was still orphaned) reports complete:false
-- and is correctly left unrecomputed at that moment — but once the LAST orphan resolves (to PM_B, in a
-- LATER call), that call would only recompute PM_B's own identity, leaving PM_A stale until the script's
-- SEPARATE, non-transactional backstop sweep (recomputeAllResolvedIdentities) happens to run — a crash
-- between finishing the per-row apply loop and that sweep would leave PM_A stranded indefinitely (it
-- would eventually self-heal on a LATER script invocation, but that is not the same as atomic). Fixed:
-- the moment THIS call determines there are ZERO remaining orphans for the wallet/pool/chain, it
-- recomputes EVERY distinct position_manager identity sharing that wallet/pool/chain — not just the one
-- passed in — all within this SAME transaction. The script's backstop sweep still exists for staleness
-- that predates this migration (or a crash before this specific call ever runs), but for the specific
-- "resolving the last orphan makes multiple sibling PMs simultaneously completable" case, this closes it
-- atomically at the SQL level with no separate script-level step required at all.
--
-- REVISED again same-day (user directive, following a third Codex live-review pass): "a manager whose
-- recorded withdrawals exceed recorded minted shares can be skipped during recovery yet still appear
-- complete." True — when this function skips a SIBLING PM because its own replay would go negative (an
-- "over-burn": a withdraw burning more than was ever minted for that identity) or because it has its own
-- missing-field gap, that skip was previously silent: nothing durable recorded it, so a position READ for
-- a DIFFERENT, genuinely-complete sibling PM in the same wallet/pool/chain had no way to know a stuck
-- sibling existed. The read-side gap check (lib/gateway/attributionCompleteness.ts) already covers the
-- missing-field case directly (a cheap NULL-field query), but an over-burn identity has EVERY field
-- populated — detecting it needs an actual replay, which is exactly what this function already does and
-- a hot read path should not repeat. Fixed: `gateway_position_recompute_issues` durably records every
-- skip this function makes (reason: 'data_gap' or 'over_burn'), keyed by the skipped identity, and is
-- cleared the moment that identity DOES successfully recompute (proving whatever was wrong has resolved).
-- The read APIs check this table too (see the same-day update to lib/gateway/attributionCompleteness.ts).

CREATE TABLE IF NOT EXISTS gateway_position_recompute_issues (
  user_wallet      text        NOT NULL,
  pool_address     text        NOT NULL,
  chain_id         integer     NOT NULL,
  position_manager text        NOT NULL,
  reason           text        NOT NULL CHECK (reason IN ('data_gap', 'over_burn')),
  detected_at      timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_wallet, pool_address, chain_id, position_manager)
);
ALTER TABLE gateway_position_recompute_issues ENABLE ROW LEVEL SECURITY; -- deny-all: service-role only, mirrors every other gateway table
COMMENT ON TABLE gateway_position_recompute_issues IS
  'Durable record of a position-manager identity apply_gateway_pm_attribution could not recompute (a sibling PM skipped this call, or recompute_gateway_position refusing directly) — reason ''data_gap'' (missing shares_minted/shares_burned) or ''over_burn'' (a withdraw burning more than was ever minted). Row is deleted the moment that identity successfully recomputes. Read by lib/gateway/attributionCompleteness.ts so a DIFFERENT, genuinely-complete sibling PM''s position read still discloses that this one is stuck. Service-role only.';

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
  v_pm_iter text;
  v_target_basis numeric(78,0);
  v_target_shares numeric(78,0);
  v_target_events integer;
  v_target_found boolean := false;
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

  -- The last orphan for this wallet/pool/chain is now resolved (by this call or already before it) —
  -- recompute EVERY distinct position_manager identity sharing this wallet/pool/chain, atomically, in
  -- THIS SAME transaction. See the header note above ("REVISED same-day") for why this must cover every
  -- sibling PM, not just the one requested.
  FOR v_pm_iter IN
    SELECT DISTINCT position_manager FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = v_chain_id AND position_manager IS NOT NULL
  LOOP
    -- Same gap-completeness gate as recompute_gateway_position, scoped to THIS identity. The specific PM
    -- the caller actually requested must raise loudly on a gap (never silently succeed with a wrong
    -- answer for what the caller asked for); an unrelated SIBLING PM's own gap is its own separate,
    -- already-flagged problem — skip recomputing it this pass rather than block the requested PM's
    -- otherwise-legitimate atomic win. It remains recoverable later (the script's backstop sweep, or a
    -- future call once that sibling's own gap is resolved).
    SELECT EXISTS(
      SELECT 1 FROM gateway_deposit_events
      WHERE address = v_address AND pool_address = v_pool AND chain_id = v_chain_id AND position_manager = v_pm_iter
        AND ((kind = 'withdraw' AND shares_burned IS NULL) OR (kind = 'deposit' AND shares_minted IS NULL))
    ) INTO v_has_gap;
    IF v_has_gap THEN
      IF v_pm_iter = v_pm THEN
        RAISE EXCEPTION 'apply_gateway_pm_attribution: % / % / % / % still has events missing shares_minted/shares_burned — resolve them first, refusing to guess', v_address, v_pool, v_chain_id, v_pm;
      END IF;
      -- Durably record the skip so a read for a DIFFERENT sibling in this same wallet/pool/chain still
      -- discloses that this one is stuck (Codex, 2026-09-10: "can be skipped during recovery yet still
      -- appear complete").
      INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason, updated_at)
      VALUES (v_address, v_pool, v_chain_id, v_pm_iter, 'data_gap', now())
      ON CONFLICT (user_wallet, pool_address, chain_id, position_manager) DO UPDATE SET reason = EXCLUDED.reason, updated_at = now();
      CONTINUE;
    END IF;

    v_new_basis := 0;
    v_running_shares := 0;
    v_event_count := 0;
    FOR v_ev IN
      SELECT kind, quote_in, shares_minted, shares_burned
      FROM gateway_deposit_events
      WHERE address = v_address AND pool_address = v_pool AND chain_id = v_chain_id AND position_manager = v_pm_iter
      ORDER BY block_number NULLS FIRST, tx_index NULLS FIRST, created_at
    LOOP
      v_event_count := v_event_count + 1;
      IF v_ev.kind = 'deposit' THEN
        v_new_basis := v_new_basis + COALESCE(v_ev.quote_in, 0);
        v_running_shares := v_running_shares + COALESCE(v_ev.shares_minted, 0);
      ELSE
        IF v_running_shares < v_ev.shares_burned THEN
          IF v_pm_iter = v_pm THEN
            RAISE EXCEPTION 'apply_gateway_pm_attribution: % / % / % / % has a withdraw burning more shares (%) than minted so far (%) — history is still incomplete, refusing to guess', v_address, v_pool, v_chain_id, v_pm, v_ev.shares_burned, v_running_shares;
          END IF;
          v_event_count := 0; -- discard this sibling's partial replay — leave its position untouched
          EXIT;
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
      IF v_pm_iter = v_pm THEN
        RAISE EXCEPTION 'apply_gateway_pm_attribution: no events found for % / % / % / % — nothing to recompute', v_address, v_pool, v_chain_id, v_pm;
      END IF;
      -- An over-burn sibling (see above) or a genuinely eventless identity — leave its position untouched,
      -- but durably record WHY so a read for a different, genuinely-complete sibling still discloses it.
      INSERT INTO gateway_position_recompute_issues (user_wallet, pool_address, chain_id, position_manager, reason, updated_at)
      VALUES (v_address, v_pool, v_chain_id, v_pm_iter, 'over_burn', now())
      ON CONFLICT (user_wallet, pool_address, chain_id, position_manager) DO UPDATE SET reason = EXCLUDED.reason, updated_at = now();
      CONTINUE;
    END IF;

    INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav, updated_at)
    VALUES (v_address, v_pool, v_chain_id, v_pm_iter, v_running_shares, v_new_basis, now())
    ON CONFLICT (user_wallet, pool_address, chain_id, position_manager) DO UPDATE SET
      shares = EXCLUDED.shares, entry_nav = EXCLUDED.entry_nav, updated_at = now();

    -- This identity recomputed successfully — clear any previously-recorded issue for it (whatever was
    -- wrong before has now resolved, e.g. a later-recorded event closed the gap or corrected the history).
    DELETE FROM gateway_position_recompute_issues
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = v_chain_id AND position_manager = v_pm_iter;

    IF v_pm_iter = v_pm THEN
      v_target_basis := v_new_basis;
      v_target_shares := v_running_shares;
      v_target_events := v_event_count;
      v_target_found := true;
    END IF;
  END LOOP;

  IF NOT v_target_found THEN
    RAISE EXCEPTION 'apply_gateway_pm_attribution: no events found for the requested identity % / % / % / % after recompute', v_address, v_pool, v_chain_id, v_pm;
  END IF;

  RETURN QUERY SELECT v_updated, true, v_target_basis, v_target_shares, v_target_events, 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_gateway_pm_attribution(uuid, text, bigint, integer, numeric, numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION apply_gateway_pm_attribution(uuid, text, bigint, integer, numeric, numeric) IS
  'Atomically applies one orphaned gateway_deposit_events row''s resolved position_manager (from a verified on-chain receipt, see scripts/verify-gateway-pm-attribution.mjs) AND recomputes its identity''s gateway_positions row, in ONE transaction under the same advisory lock every gateway write path uses — closing the interrupted-apply gap where the two used to be separate round-trips. Refuses (raises) on a conflicting existing attribution or an incomplete event history; reports remaining_orphans > 0 rather than guessing when sibling rows for the same wallet/pool/chain are still unresolved. Service-role only.';
