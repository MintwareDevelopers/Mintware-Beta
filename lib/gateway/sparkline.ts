// Price-trend sparklines (Meteora standard) for the Discover feed. Pulls 24×1h close prices per pool
// from GeckoTerminal's OHLCV endpoint (v4 poolIds are accepted verbatim). Read-only, fail-soft: any pool
// that errors/rate-limits is simply omitted, so a sparkline never blocks or breaks the table. Kept out of
// the main /discover call (which has a 6s budget) — this is its own cached endpoint.

type Logger = { warn: (t: string, m: string, c?: Record<string, unknown>) => void }

const MAX_POOLS = 16 // bound the GeckoTerminal burst (free tier ~30 req/min); the feed shows ≤~30 pools

/** Accept only a 20-byte address or a 32-byte v4 poolId (mirrors discovery.ts) so a caller-supplied id
 *  can never inject an arbitrary path segment into the upstream URL. */
function validId(v: string): string | null {
  const s = String(v ?? '').toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(s) || /^0x[0-9a-f]{64}$/.test(s) ? s : null
}

async function oneSeries(network: string, poolId: string, log?: Logger): Promise<number[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolId}/ohlcv/hour?limit=24&currency=token`,
      { headers: { accept: 'application/json' }, signal: ctrl.signal },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } }
    const list = json.data?.attributes?.ohlcv_list ?? []
    // ohlcv_list is [ts, open, high, low, close, volume], newest-first → take closes, oldest→newest.
    const closes = list.map((c) => Number(c?.[4])).filter((n) => Number.isFinite(n) && n > 0).reverse()
    return closes.length >= 3 ? closes : null
  } catch (e) {
    log?.warn('gateway.sparkline', 'ohlcv error', { poolId, error: String(e) })
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch close-price series for the given pools (capped, in parallel, fail-soft). Returns a map
 *  poolId → number[] (oldest→newest); pools that fail are absent from the map. */
export async function fetchSparklines(poolAddresses: string[], opts: { network?: string; log?: Logger } = {}): Promise<Record<string, number[]>> {
  const network = opts.network ?? process.env.LP_GATEWAY_GT_NETWORK ?? 'robinhood'
  const ids = Array.from(new Set(poolAddresses.map(validId).filter((x): x is string => !!x))).slice(0, MAX_POOLS)
  const out: Record<string, number[]> = {}
  await Promise.all(
    ids.map(async (id) => {
      const s = await oneSeries(network, id, opts.log)
      if (s) out[id] = s
    }),
  )
  return out
}
