-- ============================================================================
-- Server-recorded swap quotes — closes the reward-integrity gap (audit HIGH #6/#7).
--
-- The swap-reward path (campaigns/swap-event → swapHook) trusted the CLIENT-supplied
-- `amount_usd` and gated fee payment on a spoofable calldata substring. A client could
-- inflate the reported trade value (bounded only by the $10k cap + daily caps).
--
-- Fix: the server /api/swap/quote proxy already fetches the real LI.FI quote (which carries
-- estimate.fromAmountUSD — the true USD value) and injects the integrator fee. We now PERSIST
-- that server-computed value here, keyed by a `quote_id` returned to the client. When the client
-- later reports the swap, it passes the quote_id; swap-event looks up THIS record and uses the
-- recorded `amount_usd` (bound to the quoting wallet) instead of trusting the client body.
--
-- Backward compatible: when no quote_id is supplied (or it is unknown/expired), the caller falls
-- back to the capped client value + existing caps — nothing breaks, the enforcement just activates
-- once the client threads the quote_id through.
-- ============================================================================

CREATE TABLE IF NOT EXISTS swap_quotes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet      text        NOT NULL,                 -- the `taker` the quote was issued for
  chain_id    int,
  sell_token  text,
  buy_token   text,
  sell_amount text,
  amount_usd  numeric     CHECK (amount_usd IS NULL OR amount_usd >= 0),  -- server-computed (LI.FI fromAmountUSD)
  fee_bps     numeric,                              -- integrator fee injected server-side (e.g. 50 = 0.50%)
  referrer    text,                                 -- treasury address the fee was directed to
  expires_at  timestamptz NOT NULL,                 -- short TTL; a stale quote can't be used
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Lookups are by primary key (quote_id) from swap-event; this index supports wallet-scoped
-- housekeeping / analytics and the wallet-match check.
CREATE INDEX IF NOT EXISTS swap_quotes_wallet_idx ON swap_quotes (wallet);

COMMENT ON TABLE swap_quotes IS
  'Server-recorded LI.FI quotes. swap-event uses the recorded amount_usd (bound to `wallet`) '
  'instead of the client-supplied value — closes the reward-magnitude spoof (audit HIGH #6/#7).';
