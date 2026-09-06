import { describe, it, expect } from 'vitest'
import { skimPerformanceFee, proRataBufferCredits, type SharePosition } from './harvestMath'

describe('skimPerformanceFee', () => {
  it('skims bps and leaves the remainder for the buffer', () => {
    expect(skimPerformanceFee(1_000_000n, 1000)).toEqual({ feeAtomic: 100_000n, netAtomic: 900_000n })
  })
  it('rounds the fee DOWN (never under-credits the buffer)', () => {
    // 999 * 1000 / 10000 = 99.9 → 99
    expect(skimPerformanceFee(999n, 1000)).toEqual({ feeAtomic: 99n, netAtomic: 900n })
  })
  it('zero fee and zero gross are no-ops', () => {
    expect(skimPerformanceFee(500n, 0)).toEqual({ feeAtomic: 0n, netAtomic: 500n })
    expect(skimPerformanceFee(0n, 1000)).toEqual({ feeAtomic: 0n, netAtomic: 0n })
    expect(skimPerformanceFee(-5n, 1000)).toEqual({ feeAtomic: 0n, netAtomic: 0n })
  })
  it('rejects out-of-range bps', () => {
    expect(() => skimPerformanceFee(1n, 10_001)).toThrow()
    expect(() => skimPerformanceFee(1n, -1)).toThrow()
    expect(() => skimPerformanceFee(1n, 1.5)).toThrow()
  })
})

describe('proRataBufferCredits', () => {
  it('splits pro-rata to shares', () => {
    const pos: SharePosition[] = [{ user: 'a', shares: 100n }, { user: 'b', shares: 300n }]
    const credits = proRataBufferCredits(400n, pos)
    expect(credits).toEqual([{ user: 'a', creditAtomic: 100n }, { user: 'b', creditAtomic: 300n }])
  })

  it('assigns floor-division dust to the largest holder so the sum equals net exactly', () => {
    const pos: SharePosition[] = [{ user: 'a', shares: 1n }, { user: 'b', shares: 1n }, { user: 'c', shares: 1n }]
    const credits = proRataBufferCredits(10n, pos) // 10/3 each = 3, dust 1
    const sum = credits.reduce((s, c) => s + c.creditAtomic, 0n)
    expect(sum).toBe(10n)
    // largest holder is the first with the max share (all equal → index 0)
    expect(credits[0].creditAtomic).toBe(4n)
    expect(credits[1].creditAtomic).toBe(3n)
    expect(credits[2].creditAtomic).toBe(3n)
  })

  it('never over-distributes for arbitrary splits (sum == net)', () => {
    const pos: SharePosition[] = [
      { user: 'a', shares: 7n }, { user: 'b', shares: 13n }, { user: 'c', shares: 999n },
    ]
    const net = 1_000_000_001n
    const sum = proRataBufferCredits(net, pos).reduce((s, c) => s + c.creditAtomic, 0n)
    expect(sum).toBe(net)
  })

  it('ignores zero/negative shares and returns [] when nothing to split', () => {
    expect(proRataBufferCredits(0n, [{ user: 'a', shares: 1n }])).toEqual([])
    expect(proRataBufferCredits(100n, [])).toEqual([])
    expect(proRataBufferCredits(100n, [{ user: 'a', shares: 0n }])).toEqual([])
  })

  it('excludes a zero-share holder; dust still reconciles among real holders', () => {
    const pos: SharePosition[] = [{ user: 'z', shares: 0n }, { user: 'a', shares: 3n }]
    const credits = proRataBufferCredits(10n, pos)
    const sum = credits.reduce((s, c) => s + c.creditAtomic, 0n)
    expect(sum).toBe(10n)
    expect(credits.find((c) => c.user === 'z')).toBeUndefined()
    expect(credits.find((c) => c.user === 'a')?.creditAtomic).toBe(10n)
  })
})
