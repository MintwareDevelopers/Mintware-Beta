// =============================================================================
// volatilityMonitor.ts — T4.1 — AI Range Optimizer: volatility data layer
//
// Responsibilities:
//   1. Fetch OHLCV candle data from Pyth Benchmarks REST API (no auth required)
//   2. Compute Bollinger Bands (20-period, ±2σ) on close prices
//   3. Compute ATR (14-period) for true range estimation
//   4. Derive a suggested V4 tick range from the combined metrics
//
// Used by: T4.2 range proposal algorithm (proposes → oracle signs → rebalance)
// Architecture: Web3 layer — oracle price data, pool state
// =============================================================================

// ─── Public Pyth Benchmarks API (no key required) ────────────────────────────
const PYTH_BENCHMARKS_BASE = 'https://benchmarks.pyth.network/v1/shims/tradingview/history'

// Pyth Hermes — latest price (for current mid-price reference)
const PYTH_HERMES_LATEST = 'https://hermes.pyth.network/v2/updates/price/latest'

// Default parameters
const BB_PERIOD   = 20
const BB_STD_MULT = 2.0
const ATR_PERIOD  = 14

// Safety margin: expand suggested range by this factor beyond BB width
// (absorbs intra-period moves the BB window doesn't fully capture)
const RANGE_SAFETY_FACTOR = 1.15

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriceCandle {
  timestamp: number  // Unix seconds
  open:      number
  high:      number
  low:       number
  close:     number
}

export interface BollingerBands {
  upper:    number
  mid:      number  // SMA
  lower:    number
  widthPct: number  // (upper − lower) / mid  × 100
}

export interface VolatilityMetrics {
  feedId:           string
  computedAt:       number  // Unix seconds
  windowHours:      number
  candleCount:      number
  atr14:            number  // average true range (price units)
  atrPct:           number  // atr14 / currentPrice × 100
  bollinger:        BollingerBands
  currentPrice:     number
  suggestedTicks:   TickRange
  confidence:       'high' | 'medium' | 'low'
}

export interface TickRange {
  tickLower: number
  tickUpper: number
  priceLower: number  // price at tickLower
  priceUpper: number  // price at tickUpper
}

// Pyth Benchmarks OHLCV response shape
interface PythBenchmarksResponse {
  s:  string    // 'ok' | 'no_data' | 'error'
  t:  number[]  // timestamps
  o:  number[]  // opens
  h:  number[]  // highs
  l:  number[]  // lows
  c:  number[]  // closes
  v?: number[]  // volumes (optional)
  errmsg?: string
}

// ─── Tick Math ───────────────────────────────────────────────────────────────
// V4 tick = floor( log(price) / log(1.0001) )
// Inverse: price = 1.0001 ^ tick

const LOG_1_0001 = Math.log(1.0001)

export function priceToTick(price: number): number {
  if (price <= 0) throw new Error('price must be positive')
  return Math.floor(Math.log(price) / LOG_1_0001)
}

export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick)
}

// ─── Bollinger Bands ─────────────────────────────────────────────────────────

export function computeBollingerBands(
  closes:  number[],
  period:  number = BB_PERIOD,
  stdMult: number = BB_STD_MULT,
): BollingerBands {
  if (closes.length < period) {
    throw new Error(`computeBollingerBands: need at least ${period} closes, got ${closes.length}`)
  }
  // Use the most recent `period` values
  const window = closes.slice(-period)
  const mid    = window.reduce((s, v) => s + v, 0) / period
  const variance = window.reduce((s, v) => s + (v - mid) ** 2, 0) / period
  const stdDev = Math.sqrt(variance)
  const upper  = mid + stdMult * stdDev
  const lower  = mid - stdMult * stdDev
  return {
    upper,
    mid,
    lower,
    widthPct: ((upper - lower) / mid) * 100,
  }
}

// ─── ATR ─────────────────────────────────────────────────────────────────────

export function computeATR(candles: PriceCandle[], period: number = ATR_PERIOD): number {
  if (candles.length < period + 1) {
    throw new Error(`computeATR: need at least ${period + 1} candles, got ${candles.length}`)
  }
  // True range for each candle (requires previous close)
  const trValues: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low  - prevClose),
    )
    trValues.push(tr)
  }
  // Simple average of the last `period` true ranges
  const window = trValues.slice(-period)
  return window.reduce((s, v) => s + v, 0) / period
}

// ─── Tick Range Derivation ────────────────────────────────────────────────────
// Strategy: take the wider of BB width and 2×ATR to define a price channel,
// then expand by RANGE_SAFETY_FACTOR and align to the given tickSpacing.

export function metricsToTickRange(
  metrics:     Pick<VolatilityMetrics, 'bollinger' | 'atr14' | 'currentPrice'>,
  tickSpacing: number = 60,
): TickRange {
  const { currentPrice, atr14, bollinger } = metrics

  // Price channel half-width: max of (BB half-width, ATR) × safety factor
  const bbHalfWidth  = (bollinger.upper - bollinger.lower) / 2
  const halfWidth    = Math.max(bbHalfWidth, atr14) * RANGE_SAFETY_FACTOR

  const priceLower = Math.max(currentPrice - halfWidth, currentPrice * 0.01)
  const priceUpper = currentPrice + halfWidth

  // Raw ticks
  const rawLower = priceToTick(priceLower)
  const rawUpper = priceToTick(priceUpper)

  // Align to tickSpacing (floor lower, ceil upper)
  const tickLower = Math.floor(rawLower / tickSpacing) * tickSpacing
  const tickUpper = Math.ceil(rawUpper  / tickSpacing) * tickSpacing

  return {
    tickLower,
    tickUpper,
    priceLower: tickToPrice(tickLower),
    priceUpper: tickToPrice(tickUpper),
  }
}

