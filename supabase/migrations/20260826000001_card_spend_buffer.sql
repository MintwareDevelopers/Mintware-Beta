-- ============================================================================
-- Card spend buffer — per-card pre-funded flat balance + refill config/state + refill ledger.
--
-- Design spec: docs/developers/card-spend-buffer-spec.md. A card issuer's authorization only ever
-- sees a flat, deterministic balance (it cannot survive a live AMM-priced NAV read inside the ~6s
-- ASA window — §1), so each card gets a pre-funded spend buffer that a background loop tops up from
-- the member's vault position (Option A: per-user, funded from the member's OWN senior shares via
-- MintwarePaymentGateway.refillBuffer, receiver pinned to the member's self-registered buffer wallet).
--
-- This REVERSES the deliberate "no ledger on org_cards" choice (20260819000004): that table stayed
-- pure identity because decisions were live-NAV. The buffer model is a genuine schema addition, so it
-- lives in its own 1:1 table rather than bolting balance/state columns onto the identity mapping.
--
-- Amounts are atomic USDC (6dp) as numeric(78,0) — the on-chain uint256 mirror convention. The
-- AUTHORITATIVE buffer balance is on-chain (usdc.balanceOf(buffer_address)); `buffer_balance_atomic`
-- here is a fast-read CACHE for the ASA-window flat check, reconciled against chain by the monitor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS card_spend_buffers (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_card_id                 uuid        NOT NULL UNIQUE REFERENCES org_cards(id) ON DELETE CASCADE,
  member_wallet               text        NOT NULL,                        -- lowercase EVM addr; the on-chain `user`
  buffer_address              text,                                        -- on-chain registered buffer wallet (bufferOf[user]); null until set
  chain_id                    integer     NOT NULL,

  -- ── config (user-governed; mirrors the on-chain per-user controls) ──
  auto_refill_enabled         boolean     NOT NULL DEFAULT false,          -- master switch; OFF by default (deliberate ops act)
  service_level_bps           integer     NOT NULL DEFAULT 9500 CHECK (service_level_bps BETWEEN 1 AND 9999),
  per_tx_cap_atomic           numeric(78,0) NOT NULL DEFAULT 0,            -- max a single swipe may draw; 0 = off
  min_refill_atomic           numeric(78,0) NOT NULL DEFAULT 0,            -- suppress trickle refills below this
  refill_rate_cap_atomic      numeric(78,0) NOT NULL DEFAULT 0,            -- max auto-refilled per window; 0 = off
  refill_window_secs          integer     NOT NULL DEFAULT 86400 CHECK (refill_window_secs > 0),

  -- ── sizing inputs (BufferSizingParams; agent-tuned over time — spec §5.3) ──
  mean_demand_leadtime_atomic numeric(78,0) NOT NULL DEFAULT 0,
  demand_stdev_atomic         numeric(78,0) NOT NULL DEFAULT 0,
  sigma_period_secs           integer     NOT NULL DEFAULT 86400 CHECK (sigma_period_secs > 0),
  lead_time_secs              integer     NOT NULL DEFAULT 60 CHECK (lead_time_secs > 0),
  buffer_target_atomic        numeric(78,0) NOT NULL DEFAULT 0,            -- last computed "keep $X ready" target

  -- ── cached balance mirror (authoritative source is on-chain) ──
  buffer_balance_atomic       numeric(78,0) NOT NULL DEFAULT 0,
  balance_synced_at           timestamptz,

  -- ── refill-rate breaker state (matches lib/cards/bufferPolicy.RefillRateState) ──
  refill_window_start_secs    bigint      NOT NULL DEFAULT 0,
  refilled_in_window_atomic   numeric(78,0) NOT NULL DEFAULT 0,
  breaker_open                boolean     NOT NULL DEFAULT false,          -- manual halt; checked first, mirrors edge-auth set_breaker

  last_refill_at              timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz
);

CREATE INDEX IF NOT EXISTS card_spend_buffers_member_idx ON card_spend_buffers (member_wallet);
CREATE INDEX IF NOT EXISTS card_spend_buffers_autorefill_idx ON card_spend_buffers (auto_refill_enabled) WHERE auto_refill_enabled;

COMMENT ON TABLE card_spend_buffers IS 'Per-card pre-funded spend buffer: config, sizing inputs, cached balance, and refill-rate breaker state. Spec: docs/developers/card-spend-buffer-spec.md. Testnet/pre-audit.';

-- Refill audit trail — one row per refill attempt (sibling of card_swipe_events, keyed by org_card_id).
CREATE TABLE IF NOT EXISTS card_buffer_refills (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_card_id     uuid        NOT NULL REFERENCES org_cards(id) ON DELETE CASCADE,
  member_wallet   text        NOT NULL,
  refill_id       text        NOT NULL,                                    -- the bytes32 refillId used on-chain (idempotency key)
  amount_atomic   numeric(78,0) NOT NULL,
  shares_burned   numeric(78,0),
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','submitted','confirmed','failed','skipped','rate_capped')),
  breaker_tripped boolean     NOT NULL DEFAULT false,
  trigger         text        NOT NULL DEFAULT 'reactive'
                    CHECK (trigger IN ('reactive','cron','manual')),       -- capture-webhook | cron | user
  tx_hash         text,
  reason          text,                                                    -- failure / skip reason
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz
);

-- One row per (card, refillId) — matches the on-chain refillDone[refillId] idempotency guard.
CREATE UNIQUE INDEX IF NOT EXISTS card_buffer_refills_card_refillid_idx ON card_buffer_refills (org_card_id, refill_id);
CREATE INDEX IF NOT EXISTS card_buffer_refills_card_idx ON card_buffer_refills (org_card_id, created_at DESC);

COMMENT ON TABLE card_buffer_refills IS 'Card spend-buffer refill ledger — one row per redeem-vault-slice -> buffer top-up attempt. Spec: docs/developers/card-spend-buffer-spec.md.';

-- RLS: deny-all, service-role only (2026-08-19 hardening convention — 20260819000001). Both tables
-- are read/written exclusively by server routes (the buffer monitor, refill orchestrator, ASA
-- webhook) on the service-role client; the browser never touches them directly.
ALTER TABLE card_spend_buffers ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_buffer_refills ENABLE ROW LEVEL SECURITY;
