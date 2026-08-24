-- ============================================================================
-- x402 standing spend permits — the agent-side twin of the card permit columns
-- (org_cards, migration 20260819000003).
--
-- The card flow already proved the pattern: a spender signs a long-lived EIP-712
-- `DelegatedSpendPermit` ONCE (see lib/org/spendPermit.ts + MintwarePaymentGateway.
-- settleSpend) and every later settle reuses it. An x402 agent is the same shape —
-- it parks capital in the vault, signs ONE standing permit against the gateway, and
-- each pay-per-call settles a slice against it. But an x402 payer is NOT necessarily
-- an org member / card holder, so the permit can't live on `org_cards`. This table
-- is the payer-keyed store: keyed by (payer, gateway), holding the SAME
-- DelegatedSpendPermit fields the card columns hold.
--
-- Nothing here moves money. It only records a signature the settle path
-- (app/api/x402/settle) threads into the relayer's SettleParams.permit; the on-chain
-- settleSpend re-verifies the signature + enforces the deadline. Written + read ONLY
-- by server routes on the service-role client.
-- ============================================================================

CREATE TABLE IF NOT EXISTS x402_standing_permits (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payer                 text        NOT NULL,                       -- x402 payer address (lowercased)
  gateway               text        NOT NULL,                       -- MintwarePaymentGateway this permit authorizes (verifyingContract, lowercased)
  chain_id              bigint      NOT NULL,                       -- chain the permit's EIP-712 domain is bound to
  permit_user           text        NOT NULL,                       -- DelegatedSpendPermit.user — enforced == payer at registration
  max_daily_spend_usdc  text        NOT NULL,                       -- atomic 6dp, as signed (DelegatedSpendPermit.maxDailySpendUSDC)
  nonce                 text        NOT NULL,                       -- atomic uint256, as signed
  deadline              text        NOT NULL,                       -- unix seconds, as signed
  signature             text        NOT NULL,                       -- 65-byte EIP-712 sig, 0x-hex
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One standing permit per (payer, gateway) — re-registering overwrites (see putStandingPermit's upsert).
CREATE UNIQUE INDEX IF NOT EXISTS x402_standing_permits_payer_gateway_idx
  ON x402_standing_permits (payer, gateway);

-- Deny-all RLS, service-role only — mirrors 20260819000001_rls_backfill_hardening. This table is
-- written/read exclusively by server routes through the service-role client (BYPASSRLS); it is never
-- read by the browser. Enabling RLS with NO anon/authenticated policy means the public anon key can
-- neither read nor write it. Do NOT add an anon policy — a signature store must stay server-only.
ALTER TABLE x402_standing_permits ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE x402_standing_permits IS 'Payer-keyed store of standing EIP-712 DelegatedSpendPermit signatures for x402 agents (the twin of org_cards permit columns). Written/read only by server routes; deny-all RLS.';
