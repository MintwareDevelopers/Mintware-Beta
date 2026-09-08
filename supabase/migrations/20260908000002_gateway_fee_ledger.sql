-- ============================================================================
-- LP GATEWAY — event-indexed harvest fee ledger (audit closeout 2026-09-08: O-4 / R-3 / HO-6 / A-4).
--
-- Replaces the DB-share-weighted, read-modify-write credit into `card_spend_buffers` (which the card
-- rail authorizes against and `lib/org/bufferMonitor.ts` overwrites) with a ledger that is:
--   * EVENT-INDEXED  — one `gateway_harvest_logs` row per on-chain `Harvested` log, UNIQUE on
--                      (chain_id, tx_hash, log_index). Sweeps emitted by withdraw/deploy are the SAME
--                      event and are indexed + credited exactly like a cron harvest.
--   * ON-CHAIN-SHARE-WEIGHTED — each credit stores `shares_at_block` / `total_shares_at_block` read
--                      from the position manager AT THE HARVEST BLOCK (never DB shares).
--   * ATOMIC         — `record_gateway_harvest()` inserts the log + every credit in ONE transaction
--                      under a row lock (FOR UPDATE), idempotent on the unique key: a retried cron
--                      returns 'duplicate' and writes nothing.
--   * ISOLATED       — its own tables. Nothing here is read by the card rail; the buffer monitor never
--                      touches it. Credits are an off-chain IOU against the harvest recipient (the
--                      gateway seat wallet) until paid (`gateway_fee_payouts`) — the reconciliation
--                      view makes seat balance − Σ credits − Σ paid auditable.
--
-- Amounts are atomic units of the pool's quote asset (USDG, 6dp) as numeric(78,0). Deny-all RLS
-- (service-role only), matching every gateway table. Testnet/pre-audit.
-- ============================================================================

-- Per-(chain, position manager) indexer cursor -----------------------------------------------
CREATE TABLE IF NOT EXISTS gateway_index_cursors (
  chain_id           integer     NOT NULL,
  position_manager   text        NOT NULL,
  last_indexed_block bigint      NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, position_manager)
);

-- Every wallet that has ever emitted `Deposited` on a PM (plus any DB-known depositor). The set the
-- indexer reads `sharesOf` for at each harvest block. Append-only by nature (a wallet never leaves).
CREATE TABLE IF NOT EXISTS gateway_known_depositors (
  chain_id         integer     NOT NULL,
  position_manager text        NOT NULL,
  user_wallet      text        NOT NULL,
  first_seen_block bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, position_manager, user_wallet)
);

-- One row per on-chain `Harvested` log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway_harvest_logs (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id               integer       NOT NULL,
  tx_hash                text          NOT NULL,
  log_index              integer       NOT NULL,
  block_number           bigint        NOT NULL,
  position_manager       text          NOT NULL,
  pool_address           text          NOT NULL,
  quote_fees_atomic      numeric(78,0) NOT NULL DEFAULT 0,   -- event.quoteFees (gross)
  paired_fees_atomic     numeric(78,0) NOT NULL DEFAULT 0,   -- event.pairedFees (NOT credited here; converted later)
  recipient              text          NOT NULL,             -- event.recipient == harvestRecipient (seat wallet)
  total_shares_at_block  numeric(78,0) NOT NULL DEFAULT 0,   -- PM.totalShares() @ block_number
  perf_fee_bps           integer       NOT NULL DEFAULT 0,
  fee_skimmed_atomic     numeric(78,0) NOT NULL DEFAULT 0,
  net_quote_atomic       numeric(78,0) NOT NULL DEFAULT 0,   -- quote_fees − skim: what depositors are owed
  credited_atomic        numeric(78,0) NOT NULL DEFAULT 0,   -- Σ gateway_fee_credits for this log
  unallocated_atomic     numeric(78,0) NOT NULL DEFAULT 0,   -- net − credited (rounding + unknown holders)
  -- 'pending'  → indexed, not yet settled (restake mode compounds it on-chain later)
  -- 'credited' → per-depositor credits written (buffer mode)
  -- 'restake'  → compounded back into the PM via compoundQuote (lifts NAV pro-rata on-chain)
  settlement             text          NOT NULL DEFAULT 'pending' CHECK (settlement IN ('pending', 'credited', 'restake')),
  settle_tx              text,
  settled_at             timestamptz,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS gateway_harvest_logs_pm_idx ON gateway_harvest_logs (chain_id, position_manager, settlement);

-- Per-depositor credit per harvest log --------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway_fee_credits (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id               integer       NOT NULL,
  tx_hash                text          NOT NULL,
  log_index              integer       NOT NULL,
  position_manager       text          NOT NULL,
  pool_address           text          NOT NULL,
  user_wallet            text          NOT NULL,
  shares_at_block        numeric(78,0) NOT NULL,             -- PM.sharesOf(user) @ harvest block
  total_shares_at_block  numeric(78,0) NOT NULL,             -- PM.totalShares()  @ harvest block
  credit_atomic          numeric(78,0) NOT NULL CHECK (credit_atomic >= 0),
  created_at             timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index, user_wallet)
);
CREATE INDEX IF NOT EXISTS gateway_fee_credits_user_idx ON gateway_fee_credits (chain_id, position_manager, user_wallet);

