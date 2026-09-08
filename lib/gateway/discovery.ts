// Auto-surface the hottest pools → curated candidate queue. Fetches the top pools by 24h volume from
// GeckoTerminal (RH Chain network slug "robinhood"), maps each to a candidate with hotness + cheap
// safety signals + a risk score (lib/gateway/riskScore.ts), and upserts the ELIGIBLE ones (v4 +
// USDG-quoted) as pending requests. It NEVER auto-approves — every candidate lands as pending for a
// human. The score only ranks the queue. Already-resolved requests + already-live pools are skipped.
//
// Round-2 audit O-7 (R-4 feed poisoning) — everything GeckoTerminal returns is UNTRUSTED:
//   • the risk score sees only clamped numerics (riskScore.ts) — never name/symbol/url text;
//   • USDG-quotedness is decided by ADDRESS against `LP_GATEWAY_USDG` only. Unset ⇒ quote UNKNOWN ⇒
//     every pool ineligible (fail-closed) + a warning. Never by the pair name;
//   • token logos pass only when https AND on an allowlisted CDN host (else null → UI initials);
//   • the fee tier is read from the pool's own fee field when present and only accepted from the pair
//     name when it lands on a sane tier (≤ MAX_FEE_PCT); est. APR is bounded (n/a above MAX_EST_APR_PCT
//     or below a TVL floor);
//   • upstream fetch has a timeout (8 s) + bounded retries, and the payload SHAPE is validated so a
//     malformed body can never throw out of the cron;
//   • pruning never touches curator-decided or manual rows, and evicts an auto candidate only after a
//     grace window (`LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS`, default 72 h) of not being seen.

import { getServiceClient } from '@/lib/web2/supabase'
import { computeRisk, SIGNAL_BOUNDS, type PoolSignals } from '@/lib/gateway/riskScore'

// ── Untrusted-input guards (audit L-09 + O-7) ────────────────────────────────────────────────────
// Everything below flows verbatim from GeckoTerminal, an external API we don't control. Coerce it so
// a malformed/hostile payload can never write NaN/Infinity into a metric, an over-long or control-char
// label into a queue row, or a non-address into the pool_address (curation) key.

/** Number() that never yields NaN/Infinity — a non-finite result coerces to `fallback` (default 0). */
function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const MAX_LABEL_LEN = 64

/** Fee tiers above this are not a real market (v4 allows up to 100%, but no curated pool runs one) —
 *  anything larger is treated as UNKNOWN, never trusted from a name suffix. */
export const MAX_FEE_PCT = SIGNAL_BOUNDS.feePct.max
/** Est. fee APR above this is meaningless (a $1 TVL pool with $1B volume) → shown as n/a. */
export const MAX_EST_APR_PCT = 10_000
/** Below this TVL the vol/TVL annualization is noise → est. APR is n/a. */
export const MIN_TVL_FOR_APR_USD = 1_000
/** Default fetch budget + retries for the GeckoTerminal read (O-7 / HO-16). */
export const GT_FETCH_TIMEOUT_MS = 8_000
export const GT_FETCH_RETRIES = 2
/** Token-logo hosts we will render. Suffix-matched (a sub-host of these CDNs is fine); nothing else. */
export const IMG_HOST_ALLOWLIST = ['assets.geckoterminal.com', 'coin-images.coingecko.com', 'assets.coingecko.com'] as const
const IMG_HOST_SUFFIXES = ['.geckoterminal.com', '.coingecko.com'] as const

/** A pool's on-chain identifier is EITHER a 20-byte EVM address (a v2/v3 pool contract) OR a 32-byte
 *  Uniswap v4 poolId — v4 pools have no address of their own, so GeckoTerminal returns the poolId here.
 *  Accept both shapes; anything else ⇒ '' so the candidate is skipped and no bogus curation key is ever
 *  written (L-09). Using the plain hex shape (not viem `isAddress`, which is 20-byte only) is what lets
 *  the v4-only gateway actually surface v4 pools instead of dropping every one of them. */
export function normalizePoolId(v: unknown): string {
  const s = String(v ?? '').toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(s) || /^0x[0-9a-f]{64}$/.test(s) ? s : ''
}

/** Strip control chars (incl. newlines/zero-width breakers) and cap length — the label is displayed
 *  and persisted, so it must be bounded, printable text. */
