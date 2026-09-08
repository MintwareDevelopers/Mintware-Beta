import { describe, it, expect } from 'vitest'
import {
  depositSharesQuote, withdrawLegsQuote, readGatewayPoolState, serializePoolState, parsePoolState, type GatewayPoolState,
} from './positionReader'
import { getSqrtPriceAtTick, getAmountsForLiquidity, applyToleranceBps } from './v4Math'

const V = 1_000_000n

// C-6: the UI's dry quotes must mirror the contract's own share/leg math so the `*WithMin` floors are
// honest (tight enough to protect, loose enough not to revert on rounding).
describe('depositSharesQuote (SeniorSharesMath.toShares mirror)', () => {
  it('first deposit into an empty pool mints 1:1 (offset-consistent)', () => {
    expect(depositSharesQuote(1_000_000n, 0n, 0n)).toBe(1_000_000n)
  })
  it('mints fewer shares once NAV has grown (floor)', () => {
    const q = depositSharesQuote(1_000_000n, 1_000_000n, 1_100_000n)
    expect(q).toBe((1_000_000n * (1_000_000n + V)) / (1_100_000n + V))
    expect(q < 1_000_000n).toBe(true)
  })
  it('zero amount ⇒ zero shares', () => {
    expect(depositSharesQuote(0n, 10n, 10n)).toBe(0n)
  })
  it('a 1% tolerance floor sits just under the quote', () => {
    const q = depositSharesQuote(5_000_000n, 3_000_000n, 3_300_000n)
    const floor = applyToleranceBps(q, 100)
    expect(floor <= q).toBe(true)
    expect(Number(floor) / Number(q)).toBeCloseTo(0.99, 6)
  })
})

function state(over: Partial<GatewayPoolState> = {}): GatewayPoolState {
  return {
    totalShares: 1_000_000_000n, // 1000 USDG of shares
    totalNav: 1_200_000_000n,
    idleAtomic: 600_000_000n,
    deployed: true,
    liquidity: 10n ** 15n,
    sqrtPriceX96: getSqrtPriceAtTick(0),
    tickLower: -23040,
    tickUpper: 23040,
    quoteIsCurrency0: true,
    ...over,
  }
}

describe('withdrawLegsQuote (_withdraw pro-rata mirror)', () => {
  it('undeployed pool: only the idle leg, pro-rata with the virtual offset', () => {
    const s = state({ deployed: false, liquidity: 0n, sqrtPriceX96: null })
    const q = withdrawLegsQuote(250_000_000n, s)
    expect(q.quoteOut).toBe((250_000_000n * (s.idleAtomic + V)) / (s.totalShares + V))
    expect(q.pairedOut).toBe(0n)
    expect(q.lpQuotable).toBe(true)
  })
  it('deployed pool: idle slice + LP slice amounts at spot (quote is currency0)', () => {
    const s = state()
    const shares = 500_000_000n
    const q = withdrawLegsQuote(shares, s)
    const liq = (shares * (s.liquidity + V)) / (s.totalShares + V)
    const { amount0, amount1 } = getAmountsForLiquidity(s.sqrtPriceX96!, getSqrtPriceAtTick(s.tickLower), getSqrtPriceAtTick(s.tickUpper), liq)
    expect(q.quoteOut).toBe((shares * (s.idleAtomic + V)) / (s.totalShares + V) + amount0)
    expect(q.pairedOut).toBe(amount1)
    expect(q.pairedOut > 0n).toBe(true)
  })
  it('swaps the legs when quote is currency1', () => {
    const s0 = state({ quoteIsCurrency0: true })
    const s1 = state({ quoteIsCurrency0: false })
    const a = withdrawLegsQuote(100_000_000n, s0)
    const b = withdrawLegsQuote(100_000_000n, s1)
    const idle = (100_000_000n * (s0.idleAtomic + V)) / (s0.totalShares + V)
    expect(b.pairedOut).toBe(a.quoteOut - idle) // b's paired leg = a's LP-quote leg (amount0)
    expect(b.quoteOut - idle).toBe(a.pairedOut) // and vice-versa
  })
  it('last holder takes the whole idle reserve and the whole position', () => {
    const s = state()
    const q = withdrawLegsQuote(s.totalShares, s)
    const { amount0, amount1 } = getAmountsForLiquidity(s.sqrtPriceX96!, getSqrtPriceAtTick(s.tickLower), getSqrtPriceAtTick(s.tickUpper), s.liquidity)
    expect(q.quoteOut).toBe(s.idleAtomic + amount0)
    expect(q.pairedOut).toBe(amount1)
  })
  it('unreadable spot ⇒ LP leg unquotable (caller must not set an LP floor from a guess)', () => {
    const q = withdrawLegsQuote(100_000_000n, state({ sqrtPriceX96: null }))
    expect(q.lpQuotable).toBe(false)
    expect(q.pairedOut).toBe(0n)
  })
  it('never quotes more than the pool holds (Σ pro-rata ≤ full)', () => {
    const s = state()
    const full = withdrawLegsQuote(s.totalShares, s)
    const a = withdrawLegsQuote(s.totalShares / 3n, s)
    const b = withdrawLegsQuote(s.totalShares - s.totalShares / 3n, s)
    expect(a.quoteOut + b.quoteOut <= full.quoteOut).toBe(true)
    expect(a.pairedOut + b.pairedOut <= full.pairedOut).toBe(true)
  })
})

