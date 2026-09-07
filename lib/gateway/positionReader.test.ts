import { describe, it, expect } from 'vitest'
import { positionValueAtomic, readGatewayPosition } from './positionReader'

describe('positionValueAtomic (offset-consistent toAssets)', () => {
  it('values a share at the pooled NAV', () => {
    // even pool: 100k shares, 110k nav → 50k shares ≈ 55k value
    expect(positionValueAtomic(50_000n, 100_000n, 110_000n)).toBe(
      (50_000n * (110_000n + 1_000_000n)) / (100_000n + 1_000_000n),
    )
  })
  it('is zero with no shares or empty pool', () => {
    expect(positionValueAtomic(0n, 100n, 100n)).toBe(0n)
    expect(positionValueAtomic(10n, 0n, 0n)).toBe(0n)
  })
  it('never overstates: Σ per-share values ≤ nav (offset stays locked)', () => {
    const ts = 3n
    const nav = 1_000_000_000n
    const each = positionValueAtomic(1n, ts, nav)
    expect(each * ts).toBeLessThanOrEqual(nav)
  })
})

function mockClient(shares: bigint, totalShares: bigint, totalNav: bigint) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'sharesOf') return shares
      if (functionName === 'totalShares') return totalShares
      if (functionName === 'totalNav') return totalNav
      throw new Error(`unexpected read: ${functionName}`)
    },
  }
}

describe('readGatewayPosition', () => {
  const pm = '0x0000000000000000000000000000000000000abc' as const
  const user = '0x000000000000000000000000000000000000a11c' as const

  it('reads value + computes PnL vs cost basis', async () => {
    const v = await readGatewayPosition({
      client: mockClient(50_000n, 100_000n, 120_000n),
      positionManager: pm,
      user,
      costBasisAtomic: 50_000n,
      bufferBalanceAtomic: 1_234n,
    })
    expect(v.shares).toBe(50_000n)
    expect(v.positionValueAtomic).toBe(positionValueAtomic(50_000n, 100_000n, 120_000n))
    expect(v.unrealizedPnlAtomic).toBe(v.positionValueAtomic - 50_000n)
    expect(v.unrealizedPnlAtomic! > 0n).toBe(true) // NAV grew → positive PnL
    expect(v.bufferBalanceAtomic).toBe(1_234n)
  })

  it('null cost basis → null PnL (no fabricated basis)', async () => {
    const v = await readGatewayPosition({
      client: mockClient(10n, 10n, 10n),
      positionManager: pm,
      user,
    })
    expect(v.costBasisAtomic).toBeNull()
    expect(v.unrealizedPnlAtomic).toBeNull()
    expect(v.bufferBalanceAtomic).toBe(0n)
  })
})
