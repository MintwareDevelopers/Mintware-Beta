-- Bridge card rail — onboarding-state + webhook-lookup columns on org_cards.
--
-- The Bridge rail (docs/developers/card-spend-buffer-spec.md, Bridge union) issues a non-custodial
-- card whose funding wallet is the member's own Privy/bufferOf address (already stored as
-- card_spend_buffers.buffer_address). These columns persist the onboarding progress the state machine
-- (lib/cards/onboard.ts) derives its OnboardState from, and let the webhook resolve a Bridge card id
-- back to an org_card:
--   cardIssued      = bridge_card_id   IS NOT NULL   (card created + funding wallet linked)
--   permitSigned    = activated_at     IS NOT NULL   (existing column: the member signed their
--                                                      standing DelegatedSpendPermit — reused, unchanged)
--   approvalGranted = bridge_approved_at IS NOT NULL (capped USDC approve to Bridge's spender is live)
--   bufferPrimed    = bridge_primed_at IS NOT NULL   (initial refill confirmed on-chain, buffer >= min)
--   liveProvisioned = bridge_live_at   IS NOT NULL   (card provisioned/live — gated behind prime)
--
-- All nullable / additive; nothing here is required for the Lithic rail. The Bridge rail stays behind
-- CARD_BRIDGE_ENABLED (fail-closed, OFF by default).

ALTER TABLE org_cards
  ADD COLUMN IF NOT EXISTS bridge_card_id    text,        -- Bridge/Stripe issuing card id (webhook match key)
  ADD COLUMN IF NOT EXISTS bridge_approved_at timestamptz, -- capped approve(spender, cap) confirmed
  ADD COLUMN IF NOT EXISTS bridge_primed_at   timestamptz, -- initial buffer refill confirmed on-chain
  ADD COLUMN IF NOT EXISTS bridge_live_at     timestamptz, -- card provisioned/live (gated behind prime)
  ADD COLUMN IF NOT EXISTS bridge_approval_tx text;         -- the approve tx hash (audit trail)

-- One Bridge card id maps to at most one org_card (Bridge's own rule is one wallet = one card in
-- non-custodial mode; this enforces the inverse uniqueness on our side). Partial: only non-null ids.
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_bridge_card_id_idx
  ON org_cards (bridge_card_id)
  WHERE bridge_card_id IS NOT NULL;

COMMENT ON COLUMN org_cards.bridge_card_id IS
  'Bridge/Stripe issuing card id for the Bridge rail; matched on webhooks. Null on Lithic cards.';
