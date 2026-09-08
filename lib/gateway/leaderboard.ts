// LP-gateway leaderboard — pure ranking math. No I/O.
//
// O-11 (consolidated audit 2026-09-08): the old board summed DB `entry_nav`, which inflates whenever a
// withdraw goes unrecorded. The board now ranks CHAIN truth: for each depositor address (DB rows are the
// address SOURCE only, never a money number) the caller reads `sharesOf(addr)` + `totalShares()` +
// `totalNav()` per active instance on-chain (lib/gateway/chainTruth.ts) and this module turns those into
// standings — value = shares × totalNav / totalShares using the contract's own offset-consistent floor
// (`positionValueAtomic`, lib/gateway/positionReader.ts), summed across instances. BigInt throughout;
// amounts are atomic units of the quote asset (USDG, 6dp).
//
// Ranks OBSERVABLE capital at work only — never a trust/credit signal and never the Attribution score.

import { positionValueAtomic } from '@/lib/gateway/positionReader'

/** One instance's on-chain snapshot: pooled totals + each known depositor's shares. */
export type InstanceHoldings = {
  poolAddress: string
  totalShares: bigint
  totalNav: bigint
  /** wallet (lowercased) → sharesOf(wallet) */
  shares: ReadonlyMap<string, bigint>
}

export type ProviderStanding = {
  rank: number
  wallet: string
  /** Σ over instances of the wallet's current position value (atomic quote units). */
  valueAtomic: bigint
  /** Σ shares across instances (informational — shares are per-pool units, not comparable across pools). */
  shares: bigint
  /** Number of instances where the wallet holds > 0 shares. */
  pools: number
}

const cmpDesc = (a: bigint, b: bigint) => (a < b ? 1 : a > b ? -1 : 0)

/** Aggregate + rank. Wallets with zero shares everywhere are dropped. Ties on value share a rank
 *  (competition ranking: 1, 2, 2, 4) and are ordered by wallet for determinism. */
export function rankProviders(holdings: readonly InstanceHoldings[]): ProviderStanding[] {
  const byWallet = new Map<string, { value: bigint; shares: bigint; pools: number }>()
  for (const inst of holdings) {
    for (const [rawWallet, sh] of inst.shares) {
      if (sh <= 0n) continue
      const wallet = rawWallet.toLowerCase()
      const value = positionValueAtomic(sh, inst.totalShares, inst.totalNav)
      const e = byWallet.get(wallet) ?? { value: 0n, shares: 0n, pools: 0 }
      e.value += value
      e.shares += sh
      e.pools += 1
      byWallet.set(wallet, e)
    }
  }

  const sorted = [...byWallet.entries()]
    .map(([wallet, e]) => ({ wallet, valueAtomic: e.value, shares: e.shares, pools: e.pools }))
    .sort((a, b) => cmpDesc(a.valueAtomic, b.valueAtomic) || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))

  const out: ProviderStanding[] = []
  for (let i = 0; i < sorted.length; i++) {
    const prev = out[i - 1]
    const rank = prev && prev.valueAtomic === sorted[i].valueAtomic ? prev.rank : i + 1
    out.push({ rank, ...sorted[i] })
  }
  return out
}

/** The DEGRADED path — the old Σ entry_nav aggregation, kept only as an explicitly-flagged fallback when
 *  the chain is unreadable. Never mixed with chain standings. Uses the same competition ranking. */
export function rankProvidersFromDb(
  rows: readonly { user_wallet: string; entry_nav: unknown; pool_address: string }[],
): ProviderStanding[] {
  const byWallet = new Map<string, { value: bigint; pools: Set<string> }>()
  for (const r of rows) {
    const wallet = String(r.user_wallet).toLowerCase()
    let cap = 0n
    try { cap = BigInt(String(r.entry_nav ?? '0')) } catch { cap = 0n }
    if (cap <= 0n) continue
    const e = byWallet.get(wallet) ?? { value: 0n, pools: new Set<string>() }
    e.value += cap
    e.pools.add(String(r.pool_address).toLowerCase())
    byWallet.set(wallet, e)
  }
  const sorted = [...byWallet.entries()]
    .map(([wallet, e]) => ({ wallet, valueAtomic: e.value, shares: 0n, pools: e.pools.size }))
    .sort((a, b) => cmpDesc(a.valueAtomic, b.valueAtomic) || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))
  const out: ProviderStanding[] = []
  for (let i = 0; i < sorted.length; i++) {
    const prev = out[i - 1]
    const rank = prev && prev.valueAtomic === sorted[i].valueAtomic ? prev.rank : i + 1
    out.push({ rank, ...sorted[i] })
  }
  return out
}

/** Σ value across standings (for the "at work across the board" footer). */
export function totalValueAtomic(standings: readonly ProviderStanding[]): bigint {
  return standings.reduce((s, p) => s + p.valueAtomic, 0n)
}
