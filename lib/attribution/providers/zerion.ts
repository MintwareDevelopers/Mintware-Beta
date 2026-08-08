// =============================================================================
// Attribution Engine v2 — Zerion data adapter.
//
// Maps Zerion's wallet API (positions + transactions, EVM + Solana) into the
// engine's provider-agnostic `WalletActivity`. Zerion is the positions/history
// BACKBONE; it does not serve every field — Network comes from our own referral
// DB, Risk from Chainalysis/Nansen, governance votes from Snapshot/Tally, and
// true LP-depth-over-time from a self-indexed subgraph (see spec §10). Fields
// Zerion can't serve are left at their empty defaults and documented inline, so
// the composite provider can fill them from the other sources.
//
// The mapper (`mapZerionToActivity`) is PURE and unit-tested against fixtures.
// The fetcher (`fetchZerionActivity`) is the only part that touches the network.
// =============================================================================

import type { WalletActivity, HoldingPosition, LpPosition } from '../types'

const ZERION_BASE = 'https://api.zerion.io/v1'
const DAY_MS = 86_400_000

// ── Zerion response subset (only the fields we read) ─────────────────────────
export interface ZerionPosition {
  attributes?: {
    position_type?: string            // 'wallet' | 'deposit' | 'staked' | 'locked' | 'loan' | 'reward'
    value?: number | null             // USD value
    fungible_info?: { symbol?: string | null } | null
    application_metadata?: { name?: string | null } | null // present on protocol positions
    flags?: { displayable?: boolean } | null
  }
  relationships?: { chain?: { data?: { id?: string } } }
}

export interface ZerionTransaction {
  attributes?: {
    operation_type?: string           // 'trade' | 'send' | 'receive' | 'deposit' | 'withdraw' | 'approve' | 'execute' | 'delegate' | ...
    mined_at?: string | null          // ISO timestamp
    transfers?: Array<{
      direction?: 'in' | 'out'
      value?: number | null           // USD value of the transfer
      fungible_info?: { symbol?: string | null } | null
    }> | null
  }
  relationships?: { chain?: { data?: { id?: string } } }
}

