-- Cost-basis manager-generation fix (independent Codex audit, round-4 pass-2, 2026-09-09 — flagged
-- alongside event-order accounting; documented as an accepted, narrow residual in routeInstance.ts's
-- header comment, now actually closed).
--
-- gateway_positions was keyed by (user_wallet, pool_address, chain_id) — NOT position_manager. Since
-- migration 20260909000002 (Finding D) let a pool outlive more than one PositionManager (an operator
-- migrating to a new PM, the OLD one staying registered but retired), a wallet that deposited into BOTH
-- a retired PM and its replacement, for the SAME pool, has its cost basis co-mingled across the two
-- generations in ONE row — reading/writing the wrong generation's basis on both the write path
-- (record_gateway_deposit_event/record_gateway_withdraw_event) and the read path
-- (app/api/gateway/{position,positions}/route.ts, which already carry `?pm=`/`positionManager` per
-- instance for this exact reason, but never actually filtered the DB row by it). On-chain shares/values
-- were never affected — this is purely the displayed cost-basis/PnL number.
--
-- Fix: add `position_manager` to the identity of gateway_positions (and gateway_deposit_events, so the
-- event-order replay from 20260909000004 can also scope correctly per generation). Existing rows are
-- backfilled best-effort from the registry (prefer the pool's currently-ACTIVE instance; else its most
-- recent row of any status — covers every pool that has EVER had a registered instance). A position
-- whose pool has NO registry row at all (a pre-registry bootstrap deposit against the single-env
-- fallback) is left with position_manager = NULL — genuinely unknowable, not guessable — and is handled
-- as a "legacy, unclaimed" row by the RPCs below: the FIRST write for that identity that names a real PM
-- ADOPTS the legacy row (sets its position_manager, continuing that basis) rather than starting a
-- confusing duplicate; this is standard behavior going forward, not a special case that fades away.
--
-- Accepted residuals (independent Codex audit, live watch, 2026-09-09 — disclosed, not silently left;
-- wording tightened after Codex flagged the original phrasing as overclaiming certainty it hadn't earned):
--   * Historical PM attribution: the registry backfill picks ONE guess per pool (prefers the currently-
--     active instance, else the most recent row of any status) and applies it to EVERY pre-migration
--     position for that pool. For a pool that has ALREADY been through a PM migration by the time this
--     runs, that guess can be wrong for MANY positions, not just a rare edge case — a depositor whose
--     shares actually went to the OLD (now-retired) PM gets backfilled to the NEW one instead, because
--     nothing in the pre-migration data ever recorded which PM a given position's deposits went to. This
--     is a best-effort default, not a claim of correct attribution for every already-migrated pool.
--   * Legacy fallback: an identity whose event history includes a pre-20260909000004 withdraw (missing
--     shares_burned, never persisted before that migration) or a pre-THIS-migration deposit (missing
--     shares_minted) can't be full-replayed from scratch — falls back to the single-delta behavior
--     (this call's own live-read shares) for that one call only, same shape as 20260909000004's own
--     documented residual, now extended to cover the deposit-side derived-shares data gap too.
--   * Concurrency: neither RPC takes an explicit row lock (no `FOR UPDATE`) on the adopt-or-create
--     SELECT — matching every other gateway RPC in this codebase, none of which do either. A replay-based
--     design recomputes fresh from stored events every call, which corrects a STALE READ on the next
--     call that reads a fully-committed event set — it does NOT protect against two writers racing
--     within the same uncommitted window, and does not guarantee any particular number of calls before
--     convergence under sustained concurrent writes. The narrowest known instance: two truly concurrent
--     FIRST writes for two DIFFERENT brand-new generations of the same wallet+pool+chain, racing to adopt
--     the same unclaimed legacy row — judged too narrow (requires two simultaneous first-ever deposits
--     into two different PM generations) to justify explicit locking that nothing else in this RPC
--     family uses, but genuinely not proven safe under all concurrent interleavings, either.
--   * Same-block VALUE correctness — CLOSED (independent Codex audit, live watch, 2026-09-09, same day,
--     before this migration was ever applied): tx_index correctly ORDERS two same-block events, but
--     `on_chain_shares` used to be READ per event via `sharesOf(user, blockNumber: receipt.blockNumber)`,
--     which returns the BLOCK-END balance (after every tx in that block) — wrong for an earlier of two
--     same-block transactions by the SAME user, even once correctly ordered (predates every change in
--     this file; already documented in withdraw/route.ts's own "two of the SAME user's own transactions
--     landing in the exact same block" comment). Fix: stop reading shares from chain per event at all.
--     Every Deposited/Withdrawn event already reports its own `sharesMinted`/`sharesBurned` — values
--     genuinely local to THAT transaction, never ambiguous. The replay now derives a RUNNING share total
--     purely from those numbers (mirrors lib/gateway/basisMath.ts#replayCostBasis) — structurally immune
--     to same-block, cross-block, AND call-arrival-order ambiguity alike, since it never depends on
--     anything but each event's own on-chain-reported numbers and their real chain order.

ALTER TABLE gateway_positions ADD COLUMN IF NOT EXISTS position_manager text;
ALTER TABLE gateway_deposit_events ADD COLUMN IF NOT EXISTS position_manager text;
-- Same-block ordering fix (independent Codex audit, live watch, 2026-09-09, same day this migration was
-- written — caught before it was ever applied). The replay's sort key was `block_number, created_at` —
-- `created_at` is when the RECORDING CALL happened to run, not the transactions' real on-chain order, so
-- two DIFFERENT transactions for the same identity landing in the SAME block (rare on a ~12s-block chain,
-- but not impossible) could still replay in the WRONG order — reintroducing, for that narrow case, the
-- exact call-arrival-order problem 20260909000004 exists to eliminate. `tx_index` (the receipt's own
-- `transactionIndex` — its real position within the block, on-chain truth, never a recording artifact)
-- is the correct tiebreak; `created_at` remains the final fallback only for a row that predates this.
ALTER TABLE gateway_deposit_events ADD COLUMN IF NOT EXISTS tx_index integer;
-- Same-block VALUE fix (see the accepted-residuals note above, now closed): `shares_minted` (deposit-only,
-- from the Deposited event's own `sharesMinted`) lets the replay derive a running share total purely
-- from each event's own on-chain-reported numbers, instead of any block-level `sharesOf` read.
ALTER TABLE gateway_deposit_events ADD COLUMN IF NOT EXISTS shares_minted numeric(78,0);

-- Backfill: prefer the pool's ACTIVE instance; else its most-recently-touched row of any status. Only
-- fills rows that don't already have one (idempotent / safe to re-run).
UPDATE gateway_positions p SET position_manager = sub.position_manager
FROM (
  SELECT DISTINCT ON (pool_address, chain_id) pool_address, chain_id, position_manager
  FROM gateway_instances
  ORDER BY pool_address, chain_id, (status = 'active') DESC, updated_at DESC NULLS LAST, created_at DESC
) sub
WHERE p.pool_address = sub.pool_address AND p.chain_id = sub.chain_id AND p.position_manager IS NULL;

UPDATE gateway_deposit_events e SET position_manager = p.position_manager
FROM gateway_positions p
WHERE e.address = p.user_wallet AND e.pool_address = p.pool_address AND e.chain_id = p.chain_id
  AND e.position_manager IS NULL AND p.position_manager IS NOT NULL;

-- Identity now includes position_manager. Postgres treats NULL as distinct in a UNIQUE constraint (two
-- NULL-position_manager rows for the same wallet+pool+chain would NOT conflict) — by design: a
-- genuinely-unbackfillable legacy row must never silently merge with another legacy row that happens to
-- share its wallet+pool+chain (there should only ever be at most one per identity in practice, but this
-- constraint intentionally does not enforce that for the NULL case — the RPCs below do, via their
-- explicit "adopt-or-create" lookup rather than relying on ON CONFLICT for the NULL path).
ALTER TABLE gateway_positions DROP CONSTRAINT IF EXISTS gateway_positions_user_wallet_pool_address_chain_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS gateway_positions_identity_uidx
  ON gateway_positions (user_wallet, pool_address, chain_id, position_manager);

-- These target migration 20260909000004's ACTUAL deployed signatures (7 / 8 args respectively) — NOT
-- this migration's own signature, which has been revised several times in this same session (adding
-- position_manager, then tx_index, then shares_minted) before ever being applied. Every one of those
-- revisions is still just the ONE eventual CREATE below; only _004's real, already-deployed function
-- needs dropping first (a different arg count is a DIFFERENT Postgres function, so CREATE OR REPLACE
-- alone would otherwise leave _004's signature registered as a stale, separately-callable overload).
DROP FUNCTION IF EXISTS record_gateway_deposit_event(text, text, text, integer, numeric, numeric, bigint);
DROP FUNCTION IF EXISTS record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric, bigint);

CREATE OR REPLACE FUNCTION record_gateway_deposit_event(
  p_tx_hash text,
  p_address text,
  p_pool_address text,
  p_chain_id integer,
  p_quote_in numeric,
  p_on_chain_shares numeric,
  p_block_number bigint DEFAULT NULL,
  p_position_manager text DEFAULT NULL,
  p_tx_index integer DEFAULT NULL,
  p_shares_minted numeric DEFAULT NULL
) RETURNS TABLE(cost_basis_atomic numeric, already_recorded boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx text := lower(p_tx_hash);
  v_address text := lower(p_address);
  v_pool text := lower(p_pool_address);
  v_pm text := lower(p_position_manager);
  v_inserted_id uuid;
  v_already boolean;
  v_new_basis numeric(78,0) := 0;
  v_prior_basis numeric(78,0) := 0;
  v_has_legacy_gap boolean;
  v_pos_id uuid;
  v_running_shares numeric(78,0);
  v_ev record;
BEGIN
  INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, block_number, position_manager, tx_index, shares_minted)
  VALUES (v_tx, v_address, 'deposit', v_pool, p_chain_id, p_quote_in, p_block_number, v_pm, p_tx_index, p_shares_minted)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  IF v_already THEN
    -- A replay: find whichever row this identity's earlier (successful) write landed on — an exact-PM
    -- match if one exists, else a not-yet-adopted legacy (NULL-PM) row — and return its basis unchanged.
    SELECT entry_nav INTO v_new_basis FROM gateway_positions
      WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id
        AND (position_manager = v_pm OR position_manager IS NULL)
      ORDER BY (position_manager = v_pm) DESC LIMIT 1;
    RETURN QUERY SELECT COALESCE(v_new_basis, 0::numeric(78,0)), true;
    RETURN;
  END IF;

  -- Adopt-or-create: an EXACT (wallet, pool, chain, PM) match continues on it; else a legacy row for
  -- this identity with NO position_manager yet (pre-migration, or a first deposit recorded before this
  -- migration's backfill ran) is ADOPTED — claimed for this PM going forward — rather than starting a
  -- confusing second row; else this is genuinely this identity's first-ever deposit.
  SELECT id, entry_nav INTO v_pos_id, v_prior_basis FROM gateway_positions
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      AND (position_manager = v_pm OR position_manager IS NULL)
    ORDER BY (position_manager = v_pm) DESC LIMIT 1;
  v_prior_basis := COALESCE(v_prior_basis, 0);

  -- CAUGHT ON REVIEW (2026-09-09, Codex live watch, same day, before this migration was ever applied):
  -- the adopt-or-create SELECT above found the right POSITION row, but the underlying
  -- gateway_deposit_events rows for the ambiguous pre-migration history were left tagged
  -- position_manager = NULL — meaning a LATER, genuinely different generation's replay (which ALSO
  -- matches "OR position_manager IS NULL") would find those same legacy events again and double-count
  -- them into a second generation's basis (reproduced: "PM-B basis 110 instead of 10" when PM-A had
  -- already legitimately absorbed a 10-unit legacy history). Fix: claim the legacy events for THIS PM
  -- right now, unconditionally — a no-op if none are left unclaimed (already claimed by an earlier write,
  -- or there never were any), and otherwise permanently removes them from being matchable by any OTHER
  -- generation's future query. The ambiguous pre-migration history is a one-time, first-writer-wins
  -- resource, not a shared one.
  UPDATE gateway_deposit_events SET position_manager = v_pm
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager IS NULL;

  -- Data-completeness pre-check: a withdraw missing shares_burned (pre-20260909000004), or a deposit
  -- missing shares_minted (pre-THIS migration's same-block VALUE fix) can't feed a derived-shares
  -- replay — neither number was persisted before its respective migration existed.
  SELECT EXISTS(
    SELECT 1 FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      AND position_manager = v_pm
      AND ((kind = 'withdraw' AND shares_burned IS NULL) OR (kind = 'deposit' AND shares_minted IS NULL))
      AND id <> v_inserted_id
  ) INTO v_has_legacy_gap;

  IF NOT v_has_legacy_gap THEN
    -- Same-block VALUE fix (independent Codex audit, live watch, 2026-09-09): shares are DERIVED from
    -- each event's own sharesMinted/sharesBurned, never read from chain — immune to same-block/
    -- cross-block/call-order ambiguity alike. Mirrors lib/gateway/basisMath.ts#replayCostBasis exactly.
    v_new_basis := 0;
    v_running_shares := 0;
    FOR v_ev IN
      SELECT kind, quote_in, shares_minted, shares_burned
      FROM gateway_deposit_events
      WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
        AND position_manager = v_pm
      ORDER BY block_number NULLS FIRST, tx_index NULLS FIRST, created_at
    LOOP
      IF v_ev.kind = 'deposit' THEN
        v_new_basis := v_new_basis + COALESCE(v_ev.quote_in, 0);
        v_running_shares := v_running_shares + COALESCE(v_ev.shares_minted, 0);
      ELSE
        -- A withdraw burning more than minted so far is a data-completeness gap discovered mid-replay
        -- (e.g. an earlier deposit whose OWN recording call never landed) — abandon the full replay and
        -- fall back below, exactly like a pre-existing gap the upfront check already catches.
        IF v_running_shares < v_ev.shares_burned THEN
          v_has_legacy_gap := true;
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
  END IF;

  IF v_has_legacy_gap THEN
    v_new_basis := v_prior_basis + p_quote_in;
  END IF;

  IF v_pos_id IS NOT NULL THEN
    UPDATE gateway_positions SET
      shares = p_on_chain_shares, entry_nav = v_new_basis, position_manager = v_pm, updated_at = now()
      WHERE id = v_pos_id;
  ELSE
    INSERT INTO gateway_positions (user_wallet, pool_address, chain_id, position_manager, shares, entry_nav, updated_at)
    VALUES (v_address, v_pool, p_chain_id, v_pm, p_on_chain_shares, v_new_basis, now());
  END IF;

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
  p_block_number bigint DEFAULT NULL,
  p_position_manager text DEFAULT NULL,
  p_tx_index integer DEFAULT NULL
) RETURNS TABLE(cost_basis_atomic numeric, already_recorded boolean, position_found boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx text := lower(p_tx_hash);
  v_address text := lower(p_address);
  v_pool text := lower(p_pool_address);
  v_pm text := lower(p_position_manager);
  v_inserted_id uuid;
  v_already boolean;
  v_new_basis numeric(78,0) := 0;
  v_prior_basis numeric(78,0) := 0;
  v_has_legacy_gap boolean;
  v_pos_id uuid;
  v_found boolean;
  v_running_shares numeric(78,0);
  v_ev record;
BEGIN
  INSERT INTO gateway_deposit_events (
    tx_hash, address, kind, pool_address, chain_id, quote_out, on_chain_shares, shares_burned, block_number, position_manager, tx_index
  )
  VALUES (v_tx, v_address, 'withdraw', v_pool, p_chain_id, p_quote_out, p_on_chain_shares, p_shares_burned, p_block_number, v_pm, p_tx_index)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  -- Same adopt-or-create lookup as the deposit RPC (see its comment).
  SELECT id, entry_nav INTO v_pos_id, v_prior_basis FROM gateway_positions
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      AND (position_manager = v_pm OR position_manager IS NULL)
    ORDER BY (position_manager = v_pm) DESC LIMIT 1;

  IF v_pos_id IS NULL THEN
    -- No matching position row at all ⇒ this depositor's original deposit was never recorded (a
    -- legacy/O-1 case) — deliberately NOT synthesizing one (would fabricate a fictitious "gain" equal
    -- to the whole position); matches the prior route behavior exactly.
    RETURN QUERY SELECT NULL::numeric(78,0), v_already, false;
    RETURN;
  END IF;
  v_found := true;
  v_prior_basis := COALESCE(v_prior_basis, 0);

  IF v_already THEN
    RETURN QUERY SELECT v_prior_basis, true, true;
    RETURN;
  END IF;

  -- Same claim-the-legacy-events fix as the deposit RPC (see its comment) — otherwise a later, genuinely
  -- different generation's replay would double-count this identity's ambiguous pre-migration history.
  UPDATE gateway_deposit_events SET position_manager = v_pm
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager IS NULL;

  -- Data-completeness pre-check: same as the deposit RPC (see its comment) — a withdraw missing
  -- shares_burned (pre-20260909000004), or a deposit missing shares_minted (pre-THIS migration's
  -- same-block VALUE fix), can't feed a derived-shares replay.
  SELECT EXISTS(
    SELECT 1 FROM gateway_deposit_events
    WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
      AND position_manager = v_pm
      AND ((kind = 'withdraw' AND shares_burned IS NULL) OR (kind = 'deposit' AND shares_minted IS NULL))
      AND id <> v_inserted_id
  ) INTO v_has_legacy_gap;

  IF NOT v_has_legacy_gap THEN
    -- Same-block VALUE fix (independent Codex audit, live watch, 2026-09-09) — derived running shares,
    -- never a chain read. Mirrors lib/gateway/basisMath.ts#replayCostBasis exactly (see the deposit RPC).
    v_new_basis := 0;
    v_running_shares := 0;
    FOR v_ev IN
      SELECT kind, quote_in, shares_minted, shares_burned
      FROM gateway_deposit_events
      WHERE address = v_address AND pool_address = v_pool AND chain_id = p_chain_id
        AND position_manager = v_pm
      ORDER BY block_number NULLS FIRST, tx_index NULLS FIRST, created_at
    LOOP
      IF v_ev.kind = 'deposit' THEN
        v_new_basis := v_new_basis + COALESCE(v_ev.quote_in, 0);
        v_running_shares := v_running_shares + COALESCE(v_ev.shares_minted, 0);
      ELSE
        -- Discovered mid-replay (not caught by the upfront check) — abandon and fall back below.
        IF v_running_shares < v_ev.shares_burned THEN
          v_has_legacy_gap := true;
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
  END IF;

  IF v_has_legacy_gap THEN
    IF p_on_chain_shares = 0 OR (p_on_chain_shares + p_shares_burned) = 0 THEN
      v_new_basis := 0;
    ELSE
      v_new_basis := (v_prior_basis * p_on_chain_shares) / (p_on_chain_shares + p_shares_burned);
    END IF;
  END IF;

  UPDATE gateway_positions SET shares = p_on_chain_shares, entry_nav = v_new_basis, position_manager = v_pm, updated_at = now()
    WHERE id = v_pos_id;

  RETURN QUERY SELECT v_new_basis, false, v_found;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric, bigint, text, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric, bigint, text, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric, bigint, text, integer, numeric) IS
  'Atomic deposit-event idempotency claim + derived-shares full-history replay + PM-generation-scoped adopt-or-create (round-4 pass-2 manager-generation + same-block-value fixes). Service-role only, called from POST /api/gateway/deposit.';
COMMENT ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric, bigint, text, integer) IS
  'Atomic withdraw-event idempotency claim + derived-shares full-history replay + PM-generation-scoped adopt-or-create (round-4 pass-2 manager-generation + same-block-value fixes). Service-role only, called from POST /api/gateway/withdraw.';
