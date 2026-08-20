import { describe, it, expect } from 'vitest'
import { createQuoterReader, deriveBuyTokenPriceUsd, type QuoteSimulateFn } from './quoterReader'
import type { ListedPool } from './types'

const USDC = '0xusdc'
const WETH = '0xweth'
const pool: ListedPool = {
  chainId: 8453, router: '0xrouter', hooks: '0xhook',
  currency0: USDC, currency1: WETH, fee: 3000, tickSpacing: 60,
}

describe('createQuoterReader', () => {
  const sim = (out: bigint): QuoteSimulateFn => async () => out

  it('normalizes a simulated amountOut into a RawPoolQuote', async () => {
    const reader = createQuoterReader(sim(1234n), { tokenIn: USDC, buyTokenDecimals: 18, buyTokenPriceUsd: 2, gasCostUsd: 1 })
    const raw = await reader.quote(pool, 1000n)
    expect(raw).toEqual({ grossOut: 1234n, buyTokenPriceUsd: 2, gasCostUsd: 1, priceImpactPct: null, buyTokenDecimals: 18 })
  })

  it('derives zeroForOne from tokenIn = currency0', async () => {
    let seen = false
    const capture: QuoteSimulateFn = async (_p, zeroForOne) => { seen = zeroForOne; return 1n }
    await createQuoterReader(capture, { tokenIn: USDC, buyTokenDecimals: 18 }).quote(pool, 1n)
    expect(seen).toBe(true) // USDC is currency0 → zeroForOne
    await createQuoterReader(capture, { tokenIn: WETH, buyTokenDecimals: 6 }).quote(pool, 1n)
    expect(seen).toBe(false) // WETH is currency1 → oneForZero
  })

  it('returns null for non-positive or over-uint128 amounts', async () => {
    const reader = createQuoterReader(sim(1n), { tokenIn: USDC, buyTokenDecimals: 18 })
    expect(await reader.quote(pool, 0n)).toBeNull()
    expect(await reader.quote(pool, -5n)).toBeNull()
    expect(await reader.quote(pool, 1n << 128n)).toBeNull()
  })

  it('returns null when the pool quotes zero output', async () => {
    const reader = createQuoterReader(sim(0n), { tokenIn: USDC, buyTokenDecimals: 18 })
    expect(await reader.quote(pool, 1000n)).toBeNull()
  })
})

describe('deriveBuyTokenPriceUsd', () => {
  it('computes USD per whole buy token from LI.FI numbers', () => {
    // $200 in, 100 whole tokens out (18 dec) → $2 / token
    expect(deriveBuyTokenPriceUsd(200, 100n * 10n ** 18n, 18)).toBeCloseTo(2, 9)
  })
  it('returns null for missing / non-positive input USD', () => {
    expect(deriveBuyTokenPriceUsd(null, 100n, 18)).toBeNull()
    expect(deriveBuyTokenPriceUsd(0, 100n, 18)).toBeNull()
    expect(deriveBuyTokenPriceUsd(NaN, 100n, 18)).toBeNull()
  })
  it('returns null for zero output or bad decimals', () => {
    expect(deriveBuyTokenPriceUsd(200, 0n, 18)).toBeNull()
    expect(deriveBuyTokenPriceUsd(200, 100n, 40)).toBeNull()
  })
})
