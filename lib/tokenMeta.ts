// lib/tokenMeta.ts — Token metadata fetcher
// Primary: LI.FI token API (already in stack)
// Fallback: CoinGecko public API
// Results cached in-memory for the session lifetime

export interface TokenMeta {
  symbol: string
  name: string
  logoURI: string | null
  priceUSD: string | null
}

const LIFI_CHAIN_IDS: Record<string, number> = {
  base: 8453,
  arbitrum: 42161,
  ethereum: 1,
  mainnet: 1,
  bnb: 56,
  bsc: 56,
  polygon: 137,
  matic: 137,
  optimism: 10,
  core: 1116,
  coredao: 1116,
}

const CG_CHAIN_NAMES: Record<number, string> = {
  8453:  'base',
  42161: 'arbitrum-one',
  1:     'ethereum',
  56:    'binance-smart-chain',
  137:   'polygon-pos',
  10:    'optimistic-ethereum',
}

export function chainNameToId(chain: string): number | null {
  return LIFI_CHAIN_IDS[chain.toLowerCase()] ?? null
}

// ─── DexScreener ──────────────────────────────────────────────────────────────

export interface DexMeta {
  dexUrl:   string
  website:  string | null
  twitter:  string | null
  telegram: string | null
}

const DS_CHAIN: Record<number, string> = {
  8453:  'base',
  42161: 'arbitrum',
  1:     'ethereum',
  56:    'bsc',
  137:   'polygon',
  10:    'optimism',
  1116:  'coredao',
}

const _dexCache = new Map<string, DexMeta | null>()

export async function fetchDexMeta(
  chainId: number,
  address: string,
): Promise<DexMeta | null> {
  const key = `dex:${chainId}:${address.toLowerCase()}`
  if (_dexCache.has(key)) return _dexCache.get(key)!

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
    )
    if (!res.ok) { _dexCache.set(key, null); return null }

    const data = await res.json()
    const chainName = DS_CHAIN[chainId]

    // Filter to correct chain, sort by liquidity, take best pair
    const pairs: Record<string, unknown>[] = (data.pairs ?? [])
      .filter((p: Record<string, unknown>) => !chainName || p.chainId === chainName)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const la = (a.liquidity as Record<string, number>)?.usd ?? 0
        const lb = (b.liquidity as Record<string, number>)?.usd ?? 0
        return lb - la
      })

    if (!pairs.length) { _dexCache.set(key, null); return null }

    const pair = pairs[0]
    const socials: { type: string; url: string }[] =
      (pair.info as Record<string, unknown>)?.socials as { type: string; url: string }[] ?? []
    const websites: { url: string }[] =
      (pair.info as Record<string, unknown>)?.websites as { url: string }[] ?? []

    const meta: DexMeta = {
      dexUrl:   pair.url as string,
      website:  websites[0]?.url ?? null,
      twitter:  socials.find(s => s.type === 'twitter')?.url ?? null,
      telegram: socials.find(s => s.type === 'telegram')?.url ?? null,
    }
    _dexCache.set(key, meta)
    return meta
  } catch {
    _dexCache.set(key, null)
    return null
  }
}

// ─── Token price/logo ──────────────────────────────────────────────────────────

const _cache = new Map<string, TokenMeta | null>()

export async function fetchTokenMeta(
  chainId: number,
  address: string,
): Promise<TokenMeta | null> {
  const key = `${chainId}:${address.toLowerCase()}`
  if (_cache.has(key)) return _cache.get(key)!

  // ── LI.FI ──────────────────────────────────────────────────────────────────
  try {
    const res = await fetch(
      `https://li.quest/v1/token?chain=${chainId}&token=${address}`,
      { next: { revalidate: 3600 } },
    )
    if (res.ok) {
      const d = await res.json()
      const meta: TokenMeta = {
        symbol:   d.symbol  ?? '',
        name:     d.name    ?? '',
        logoURI:  d.logoURI ?? null,
        priceUSD: d.priceUSD != null ? String(d.priceUSD) : null,
      }
      _cache.set(key, meta)
      return meta
    }
  } catch { /* fall through */ }

  // ── CoinGecko fallback ─────────────────────────────────────────────────────
  const cgChain = CG_CHAIN_NAMES[chainId]
  if (cgChain) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${cgChain}/contract/${address}`,
      )
      if (res.ok) {
        const d = await res.json()
        const meta: TokenMeta = {
          symbol:   (d.symbol as string)?.toUpperCase() ?? '',
          name:     d.name ?? '',
          logoURI:  d.image?.small ?? null,
          priceUSD: d.market_data?.current_price?.usd != null
            ? String(d.market_data.current_price.usd)
            : null,
        }
        _cache.set(key, meta)
        return meta
      }
    } catch { /* fall through */ }
  }

  _cache.set(key, null)
  return null
}
