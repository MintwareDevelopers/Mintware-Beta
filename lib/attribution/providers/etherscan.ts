// =============================================================================
// Attribution Engine v2 — Etherscan V2 (multichain) data adapter.
//
// A FREE alternative to the rate-limited Zerion backbone. Etherscan's V2 unified
// API serves 50+ chains from ONE key via a `chainid` param, free tier 100k
// calls/day. We scan the major EVM chains for each wallet and map txns + native
// balances into the engine's provider-agnostic `WalletActivity`.
//
// What Etherscan serves well (real, live): longevity (first-seen), activity
// (tx count + active weeks), volume (native transfer flow × price), chains, and
// a native-balance holding proxy. What it can't serve on the free tier is left
// at empty defaults — exactly like the Zerion adapter — so the composite
// provider still fills Network (referral DB) and Risk (Chainalysis) elsewhere,
// and USD-priced token portfolios / LP-depth-over-time upgrade later.
//
// `mapEtherscanToActivity` is PURE and unit-tested. `fetchEtherscanActivity` is
// the only part that touches the network.
// =============================================================================

import type { WalletActivity, HoldingPosition } from '../types'

const V2_BASE = 'https://api.etherscan.io/v2/api'
const DAY_MS = 86_400_000

// Chains to scan. `native` is the CoinGecko id used to price the gas token so
// native transfer volume + balance can be expressed in USD.
export const ETHERSCAN_CHAINS: { id: number; name: string; native: string }[] = [
  { id: 1,     name: 'ethereum', native: 'ethereum' },
  { id: 8453,  name: 'base',     native: 'ethereum' },
  { id: 42161, name: 'arbitrum', native: 'ethereum' },
  { id: 10,    name: 'optimism', native: 'ethereum' },
  { id: 137,   name: 'polygon',  native: 'matic-network' },
  { id: 56,    name: 'bsc',      native: 'binancecoin' },
]

export function etherscanConfigured(): boolean {
  return Boolean(process.env.ETHERSCAN_API_KEY)
}

// ── Etherscan response subset (only the fields we read) ─────────────────────
export interface EtherscanTx {
  timeStamp?: string // unix seconds
  value?: string     // wei (native)
  from?: string
  to?: string
  isError?: string
}

// Per-chain fetch bundle handed to the pure mapper.
export interface EtherscanChainData {
  name: string
  native: string          // CoinGecko id of the gas token
  txs: EtherscanTx[]
  nativeBalanceWei: string // current native balance (wei)
}

