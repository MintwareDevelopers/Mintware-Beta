// LP-gateway cost-basis math (M-04). Pure, idempotent-aware helpers documenting the exact formula the
// deposit/withdraw routes' entry_nav updates use — `alreadyRecorded` is true when the tx already exists
// in gateway_deposit_events (UNIQUE tx_hash), in which case the basis is left exactly as-is (the
// mutation was applied once, the first time the tx was seen).
//
// Round-4 audit fix (2026-09-09): the routes no longer call these functions directly — the actual
// mutation moved into one atomic RPC per direction (record_gateway_deposit_event /
// record_gateway_withdraw_event, supabase/migrations/20260909000001_gateway_position_atomic_writes.sql)
// so the idempotency claim and the basis write happen in a single transaction instead of two separate
// round-trips (which could strand a missed increment on a crash, or lose one of two concurrent writers'
// contributions to a read-modify-write race). These functions are KEPT as the reference spec the SQL
// mirrors and stay covered by basisMath.test.ts — the SQL's CASE expressions are the same formula,
// just evaluated atomically against the row's live value instead of a value read in JS beforehand.
//
// Round-4 pass-2 event-order fix (independent Codex audit, 2026-09-09 — see `replayCostBasis` below):
// applying one of these STEPS per HTTP recording call (as 20260909000001 did) is only correct if calls
// arrive in the same order their txs were mined — nothing guaranteed that. Migration 20260909000004
// moved the RPCs from "apply one delta against the row's current value" to "replay the position's whole
// stored history in on-chain block order, from zero, every time" — order-independent w.r.t. call
// arrival. `nextDepositBasis`/`nextWithdrawBasis` are unchanged (still the single-step formulas).

/** Deposit: additive cost basis, applied at most once per deposit tx. */
export function nextDepositBasis(priorBasis: bigint, quoteIn: bigint, alreadyRecorded: boolean): bigint {
  if (alreadyRecorded) return priorBasis
  return priorBasis + quoteIn
}

/** Withdraw: reduce cost basis proportionally to the shares burned (full exit ⇒ 0), applied at most
 *  once per withdraw tx. `onChainShares` is the balance immediately AFTER this specific withdrawal;
 *  `sharesBurned` is from the Withdrawn event, so priorShares = onChainShares + sharesBurned. */
export function nextWithdrawBasis(
  priorBasis: bigint,
  onChainShares: bigint,
  sharesBurned: bigint,
  alreadyRecorded: boolean,
): bigint {
  if (alreadyRecorded) return priorBasis
  const priorShares = onChainShares + sharesBurned
  if (onChainShares === 0n || priorShares === 0n) return 0n
  return (priorBasis * onChainShares) / priorShares
}

// ── Event-order + same-block VALUE fix (independent Codex audit, round-4 pass-2, 2026-09-09) ───────────
//
// nextDepositBasis/nextWithdrawBasis above are each a single STEP. The original RPCs (migration
// 20260909000001) applied one step per HTTP recording call, against gateway_positions.entry_nav's
// CURRENT value at write time — which is correct ONLY if recording calls for the same position always
// arrive in the same order their underlying on-chain txs were mined in. Migration 20260909000004 fixed
// that by replaying the position's ENTIRE stored event history in on-chain block order every time.
//
// That still left a subtler, deeper bug Codex's live watch confirmed with a concrete reproduction
// (wrong basis 175 vs 150): `onChainShares` for a withdraw event used to be READ from chain
// (`sharesOf(user, blockNumber: receipt.blockNumber)`), which returns the BLOCK-END balance — after
// EVERY tx in that block, not just this one. Adding `tx_index` (migration 20260909000005) correctly
// ORDERS two same-block events for replay, but the STORED `onChainShares` value for the earlier of two
// same-block txs by the same user is still wrong (it's really the value after BOTH), regardless of
// order — this predates every change in this file (already documented as an accepted residual in
// withdraw/route.ts, before tonight), just now confirmed as a real, closable gap rather than a
// theoretical one.
//
// Fix (this pass): stop reading `onChainShares` from chain per event entirely. Every Deposited/Withdrawn
// event already reports its own `sharesMinted`/`sharesBurned` directly — values genuinely local to THAT
// transaction, never ambiguous, never needing any block-level read. `replayCostBasis` now derives a
// RUNNING share total purely from replayed mint/burn amounts (deposit: `shares += sharesMinted`;
// withdraw: `post = shares - sharesBurned`, basis via `nextWithdrawBasis(basis, post, sharesBurned,
// false)`, `shares = post`) — structurally immune to same-block ambiguity, cross-block ambiguity, and
// call-arrival order alike, since it never depends on anything but each event's own on-chain-reported
// numbers and their real chain order (block_number, then tx_index — migration 20260909000005's tiebreak).
//
// A history that would make `shares` go negative mid-replay (fewer minted than burned by that point —
// a genuine data-completeness gap, e.g. an earlier deposit whose OWN recording call never landed) can't
// be trusted to replay correctly; `replayCostBasis` reports that explicitly (`ok: false`) instead of
// clamping or throwing, so the caller (the SQL RPC) can fall back to the single-delta behavior for that
// one call — the same graceful-degradation shape already established for every other "can't fully
// replay this identity's history" case in this file.

