-- ============================================================================
-- Card spend buffer — FIX RE-AUDIT remediation (R1 belt, R3, R4).
--
-- R1 (belt-and-suspenders): the reversal webhook releases a hold when delivered, but a MISSED
--   reversal/void webhook would leak the reservation. reconcile_card_reservations releases holds for
--   buffer swipes that were approved but never settled past the card-network auth-hold window.
-- R3: begin_card_refill advances the rate window BEFORE the on-chain refill; a reverted/failed refill
--   must roll that back or the cap counts phantom refills and starves future ones. end_card_refill now
--   takes a refund amount (the window room to give back on non-success).
-- R4: the in-flight TTL (was 120s) is raised to 300s so a slow on-chain refill isn't double-submitted
--   after the slot times out mid-tx (the impact was bounded over-provision; this shrinks the window).
-- ============================================================================

-- R3+R4: replace end_card_refill (now refunds window room) and begin_card_refill (300s TTL).
CREATE OR REPLACE FUNCTION end_card_refill(p_org_card_id uuid, p_refund numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE card_spend_buffers
     SET refill_in_progress_at = NULL,
         refilled_in_window_atomic = GREATEST(0, refilled_in_window_atomic - GREATEST(0, p_refund)),
         updated_at = now()
   WHERE org_card_id = p_org_card_id;
END; $$;

CREATE OR REPLACE FUNCTION begin_card_refill(p_org_card_id uuid, p_amount numeric, p_now_secs bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r card_spend_buffers%ROWTYPE; v_start bigint; v_refilled numeric; v_room numeric; v_allowed numeric;
BEGIN
  SELECT * INTO r FROM card_spend_buffers WHERE org_card_id = p_org_card_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_buffer', 'allowed', '0'); END IF;
  IF r.breaker_open THEN RETURN jsonb_build_object('status', 'breaker', 'allowed', '0'); END IF;
  IF r.refill_in_progress_at IS NOT NULL AND r.refill_in_progress_at > now() - interval '300 seconds'
     THEN RETURN jsonb_build_object('status', 'in_flight', 'allowed', '0'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('status', 'nothing', 'allowed', '0'); END IF;

  IF r.refill_window_secs > 0 AND (p_now_secs - r.refill_window_start_secs) >= r.refill_window_secs THEN
    v_start := p_now_secs; v_refilled := 0;
  ELSE
    v_start := r.refill_window_start_secs; v_refilled := r.refilled_in_window_atomic;
  END IF;

  IF r.refill_rate_cap_atomic <= 0 THEN
    v_allowed := p_amount;
  ELSE
    v_room := r.refill_rate_cap_atomic - v_refilled;
    IF v_room <= 0 THEN
      UPDATE card_spend_buffers
         SET refill_window_start_secs = v_start, refilled_in_window_atomic = v_refilled, updated_at = now()
       WHERE org_card_id = p_org_card_id;
      RETURN jsonb_build_object('status', 'rate_capped', 'allowed', '0');
    END IF;
    v_allowed := LEAST(p_amount, v_room);
  END IF;

  UPDATE card_spend_buffers
     SET refill_window_start_secs = v_start,
         refilled_in_window_atomic = v_refilled + v_allowed,
         refill_in_progress_at = now(),
         updated_at = now()
   WHERE org_card_id = p_org_card_id;
  RETURN jsonb_build_object('status', 'ok', 'allowed', v_allowed::text);
END; $$;

-- R1 belt: release reservations for buffer swipes approved but never settled past the auth-hold window
-- (a missed reversal/void webhook). Returns the atomic amount released. Marks the stale swipes closed so
-- a later stray webhook is a no-op; if one somehow captures late, the balance sync reflects the real drop.
CREATE OR REPLACE FUNCTION reconcile_card_reservations(p_org_card_id uuid, p_stale_before timestamptz)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE v_stale numeric;
BEGIN
  SELECT COALESCE(SUM(amount_atomic_usdc), 0) INTO v_stale
    FROM card_swipe_events
   WHERE org_card_id = p_org_card_id AND provider = 'lithic' AND auth_mode = 'buffer'
     AND decision = 'approved' AND settled = false AND created_at < p_stale_before;
  IF v_stale > 0 THEN
    UPDATE card_spend_buffers
       SET reserved_atomic = GREATEST(0, reserved_atomic - v_stale), updated_at = now()
     WHERE org_card_id = p_org_card_id;
    UPDATE card_swipe_events
       SET settled = true, settled_at = now(), decline_reason = 'stale_auth_reconciled'
     WHERE org_card_id = p_org_card_id AND provider = 'lithic' AND auth_mode = 'buffer'
       AND decision = 'approved' AND settled = false AND created_at < p_stale_before;
  END IF;
  RETURN v_stale;
END; $$;
