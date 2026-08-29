-- ============================================================================
-- treasury_spend_events — the unified org-treasury spend ledger.
--
-- Before this, only card swipes produced an org-scoped spend record (card_swipe_events);
-- vendor pay and payroll (app/api/orgs/[id]/pay) wrote NOTHING, and x402 wrote a non-org-scoped
-- observability log (x402_settle_events). A team could run payroll and have zero record of it.
--
-- This is the single row-per-spend ledger every rail writes to (vendor_pay, payroll, card_swipe,
-- x402, deposit, withdraw), so a treasury team can see + report on every dollar that moved. It is
-- the UNION of the two proven schemas: org tenancy + idempotency unique-key + the settled/
-- settle_tx/settled_at reconciliation triplet from card_swipe_events (20260819000003), plus the
-- payer/payee observability fields + actor indexes from x402_settle_events (20260828000002). The
-- one new idea is the `spend_type` discriminator that lets all rails share one feed.
--
-- Reconciliation contract (mirrors lib/org/settleSwipe.ts): a row is only marked settled=true /
-- status='settled' AFTER its tx mines with receipt.status === 'success'. A mined-but-reverted tx
-- must never be recorded as settled, or the feed lies. Amounts are atomic 6dp USDC kept as `text`
-- (uint256-safe, matching every other money column in this codebase).
--
-- Written exclusively by server-side lib code (lib/treasury/spendLog.ts) through the service-role
-- client; read only through a server route (POST, org-scoped, like /api/orgs/[id]/cards/events).
-- ============================================================================

CREATE TABLE IF NOT EXISTS treasury_spend_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  spend_type         text        NOT NULL,                    -- 'vendor_pay'|'payroll'|'card_swipe'|'x402'|'deposit'|'withdraw'
  provider           text,                                    -- 'relayer'|'oracle'|'direct'|'lithic'|...
  provider_event_ref text,                                    -- external idempotency key (Lithic token, per-leg id, ...)
  batch_id           text,                                    -- groups a payroll run's legs (null for single payments)
  initiated_by       text,                                    -- member wallet that initiated (lowercased); null if automated
  initiator_role     text,                                    -- role at spend time: owner|manager|contributor|vendor
  from_wallet        text,                                    -- treasury / payer (lowercased)
  to_wallet          text        NOT NULL,                    -- recipient (lowercased)
  amount_atomic_usdc text        NOT NULL,                    -- atomic 6dp USDC, uint256-safe as text
  asset              text        NOT NULL DEFAULT 'USDC',
  chain_id           integer,
  category           text,                                    -- optional reporting category
  memo               text,                                    -- optional free-text note
  status             text        NOT NULL DEFAULT 'recorded',  -- 'recorded'|'settled'|'failed'
  settled            boolean     NOT NULL DEFAULT false,
  settle_tx          text,                                    -- on-chain tx hash (null until mined)
  receipt_status     text,                                    -- 'success'|'reverted' — from the mined receipt
  shares_burned      text,                                    -- settleSpend() return, optional evidence
  error_reason       text,
  latency_ms         integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  settled_at         timestamptz,
  CHECK (spend_type IN ('vendor_pay','payroll','card_swipe','x402','deposit','withdraw')),
  CHECK (status IN ('recorded','settled','failed'))
);

-- Feed + filtered-feed access patterns.
CREATE INDEX IF NOT EXISTS treasury_spend_org_idx        ON treasury_spend_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS treasury_spend_org_type_idx   ON treasury_spend_events (org_id, spend_type, settled);
-- Per-vendor and per-member rollups.
CREATE INDEX IF NOT EXISTS treasury_spend_to_idx         ON treasury_spend_events (to_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS treasury_spend_member_idx     ON treasury_spend_events (org_id, initiated_by, created_at DESC);
-- Idempotency: a retried webhook / re-submitted leg with the same provider ref resolves to one row.
-- Partial unique (nulls allowed) so rails without an external ref can still insert freely.
CREATE UNIQUE INDEX IF NOT EXISTS treasury_spend_provider_ref_uq
  ON treasury_spend_events (provider, provider_event_ref)
  WHERE provider_event_ref IS NOT NULL;

-- Deny-all RLS, service-role only — mirrors 20260819000001_rls_backfill_hardening. Written only by
-- lib/treasury/spendLog.ts via the service-role client (BYPASSRLS); browser reads go through a
-- server route on the same client. Do NOT add an anon policy.
ALTER TABLE treasury_spend_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE treasury_spend_events IS 'Unified org-treasury spend ledger — one row per spend across all rails (vendor_pay/payroll/card_swipe/x402/deposit/withdraw). settled=true only after receipt.status===success. Deny-all RLS, service-role only.';