describe('pool state serialisation round-trips', () => {
  it('serialize → parse is identity', () => {
    const s = state()
    expect(parsePoolState(serializePoolState(s))).toEqual(s)
    const u = state({ deployed: false, liquidity: 0n, sqrtPriceX96: null })
    expect(parsePoolState(serializePoolState(u))).toEqual(u)
  })
})

describe('readGatewayPoolState', () => {
  const PM = '0x00000000000000000000000000000000000000ab' as const
  const STAGING = '0x00000000000000000000000000000000000000cd' as const
  const PERIPHERY = '0x00000000000000000000000000000000000000ef' as const
  const POOL_MANAGER = '0x0000000000000000000000000000000000000012' as const
  const key = { currency0: '0x' + '11'.repeat(20), currency1: '0x' + '22'.repeat(20), fee: 3000, tickSpacing: 60, hooks: '0x' + '00'.repeat(20) }

  function client(over: { tokenId?: bigint; slot0Throws?: boolean } = {}) {
    const calls: string[] = []
    return {
      calls,
      readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: unknown[] }) => {
        calls.push(`${address}:${functionName}`)
        if (address === PM) {
          switch (functionName) {
            case 'totalShares': return 1_000n
            case 'totalNav': return 1_100n
            case 'tokenId': return over.tokenId ?? 7n
            case 'tickLower': return -23040
            case 'tickUpper': return 23040
            case 'quoteIsCurrency0': return true
            case 'staging': return STAGING
            case 'positionManager': return PERIPHERY
            case 'poolManager': return POOL_MANAGER
            case 'poolKey': return key
          }
        }
        if (address === STAGING && functionName === 'stagedAssets') return 600n
        if (address === PERIPHERY && functionName === 'getPositionLiquidity') { expect(args).toEqual([over.tokenId ?? 7n]); return 5_000n }
        if (address === POOL_MANAGER && functionName === 'extsload') {
          if (over.slot0Throws) throw new Error('rpc')
          // slot0 word: tick 0 at bits 160..183, sqrtPrice = 2^96 in the low 160 bits
          return ('0x' + (1n << 96n).toString(16).padStart(64, '0')) as `0x${string}`
        }
        throw new Error(`unexpected ${address}:${functionName}`)
      },
    }
  }

  it('reads every input for a deployed pool (staging from the PM when not supplied)', async () => {
    const c = client()
    const s = await readGatewayPoolState({ client: c, positionManager: PM })
    expect(s).toEqual({
      totalShares: 1_000n, totalNav: 1_100n, idleAtomic: 600n, deployed: true, liquidity: 5_000n,
      sqrtPriceX96: 1n << 96n, tickLower: -23040, tickUpper: 23040, quoteIsCurrency0: true,
    })
    expect(c.calls).toContain(`${PM}:staging`)
  })
  it('uses a supplied staging address instead of reading it', async () => {
    const c = client()
    await readGatewayPoolState({ client: c, positionManager: PM, staging: STAGING })
    expect(c.calls).not.toContain(`${PM}:staging`)
  })
  it('undeployed pool (tokenId 0): no periphery / slot0 reads, liquidity 0, spot null', async () => {
    const c = client({ tokenId: 0n })
    const s = await readGatewayPoolState({ client: c, positionManager: PM })
    expect(s.deployed).toBe(false)
    expect(s.liquidity).toBe(0n)
    expect(s.sqrtPriceX96).toBeNull()
    expect(c.calls.some((x) => x.startsWith(PERIPHERY))).toBe(false)
  })
  it('a failed slot0 read nulls the spot (LP leg unquotable) instead of throwing', async () => {
    const s = await readGatewayPoolState({ client: client({ slot0Throws: true }), positionManager: PM })
    expect(s.sqrtPriceX96).toBeNull()
    expect(s.liquidity).toBe(5_000n)
  })
})