export function sanitizeLabel(name: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(name ?? '').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '').trim().slice(0, MAX_LABEL_LEN)
}

/** Only pass through an https image URL on an allowlisted CDN host (GeckoTerminal / CoinGecko). Anything
 *  else ⇒ null so a hostile/malformed payload can never inject a non-image, a data:/js: URL, or a
 *  third-party tracking pixel into an <img> src (L-09, O-7). The page falls back to token initials. */
export function safeImg(v: unknown): string | null {
  const s = String(v ?? '')
  if (s.length > 2048 || /[\s"'<>]/.test(s)) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  const allowed = (IMG_HOST_ALLOWLIST as readonly string[]).includes(host) || IMG_HOST_SUFFIXES.some((suf) => host.endsWith(suf))
  return allowed ? u.toString() : null
}

/** Fee tier (percent) — the pool's own fee field wins when present; the pair-name suffix is accepted only
 *  when it lands on a sane tier (≤ MAX_FEE_PCT). Anything else ⇒ null (unknown), never a 99% "tier". */
export function parseFeePct(attrs: { pool_fee_percentage?: unknown; fee_percentage?: unknown; fee_tier?: unknown }, name: string): number | null {
  const inRange = (n: number) => Number.isFinite(n) && n > 0 && n <= MAX_FEE_PCT
  for (const raw of [attrs.pool_fee_percentage, attrs.fee_percentage, attrs.fee_tier]) {
    if (raw == null || raw === '') continue
    const n = Number(String(raw).replace('%', ''))
    return inRange(n) ? n : null // a present-but-insane field means we do NOT fall back to the name
  }
  const m = name.match(/(\d+(?:\.\d+)?)\s*%/)
  if (!m) return null
  const n = Number(m[1])
  return inRange(n) ? n : null
}

/** Trailing est. fee APR (%) = feeRate × 24h vol ÷ TVL × 365. Bounded: n/a when the fee tier is unknown,
 *  TVL is below the floor, or the result exceeds MAX_EST_APR_PCT (a tiny-TVL pool can't "earn" 1e13%). */
export function estimateFeeAprPct(feePct: number | null, vol24Usd: number, tvlUsd: number): number | null {
  if (feePct == null || !(tvlUsd >= MIN_TVL_FOR_APR_USD) || !(vol24Usd >= 0)) return null
  const apr = (feePct / 100) * vol24Usd / tvlUsd * 365 * 100
  return Number.isFinite(apr) && apr >= 0 && apr <= MAX_EST_APR_PCT ? apr : null
}

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { info: (t: string, m: string, c?: Record<string, unknown>) => void; warn: (t: string, m: string, c?: Record<string, unknown>) => void }

/** A GeckoTerminal token object from the `?include=base_token,quote_token` sideload. */
export type GtToken = { id?: string; attributes?: { symbol?: string; image_url?: string | null } }

export type GtPool = {
  attributes?: {
    address?: string
    name?: string
    reserve_in_usd?: string | number
    pool_created_at?: string
    base_token_price_quote_token?: string | number
    volume_usd?: { h24?: string | number }
    transactions?: { h24?: { buys?: number; sells?: number } }
    pool_fee_percentage?: string | number
    fee_percentage?: string | number
    fee_tier?: string | number
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
  priceQuotePerBase: number | null // 1 base ≈ N quote (current pool price)
  // Token addresses behind `priceQuotePerBase` (lower-cased 20-byte, or null when GeckoTerminal did not resolve them).
  // Round-3 XR-2: the deploy cron uses these to orient the external price against the pool's own quote/paired legs.
  baseToken: string | null
  quoteToken: string | null
  signals: PoolSignals
  score: number
  verdict: 'ineligible' | 'review'
  reasons: string[]
  // ── display enrichment (Meteora/Krystal parity) — from the token sideload + the pair name ──
  baseSymbol: string
  quoteSymbol: string
  baseLogo: string | null   // token logo URL (https + allowlisted CDN) or null → the UI shows initials
  quoteLogo: string | null
  feePct: number | null     // fee tier (pool field, else a sane name suffix) — null when unknown
  // Trailing est. fee APR = feeRate × 24h volume ÷ TVL, annualized (%). The list-level estimate (the
  // detail page recomputes it from the on-chain fee). Bounded; null = n/a. Never a projection/guarantee.
  estFeeAprPct: number | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** GeckoTerminal token ids are `<network>_<address>`; resolve the address leg, 20-byte hex only. */
function tokenAddr(id?: unknown): string | undefined {
  if (typeof id !== 'string') return undefined
  const a = id.split('_').pop()?.toLowerCase() ?? ''
  return /^0x[0-9a-f]{40}$/.test(a) ? a : undefined
}

/** Pure: map one GeckoTerminal pool → a scored candidate. USDG is matched by ADDRESS only: when
 *  `usdgAddress` is absent the quote asset is UNKNOWN (`usdgQuoted: null` → ineligible, fail-closed). */
export function poolToCandidate(pool: GtPool, opts: { usdgAddress?: string; tokensById?: Map<string, GtToken> } = {}): PoolCandidate {
  const a = isRecord(pool?.attributes) ? (pool.attributes as NonNullable<GtPool['attributes']>) : {}
  const rel = isRecord(pool?.relationships) ? (pool.relationships as NonNullable<GtPool['relationships']>) : {}
  const dexId = typeof rel.dex?.data?.id === 'string' ? rel.dex.data.id : ''
  const protocol = dexId.includes('v4') ? 'v4' : dexId.includes('v3') ? 'v3' : dexId.includes('v2') ? 'v2' : 'unknown'
  const tvlUsd = Math.max(0, safeNum(a.reserve_in_usd))
  const vol24Usd = Math.max(0, safeNum(a.volume_usd?.h24))
  const name = sanitizeLabel(a.name)

  const usdg = normalizePoolId(opts.usdgAddress) || undefined // 20-byte only in practice; '' ⇒ unknown
  const base = tokenAddr(rel.base_token?.data?.id)
  const quote = tokenAddr(rel.quote_token?.data?.id)
  const tokensResolved = !!base && !!quote
  // ADDRESS-only match. No configured USDG ⇒ null (unknown) — never the pair name (O-7).
  const usdgQuoted: boolean | null = usdg ? base === usdg || quote === usdg : null

  // ── token display (logos + symbols): prefer the sideloaded token objects, fall back to the pair name ──
  const baseId = rel.base_token?.data?.id
  const quoteId = rel.quote_token?.data?.id
  const baseTok = typeof baseId === 'string' ? opts.tokensById?.get(baseId) : undefined
  const quoteTok = typeof quoteId === 'string' ? opts.tokensById?.get(quoteId) : undefined
  const [nameBase, nameQuote] = name.split('/').map((s) => s.replace(/\s*\d.*$/, '').trim()) // "MEME / USDG 0.7%" → ["MEME","USDG"]
  const baseSymbol = sanitizeLabel(baseTok?.attributes?.symbol) || nameBase || 'TOKEN'
  const quoteSymbol = sanitizeLabel(quoteTok?.attributes?.symbol) || nameQuote || 'USDG'
  const baseLogo = safeImg(baseTok?.attributes?.image_url)
  const quoteLogo = safeImg(quoteTok?.attributes?.image_url)

  // Fee tier: the pool's own field first, else a SANE name suffix; bounded est. APR (O-7).
  const feePct = parseFeePct(a, name)
  const estFeeAprPct = estimateFeeAprPct(feePct, vol24Usd, tvlUsd)

  const created = typeof a.pool_created_at === 'string' ? Date.parse(a.pool_created_at) : NaN
  const poolAgeDays = Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86_400_000)) : null
  const tx = a.transactions?.h24
  const txCount24 = isRecord(tx) ? safeNum(tx.buys) + safeNum(tx.sells) : null

  const signals: PoolSignals = {
    protocol: protocol as PoolSignals['protocol'],
    usdgQuoted,
    poolAgeDays,
    tvlUsd,
    vol24Usd,
    volTvlRatio: tvlUsd > 0 ? vol24Usd / tvlUsd : null,
    txCount24,
    feePct,
    tokensResolved,
  }
  const risk = computeRisk(signals)
  const price = safeNum(a.base_token_price_quote_token)
  // Accept a 20-byte address OR a 32-byte v4 poolId; anything else ⇒ '' so discoverAndIngest skips it
  // (it guards on `!c.poolAddress`) and never writes a bogus curation key.
  const poolAddress = normalizePoolId(a.address)
  return {
    poolAddress,
    pairLabel: name,
    tvlUsd,
    vol24Usd,
    priceQuotePerBase: Number.isFinite(price) && price > 0 ? price : null,
    baseToken: base ?? null,
    quoteToken: quote ?? null,
    signals,
    score: risk.score,
    verdict: risk.verdict,
    reasons: risk.reasons,
    baseSymbol,
    quoteSymbol,
    baseLogo,
    quoteLogo,
    feePct,
    estFeeAprPct,
  }
}

// ── Upstream read: timeout + bounded retries + shape validation (O-7 / HO-16) ─────────────────────

/** The GeckoTerminal network slug — env-overridable but shape-checked so it can never inject a path. */
export function gtNetwork(): string {
  const n = (process.env.LP_GATEWAY_GT_NETWORK ?? 'robinhood').toLowerCase()
  return /^[a-z0-9-]{1,40}$/.test(n) ? n : 'robinhood'
}

export type GtFetchResult = { ok: boolean; status?: number; pools: GtPool[]; tokens: GtToken[]; attempts: number; error?: string }

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve())

/** Validate the JSON:API shape we depend on: `data` must be an array of objects (non-objects dropped),
 *  `included` an array of objects. Anything else ⇒ empty, never a throw. */
export function validateGtPayload(json: unknown): { pools: GtPool[]; tokens: GtToken[] } {
  if (!isRecord(json)) return { pools: [], tokens: [] }
  const data = Array.isArray(json.data) ? json.data.filter(isRecord) : []
  const included = Array.isArray(json.included) ? json.included.filter(isRecord) : []
  return { pools: data as GtPool[], tokens: included as GtToken[] }
}

/** Fetch the top pools (by 24h volume) with an AbortController timeout and bounded retries. Retries only
 *  on a network/timeout error or a 5xx; a 4xx (incl. 429) is returned as-is so we never amplify a rate
 *  limit. Never throws — the cron and the public route both stay up on a hostile/malformed upstream. */
export async function fetchGtPools(opts: {
  network?: string
  include?: boolean
  log?: Logger
  timeoutMs?: number
  retries?: number
  backoffMs?: number
} = {}): Promise<GtFetchResult> {
  const network = opts.network ?? gtNetwork()
  const timeoutMs = opts.timeoutMs ?? GT_FETCH_TIMEOUT_MS
  const retries = Math.max(0, opts.retries ?? GT_FETCH_RETRIES)
  const backoffMs = opts.backoffMs ?? 250
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools?sort=h24_volume_usd_desc${opts.include ? '&include=base_token,quote_token' : ''}`
  let lastError = ''
  let lastStatus: number | undefined
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal })
      lastStatus = res.status
      if (!res.ok) {
        opts.log?.warn('gateway.discover', 'geckoterminal fetch failed', { status: res.status, attempt })
        if (res.status >= 500 && attempt <= retries) {
          await sleep(backoffMs * attempt)
          continue
        }
        return { ok: false, status: res.status, pools: [], tokens: [], attempts: attempt }
      }
      let json: unknown
      try {
        json = await res.json()
      } catch (e) {
        // A 200 with a non-JSON body is a malformed upstream, not a transient — don't retry, don't throw.
        opts.log?.warn('gateway.discover', 'geckoterminal payload not JSON', { error: String(e) })
        return { ok: false, status: res.status, pools: [], tokens: [], attempts: attempt, error: 'malformed_payload' }
      }
      const { pools, tokens } = validateGtPayload(json)
      return { ok: true, status: res.status, pools, tokens, attempts: attempt }
    } catch (e) {
      lastError = String(e)
      opts.log?.warn('gateway.discover', 'geckoterminal error', { error: lastError, attempt })
      if (attempt <= retries) await sleep(backoffMs * attempt)
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status: lastStatus, pools: [], tokens: [], attempts: retries + 1, error: lastError || 'exhausted' }
}

/** Resolve the configured USDG address (20-byte, lowercased) or undefined — and warn ONCE per call site
 *  when it is unset, because that makes every pool ineligible (fail-closed, O-7). */
function resolveUsdg(explicit: string | undefined, log?: Logger): string | undefined {
  const raw = explicit ?? process.env.LP_GATEWAY_USDG
  const addr = normalizePoolId(raw)
  if (!addr || addr.length !== 42) {
    log?.warn('gateway.discover', 'LP_GATEWAY_USDG unset/invalid — quote asset unknown; NO pool is eligible until it is set (fail-closed, never matched by name)', {
      configured: !!raw,
    })
    return undefined
  }
  return addr
}

/** Read-only: fetch the hottest pools (by 24h volume) for the network and map each to a scored
 *  candidate — no DB writes. Powers the Discover surface (live browse of real RH-Chain pools). */
export async function fetchHotPools(opts: { usdgAddress?: string; limit?: number; log?: Logger } = {}): Promise<PoolCandidate[]> {
  const usdgAddress = resolveUsdg(opts.usdgAddress, opts.log)
  const res = await fetchGtPools({ include: true, log: opts.log })
  if (!res.ok) return []
  // Sideloaded token objects (logos + symbols), keyed by their JSON:API id for O(1) lookup per pool.
  const tokensById = new Map<string, GtToken>(res.tokens.filter((t) => typeof t.id === 'string').map((t) => [t.id as string, t]))
  return res.pools.slice(0, opts.limit ?? 30).map((p) => poolToCandidate(p, { usdgAddress, tokensById }))
}

/** Grace window before an unseen auto candidate is pruned — default 72 h (three daily discover runs). */
export function pruneGraceMs(): number {
  const h = Number(process.env.LP_GATEWAY_DISCOVER_PRUNE_GRACE_HOURS ?? '72')
  return (Number.isFinite(h) && h >= 0 ? h : 72) * 3_600_000
}

export async function discoverAndIngest(opts: {
  supabase: SupabaseClient
  chainId: number
  log?: Logger
  now?: number
}): Promise<{ scanned: number; ingested: number; skipped: number; pruned: number; upstream: 'ok' | 'error' }> {
  const { supabase, chainId, log } = opts
  const now = opts.now ?? Date.now()
  const usdgAddress = resolveUsdg(undefined, log)

  const res = await fetchGtPools({ log })
  if (!res.ok) return { scanned: 0, ingested: 0, skipped: 0, pruned: 0, upstream: 'error' }
  const pools = res.pools.slice(0, 30)

  let ingested = 0
  let skipped = 0
  const kept: string[] = [] // pool_addresses that are current, eligible candidates this run (for pruning)
  const seenAt = new Date(now).toISOString()
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
      // lastSeenAt drives the prune grace window (no updated_at column on the table).
      hotness: { tvlUsd: c.tvlUsd, vol24Usd: c.vol24Usd, volTvlRatio: c.signals.volTvlRatio, lastSeenAt: seenAt },
    }
    if (existing) {
      await supabase.from('gateway_pool_requests').update(row).eq('id', String(existing.id))
    } else {
      await supabase.from('gateway_pool_requests').insert(row)
    }
    kept.push(c.poolAddress)
    ingested++
  }

  // Prune so the feed stays LIVE: drop auto pending candidates that fell out of the current top-30 AND
  // have not been seen for the grace window. Only auto+pending rows for this chain are candidates —
  // NEVER a manual request, NEVER a curator decision (approved/rejected) — and only when we actually got
  // a fresh set (kept>0), so a transient GeckoTerminal blip can't wipe it and a hostile top-30 can't
  // evict a legitimate candidate in one run (O-7 / R-4).
  let pruned = 0
  if (kept.length > 0) {
    const inList = `(${kept.map((a) => `"${a}"`).join(',')})`
    const { data: stale } = await supabase
      .from('gateway_pool_requests')
      .select('id, created_at, hotness')
      .eq('status', 'pending')
      .eq('source', 'auto')
      .eq('chain_id', chainId)
      .not('pool_address', 'in', inList)
    const cutoff = now - pruneGraceMs()
    for (const r of (stale ?? []) as Array<{ id: unknown; created_at?: unknown; hotness?: unknown }>) {
      const seen = isRecord(r.hotness) && typeof r.hotness.lastSeenAt === 'string' ? Date.parse(r.hotness.lastSeenAt) : NaN
      const anchor = Number.isFinite(seen) ? seen : typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN
      // Unknown anchor ⇒ keep (never evict on missing data); within grace ⇒ keep.
      if (!Number.isFinite(anchor) || anchor >= cutoff) continue
      const { data: del } = await supabase
        .from('gateway_pool_requests')
        .delete()
        .eq('id', String(r.id))
        .eq('status', 'pending')
        .eq('source', 'auto')
        .select('id')
      pruned += del?.length ?? 0
    }
  }
  return { scanned: pools.length, ingested, skipped, pruned, upstream: 'ok' }
}
