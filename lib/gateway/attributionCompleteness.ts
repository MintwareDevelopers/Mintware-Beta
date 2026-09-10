// Whether a wallet's LP-gateway cost-basis history for a given pool/chain might still be incomplete.
// Two independent reasons, both checked:
//   (1) `gateway_deposit_events` holds an ORPHANED (`position_manager IS NULL`) row for that exact
//       `(address, pool_address, chain_id)` — real historical activity not yet attributed to any
//       generation at all.
//   (2) it holds a RESOLVED row (position_manager IS NOT NULL) that is missing its own kind-appropriate
//       share field (`shares_minted` for a deposit, `shares_burned` for a withdraw) — a sibling identity
//       `apply_gateway_pm_attribution` (migration 20260909000007) deliberately SKIPS recomputing when it
//       has this kind of data gap, rather than block a different, otherwise-complete sibling PM's own
//       atomic win. That design is correct (never guess over an incomplete history) but means such a
//       sibling's OWN `gateway_positions` row can sit stale indefinitely with nothing else surfacing it
//       (Codex, 2026-09-10: "the read completeness flag still checks only orphan existence... persist/
//       reveal that incomplete sibling status before claiming every returned basis complete").
//
// User concern (2026-09-10, following the PM-attribution recovery work): "Prevent incomplete historical
// data from appearing as a complete cost basis." The exact-match-only design (migration 20260909000005,
// Codex's to-do items 3/4) never merges ambiguous history into any generation's basis — correct, but with
// the quiet side effect above (case 1) plus the gap case (case 2). This module exists so every reader of
// a position surfaces either honestly instead of presenting a partial basis as if it were the whole
// picture — never silently, never a guess either way (an unverifiable check fails closed to "incomplete").
//
// NOT covered (an accepted, narrower residual): a resolved sibling whose fields are ALL populated but
// whose OWN replay would go negative (an "over-burn" — a withdraw burning more than was ever minted for
// that specific identity). Detecting that cheaply on every position read would need a full per-identity
// replay in the hot read path; it is rare (implies corrupted/inconsistent historical data, not merely
// unattributed history) and is not checked here.

type SupabaseLike = { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

const PAGE_SIZE = 1000

/** Pages a query with a deterministic `id ASC` order, advancing by the ACTUAL row count each page
 *  returns (never a fixed page size) so a server-enforced cap lower than PAGE_SIZE can't cause premature
 *  termination — same discipline as scripts/verify-gateway-pm-attribution.mjs's own paginateAll, applied
 *  here because `fetchUnresolvedPoolChainKeys` fans out across a WHOLE wallet's event history and, unlike
 *  the single-pool `hasUnresolvedHistory` (bounded by `.limit(1)`), has no bound of its own without this.
 *  `queryFactory` must return a fresh query (missing only `.order()`/`.range()`) — Supabase builders are
 *  single-use per chain. Returns `null` (propagate a read failure) the first time any page errors. */
async function paginateAll<T>(queryFactory: () => any): Promise<T[] | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = []
  for (let from = 0; ; ) {
    const { data, error } = await queryFactory().order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) return null
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length === 0) break
    from += rows.length
  }
  return out
}

async function hasGapRow(supabase: SupabaseLike, address: string, poolAddress: string, chainId: number): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('gateway_deposit_events')
    .select('id')
    .eq('address', address.toLowerCase())
    .eq('pool_address', poolAddress.toLowerCase())
    .eq('chain_id', chainId)
    .not('position_manager', 'is', null)
    .or('and(kind.eq.deposit,shares_minted.is.null),and(kind.eq.withdraw,shares_burned.is.null)')
    .limit(1)
  if (error) return null
  return (data?.length ?? 0) > 0
}

/** Single-pool check — for routes that already resolve one specific instance
 *  (`/api/gateway/position`). Returns `true` (assume incomplete) when either reason above applies, or
 *  when the check itself can't be verified — never claims completeness on a failed read. */
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
  if ((data?.length ?? 0) > 0) return true

  const gap = await hasGapRow(supabase, address, poolAddress, chainId)
  if (gap === null) return true // fail closed
  return gap
}

/** Batch form — for routes that fan out across many pools per request (`/api/gateway/positions`) and
 *  must not issue one completeness query per pool. Returns a Set of `poolAddress:chainId` keys (pool
 *  lowercased) covering EITHER reason above, or `null` on a read failure — callers must treat a `null`
 *  result as "every pool unverified, so none may be reported complete," never as "nothing incomplete." */
export async function fetchUnresolvedPoolChainKeys(supabase: SupabaseLike, address: string): Promise<Set<string> | null> {
  type Row = { pool_address: string; chain_id: number }
  const orphaned = await paginateAll<Row>(() =>
    supabase.from('gateway_deposit_events').select('id, pool_address, chain_id').eq('address', address.toLowerCase()).is('position_manager', null))
  if (orphaned === null) return null

  const gappy = await paginateAll<Row>(() =>
    supabase.from('gateway_deposit_events').select('id, pool_address, chain_id')
      .eq('address', address.toLowerCase())
      .not('position_manager', 'is', null)
      .or('and(kind.eq.deposit,shares_minted.is.null),and(kind.eq.withdraw,shares_burned.is.null)'))
  if (gappy === null) return null

  const keys = new Set<string>()
  for (const row of [...orphaned, ...gappy]) {
    keys.add(`${String(row.pool_address).toLowerCase()}:${Number(row.chain_id)}`)
  }
  return keys
}
