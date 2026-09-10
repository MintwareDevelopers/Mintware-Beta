// Whether a wallet's LP-gateway cost-basis history for a given pool/chain might still be incomplete —
// i.e. whether `gateway_deposit_events` holds an orphaned (`position_manager IS NULL`) row for that
// exact `(address, pool_address, chain_id)`.
//
// User concern (2026-09-10, following the PM-attribution recovery work): "Prevent incomplete historical
// data from appearing as a complete cost basis." An orphaned row predates PM-generation tracking (or is a
// not-yet-resolved historical row) and is — by the exact-match-only design (migration
// 20260909000005, Codex's to-do items 3/4) — NEVER merged into any generation's basis. That design
// closed the WRONG-basis bug (silently attributing ambiguous history to whichever generation asked
// first), but it has a quieter side effect: a cost basis shown for a specific position manager can look
// perfectly complete while real historical activity for this exact wallet/pool is still sitting,
// unattributed, in an orphaned row until `scripts/verify-gateway-pm-attribution.mjs` resolves it from a
// real on-chain receipt. This module exists so every reader of a position surfaces that honestly instead
// of presenting a partial basis as if it were the whole picture — never silently, never a guess either
// way (an unverifiable check fails closed to "incomplete", not "complete").

type SupabaseLike = { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Single-pool check — one query, for routes that already resolve one specific instance
 *  (`/api/gateway/position`). Returns `true` (assume incomplete) when the check itself can't be
 *  verified — never claims completeness on a failed read. */
export async function hasUnresolvedHistory(
  supabase: SupabaseLike,
  address: string,
  poolAddress: string,
  chainId: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('gateway_deposit_events')
    .select('id')
    .eq('address', address.toLowerCase())
    .eq('pool_address', poolAddress.toLowerCase())
    .eq('chain_id', chainId)
    .is('position_manager', null)
    .limit(1)
  if (error) return true // fail closed: unverifiable ⇒ treat as incomplete, never silently claim completeness
  return (data?.length ?? 0) > 0
}

/** Batch form — one query covering every pool/chain a wallet has an orphaned row in, for routes that fan
 *  out across many pools per request (`/api/gateway/positions`) and must not issue one completeness
 *  query per pool. Returns a Set of `poolAddress:chainId` keys (pool lowercased) that have at least one
 *  orphaned row, or `null` on a read failure — callers must treat a `null` result as "every pool
 *  unverified, so none may be reported complete," never as "nothing orphaned." */
export async function fetchUnresolvedPoolChainKeys(supabase: SupabaseLike, address: string): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from('gateway_deposit_events')
    .select('pool_address, chain_id')
    .eq('address', address.toLowerCase())
    .is('position_manager', null)
  if (error) return null
  const keys = new Set<string>()
  for (const row of (data ?? []) as { pool_address: string; chain_id: number }[]) {
    keys.add(`${String(row.pool_address).toLowerCase()}:${Number(row.chain_id)}`)
  }
  return keys
}