-- Payouts against the IOU (written by the operator/payout job, never by the indexer) ------------
CREATE TABLE IF NOT EXISTS gateway_fee_payouts (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id         integer       NOT NULL,
  position_manager text          NOT NULL,
  user_wallet      text          NOT NULL,
  amount_atomic    numeric(78,0) NOT NULL CHECK (amount_atomic > 0),
  tx_hash          text,
  note             text,
  created_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_fee_payouts_tx_uidx ON gateway_fee_payouts (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS gateway_fee_payouts_user_idx ON gateway_fee_payouts (chain_id, position_manager, user_wallet);

-- ---------------------------------------------------------------------------------------------
-- record_gateway_harvest — the ONE writer. Inserts the harvest log + all credits atomically.
--   p_log     : { chain_id, tx_hash, log_index, block_number, position_manager, pool_address,
--                 quote_fees_atomic, paired_fees_atomic, recipient, total_shares_at_block,
--                 perf_fee_bps, fee_skimmed_atomic, net_quote_atomic }
--   p_credits : [ { user_wallet, shares_at_block, credit_atomic }, ... ]   (may be empty)
--   p_settlement : 'credited' | 'pending'
-- Returns 'ok' | 'duplicate'. Idempotent: the unique (chain_id, tx_hash, log_index) key is claimed
-- first; a second caller (retry / concurrent cron) sees the existing row under FOR UPDATE and exits
-- without touching credits. Credits are only ever written by the caller that first claimed the log.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_gateway_harvest(p_log jsonb, p_credits jsonb, p_settlement text DEFAULT 'credited')
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_chain   integer := (p_log->>'chain_id')::integer;
  v_tx      text    := lower(p_log->>'tx_hash');
  v_idx     integer := (p_log->>'log_index')::integer;
  v_pm      text    := lower(p_log->>'position_manager');
  v_pool    text    := lower(p_log->>'pool_address');
  v_row     gateway_harvest_logs%ROWTYPE;
  v_sum     numeric(78,0) := 0;
  v_net     numeric(78,0) := COALESCE((p_log->>'net_quote_atomic')::numeric, 0);
  c         jsonb;
BEGIN
  IF p_settlement NOT IN ('credited', 'pending') THEN
    RAISE EXCEPTION 'record_gateway_harvest: bad settlement %', p_settlement;
  END IF;

  -- Claim the unique key. A conflict means another caller already recorded this log.
  INSERT INTO gateway_harvest_logs (
    chain_id, tx_hash, log_index, block_number, position_manager, pool_address,
    quote_fees_atomic, paired_fees_atomic, recipient, total_shares_at_block,
    perf_fee_bps, fee_skimmed_atomic, net_quote_atomic, settlement
  ) VALUES (
    v_chain, v_tx, v_idx, (p_log->>'block_number')::bigint, v_pm, v_pool,
    COALESCE((p_log->>'quote_fees_atomic')::numeric, 0),
    COALESCE((p_log->>'paired_fees_atomic')::numeric, 0),
    lower(p_log->>'recipient'),
    COALESCE((p_log->>'total_shares_at_block')::numeric, 0),
    COALESCE((p_log->>'perf_fee_bps')::integer, 0),
    COALESCE((p_log->>'fee_skimmed_atomic')::numeric, 0),
    v_net,
    'pending'
  )
  ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING;

  SELECT * INTO v_row FROM gateway_harvest_logs
   WHERE chain_id = v_chain AND tx_hash = v_tx AND log_index = v_idx
   FOR UPDATE;

  -- Someone else claimed + settled it (or an earlier run of ours did) → nothing to do.
  IF v_row.settlement <> 'pending' OR v_row.credited_atomic > 0 THEN
    RETURN 'duplicate';
  END IF;
  -- Claimed by a concurrent caller that is still inside its own transaction is impossible here:
  -- FOR UPDATE serialized us behind it, and it will have flipped settlement / credited before commit.
  -- A row left 'pending' with zero credits is legitimately ours to settle (indexed-then-credit-later).

  IF p_settlement = 'pending' THEN
    RETURN 'ok';
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_credits, '[]'::jsonb)) LOOP
    IF COALESCE((c->>'credit_atomic')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO gateway_fee_credits (
      chain_id, tx_hash, log_index, position_manager, pool_address, user_wallet,
      shares_at_block, total_shares_at_block, credit_atomic
    ) VALUES (
      v_chain, v_tx, v_idx, v_pm, v_pool, lower(c->>'user_wallet'),
      (c->>'shares_at_block')::numeric, v_row.total_shares_at_block, (c->>'credit_atomic')::numeric
    )
    ON CONFLICT (chain_id, tx_hash, log_index, user_wallet) DO NOTHING;
    v_sum := v_sum + (c->>'credit_atomic')::numeric;
  END LOOP;

  IF v_sum > v_net THEN
    RAISE EXCEPTION 'record_gateway_harvest: credits % exceed net %', v_sum, v_net;
  END IF;

  UPDATE gateway_harvest_logs
     SET settlement = 'credited', credited_atomic = v_sum, unallocated_atomic = v_net - v_sum,
         settled_at = now()
   WHERE id = v_row.id;
  RETURN 'ok';
END $$;

-- Reconciliation --------------------------------------------------------------------------------
-- Per depositor: what they are owed (Σ credits − Σ payouts).
CREATE OR REPLACE VIEW gateway_fee_balances AS
SELECT c.chain_id, c.position_manager, c.user_wallet,
       COALESCE(SUM(c.credit_atomic), 0)::numeric(78,0)                                  AS credited_atomic,
       COALESCE((SELECT SUM(p.amount_atomic) FROM gateway_fee_payouts p
                  WHERE p.chain_id = c.chain_id AND p.position_manager = c.position_manager
                    AND p.user_wallet = c.user_wallet), 0)::numeric(78,0)                AS paid_atomic,
       (COALESCE(SUM(c.credit_atomic), 0)
        - COALESCE((SELECT SUM(p.amount_atomic) FROM gateway_fee_payouts p
                     WHERE p.chain_id = c.chain_id AND p.position_manager = c.position_manager
                       AND p.user_wallet = c.user_wallet), 0))::numeric(78,0)            AS owed_atomic
FROM gateway_fee_credits c
GROUP BY c.chain_id, c.position_manager, c.user_wallet;

-- Per position manager: everything the seat wallet should be holding on depositors' behalf.
--   expected_seat_quote ≈ Σ owed (credited − paid) + Σ pending net (indexed, not yet compounded)
--                         + Σ unallocated + Σ skimmed perf fees (Mintware's, until swept)
-- Compare with quoteAsset.balanceOf(harvestRecipient) read from chain (lib/gateway/ledger.ts
-- `reconcileSeat`). The on-chain balance is NOT stored here — it must be read live.
CREATE OR REPLACE VIEW gateway_fee_ledger_reconciliation AS
SELECT l.chain_id, l.position_manager,
       COUNT(*)                                                         AS harvest_logs,
       COALESCE(SUM(l.quote_fees_atomic), 0)::numeric(78,0)             AS gross_quote_atomic,
       COALESCE(SUM(l.paired_fees_atomic), 0)::numeric(78,0)            AS gross_paired_atomic,
       COALESCE(SUM(l.fee_skimmed_atomic), 0)::numeric(78,0)            AS skimmed_atomic,
       COALESCE(SUM(l.credited_atomic), 0)::numeric(78,0)               AS credited_atomic,
       COALESCE(SUM(l.unallocated_atomic), 0)::numeric(78,0)            AS unallocated_atomic,
       COALESCE(SUM(l.net_quote_atomic) FILTER (WHERE l.settlement = 'pending'), 0)::numeric(78,0) AS pending_net_atomic,
       COALESCE(SUM(l.net_quote_atomic) FILTER (WHERE l.settlement = 'restake'), 0)::numeric(78,0) AS restaked_net_atomic,
       COALESCE((SELECT SUM(p.amount_atomic) FROM gateway_fee_payouts p
                  WHERE p.chain_id = l.chain_id AND p.position_manager = l.position_manager), 0)::numeric(78,0) AS paid_atomic,
       (COALESCE(SUM(l.credited_atomic), 0)
        - COALESCE((SELECT SUM(p.amount_atomic) FROM gateway_fee_payouts p
                     WHERE p.chain_id = l.chain_id AND p.position_manager = l.position_manager), 0)
        + COALESCE(SUM(l.unallocated_atomic), 0)
        + COALESCE(SUM(l.net_quote_atomic) FILTER (WHERE l.settlement = 'pending'), 0)
        + COALESCE(SUM(l.fee_skimmed_atomic), 0))::numeric(78,0)        AS expected_seat_quote_atomic
FROM gateway_harvest_logs l
GROUP BY l.chain_id, l.position_manager;

alter table if exists public.gateway_index_cursors     enable row level security;
alter table if exists public.gateway_known_depositors  enable row level security;
alter table if exists public.gateway_harvest_logs      enable row level security;
alter table if exists public.gateway_fee_credits       enable row level security;
alter table if exists public.gateway_fee_payouts       enable row level security;

COMMENT ON TABLE gateway_harvest_logs  IS 'One row per on-chain Harvested log (harvest cron AND withdraw/deploy sweeps). UNIQUE(chain_id,tx_hash,log_index). Settlement: pending → credited (buffer) | restake (compounded on-chain). O-4 / A-4 closeout. Testnet/pre-audit.';
COMMENT ON TABLE gateway_fee_credits   IS 'Per-depositor fee credit per Harvested log, weighted by PM.sharesOf/totalShares read AT the harvest block. Written only by record_gateway_harvest(). Never read by the card rail. Testnet/pre-audit.';
COMMENT ON TABLE gateway_fee_payouts   IS 'Payouts against gateway_fee_credits IOUs (operator/payout job). Σ credits − Σ payouts = owed (gateway_fee_balances). Testnet/pre-audit.';
COMMENT ON TABLE gateway_known_depositors IS 'Every wallet seen in a Deposited log (or DB position) per PM — the sharesOf read-set at each harvest block.';
COMMENT ON TABLE gateway_index_cursors IS 'Last indexed block per (chain, PM) for the Harvested/Deposited log indexer (lib/gateway/ledger.ts).';
COMMENT ON FUNCTION record_gateway_harvest(jsonb, jsonb, text) IS 'Atomic, idempotent harvest-log + credits writer (FOR UPDATE on the unique log row). Returns ok | duplicate.';
