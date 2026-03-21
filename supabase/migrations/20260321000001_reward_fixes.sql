-- =============================================================================
-- Migration: Reward flow fixes
-- 1. increment_participant_points() — atomic per-wallet points increment
--    Replaces the non-atomic read-modify-write in swapHook.ts and bridgeVerifier.ts
-- =============================================================================

-- ---------------------------------------------------------------------------
-- increment_participant_points(campaign_id, wallet, delta)
--
-- Atomically increments total_points for a specific wallet in a campaign.
-- Uses SET total_points = total_points + delta (no read-modify-write in app code).
-- Also updates last_active_at and updated_at.
-- Safe to call concurrently — no race condition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_participant_points(
  p_campaign_id text,
  p_wallet      text,
  p_delta       numeric
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE participants
     SET total_points   = total_points + p_delta,
         last_active_at = now(),
         updated_at     = now()
   WHERE campaign_id = p_campaign_id
     AND wallet      = p_wallet;
END;
$$;
