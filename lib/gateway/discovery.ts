// Auto-surface the hottest pools → curated candidate queue. Fetches the top pools by 24h volume from
// GeckoTerminal (RH Chain network slug "robinhood"), maps each to a candidate with hotness + cheap
// safety signals + a risk score (lib/gateway/riskScore.ts), and upserts the ELIGIBLE ones (v4 +
// USDG-quoted) as pending requests. It NEVER auto-approves — every candidate lands as pending for a
// human. The score only ranks the queue. Already-resolved requests + already-live pools are skipped.

import { getServiceClient } from '@/lib/web2/supabase'
import { computeRisk, type PoolSignals } from '@/lib/gateway/riskScore'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { info: (t: string, m: string, c?: Record<string, unknown>) => void; warn: (t: string, m: string, c?: Record<string, unknown>) => void }

type GtPool = {
  attributes?: {
    address?: string
    name?: string
    reserve_in_usd?: string | number
    pool_created_at?: string
    volume_usd?: { h24?: string | number }
    transactions?: { h24?: { buys?: number; sells?: number } }
  }
  relationships?: {
    dex?: { data?: { id?: string } }
    base_token?: { data?: { id?: string } }
    quote_token?: { data?: { id?: string } }
  }
}

export type PoolCandidate = {
  poolAddress: string
  pairLabel: string
  tvlUsd: number
  vol24Usd: number
  signals: PoolSignals
  score: number
  verdict: 'ineligible' | 'review'
  reasons: string[]
}

const tokenAddr = (id?: string) => (id ? id.split('_').pop()?.toLowerCase() : undefined)

/** Pure: map one GeckoTerminal pool → a scored candidate. `usdgAddress` (when known) is matched against
 *  the pool's legs; otherwise USDG is detected from the pair name. */
export function poolToCandidate(pool: GtPool, opts: { usdgAddress?: string } = {}): PoolCandidate {
  const a = pool.attributes ?? {}
  const dexId = pool.relationships?.dex?.data?.id ?? ''
  const protocol = dexId.includes('v4') ? 'v4' : dexId.includes('v3') ? 'v3' : dexId.includes('v2') ? 'v2' : 'unknown'
  const tvlUsd = Number(a.reserve_in_usd ?? 0)
  const vol24Usd = Number(a.volume_usd?.h24 ?? 0)
  const name = String(a.name ?? '')

  const usdg = opts.usdgAddress?.toLowerCase()
  const base = tokenAddr(pool.relationships?.base_token?.data?.id)
  const quote = tokenAddr(pool.relationships?.quote_token?.data?.id)
  const usdgQuoted = usdg ? base === usdg || quote === usdg : /(^|[^a-z])usdg([^a-z]|$)/i.test(name)

  const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN
  const poolAgeDays = Number.isFinite(created) ? Math.floor((Date.now() - created) / 86_400_000) : null
  const tx = a.transactions?.h24
  const txCount24 = tx ? Number(tx.buys ?? 0) + Number(tx.sells ?? 0) : null

  const signals: PoolSignals = {
    protocol: protocol as PoolSignals['protocol'],
    usdgQuoted,
    poolAgeDays,
    tvlUsd,
    vol24Usd,
    volTvlRatio: tvlUsd > 0 ? vol24Usd / tvlUsd : null,
    txCount24,
  }
  const risk = computeRisk(signals)
  return {
    poolAddress: String(a.address ?? '').toLowerCase(),
    pairLabel: name,
    tvlUsd,
    vol24Usd,
    signals,
    score: risk.score,
    verdict: risk.verdict,
    reasons: risk.reasons,
  }
}

/** Read-only: fetch the hottest pools (by 24h volume) for the network and map each to a scored
 *  candidate — no DB writes. Powers the Discover surface (live browse of real RH-Chain pools). */
export async function fetchHotPools(opts: { usdgAddress?: string; limit?: number; log?: Logger } = {}): Promise<PoolCandidate[]> {
  const network = process.env.LP_GATEWAY_GT_NETWORK ?? 'robinhood'
  const usdgAddress = (opts.usdgAddress ?? process.env.LP_GATEWAY_USDG)?.toLowerCase()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000) // never hang the caller on a slow upstream
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/pools?sort=h24_volume_usd_desc`, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      opts.log?.warn('gateway.discover', 'geckoterminal fetch failed', { status: res.status })
      return []
    }
    const json = (await res.json()) as { data?: GtPool[] }
    return (json.data ?? []).slice(0, opts.limit ?? 30).map((p) => poolToCandidate(p, { usdgAddress }))
  } catch (e) {
    opts.log?.warn('gateway.discover', 'geckoterminal error', { error: String(e) })
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function discoverAndIngest(opts: {
  supabase: SupabaseClient
  chainId: number
  log?: Logger
}): Promise<{ scanned: number; ingested: number; skipped: number }> {
  const { supabase, chainId, log } = opts
  const network = process.env.LP_GATEWAY_GT_NETWORK ?? 'robinhood'
  const usdgAddress = process.env.LP_GATEWAY_USDG?.toLowerCase()

  let pools: GtPool[] = []
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/pools?sort=h24_volume_usd_desc`, {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      log?.warn('gateway.discover', 'geckoterminal fetch failed', { status: res.status })
      return { scanned: 0, ingested: 0, skipped: 0 }
    }
    const json = (await res.json()) as { data?: GtPool[] }
    pools = (json.data ?? []).slice(0, 30)
  } catch (e) {
    log?.warn('gateway.discover', 'geckoterminal error', { error: String(e) })
    return { scanned: 0, ingested: 0, skipped: 0 }
  }

  let ingested = 0
  let skipped = 0
  for (const p of pools) {
    const c = poolToCandidate(p, { usdgAddress })
    if (c.verdict === 'ineligible' || !c.poolAddress) {
      skipped++
      continue
    }
    // already live?
    const { data: inst } = await supabase
      .from('gateway_instances')
      .select('id')
      .eq('pool_address', c.poolAddress)
      .eq('chain_id', chainId)
      .maybeSingle()
    if (inst) {
      skipped++
      continue
    }
    // respect a curator's prior decision (approved/rejected) — only refresh a pending auto-candidate
    const { data: existing } = await supabase
      .from('gateway_pool_requests')
      .select('id, status')
      .eq('pool_address', c.poolAddress)
      .eq('chain_id', chainId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing && existing.status !== 'pending') {
      skipped++
      continue
    }
    const row = {
      pool_address: c.poolAddress,
      chain_id: chainId,
      pair_label: c.pairLabel,
      quote_asset: usdgAddress ?? null,
      status: 'pending' as const,
      source: 'auto' as const,
      risk_score: c.score,
      risk_signals: { ...c.signals, reasons: c.reasons },
      hotness: { tvlUsd: c.tvlUsd, vol24Usd: c.vol24Usd, volTvlRatio: c.signals.volTvlRatio },
    }
    if (existing) {
      await supabase.from('gateway_pool_requests').update(row).eq('id', String(existing.id))
    } else {
      await supabase.from('gateway_pool_requests').insert(row)
    }
    ingested++
  }
  return { scanned: pools.length, ingested, skipped }
}