// ─── Pyth Benchmarks Fetch ────────────────────────────────────────────────────

// Map window size to candle resolution (1h candles for ≤72h, 4h for ≤336h, daily beyond)
function resolveResolution(windowHours: number): string {
  if (windowHours <= 72)  return '60'    // 1h candles
  if (windowHours <= 336) return '240'   // 4h candles
  return 'D'                              // daily candles
}

// Symbol lookup: feedId → Pyth symbol string for Benchmarks API
// Covers common pools — fallback to feedId hex if not found
const FEED_ID_TO_SYMBOL: Record<string, string> = {
  // ETH/USD
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace': 'Crypto.ETH/USD',
  // BTC/USD
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43': 'Crypto.BTC/USD',
  // USDC/USD
  'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a': 'Crypto.USDC/USD',
  // SOL/USD
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d': 'Crypto.SOL/USD',
  // ARB/USD
  '3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5': 'Crypto.ARB/USD',
}

function feedIdToSymbol(feedId: string): string {
  const clean = feedId.replace(/^0x/, '').toLowerCase()
  return FEED_ID_TO_SYMBOL[clean] ?? `Crypto.${clean.slice(0, 6).toUpperCase()}/USD`
}

export async function fetchPythCandles(
  feedId:      string,
  windowHours: number = 168,  // default: 7 days of hourly candles
): Promise<PriceCandle[]> {
  const now        = Math.floor(Date.now() / 1000)
  const from       = now - windowHours * 3600
  const resolution = resolveResolution(windowHours)
  const symbol     = feedIdToSymbol(feedId)

  const url = `${PYTH_BENCHMARKS_BASE}?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${now}`

  const res = await fetch(url, { next: { revalidate: 300 } })  // cache 5 min
  if (!res.ok) {
    throw new Error(`Pyth Benchmarks fetch failed: ${res.status} ${res.statusText}`)
  }

  const data: PythBenchmarksResponse = await res.json()

  if (data.s === 'no_data') return []
  if (data.s !== 'ok') {
    throw new Error(`Pyth Benchmarks error: ${data.errmsg ?? data.s}`)
  }

  return data.t.map((ts, i) => ({
    timestamp: ts,
    open:      data.o[i],
    high:      data.h[i],
    low:       data.l[i],
    close:     data.c[i],
  }))
}

// ─── Current Price via Hermes ─────────────────────────────────────────────────

export async function fetchCurrentPrice(feedId: string): Promise<number> {
  const cleanId = feedId.startsWith('0x') ? feedId : `0x${feedId}`
  const url     = `${PYTH_HERMES_LATEST}?ids[]=${encodeURIComponent(cleanId)}`

  const res = await fetch(url, { next: { revalidate: 10 } })
  if (!res.ok) {
    throw new Error(`Pyth Hermes fetch failed: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  const feed = data?.parsed?.[0]?.price
  if (!feed) throw new Error('Pyth Hermes: no price data in response')

  // Pyth returns price as integer + expo (e.g. 200000000000, -8 → $2000)
  return feed.price * Math.pow(10, feed.expo)
}

// ─── Top-level: computeVolatilityMetrics ──────────────────────────────────────

export async function computeVolatilityMetrics(
  feedId:      string,
  windowHours: number = 168,
  tickSpacing: number = 60,
): Promise<VolatilityMetrics> {
  const [candles, currentPrice] = await Promise.all([
    fetchPythCandles(feedId, windowHours),
    fetchCurrentPrice(feedId).catch(() => null),  // non-fatal — fallback to last close
  ])

  if (candles.length === 0) {
    throw new Error(`computeVolatilityMetrics: no candle data returned for feedId ${feedId}`)
  }

  const price = currentPrice ?? candles[candles.length - 1].close

  const closes = candles.map(c => c.close)

  // Need enough data for both indicators
  const minRequired = Math.max(BB_PERIOD, ATR_PERIOD + 1)
  if (candles.length < minRequired) {
    throw new Error(
      `computeVolatilityMetrics: insufficient data — need ${minRequired} candles, got ${candles.length}`
    )
  }

  const bollinger = computeBollingerBands(closes)
  const atr14     = computeATR(candles)
  const atrPct    = (atr14 / price) * 100

  const suggestedTicks = metricsToTickRange({ bollinger, atr14, currentPrice: price }, tickSpacing)

  // Confidence based on data completeness relative to requested window
  const expectedCandles = windowHours / (resolveResolution(windowHours) === 'D' ? 24 : resolveResolution(windowHours) === '240' ? 4 : 1)
  const completeness    = candles.length / expectedCandles
  const confidence: VolatilityMetrics['confidence'] =
    completeness >= 0.85 ? 'high' :
    completeness >= 0.60 ? 'medium' :
    'low'

  return {
    feedId:       feedId.startsWith('0x') ? feedId : `0x${feedId}`,
    computedAt:   Math.floor(Date.now() / 1000),
    windowHours,
    candleCount:  candles.length,
    atr14,
    atrPct,
    bollinger,
    currentPrice: price,
    suggestedTicks,
    confidence,
  }
}
