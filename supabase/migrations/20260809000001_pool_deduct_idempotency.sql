-- ============================================================================
-- Token-pool deduction: atomic + idempotent per swap tx.
--
-- Audit MED: processTokenPool() called deduct_token_pool_reward() (an atomic
-- pool decrement) BEFORE the pending_rewards upsert-with-ignoreDuplicates guard.
-- Two concurrent requests for the same tx_hash both passed the pre-checks and
-- both decremented the pool, while only ONE reward row was written (unique index
-- campaign_id,tx_hash,reward_type) -> the pool was drained N× for a single
-- credited reward (a pool-drain vector).
--
-- Fix (mirrors credit_hold_points): fold a per-(campaign, tx) idempotency guard
-- into the SAME transaction as the pool decrement, so a concurrent/replay request
-- conflicts on the guard and returns WITHOUT decrementing the pool a second time.
-- The guard is the single source of truth for "this tx already drew from the
-- pool"; the pending_rewards unique index stays as belt-and-suspenders.
-- ============================================================================

-- One row per swap tx that successfully drew from a campaign's pool. The primary
-- key is the idempotency guard: a second deduction for the same (campaign, tx)
-- conflicts here.
CREATE TABLE IF NOT EXISTS token_pool_deductions (
  campaign_id text        NOT NULL,
  tx_hash     text        NOT NULL,
  amount_usd  numeric     NOT NULL CHECK (amount_usd >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, tx_hash)
);

COMMENT ON TABLE token_pool_deductions IS
  'Idempotency guard for token-pool deductions — one row per (campaign_id, tx_hash). '
  'Prevents concurrent/replay requests for the same swap from draining the pool twice.';

-- Atomic, idempotent deduction. Returns:
--   'ok'           — newly deducted (proceed to write reward rows)
--   'duplicate'    — this tx already drew from the pool (idempotent no-op)
--   'insufficient' — pool balance < required (guard rolled back, retry allowed)
--   'not_found'    — campaign missing / not a token_pool
CREATE OR REPLACE FUNCTION deduct_token_pool_reward_idempotent(
  p_campaign_id  text,
  p_tx_hash      text,
  p_required_usd numeric
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_remaining numeric;
BEGIN
  -- 1. Claim the idempotency guard. A concurrent/replay call for the same tx
  --    conflicts here and is rejected WITHOUT touching the pool.
  INSERT INTO token_pool_deductions (campaign_id, tx_hash, amount_usd)
    VALUES (p_campaign_id, p_tx_hash, p_required_usd)
    ON CONFLICT (campaign_id, tx_hash) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  -- 2. Lock the campaign row and verify/decrement the pool.
  SELECT pool_remaining_usd
    INTO v_remaining
    FROM campaigns
   WHERE id = p_campaign_id
     AND campaign_type = 'token_pool'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Not a valid token_pool campaign — release the guard so nothing is stranded.
    DELETE FROM token_pool_deductions
      WHERE campaign_id = p_campaign_id AND tx_hash = p_tx_hash;
    RETURN 'not_found';
  END IF;

  IF v_remaining < p_required_usd THEN
    -- Pool can't cover it — release the guard so a later (refilled) retry can proceed.
    DELETE FROM token_pool_deductions
      WHERE campaign_id = p_campaign_id AND tx_hash = p_tx_hash;
    RETURN 'insufficient';
  END IF;

  UPDATE campaigns
     SET pool_remaining_usd = pool_remaining_usd - p_required_usd
   WHERE id = p_campaign_id;

  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION deduct_token_pool_reward_idempotent(text, text, numeric) IS
  'Atomic + idempotent per-(campaign, tx) pool deduction. Supersedes the '
  'non-idempotent deduct_token_pool_reward() in the swap-reward hot path.';
