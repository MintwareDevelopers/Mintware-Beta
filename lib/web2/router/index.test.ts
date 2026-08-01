import { describe, it, expect } from 'vitest'
import { resolveSwapRoute, type LifiSide } from './index'
import { staticRegistry } from './listing'
import type { QuoterReader, RawPoolQuote } from './internalQuote'
import type { ListedPool } from './types'

const USDC = '0xusdc'
const WETH = '0xweth'
const DEC = 10n ** 18n

const pool: ListedPool = {
  chainId: 8453, router: '0xrouter', hooks: '0xhook',
  currency0: USDC, currency1: WETH, fee: 3000, tickSpacing: 60,
}
const registry = staticRegistry([pool])

const rawReader = (r: RawPoolQuote | null): QuoterReader => ({ async quote() { return r } })

const raw = (over: Partial<RawPoolQuote> = {}): RawPoolQuote => ({
  grossOut: 100n * DEC,
  buyTokenPriceUsd: 2,
  gasCostUsd: 1,
  priceImpactPct: 0.1,
  buyTokenDecimals: 18,
  ...over,
})

const lifi = (over: Partial<LifiSide> = {}): LifiSide => ({
  buyAmount: 99n * DEC,
  gasCostUsd: 1,
  ...over,
})

const base = {
  chainId: 8453, tokenIn: USDC, tokenOut: WETH, amountIn: 1000n * DEC,
}

describe('resolveSwapRoute — kill switch & listing', () => {
  it('is inert when disabled (pure LI.FI, no USD basis attached)', async () => {
    const d = await resolveSwapRoute({ ...base, lifi: lifi(), enabled: false, registry, reader: rawReader(raw()) })
    expect(d.winner).toBe('lifi')
    expect(d.reason).toBe('lifi-router-disabled')
    expect(d.best.buyAmountUsd).toBeNull()
    expect(d.pool).toBeNull()
    expect(d.alternative).toBeNull()
  })

  it('falls through to LI.FI for an unlisted pair', async () => {
    const d = await resolveSwapRoute({ ...base, tokenOut: '0xdead', lifi: lifi(), enabled: true, registry, reader: rawReader(raw()) })
    expect(d.reason).toBe('lifi-only-unlisted')
    expect(d.pool).toBeNull()
  })

  it('falls through to LI.FI when there is no reader (Slice 2 not wired)', async () => {
    const d = await resolveSwapRoute({ ...base, lifi: lifi(), enabled: true, registry, reader: null })
    expect(d.reason).toBe('lifi-internal-unavailable')
    expect(d.pool).toEqual(pool) // pool identified, just no quote
  })

  it('falls through to LI.FI when the reader throws', async () => {
    const boom: QuoterReader = { async quote() { throw new Error('rpc') } }
    const d = await resolveSwapRoute({ ...base, lifi: lifi(), enabled: true, registry, reader: boom })
    expect(d.reason).toBe('lifi-internal-unavailable')
  })
})

describe('resolveSwapRoute — best execution on listed pairs', () => {
  it('picks internal when it beats LI.FI user-net', async () => {
    // internal: 100 tokens - 0.5% = 99.5 → $199, gas $1 → net $198
    // lifi:     99 tokens (valued at same $2 price) → $198, gas $1 → net $197
    const d = await resolveSwapRoute({ ...base, lifi: lifi({ buyAmount: 99n * DEC, gasCostUsd: 1 }), enabled: true, registry, reader: rawReader(raw()) })
    expect(d.winner).toBe('mw-internal')
    expect(d.reason).toBe('internal-better')
    expect(d.pool).toEqual(pool)
    // LI.FI kept as the alternative, valued at the shared pool price
    expect(d.alternative?.provider).toBe('lifi')
    expect(d.alternative?.buyAmountUsd).toBeCloseTo(198, 6)
  })

  it('keeps LI.FI when it is better', async () => {
    // lifi 101 tokens → $202 net $201 ; internal 99.5 → $199 net $198
    const d = await resolveSwapRoute({ ...base, lifi: lifi({ buyAmount: 101n * DEC, gasCostUsd: 1 }), enabled: true, registry, reader: rawReader(raw()) })
    expect(d.winner).toBe('lifi')
    expect(d.reason).toBe('lifi-better')
    expect(d.alternative?.provider).toBe('mw-internal')
  })

  it('values the LI.FI output at the SAME price the pool used', async () => {
    // pool price $5/token; lifi 99 tokens → should be valued at $495, not a stale price
    const d = await resolveSwapRoute({
      ...base,
      lifi: lifi({ buyAmount: 99n * DEC, gasCostUsd: 1 }),
      enabled: true, registry,
      reader: rawReader(raw({ buyTokenPriceUsd: 5 })),
    })
    const lifiSide = d.winner === 'lifi' ? d.best : d.alternative
    expect(lifiSide?.buyAmountUsd).toBeCloseTo(495, 6)
  })

  it('keeps LI.FI when gas erases internal\'s output edge', async () => {
    // internal higher output but $10 gas → net $189; lifi net $197 → lifi wins
    const d = await resolveSwapRoute({
      ...base,
      lifi: lifi({ buyAmount: 99n * DEC, gasCostUsd: 1 }),
      enabled: true, registry,
      reader: rawReader(raw({ gasCostUsd: 10 })),
    })
    expect(d.winner).toBe('lifi')
  })

  it('suppresses internal on high price impact', async () => {
    const d = await resolveSwapRoute({
      ...base,
      lifi: lifi({ buyAmount: 1n * DEC, gasCostUsd: 1 }), // LI.FI worse on paper
      enabled: true, registry,
      reader: rawReader(raw({ priceImpactPct: 5 })),
    })
    expect(d.winner).toBe('lifi')
    expect(d.reason).toBe('lifi-internal-high-impact')
  })
})
