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
-- event-order replay from 20260909000004 can also scope correctly per generation). Every deposit/withdraw
-- route already resolves `inst.positionManager` on-chain (H-01) before recording — VERIFIED, never a
-- client-supplied claim — so every NEW event recorded from here on is 100% correctly attributed at write
-- time. The only genuine ambiguity is PRE-EXISTING rows that predate this column existing.
--
-- REVISION (independent Codex audit, to-do items 3/4, 2026-09-10 — before this migration was ever
-- applied): the first version of this fix resolved that ambiguity by GUESSING — a migration-time
-- backfill that stamped every pre-existing position with whichever PM currently happens to be active for
-- its pool, plus a runtime "adopt-or-create" rule where the first write naming ANY real PM silently
-- absorbed a wallet's entire unclaimed legacy history into that PM's basis. Codex's review: this is not
-- a narrow best-effort default, it is actively WRONG whenever it matters — a wallet whose historical
-- shares genuinely sit in a RETIRED PM (a real, separate, still-withdrawable position) would have that
-- basis silently reassigned to a brand-new, unrelated deposit into the REPLACEMENT PM the moment it made
-- one, because nothing about "this wallet is depositing into PM_A right now" implies "PM_A is also the
-- rightful heir of this wallet's separate, older, ambiguous history."
--
-- Fixed design: NO guessing, anywhere, ever. Both RPCs now operate on an EXACT (wallet, pool, chain, PM)
-- match ONLY — never `OR position_manager IS NULL`, never a migration-time heuristic backfill, never a
-- runtime "adopt" step. A pre-existing row with position_manager IS NULL is left exactly as it was:
-- untouched, unmerged, invisible to any specific-PM query — its basis stays displayed as unrecorded
-- (`recorded: false`) rather than a guessed number, honoring "preserve explicit unknown/unresolved
-- accounting rather than displaying a guessed basis." On-chain shares are NEVER affected by any of this
-- (every real balance read is chain-first, sharesOf() regardless) — resolving it is a DISPLAY correctness
-- problem, not a fund-safety one, and is deliberately left to a dedicated, auditable process instead of
-- an inline guess: see scripts/verify-gateway-pm-attribution.mjs, which recovers the REAL position_manager
-- for an orphaned row from its own stored tx_hash's on-chain receipt (VERIFIED, not inferred) and offers a
-- reviewable dry-run before any live mutation — run it once real historical tx hashes exist to resolve.
--
-- Accepted residuals (independent Codex audit, live watch, 2026-09-09/10 — disclosed, not silently left):
--   * Orphaned pre-existing rows (position_manager IS NULL) are invisible to the per-PM read/write paths
--     until scripts/verify-gateway-pm-attribution.mjs resolves them from real on-chain data, or a row
--     whose original tx_hash can no longer be resolved (pruned node, chain reorg edge case) stays
--     unresolved indefinitely — an honest "we don't know" is the correct display for that case, not a
--     guess. This trades a temporary display gap (a real depositor's OLD position looking un-recorded in
--     the UI until resolved) for never showing a WRONG number — judged the safer default.
--   * Legacy fallback: an identity whose event history includes a pre-20260909000004 withdraw (missing
--     shares_burned, never persisted before that migration) or a pre-THIS-migration deposit (missing
--     shares_minted) can't be full-replayed from scratch — falls back to the single-delta behavior
--     (this call's own live-read shares) for that one call only, same shape as 20260909000004's own
--     documented residual, now extended to cover the deposit-side derived-shares data gap too.
--   * Concurrency — CLOSED (independent Codex audit, to-do item 2, 2026-09-10): both RPCs now take
--     `pg_advisory_xact_lock(hashtext(wallet||':'||pool), chain_id)` as their FIRST statement — every
--     call for the same (wallet, pool, chain) genuinely serializes, across BOTH deposit and withdraw and
--     across every generation, for the RPC's whole claim→replay→write sequence, auto-released at
--     transaction end. A second concurrent call BLOCKS until the first fully commits, then proceeds
--     against fresh, fully-committed state. Honest scope limit: this repo's PGlite-based SQL tests
--     (lib/gateway/costBasisRpc.pglite.test.ts) run against a single-process embedded Postgres and
--     cannot themselves exercise genuine multi-connection contention — they verify the SQL's
--     correctness, not concurrent-load safety under a real multi-connection Postgres, which this fix has
--     not been load-tested against.
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

-- NO backfill here — see the revision note above. Pre-existing rows simply keep position_manager NULL
-- until scripts/verify-gateway-pm-attribution.mjs resolves them from real on-chain receipt data; nothing
-- in this migration guesses on their behalf.

-- Identity now includes position_manager. Postgres treats NULL as distinct in a UNIQUE constraint (two
-- NULL-position_manager rows for the same wallet+pool+chain would NOT conflict) — by design: this table
-- may accumulate more than one still-unresolved orphaned row per identity over time (e.g. across
-- multiple historical generations that each predate position_manager tracking), and nothing here should
-- force them together — the verification script resolves each on its own on-chain evidence.
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
  v_has_legacy_gap boolean;
  v_pos_id uuid;
  v_running_shares numeric(78,0);
  v_ev record;
BEGIN
  -- Concurrency fix (independent Codex audit, to-do item 2, 2026-09-10): every prior version of this
  -- RPC read-then-wrote across several statements with no lock — two genuinely concurrent calls for the
  -- SAME identity (a deposit and a withdraw racing) could each read a state the other was about to
  -- invalidate, and "replay is idempotent and self-correcting on the next call" is true for a STALE READ
  -- on a later call, not for two writers racing inside the same uncommitted window.
  -- `pg_advisory_xact_lock` blocks until acquired and auto-releases at this transaction's end (commit or
  -- rollback) — a second concurrent call for the SAME (wallet, pool, chain) genuinely BLOCKS here until
  -- the first call's entire claim→replay→write sequence has committed, then proceeds against the now-
  -- fully-current state. `hashtext` is not cryptographic and can collide, but a collision only ever costs
  -- unrelated identities some avoidable serialization, never incorrectness — the standard accepted
  -- trade-off for advisory locks.
  PERFORM pg_advisory_xact_lock(hashtext(v_address || ':' || v_pool), p_chain_id);

  INSERT INTO gateway_deposit_events (tx_hash, address, kind, pool_address, chain_id, quote_in, block_number, position_manager, tx_index, shares_minted)
  VALUES (v_tx, v_address, 'deposit', v_pool, p_chain_id, p_quote_in, p_block_number, v_pm, p_tx_index, p_shares_minted)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  IF v_already THEN
    -- A replay: return the EXACT-PM row's current basis unchanged. Never matches a NULL-tagged orphaned
    -- row — see the header note (no silent cross-generation merging, anywhere, ever).
    SELECT entry_nav INTO v_new_basis FROM gateway_positions
      WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager = v_pm;
    RETURN QUERY SELECT COALESCE(v_new_basis, 0::numeric(78,0)), true;
    RETURN;
  END IF;

  -- EXACT match only (independent Codex audit, to-do items 3/4, 2026-09-10 — see the header's revision
  -- note): no adopt-or-create, no `OR position_manager IS NULL` fallback. A pre-existing orphaned row for
  -- this wallet+pool+chain is NEVER touched or merged here — only scripts/verify-gateway-pm-attribution.mjs
  -- resolves it, from real on-chain evidence.
  SELECT id INTO v_pos_id FROM gateway_positions
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager = v_pm;

  -- Data-completeness pre-check: a withdraw missing shares_burned (pre-20260909000004), or a deposit
  -- missing shares_minted (pre-THIS migration's same-block VALUE fix) can't feed a derived-shares
  -- replay — neither number was persisted before its respective migration existed. Scoped to THIS exact
  -- generation's own events only, same as the replay below.
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
    -- Single-delta fallback: this exact generation's OWN prior basis (0 if this is its first event, since
    -- there is no cross-generation inheritance any more), plus this deposit's own quoteIn.
    SELECT entry_nav INTO v_new_basis FROM gateway_positions
      WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager = v_pm;
    v_new_basis := COALESCE(v_new_basis, 0) + p_quote_in;
  END IF;

  IF v_pos_id IS NOT NULL THEN
    UPDATE gateway_positions SET
      shares = p_on_chain_shares, entry_nav = v_new_basis, updated_at = now()
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
  -- Concurrency fix (independent Codex audit, to-do item 2, 2026-09-10) — same lock as the deposit RPC
  -- (see its comment): serializes every call for this (wallet, pool, chain) across BOTH RPCs, since a
  -- deposit and a withdraw racing on the same identity is exactly the same hazard as two withdraws or
  -- two deposits racing.
  PERFORM pg_advisory_xact_lock(hashtext(v_address || ':' || v_pool), p_chain_id);

  INSERT INTO gateway_deposit_events (
    tx_hash, address, kind, pool_address, chain_id, quote_out, on_chain_shares, shares_burned, block_number, position_manager, tx_index
  )
  VALUES (v_tx, v_address, 'withdraw', v_pool, p_chain_id, p_quote_out, p_on_chain_shares, p_shares_burned, p_block_number, v_pm, p_tx_index)
  ON CONFLICT (tx_hash) DO NOTHING
  RETURNING id INTO v_inserted_id;
  v_already := v_inserted_id IS NULL;

  -- EXACT match only — see the deposit RPC's identical comment (no adopt-or-create, no NULL fallback).
  SELECT id, entry_nav INTO v_pos_id, v_prior_basis FROM gateway_positions
    WHERE user_wallet = v_address AND pool_address = v_pool AND chain_id = p_chain_id AND position_manager = v_pm;

  IF v_pos_id IS NULL THEN
    -- No matching position row for THIS exact generation ⇒ this depositor's deposit into it was never
    -- recorded (a legacy/O-1 case, OR its history sits in a still-unresolved orphaned row this PM has no
    -- claim to) — deliberately NOT synthesizing one (would fabricate a fictitious "gain" equal to the
    -- whole position, or wrongly attach to a different generation's history).
    RETURN QUERY SELECT NULL::numeric(78,0), v_already, false;
    RETURN;
  END IF;
  v_found := true;
  v_prior_basis := COALESCE(v_prior_basis, 0);

  IF v_already THEN
    RETURN QUERY SELECT v_prior_basis, true, true;
    RETURN;
  END IF;

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

  UPDATE gateway_positions SET shares = p_on_chain_shares, entry_nav = v_new_basis, updated_at = now()
    WHERE id = v_pos_id;

  RETURN QUERY SELECT v_new_basis, false, v_found;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric, bigint, text, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric, bigint, text, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION record_gateway_deposit_event(text, text, text, integer, numeric, numeric, bigint, text, integer, numeric) IS
  'Atomic deposit-event idempotency claim + derived-shares full-history replay, EXACT (wallet,pool,chain,PM) match only — never a cross-generation guess (round-4 pass-2 manager-generation + same-block-value fixes; to-do items 2-4 concurrency/attribution fixes). Service-role only, called from POST /api/gateway/deposit.';
COMMENT ON FUNCTION record_gateway_withdraw_event(text, text, text, integer, numeric, numeric, numeric, bigint, text, integer) IS
  'Atomic withdraw-event idempotency claim + derived-shares full-history replay, EXACT (wallet,pool,chain,PM) match only — never a cross-generation guess (round-4 pass-2 manager-generation + same-block-value fixes; to-do items 2-4 concurrency/attribution fixes). Service-role only, called from POST /api/gateway/withdraw.';