function isoWeek(ms: number): string {
  const d = new Date(ms)
  // ISO week key YYYY-Www — good enough for "distinct active weeks".
  const day = (d.getUTCDay() + 6) % 7
  const thu = new Date(d)
  thu.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((thu.getTime() - firstThu.getTime()) / DAY_MS - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return `${thu.getUTCFullYear()}-W${week}`
}

/**
 * Pure mapping from Zerion positions + transactions → WalletActivity.
 *
 * Approximations (all documented, all improve as more tx pages are fetched):
 *  • holdDays / durationDays are derived from the EARLIEST tx that received the
 *    asset / entered the protocol — Zerion gives current position value, not
 *    acquisition time, so tx history is the honest source.
 *  • totalTxCount / activeWeeks / lifetimeVolume reflect the txs actually fetched
 *    (a lower bound unless the caller paginated fully).
 *  • firstSeen/lastSeen = min/max mined_at across fetched txs.
 */
export function mapZerionToActivity(input: {
  address: string
  positions: ZerionPosition[]
  transactions: ZerionTransaction[]
  nowMs: number
}): WalletActivity {
  const { address, positions, transactions, nowMs } = input

  const txTimes: number[] = []
  const activeWeekSet = new Set<string>()
  const chainSet = new Set<string>()
  let lifetimeVolumeUsd = 0
  let delegations = 0
  // symbol → earliest ms we saw it arrive; protocol → earliest deposit ms.
  const firstReceiveBySymbol = new Map<string, number>()
  let firstProtocolEntryMs = Infinity

  for (const tx of transactions) {
    const a = tx.attributes ?? {}
    const chain = tx.relationships?.chain?.data?.id
    if (chain) chainSet.add(chain)
    const t = a.mined_at ? Date.parse(a.mined_at) : NaN
    if (!Number.isNaN(t)) {
      txTimes.push(t)
      activeWeekSet.add(isoWeek(t))
    }
    const op = a.operation_type
    if (op === 'trade') {
      // Trade size ≈ the larger leg's USD value.
      const legs = (a.transfers ?? []).map(tr => tr.value ?? 0)
      lifetimeVolumeUsd += legs.length ? Math.max(...legs) : 0
    }
    if (op === 'delegate') delegations++
    if ((op === 'deposit' || op === 'stake') && !Number.isNaN(t)) {
      firstProtocolEntryMs = Math.min(firstProtocolEntryMs, t)
    }
    // Track earliest receive per symbol for holdDays.
    if (!Number.isNaN(t)) {
      for (const tr of a.transfers ?? []) {
        if (tr.direction === 'in') {
          const sym = tr.fungible_info?.symbol ?? undefined
          if (sym) firstReceiveBySymbol.set(sym, Math.min(firstReceiveBySymbol.get(sym) ?? Infinity, t))
        }
      }
    }
  }

  const firstSeenMs = txTimes.length ? Math.min(...txTimes) : 0
  const lastSeenMs = txTimes.length ? Math.max(...txTimes) : 0

  const holdings: HoldingPosition[] = []
  const lpPositions: LpPosition[] = []
  for (const p of positions) {
    const a = p.attributes ?? {}
    if (a.flags?.displayable === false) continue
    const value = a.value ?? 0
    if (value <= 0) continue
    const chain = p.relationships?.chain?.data?.id
    if (chain) chainSet.add(chain)
    const type = a.position_type ?? 'wallet'
    const isProtocol = Boolean(a.application_metadata?.name)

    if (isProtocol && (type === 'deposit' || type === 'staked' || type === 'locked')) {
      // Committed, protocol-held capital → treat as liquidity. durationDays from
      // the earliest protocol-entry tx (falls back to wallet age).
      const startMs = Number.isFinite(firstProtocolEntryMs) ? firstProtocolEntryMs : firstSeenMs
      const durationDays = startMs > 0 ? Math.max(0, (nowMs - startMs) / DAY_MS) : 0
      lpPositions.push({ pool: a.application_metadata?.name ?? 'protocol', usdDepth: value, durationDays, active: true })
    } else if (type === 'wallet' || type === 'deposit') {
      const sym = a.fungible_info?.symbol ?? '?'
      const gotMs = firstReceiveBySymbol.get(sym)
      const holdDays = gotMs ? Math.max(0, (nowMs - gotMs) / DAY_MS) : 0
      holdings.push({ symbol: sym, usdValue: value, holdDays })
    }
  }

  return {
    address,
    firstSeenMs,
    lastSeenMs,
    chains: [...chainSet],
    totalTxCount: transactions.length,
    activeWeeks: activeWeekSet.size,
    lifetimeVolumeUsd,
    positions: holdings,
    lpPositions,
    govVotes: 0,        // Zerion has no proposal-vote data → Snapshot/Tally (v2.1)
    govProposals: 0,
    delegations,        // delegation events ARE in Zerion tx history
    referrals: [],      // from our own referral DB (composite provider)
    riskFlags: [],      // from Chainalysis/Nansen (composite provider)
  }
}

export function zerionConfigured(): boolean {
  return Boolean(process.env.ZERION_API_KEY)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// One GET with polite retry on 429 (free-tier rate limit). Honors `Retry-After`
// when present, else exponential backoff. Keeps total wait small so the request
// never hangs a serverless function.
interface ZerionPage { data?: unknown[]; links?: { next?: string } }

// One GET with polite retry on 429 (free-tier rate limit). Honors `Retry-After`
// when present, else exponential backoff. Accepts a relative path OR an absolute
// pagination URL (Zerion's `links.next`). Keeps total wait small.
async function zerionGet(pathOrUrl: string, apiKey: string, attempts = 3): Promise<ZerionPage> {
  const auth = Buffer.from(`${apiKey}:`).toString('base64') // Basic auth: base64("<key>:")
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${ZERION_BASE}${pathOrUrl}`
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
    })
    if (res.ok) return res.json() as Promise<ZerionPage>
    if (res.status === 429 && i < attempts - 1) {
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 700 * (i + 1))
      continue
    }
    throw new Error(`Zerion ${pathOrUrl} → ${res.status}`)
  }
  throw new Error(`Zerion ${pathOrUrl} → retries exhausted`)
}

// Follow `links.next` up to maxPages, accumulating `data`. Stops early when
// there's no next cursor. Bounded so heavy wallets don't hammer the free tier.
async function zerionGetPaged(path: string, apiKey: string, maxPages: number): Promise<unknown[]> {
  const all: unknown[] = []
  let next: string | undefined = path
  for (let p = 0; p < maxPages && next; p++) {
    const page: ZerionPage = await zerionGet(next, apiKey)
    all.push(...(page.data ?? []))
    next = page.links?.next
    if (next) await sleep(350)
  }
  return all
}

/**
 * Fetch a wallet's positions + a page of transactions from Zerion and map to
 * WalletActivity. Throws if `ZERION_API_KEY` is unset or the API errors — the
 * composite provider decides whether to fall back to the mock.
 */
export async function fetchZerionActivity(address: string, nowMs: number, txPages = 3): Promise<WalletActivity> {
  const apiKey = process.env.ZERION_API_KEY
  if (!apiKey) throw new Error('ZERION_API_KEY not set')
  // Sequential (not parallel) — the free tier rate-limits concurrent requests.
  // The age chart goes FIRST: it's the request most likely to be dropped by the
  // rate limit, so we spend the wallet's freshest budget on it. Then positions,
  // then several pages of transactions (widening the window so lifetime Volume and
  // active-weeks aren't understated to a single 100-row page).
  const chartFirstSeen = await fetchZerionFirstSeenMs(address, apiKey)
  await sleep(350)
  const pos = await zerionGet(`/wallets/${address}/positions/?filter[trash]=only_non_trash&sort=value`, apiKey)
  await sleep(350)
  const txs = await zerionGetPaged(`/wallets/${address}/transactions/?page[size]=100`, apiKey, txPages)
  const activity = mapZerionToActivity({
    address,
    positions: (pos.data ?? []) as ZerionPosition[],
    transactions: txs as ZerionTransaction[],
    nowMs,
  })

  if (chartFirstSeen > 0 && (activity.firstSeenMs === 0 || chartFirstSeen < activity.firstSeenMs)) {
    activity.firstSeenMs = chartFirstSeen // best-effort; keeps tx value on failure
  }
  return activity
}

// Earliest point of the `max` balance chart ≈ wallet age. Returns 0 (→ caller
// keeps its fallback) on any error. Timestamps come back in Unix SECONDS.
async function fetchZerionChartFirstSec(address: string, apiKey: string, period: string, attempts = 3): Promise<number> {
  const auth = Buffer.from(`${apiKey}:`).toString('base64')
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${ZERION_BASE}/wallets/${address}/charts/${period}`, {
        headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
      })
      if (res.status === 429 && i < attempts - 1) {
        const ra = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 700 * (i + 1))
        continue
      }
      if (!res.ok) return 0
      const json = (await res.json()) as { data?: { attributes?: { points?: [number, number][] } } }
      const points = json.data?.attributes?.points ?? []
      if (!points.length) return 0
      const earliestSec = Math.min(...points.map(p => p[0]).filter(t => Number.isFinite(t) && t > 0))
      return Number.isFinite(earliestSec) && earliestSec > 0 ? earliestSec : 0
    } catch {
      return 0
    }
  }
  return 0
}

// Wallet age from the earliest chart point. `max` is ideal, but Zerion's chart
// 500s on pathologically huge wallets (millions of txs) — fall back to `5years`
// (still far better than the 100-tx window). Returns ms, or 0 if all fail.
async function fetchZerionFirstSeenMs(address: string, apiKey: string): Promise<number> {
  for (const period of ['max', '5years']) {
    const sec = await fetchZerionChartFirstSec(address, apiKey, period)
    if (sec > 0) return sec * 1000
  }
  return 0
}
