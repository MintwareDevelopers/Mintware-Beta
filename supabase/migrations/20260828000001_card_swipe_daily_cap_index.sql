-- Serves the cumulative daily-cap read in lib/org/cardAuthorize.ts#sumApprovedTodayAtomic:
--   WHERE org_id = ? AND member_wallet = ? AND decision = 'approved' AND created_at >= <UTC day start>
-- That read is on the latency-sensitive card-swipe (ASA) authorization path, so give it a covering
-- composite index. The existing (org_id, created_at DESC) index only ranges by org; this one lets the
-- planner seek straight to one member's rows for today. IF NOT EXISTS = safe to re-run.
CREATE INDEX IF NOT EXISTS card_swipe_events_member_day_idx
  ON card_swipe_events (org_id, member_wallet, created_at DESC);
