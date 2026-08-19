-- ============================================================================
-- Org card accounts — maps a card-issuer's card token to an org member wallet.
--
-- This is the missing link the "Team · Cards & Spend" UI (app/app/team/cards/page.tsx) has been
-- waiting on: its "+ Issue card" button has shipped disabled since it landed, captioned "Card
-- issuance needs the CPN card issuer — coming soon." `lib/org/rolePresets.ts`'s `contributor`
-- preset already says the quiet part out loud: "Spend up to $2,000/day from the treasury via
-- card / x402" — cards were always meant to draw on the SAME org treasury + role-cap system that
-- `/api/orgs/[id]/pay` uses for vendor payouts, not a separate product.
--
-- `provider` is deliberately not hardcoded to Lithic — the row shape is generic so a second card
-- issuer (or Lithic's own production tier once past sandbox) can reuse this table without a new
-- migration. Sandbox-only today (see `lib/cards/lithic.ts`).
--
-- No `amount`/ledger columns here on purpose — authorization decisions are NOT persisted (they're
-- decided live by edge-auth off NAV, same as every other spend path in this repo); this table is
-- only the durable card-token → (org, member) identity mapping the webhook needs to route a swipe.
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_cards (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  member_wallet       text        NOT NULL,                       -- lowercase EVM address; org_members.wallet
  provider            text        NOT NULL DEFAULT 'lithic',
  provider_card_token text        NOT NULL,                       -- Lithic card `token` (uuid, opaque to us)
  last_four           text,
  card_type           text        NOT NULL DEFAULT 'VIRTUAL',      -- VIRTUAL | PHYSICAL | SINGLE_USE | MERCHANT_LOCKED
  state               text        NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'PAUSED', 'CLOSED')),
  memo                text,
  issued_by           text        NOT NULL,                        -- caller wallet that requested issuance
  created_at          timestamptz NOT NULL DEFAULT now(),
  state_changed_at    timestamptz                                  -- set explicitly on pause/close; no generic
                                                                     -- updated_at trigger exists in this schema
                                                                     -- (docs/schema.sql has only a one-off
                                                                     -- epoch_state version, not a shared fn)
);

-- One row per (issuer, card token); fast lookup on both the webhook's join key and the org's card list.
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_provider_token_idx ON org_cards (provider, provider_card_token);
CREATE INDEX IF NOT EXISTS org_cards_org_member_idx ON org_cards (org_id, member_wallet);

-- RLS: deny-all, service-role only (2026-08-19 hardening convention — see
-- 20260819000001_rls_backfill_hardening.sql). This table is read/written exclusively by the
-- webhook route and the org-scoped issue/list routes, both on the service-role client; the browser
-- never touches it directly. A leaked provider_card_token is opaque without the Lithic API key, but
-- deny-all costs nothing and closes the anon PostgREST hole by default rather than by omission.
ALTER TABLE org_cards ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE org_cards IS 'Card-token -> (org, member) identity mapping for card-issuer webhooks. Sandbox-only (Lithic) as of 2026-08-19.';
