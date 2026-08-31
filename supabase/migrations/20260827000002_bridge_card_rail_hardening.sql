-- Bridge card rail — audit hardening (2026-08-27 adversarial audit).
--
-- (1) bridge_webhook_events: idempotency ledger so a replayed webhook (valid HMAC, re-POSTed inside
--     the signature freshness window) is a no-op instead of triggering another resync+refill. The
--     webhook route inserts event_id before acting and short-circuits on a unique-violation. Paired
--     with the timestamp-tolerance check in verifyBridgeWebhook (which blocks replays OUTSIDE the
--     window); together they close the replay → rate-window-exhaustion → decline vector.
--
-- (2) card_spend_buffers.privy_wallet_id: the member's Privy wallet id for the approve signer. Privy
--     keys wallets by id, not address; without this the grant_approval step fails closed (the signer
--     can't be constructed), so the Bridge rail can't function. Nullable — set when the member's
--     funding wallet is provisioned.

CREATE TABLE IF NOT EXISTS bridge_webhook_events (
  event_id  text        PRIMARY KEY,               -- Bridge/Stripe event id (issuing_transaction.created etc.)
  seen_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bridge_webhook_events IS
  'Idempotency ledger for Bridge card webhooks: one row per processed event id, so a replayed delivery is a no-op.';

ALTER TABLE card_spend_buffers
  ADD COLUMN IF NOT EXISTS privy_wallet_id text; -- Privy wallet id of the funding wallet (approve signer)

COMMENT ON COLUMN card_spend_buffers.privy_wallet_id IS
  'Privy wallet id of the buffer/funding wallet; used as the signer id for the Bridge approve. Null until provisioned.';
