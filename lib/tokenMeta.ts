// =============================================================================
// lib/tokenMeta.ts — Token logo + DexScreener social links enrichment
// Sources: LI.FI (logos, price) → DexScreener (socials, website)
// Both sources are free, no API key required.
// Results are cached in-memory — one fetch per token per session.
// =============================================================================

export interface TokenMeta {
  logoURI: string | null
  symbol: string
  name: string
  priceUSD: string | null
}

export interface DexMeta {
  dexUrl: string
  website: string | null
  twitter: string | null
  telegram: string | null
}

// LI.FI chain names (uppercase)
const LIFI_CHAIN: Record<number, string> = {
  8453:  'BASE',
  42161: 'ARB',
  1:     'ETH',
  56:    'BSC',
  137:   'POL',
  10:    'OPT',
  1116:  'CORE',
}

// DexScreener chain slugs
const DEX_CHAIN: Record<number, string> = {
  8453:  'base',
  42161: 'arbitrum',
  1:     'ethereum',
  56:    'bsc',
  137:   'polygon',
  10:    'optimism',
  1116:  'coredao',
}

const _tokenCache = new Map<string, TokenMeta | null>()
const _dexCache   = new Map<string, DexMeta   | null>()

// ─── LI.FI token metadata (logo, symbol, price) ───────────────────────────

export async function fetchTokenMeta(chainId: number, address: string): Promise<TokenMeta | null> {
  const key = `${chainId}:${address.toLowerCase()}`
  if (_tokenCache.has(key)) return _tokenCache.get(key)!

  const chain = LIFI_CHAIN[chainId]
  if (!chain) { _tokenCache.set(key, null); return null }

  try {
    const res = await fetch(`https://li.quest/v1/token?chain=${chain}&token=${address}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) { _tokenCache.set(key, null); return null }

    const d = await res.json()
    const meta: TokenMeta = {
      logoURI:  d.logoURI  ?? null,
      symbol:   d.symbol   ?? '',
      name:     d.name     ?? '',
      priceUSD: d.priceUSD ?? null,
    }
    _tokenCache.set(key, meta)
    return meta
  } catch {
    _tokenCache.set(key, null)
    return null
  }
}

// ─── DexScreener metadata (socials, website, dex link) ────────────────────

export async function fetchDexMeta(chainId: number, address: string): Promise<DexMeta | null> {
  const key = `${chainId}:${address.toLowerCase()}`
  if (_dexCache.has(key)) return _dexCache.get(key)!

  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) { _dexCache.set(key, null); return null }

    const data = await res.json()
    const slug  = DEX_CHAIN[chainId]

    // Filter to correct chain, prefer highest liquidity pair
    const pairs: any[] = (data.pairs ?? [])
      .filter((p: any) => !slug || p.chainId === slug)
      .sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))

    if (!pairs.length) { _dexCache.set(key, null); return null }

    const pair    = pairs[0]
    const socials: any[] = pair.info?.socials ?? []

    const meta: DexMeta = {
      dexUrl:   pair.url,
      website:  pair.info?.websites?.[0]?.url ?? null,
      twitter:  socials.find((s: any) => s.type === 'twitter')?.url  ?? null,
      telegram: socials.find((s: any) => s.type === 'telegram')?.url ?? null,
    }
    _dexCache.set(key, meta)
    return meta
  } catch {
    _dexCache.set(key, null)
    return null
  }
}

// ─── Construct DexScreener URL directly from address (no API call) ─────────

export function dexUrl(chainId: number, address: string): string {
  const slug = DEX_CHAIN[chainId] ?? 'base'
  return `https://dexscreener.com/${slug}/${address}`
}
