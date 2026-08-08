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

async function zerionGet(path: string, apiKey: string): Promise<{ data?: unknown[] }> {
  // Zerion uses HTTP Basic auth: base64("<key>:").
  const auth = Buffer.from(`${apiKey}:`).toString('base64')
  const res = await fetch(`${ZERION_BASE}${path}`, {
    headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Zerion ${path} → ${res.status}`)
  return res.json() as Promise<{ data?: unknown[] }>
}

/**
 * Fetch a wallet's positions + a page of transactions from Zerion and map to
 * WalletActivity. Throws if `ZERION_API_KEY` is unset or the API errors — the
 * composite provider decides whether to fall back to the mock.
 */
export async function fetchZerionActivity(address: string, nowMs: number, txPageSize = 100): Promise<WalletActivity> {
  const apiKey = process.env.ZERION_API_KEY
  if (!apiKey) throw new Error('ZERION_API_KEY not set')
  const [pos, txs] = await Promise.all([
    zerionGet(`/wallets/${address}/positions/?filter[trash]=only_non_trash&sort=value`, apiKey),
    zerionGet(`/wallets/${address}/transactions/?page[size]=${txPageSize}`, apiKey),
  ])
  return mapZerionToActivity({
    address,
    positions: (pos.data ?? []) as ZerionPosition[],
    transactions: (txs.data ?? []) as ZerionTransaction[],
    nowMs,
  })
}
