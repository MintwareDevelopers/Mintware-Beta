-- Automated fee-conversion swap reconciliation (user directive, 2026-09-10: "built it" — closing the one
-- remaining real gap in the paired-token fee-conversion work independent Codex live-watch review kept
-- flagging: a swap whose real proceeds could not be measured at harvest time — receipt confirmation
-- failed transiently, or the swap confirmed but no qualifying ERC-20 Transfer log was found in it (see
-- lib/gateway/routerSwap.ts#measureSwapProceeds) — was never revisited. The swap_tx itself was already
-- durably recorded (this session's earlier fix), but nothing re-checked it later.
--
-- This migration adds the durable signal `swapPairedToQuote` now returns (`needsReconciliation`) as a
-- column on `harvest_events`, so `lib/gateway/reconcileSwaps.ts` (the new cron) can find exactly the rows
-- worth re-checking without re-deriving that judgment from scratch. Existing rows default to
-- `false` — this whole concept postdates them, and retroactively flagging every historical row for
-- reconciliation would just create noise the cron can never resolve either way (their swap_tx, if any,
-- predates this column existing on the writer side and was never tagged with a measurement outcome).

ALTER TABLE harvest_events ADD COLUMN IF NOT EXISTS swap_needs_reconciliation boolean NOT NULL DEFAULT false;
-- Set only once the cron actually resolves a row (success or terminal failure) — null means "still pending".
ALTER TABLE harvest_events ADD COLUMN IF NOT EXISTS swap_reconciled_at timestamptz;
-- 'recovered' (real proceeds found + compounded into NAV) | 'reverted' (the swap itself reverted, confirmed
-- on a later check — zero proceeds, definitive) | 'zero' (proceeds measured now, net <= 0 — a genuine,
-- confirmed answer, not "still unknown") | 'unmeasurable' (swap confirmed successful, but STILL no
-- qualifying Transfer log even on re-check — this is a permanent characteristic of that specific
-- transaction, not something further retries could ever resolve; flagged for manual operator review, not
-- retried forever). Null while `swap_needs_reconciliation` is still true (unresolved).
ALTER TABLE harvest_events ADD COLUMN IF NOT EXISTS swap_reconciliation_outcome text
  CHECK (swap_reconciliation_outcome IN ('recovered', 'reverted', 'zero', 'unmeasurable') OR swap_reconciliation_outcome IS NULL);
-- The tx that actually credited recovered proceeds into NAV (a real, separate compoundQuote() call) — only
-- set when swap_reconciliation_outcome = 'recovered'.
ALTER TABLE harvest_events ADD COLUMN IF NOT EXISTS swap_reconciliation_tx text;

CREATE INDEX IF NOT EXISTS harvest_events_pending_reconciliation_idx
  ON harvest_events (chain_id, pool_address, created_at)
  WHERE swap_needs_reconciliation = true;
