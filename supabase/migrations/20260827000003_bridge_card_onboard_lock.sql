-- Bridge card onboarding — per-card single-flight lock (audit finding: runner has no lock).
--
-- runOnboarding re-reads state and writes effects across several awaits with no mutex; two concurrent
-- onboard calls for the same card could double-fire a step (harmless today thanks to per-effect
-- idempotency, but a latent trap once push-provisioning is wired into go_live). This adds an atomic
-- claim/release around the WHOLE run, mirroring begin_card_refill: begin_card_onboard claims a slot
-- under SELECT … FOR UPDATE with a TTL (so a crashed run can't wedge onboarding); the route wraps the
-- run in try/finally and releases with end_card_onboard.

ALTER TABLE org_cards ADD COLUMN IF NOT EXISTS onboard_in_progress_at timestamptz;

-- Returns true iff the caller claimed the onboarding slot. A slot older than p_ttl_secs is considered
-- stale and reclaimable (a prior run crashed mid-flight).
CREATE OR REPLACE FUNCTION begin_card_onboard(p_card_id uuid, p_ttl_secs int DEFAULT 300)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r org_cards%ROWTYPE;
BEGIN
  SELECT * INTO r FROM org_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF r.onboard_in_progress_at IS NOT NULL
     AND r.onboard_in_progress_at > now() - (p_ttl_secs * interval '1 second') THEN
    RETURN false; -- another run holds a fresh slot
  END IF;
  UPDATE org_cards SET onboard_in_progress_at = now() WHERE id = p_card_id;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION end_card_onboard(p_card_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE org_cards SET onboard_in_progress_at = NULL WHERE id = p_card_id;
END; $$;

COMMENT ON COLUMN org_cards.onboard_in_progress_at IS
  'In-flight Bridge onboarding claim (default 300s TTL); one onboarding run per card at a time.';
