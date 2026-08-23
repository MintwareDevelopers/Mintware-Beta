-- ============================================================================
-- Card swipe events + standing spend permits — completes the showcase loop
-- (issue -> activate -> swipe -> authorize -> settle) on top of the org_cards
-- table from 20260819000004.
--
-- `card_swipe_events` is the audit trail the ASA webhook writes on EVERY decision
-- (approved or declined) — it's what a real spend feed reads, and what the settle
-- route looks up to know an event is real, approved, and not already settled.
-- Nothing here is a source of truth for money movement; `settle_tx` is filled in
-- only after a real settleSpend() call succeeds on-chain (see
-- app/api/orgs/[id]/cards/settle/route.ts) — this table records the fact, it
-- doesn't cause it.
--
-- The permit columns on org_cards hold a member's OWN standing EIP-712
-- DelegatedSpendPermit signature (see MintwarePaymentGateway.settleSpend) — set
-- once when the member "activates" their card by signing with their own wallet
-- (only they can produce a valid signature for their own `user` field; the org
-- owner issuing the card cannot sign on the member's behalf). Reused across many
-- settleSpend calls until `permit_deadline` passes.
-- ============================================================================

ALTER TABLE org_cards
  ADD COLUMN IF NOT EXISTS permit_max_daily_usdc text,   -- atomic 6dp, as signed (DelegatedSpendPermit.maxDailySpendUSDC)
  ADD COLUMN IF NOT EXISTS permit_nonce           text,  -- atomic uint256, as signed
  ADD COLUMN IF NOT EXISTS permit_deadline        text,  -- unix seconds, as signed
  ADD COLUMN IF NOT EXISTS permit_signature       text,  -- 65-byte EIP-712 sig, 0x-hex
  ADD COLUMN IF NOT EXISTS activated_at           timestamptz,
  -- SANDBOX ONLY: Lithic's simulateAuthorization() needs the card's raw PAN, not its token — there is
  -- no "simulate by token" variant. A real (non-sandbox) PAN would need proper tokenization/vaulting
  -- before ever touching a DB column; a Lithic SANDBOX PAN is a synthetic test number with no
  -- real-world payment value, so storing it here (behind the same deny-all RLS as everything else in
  -- this table) is an acceptable simplification for the demo loop, not a pattern to carry to prod.
  ADD COLUMN IF NOT EXISTS sandbox_pan            text;

CREATE TABLE IF NOT EXISTS card_swipe_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  org_card_id         uuid        NOT NULL REFERENCES org_cards(id) ON DELETE CASCADE,
  member_wallet       text        NOT NULL,
  provider            text        NOT NULL DEFAULT 'lithic',
  provider_event_ref  text        NOT NULL,                        -- Lithic ASA event `token` — idempotency key
  amount_atomic_usdc  text        NOT NULL,                        -- 6dp, as decided
  merchant_descriptor text,
  decision            text        NOT NULL CHECK (decision IN ('approved', 'declined')),
  decline_reason      text,                                        -- one of decideCardSwipe's reason strings
  edge_hold_id        text,                                        -- edge-auth hold id, when approved
  latency_ms          integer,
  settled             boolean     NOT NULL DEFAULT false,
  settle_tx           text,
  settled_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotent on (provider, provider_event_ref) — Lithic may retry a webhook delivery; a retry must
-- resolve to the same row, never a duplicate feed entry or a second settle attempt.
CREATE UNIQUE INDEX IF NOT EXISTS card_swipe_events_provider_ref_idx ON card_swipe_events (provider, provider_event_ref);
CREATE INDEX IF NOT EXISTS card_swipe_events_org_created_idx ON card_swipe_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS card_swipe_events_settle_candidates_idx ON card_swipe_events (org_id, decision, settled);

ALTER TABLE card_swipe_events ENABLE ROW LEVEL SECURITY; -- deny-all, service-role only (see 20260819000004 header)

COMMENT ON TABLE card_swipe_events IS 'Audit trail of every card-swipe authorize decision (approved/declined) + settlement status. Written only by the ASA webhook + settle route.';
