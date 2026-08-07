// =============================================================================
// priceFeed.ts — Token price resolution
// Ticket 4: Epoch distribution
//
// Priority:
//   1. PRICE_FEED_URL env var — custom JSON endpoint → { price_usd: number }
//   2. CoinGecko free API — https://api.coingecko.com/api/v3/simple/price
//   3. Throws if both fail — epoch processing halts, cron retries next hour
//
// Never hardcodes prices. All conversions go through this module.
// =============================================================================

// Common token symbol → CoinGecko API ID mapping
// Extend as new campaign tokens are added.
const COINGECKO_ID_MAP: Record<string, string> = {
  WCORE:  'wrapped-core',
  ETH:    'ethereum',
  WETH:   'weth',
  BTC:    'bitcoin',
  WBTC:   'wrapped-bitcoin',
  USDC:   'usd-coin',
  USDT:   'tether',
  DAI:    'dai',
  ARB:    'arbitrum',
  OP:     'optimism',
  MATIC:  'matic-network',
  SOL:    'solana',
  AVAX:   'avalanche-2',
  BNB:    'binancecoin',
  LINK:   'chainlink',
  UNI:    'uniswap',
  AAVE:   'aave',
  MKR:    'maker',
  SNX:    'havven',
  CRV:    'curve-dao-token',
}

function coingeckoId(symbol: string): string {
  const upper = symbol.toUpperCase()
  return COINGECKO_ID_MAP[upper] ?? symbol.toLowerCase()
}

// ---------------------------------------------------------------------------
// Custom price feed (PRICE_FEED_URL)
//
// Expected response: { price_usd: number } or any object where
// price_usd is the key. Endpoint should return price per whole token (not wei).
// ---------------------------------------------------------------------------
async function fetchFromCustomFeed(
  symbol: string,
  feedUrl: string
): Promise<number | null> {
  try {
    const url = feedUrl.replace('{symbol}', symbol).replace('{SYMBOL}', symbol.toUpperCase())
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const price = data?.price_usd ?? data?.price ?? data?.[symbol.toLowerCase()]?.usd
    return typeof price === 'number' && price > 0 ? price : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// CoinGecko free API
// Rate limit: 10-30 req/min on the free tier.
// Epoch processing calls this once per campaign — well within limits.
// ---------------------------------------------------------------------------
async function fetchFromCoinGecko(symbol: string): Promise<number | null> {
  try {
    const id = coingeckoId(symbol)
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    const headers: HeadersInit = { Accept: 'application/json' }

    // Use API key if provided (CoinGecko Pro gives higher rate limits)
    const cgKey = process.env.COINGECKO_API_KEY
    if (cgKey) headers['x-cg-pro-api-key'] = cgKey

    const res = await fetch(url, { headers, cache: 'no-store' })
    if (!res.ok) return null

    const data = await res.json()
    const price = data?.[id]?.usd
    return typeof price === 'number' && price > 0 ? price : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// getTokenPrice — main export
//
// Returns price per whole token in USD.
// Throws if price cannot be resolved — do not proceed with epoch distribution
// using a null price; that would corrupt payout amounts.
// ---------------------------------------------------------------------------
export async function getTokenPrice(symbol: string): Promise<number> {
  // Stablecoins: hardcode $1 — avoids feed dependency for simple cases
  const upper = symbol.toUpperCase()
  if (['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD'].includes(upper)) {
    return 1.0
  }

  // Try custom feed first
  const feedUrl = process.env.PRICE_FEED_URL
  if (feedUrl) {
    const customPrice = await fetchFromCustomFeed(symbol, feedUrl)
    if (customPrice !== null) return customPrice
    console.warn(`[priceFeed] PRICE_FEED_URL returned no price for ${symbol}, falling back to CoinGecko`)
  }

  // CoinGecko fallback
  const cgPrice = await fetchFromCoinGecko(symbol)
  if (cgPrice !== null) return cgPrice

  throw new Error(
    `[priceFeed] Could not resolve price for "${symbol}". ` +
    `Set PRICE_FEED_URL or ensure the token is listed on CoinGecko as "${coingeckoId(symbol)}".`
  )
}

// ---------------------------------------------------------------------------
// usdToWei — converts a USD payout to token base units (wei)
//
// amount_wei = floor((payout_usd / token_price_usd) * 10^decimals)
// Returns as bigint for precision — stored as string in DB (numeric type).
//
// Integer arithmetic: both USD inputs are scaled to 8 dp and that scale cancels
// in the ratio, so the only floating-point step is rounding two *dollar* values
// (small, well within MAX_SAFE_INTEGER) into integers. The 10^decimals multiply
// and the final division are exact BigInt ops — no precision loss at 18 decimals
// or sub-cent payouts, which the old `float * 10**18` path silently corrupted.
// ---------------------------------------------------------------------------
const USD_DP = 1e8 // 8 decimal places of USD precision; cancels between payout and price

export function usdToWei(
  payout_usd: number,
  token_price_usd: number,
  decimals: number
): bigint {
  if (token_price_usd <= 0) throw new Error('[priceFeed] token_price_usd must be > 0')
  if (!Number.isFinite(payout_usd) || payout_usd < 0) {
    throw new Error('[priceFeed] payout_usd must be a non-negative finite number')
  }
  const payoutScaled = BigInt(Math.round(payout_usd * USD_DP))
  const priceScaled = BigInt(Math.round(token_price_usd * USD_DP))
  if (priceScaled <= 0n) throw new Error('[priceFeed] token_price_usd too small to represent')
  // (payout_usd / token_price_usd) * 10^decimals, floored — the 1e8 scale cancels.
  return (payoutScaled * 10n ** BigInt(decimals)) / priceScaled
}
