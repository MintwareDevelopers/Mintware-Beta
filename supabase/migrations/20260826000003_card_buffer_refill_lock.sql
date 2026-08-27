-- ============================================================================
-- Card spend buffer — AUDIT FIX M1 (refill double-execution + refill-rate-breaker bypass).
--
-- The reactive capture-webhook and the steady-state cron could both call refillCardBuffer for one
-- deficit; the off-chain refill-rate window was a lock-free read-modify-write (checkRefillRate then a
-- separate UPDATE), so two refills could each pass the breaker and mint DISTINCT on-chain refillIds
-- (the contract's refillDone only dedupes the SAME id), redeeming N× the deficit and defeating the cap.
--
-- Fix: an ATOMIC begin/end around each refill. begin_card_refill (SELECT … FOR UPDATE) rolls the rate
-- window, enforces the manual breaker + rate cap, claims an in-flight slot (with a 120s TTL so a crash
-- can't wedge it), and advances the window — all in one locked statement. end_card_refill releases the
-- slot. Two concurrent refills serialize: the first claims the slot + window room, the second sees
-- 'in_flight' / reduced room. The window accounting can no longer be raced.
-- ============================================================================

ALTER TABLE card_spend_buffers ADD COLUMN IF NOT EXISTS refill_in_progress_at timestamptz;

-- Returns {"status": "...", "allowed": "<atomic>"}. status: ok | no_buffer | breaker | in_flight |
-- rate_capped | nothing. On 'ok' the in-flight slot is claimed and the window advanced by `allowed`.
CREATE OR REPLACE FUNCTION begin_card_refill(p_org_card_id uuid, p_amount numeric, p_now_secs bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r card_spend_buffers%ROWTYPE; v_start bigint; v_refilled numeric; v_room numeric; v_allowed numeric;
BEGIN
  SELECT * INTO r FROM card_spend_buffers WHERE org_card_id = p_org_card_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_buffer', 'allowed', '0'); END IF;
  IF r.breaker_open THEN RETURN jsonb_build_object('status', 'breaker', 'allowed', '0'); END IF;
  IF r.refill_in_progress_at IS NOT NULL AND r.refill_in_progress_at > now() - interval '120 seconds'
     THEN RETURN jsonb_build_object('status', 'in_flight', 'allowed', '0'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('status', 'nothing', 'allowed', '0'); END IF;

  -- roll the rolling window
  IF r.refill_window_secs > 0 AND (p_now_secs - r.refill_window_start_secs) >= r.refill_window_secs THEN
    v_start := p_now_secs; v_refilled := 0;
  ELSE
    v_start := r.refill_window_start_secs; v_refilled := r.refilled_in_window_atomic;
  END IF;

  -- rate cap (0 = unlimited)
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

  -- claim the in-flight slot + advance the window atomically
  UPDATE card_spend_buffers
     SET refill_window_start_secs = v_start,
         refilled_in_window_atomic = v_refilled + v_allowed,
         refill_in_progress_at = now(),
         updated_at = now()
   WHERE org_card_id = p_org_card_id;
  RETURN jsonb_build_object('status', 'ok', 'allowed', v_allowed::text);
END; $$;

CREATE OR REPLACE FUNCTION end_card_refill(p_org_card_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE card_spend_buffers SET refill_in_progress_at = NULL, updated_at = now() WHERE org_card_id = p_org_card_id;
END; $$;

COMMENT ON COLUMN card_spend_buffers.refill_in_progress_at IS 'In-flight refill claim (120s TTL); one refill per card at a time. Audit fix M1.';