export type BasisEvent =
  | { kind: 'deposit'; quoteIn: bigint; sharesMinted: bigint }
  | { kind: 'withdraw'; sharesBurned: bigint }

export type ReplayResult =
  | { ok: true; basis: bigint; finalShares: bigint }
  /** `shares` would have gone negative at some point — the history is incomplete for this identity
   *  (e.g. a deposit whose recording call never succeeded); the caller must not trust a from-scratch
   *  replay and should fall back to a single-delta update instead. */
  | { ok: false; reason: 'insufficient_shares' }

/** Replays a position's full recorded history (already sorted into on-chain order — by block number
 *  then tx_index, the caller's job) into a final cost basis + share count. Each event is applied as a
 *  fresh (never `alreadyRecorded`) step — idempotency against a REPLAYED tx is handled upstream by never
 *  storing the same tx_hash twice (UNIQUE constraint), not by this function, which only ever sees each
 *  recorded tx once per replay. Shares are DERIVED from each event's own sharesMinted/sharesBurned —
 *  never read from chain — so this is immune to same-block/cross-block/call-order ambiguity alike. */
export function replayCostBasis(eventsInChainOrder: BasisEvent[]): ReplayResult {
  let basis = 0n
  let shares = 0n
  for (const e of eventsInChainOrder) {
    if (e.kind === 'deposit') {
      basis = nextDepositBasis(basis, e.quoteIn, false)
      shares += e.sharesMinted
    } else {
      if (shares < e.sharesBurned) return { ok: false, reason: 'insufficient_shares' }
      const post = shares - e.sharesBurned
      basis = nextWithdrawBasis(basis, post, e.sharesBurned, false)
      shares = post
    }
  }
  return { ok: true, basis, finalShares: shares }
}

// ── Manager-generation fix (independent Codex audit, round-4 pass-2, 2026-09-09 → revised 2026-09-10) ──
//
// Migration 20260909000005 scopes replay per PositionManager generation. Its first two designs both
// guessed at ambiguous history and were both caught by Codex's live watch before ever being applied:
//   1. A migration-time backfill stamped every pre-existing position with whichever PM is CURRENTLY
//      active for its pool — wrong whenever a wallet's real history sits in a retired PM instead.
//   2. A runtime "adopt-or-create" rule let the first write naming ANY real PM silently absorb a
//      wallet's entire unclaimed (position_manager IS NULL) history — which double-counted that
//      history into a SECOND generation's basis too, the moment it also wrote (reproduced concretely:
//      PM-A correctly got a legacy 10 + its own 100 = 110, but PM-B incorrectly ALSO showed 110). Fixing
//      the double-count without addressing the deeper flaw just meant "whichever PM asks FIRST wins the
//      guess" — still wrong whenever that first PM isn't actually the historical owner.
//
// Final fix: no guessing, anywhere. Every generation is fully isolated by an EXACT (wallet, pool, chain,
// positionManager) match — a plain filter, nothing more. An ambiguous, still-unresolved legacy event
// (positionManager: null) is simply excluded from every generation's replay; it stays invisible until
// something else (scripts/verify-gateway-pm-attribution.mjs, using real on-chain receipt data) resolves
// it to a real PM. `replayCostBasis` above already does everything a single generation's replay needs —
// filter this identity's events to the exact PM, sort by chain order, replay. No separate function
// is needed any more: `events.filter(e => e.positionManager === pm).sort(...)` then `replayCostBasis`.
