-- ============================================================================
-- Card spend buffer — AUDIT FIXES C1 (over-authorization) + H2 (auth/capture mode divergence).
--
-- C1: the flat ASA check read buffer_balance_atomic but never DEBITED it, so N swipes each ≤ the
--     (unchanging) cached balance all approved against one reserve — an over-spend the reserve exists
--     to prevent. Fix: a real reservation ledger. `reserved_atomic` holds authorized-but-uncaptured
--     amounts; available = buffer_balance_atomic − reserved_atomic. `reserve_card_buffer` performs the
--     check-and-hold ATOMICALLY (SELECT … FOR UPDATE), so concurrent/sequential auths can't both pass.
--     A separate column (not decrementing the balance) is required because the monitor overwrites
--     buffer_balance_atomic from the authoritative on-chain balance — reserved must survive that sync.
--
-- H2: capture chose the buffer-vs-vault settle path from whether a buffer row exists NOW, so creating a
--     buffer after an edge-auth swipe made capture skip settleSpend (dropping the obligation). Fix:
--     record HOW each swipe was authorized (`auth_mode`) and let capture honor that, not current state.
-- ============================================================================

ALTER TABLE card_spend_buffers ADD COLUMN IF NOT EXISTS reserved_atomic numeric(78,0) NOT NULL DEFAULT 0;

-- 'buffer' = approved by the flat buffer reservation; 'edge' = approved by the edge-auth NAV hold.
-- NULL = pre-fix / legacy rows (capture falls through to the vault settle path, unchanged).
ALTER TABLE card_swipe_events ADD COLUMN IF NOT EXISTS auth_mode text
  CHECK (auth_mode IS NULL OR auth_mode IN ('buffer', 'edge'));

-- Atomic check-and-hold. Returns 'ok' | 'insufficient' | 'over_cap' | 'no_buffer'. Runs service-role
-- (RLS deny-all is bypassed). The row lock serializes concurrent authorizations for one card.
CREATE OR REPLACE FUNCTION reserve_card_buffer(p_org_card_id uuid, p_amount numeric)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r card_spend_buffers%ROWTYPE;
BEGIN
  SELECT * INTO r FROM card_spend_buffers WHERE org_card_id = p_org_card_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_buffer'; END IF;
  IF p_amount <= 0 THEN RETURN 'insufficient'; END IF;
  IF r.per_tx_cap_atomic > 0 AND p_amount > r.per_tx_cap_atomic THEN RETURN 'over_cap'; END IF;
  IF (r.buffer_balance_atomic - r.reserved_atomic) < p_amount THEN RETURN 'insufficient'; END IF;
  UPDATE card_spend_buffers
     SET reserved_atomic = reserved_atomic + p_amount, updated_at = now()
   WHERE org_card_id = p_org_card_id;
  RETURN 'ok';
END; $$;

-- Release a hold: on capture (the spend realized — the on-chain balance drops via the monitor) or on a
-- reversal/expiry (the auth never captured). Floored at 0. Idempotency is the caller's responsibility
-- (settle only fires once per swipe via the `settled` guard).
CREATE OR REPLACE FUNCTION release_card_buffer(p_org_card_id uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE card_spend_buffers
     SET reserved_atomic = GREATEST(0, reserved_atomic - p_amount), updated_at = now()
   WHERE org_card_id = p_org_card_id;
END; $$;

COMMENT ON COLUMN card_spend_buffers.reserved_atomic IS 'Authorized-but-uncaptured holds; available = buffer_balance_atomic - reserved_atomic. Audit fix C1.';
COMMENT ON COLUMN card_swipe_events.auth_mode IS 'How the swipe was authorized: buffer (flat reservation) | edge (NAV hold). Capture honors this, not current state. Audit fix H2.';
