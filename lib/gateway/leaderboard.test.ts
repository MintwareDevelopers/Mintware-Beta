import { describe, it, expect } from 'vitest'
import { rankProviders, rankProvidersFromDb, totalValueAtomic, type InstanceHoldings } from './leaderboard'
import { positionValueAtomic } from './positionReader'

const A = '0x' + 'a'.repeat(40)
const B = '0x' + 'b'.repeat(40)
const C = '0x' + 'c'.repeat(40)
const D = '0x' + 'd'.repeat(40)
const USDG = (n: number) => BigInt(Math.round(n * 1e6)) // 6dp

const inst = (poolAddress: string, totalShares: bigint, totalNav: bigint, shares: Record<string, bigint>): InstanceHoldings =>
  ({ poolAddress, totalShares, totalNav, shares: new Map(Object.entries(shares)) })

describe('rankProviders — chain-truth standings', () => {
  it('values = shares × totalNav / totalShares (offset floor), ranked desc, 6dp', () => {
    // 1,000 USDG of shares in a pool whose NAV grew to 1,100 USDG → holder of 40% is worth ~440
    const ts = USDG(1000), nav = USDG(1100)
    const out = rankProviders([inst('0xp1', ts, nav, { [A]: USDG(400), [B]: USDG(600) })])
    expect(out.map((p) => p.wallet)).toEqual([B, A])
    expect(out[0]).toMatchObject({ rank: 1, pools: 1, shares: USDG(600) })
    expect(out[0].valueAtomic).toBe(positionValueAtomic(USDG(600), ts, nav))
    expect(out[1].valueAtomic).toBe(positionValueAtomic(USDG(400), ts, nav))
    // never overstates the pool
    expect(out[0].valueAtomic + out[1].valueAtomic).toBeLessThanOrEqual(nav)
  })

  it('sums across multiple instances and counts pools with >0 shares', () => {
    const out = rankProviders([
      inst('0xp1', USDG(100), USDG(100), { [A]: USDG(10), [B]: USDG(50) }),
      inst('0xp2', USDG(100), USDG(200), { [A]: USDG(30), [B]: 0n }),
    ])
    const a = out.find((p) => p.wallet === A)!
    const b = out.find((p) => p.wallet === B)!
    expect(a.pools).toBe(2)
    expect(b.pools).toBe(1)
    expect(a.valueAtomic).toBe(positionValueAtomic(USDG(10), USDG(100), USDG(100)) + positionValueAtomic(USDG(30), USDG(100), USDG(200)))
    expect(a.rank).toBe(1) // ~10 + ~60 > ~50
    expect(b.rank).toBe(2)
  })

  it('drops zero-share wallets (a fully-withdrawn depositor no longer ranks — the O-11 fix)', () => {
    const out = rankProviders([inst('0xp1', USDG(100), USDG(100), { [A]: 0n, [B]: USDG(1) })])
    expect(out.map((p) => p.wallet)).toEqual([B])
  })

  it('ties share a rank (competition ranking) and order by wallet for determinism', () => {
    const out = rankProviders([inst('0xp1', USDG(100), USDG(100), { [C]: USDG(10), [A]: USDG(10), [B]: USDG(20), [D]: USDG(1) })])
    expect(out.map((p) => [p.wallet, p.rank])).toEqual([[B, 1], [A, 2], [C, 2], [D, 4]])
  })

  it('empty pool (totalShares = 0) contributes nothing; empty input → []', () => {
    expect(rankProviders([])).toEqual([])
    expect(rankProviders([inst('0xp1', 0n, 0n, { [A]: 0n })])).toEqual([])
  })

  it('normalises wallet case so the same address is one row', () => {
    const out = rankProviders([
      inst('0xp1', USDG(100), USDG(100), { [A.toUpperCase().replace('0X', '0x')]: USDG(10) }),
      inst('0xp2', USDG(100), USDG(100), { [A]: USDG(10) }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].pools).toBe(2)
  })

  it('totalValueAtomic sums the board', () => {
    const out = rankProviders([inst('0xp1', USDG(100), USDG(100), { [A]: USDG(10), [B]: USDG(20) })])
    expect(totalValueAtomic(out)).toBe(out[0].valueAtomic + out[1].valueAtomic)
  })
})

describe('rankProvidersFromDb — the explicitly-degraded fallback', () => {
  it('sums entry_nav per wallet, counts distinct pools, ranks with ties', () => {
    const out = rankProvidersFromDb([
      { user_wallet: A, entry_nav: '5000000', pool_address: '0xP1' },
      { user_wallet: A, entry_nav: '5000000', pool_address: '0xp2' },
      { user_wallet: B, entry_nav: '10000000', pool_address: '0xp1' },
      { user_wallet: C, entry_nav: 'garbage', pool_address: '0xp1' },
      { user_wallet: D, entry_nav: '0', pool_address: '0xp1' },
    ])
    expect(out.map((p) => [p.wallet, p.rank, p.pools])).toEqual([[A, 1, 2], [B, 1, 1]])
    expect(out[0].valueAtomic).toBe(10_000_000n)
  })
})