function isoWeek(ms: number): string {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7
  const thu = new Date(d)
  thu.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((thu.getTime() - firstThu.getTime()) / DAY_MS - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return `${thu.getUTCFullYear()}-W${week}`
}

function weiToNative(wei: string | undefined): number {
  if (!wei) return 0
  // 18 decimals for every native gas token we scan (ETH, MATIC, BNB).
  const n = Number(wei)
  return Number.isFinite(n) ? n / 1e18 : 0
}

/**
 * Pure mapping from per-chain Etherscan txns + native balances → WalletActivity.
 *
 * Approximations (all documented, all improve with more pages / a token API):
 *  • totalTxCount / activeWeeks / lifetimeVolume reflect the txns actually
 *    fetched (a lower bound; exact for wallets under the page cap).
 *  • firstSeen/lastSeen = min/max tx timestamp across all scanned chains.
 *  • lifetimeVolume ≈ native transfer flow (in + out) valued at the current
 *    native price — a proxy for on-chain volume, not a priced trade ledger.
 *  • holdings = one native-balance position per chain, held since first-seen —
 *    a real but coarse holding signal until a USD token-portfolio API lands.
 *  • LP depth, governance votes, referrals and risk are left at defaults and
 *    filled by the other providers (subgraph / Snapshot / referral DB / oracle).
 */
export function mapEtherscanToActivity(input: {
  address: string
  chains: EtherscanChainData[]
  priceUsd: Record<string, number> // CoinGecko id → USD
  nowMs: number
}): WalletActivity {
  const { address, chains, priceUsd, nowMs } = input

  const txTimes: number[] = []
  const activeWeekSet = new Set<string>()
  const chainSet = new Set<string>()
  let totalTxCount = 0
  let lifetimeVolumeUsd = 0
  const positions: HoldingPosition[] = []

  for (const c of chains) {
    const price = priceUsd[c.native] ?? 0
    let chainHadActivity = false

    for (const tx of c.txs) {
      const t = tx.timeStamp ? Number(tx.timeStamp) * 1000 : NaN
      if (!Number.isNaN(t)) {
        txTimes.push(t)
        activeWeekSet.add(isoWeek(t))
        chainHadActivity = true
        totalTxCount++
        // Native value moved in this tx, priced to USD (volume proxy).
        lifetimeVolumeUsd += weiToNative(tx.value) * price
      }
    }
    if (chainHadActivity) chainSet.add(c.name)

    // Native-balance holding proxy (only when it's worth something).
    const balNative = weiToNative(c.nativeBalanceWei)
    const balUsd = balNative * price
    if (balUsd >= 1) {
      positions.push({ symbol: c.native === 'matic-network' ? 'MATIC' : c.native === 'binancecoin' ? 'BNB' : 'ETH', usdValue: balUsd, holdDays: 0 /* set below from firstSeen */ })
    }
  }

  const firstSeenMs = txTimes.length ? Math.min(...txTimes) : 0
  const lastSeenMs = txTimes.length ? Math.max(...txTimes) : 0
  // Hold duration for the native-balance proxy = wallet age (held since first-seen).
  const heldDays = firstSeenMs ? Math.max(0, Math.floor((nowMs - firstSeenMs) / DAY_MS)) : 0
  for (const p of positions) p.holdDays = heldDays

  return {
    address,
    firstSeenMs,
    lastSeenMs,
    chains: [...chainSet],
    totalTxCount,
    activeWeeks: activeWeekSet.size,
    lifetimeVolumeUsd,
    positions,
    lpPositions: [],
    govVotes: 0,
    govProposals: 0,
    delegations: 0,
    referrals: [],
    riskFlags: [],
  }
}

// ── Network fetcher ─────────────────────────────────────────────────────────
async function esCall(chainId: number, params: Record<string, string>, key: string): Promise<unknown> {
  const qs = new URLSearchParams({ chainid: String(chainId), apikey: key, ...params })
  const res = await fetch(`${V2_BASE}?${qs.toString()}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`etherscan ${chainId} HTTP ${res.status}`)
  const j = (await res.json()) as { status?: string; result?: unknown; message?: string }
  return j.result
}

// CoinGecko simple price for the native gas tokens (free endpoint; optional Pro key).
async function fetchNativePrices(ids: string[]): Promise<Record<string, number>> {
  try {
    const unique = [...new Set(ids)]
    const cgKey = process.env.COINGECKO_API_KEY
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${unique.join(',')}&vs_currencies=usd${cgKey ? `&x_cg_pro_api_key=${cgKey}` : ''}`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`coingecko HTTP ${res.status}`)
    const j = (await res.json()) as Record<string, { usd?: number }>
    const out: Record<string, number> = {}
    for (const id of unique) out[id] = j[id]?.usd ?? 0
    return out
  } catch {
    // Price feed is best-effort — volume/holding fall to 0 rather than failing the score.
    return {}
  }
}

/**
 * Live fetch across the major EVM chains. Throws if `ETHERSCAN_API_KEY` is unset;
 * per-chain errors are swallowed (a chain with no data just contributes nothing).
 * Bounded to `txCap` earliest txns per chain to stay well within the free tier.
 */
export async function fetchEtherscanActivity(address: string, nowMs: number, txCap = 1000): Promise<WalletActivity> {
  const key = process.env.ETHERSCAN_API_KEY
  if (!key) throw new Error('ETHERSCAN_API_KEY not set')

  const chains: EtherscanChainData[] = await Promise.all(
    ETHERSCAN_CHAINS.map(async (c) => {
      let txs: EtherscanTx[] = []
      let nativeBalanceWei = '0'
      try {
        const r = await esCall(c.id, {
          module: 'account', action: 'txlist', address,
          startblock: '0', endblock: '99999999', page: '1', offset: String(txCap), sort: 'asc',
        }, key)
        if (Array.isArray(r)) txs = r as EtherscanTx[]
      } catch { /* chain has no data / errored — contributes nothing */ }
      try {
        const b = await esCall(c.id, { module: 'account', action: 'balance', address, tag: 'latest' }, key)
        if (typeof b === 'string') nativeBalanceWei = b
      } catch { /* balance best-effort */ }
      return { name: c.name, native: c.native, txs, nativeBalanceWei }
    }),
  )

  const priceUsd = await fetchNativePrices(ETHERSCAN_CHAINS.map((c) => c.native))
  return mapEtherscanToActivity({ address, chains, priceUsd, nowMs })
}
