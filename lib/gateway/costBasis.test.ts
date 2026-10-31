import { describe, it, expect } from 'vitest'
import { computeCostBasis, type EngineEvent } from './costBasis'

const dep = (block: number, quote: bigint, shares: bigint, other = 0n): EngineEvent =>
  ({ action: 'deposit', sharesAtomic: shares, amount0Atomic: quote, amount1Atomic: other, blockNumber: BigInt(block), txIndex: 0 })
const wd = (block: number, shares: bigint): EngineEvent =>
  ({ action: 'withdraw', sharesAtomic: shares, amount0Atomic: 1n, amount1Atomic: 1n, blockNumber: BigInt(block), txIndex: 0 })

describe('computeCostBasis', () => {
  it('sums quote deposits', () => {
    expect(computeCostBasis([dep(1, 1_000n, 990n), dep(2, 500n, 480n)], 1_470n, true)).toEqual({ basisAtomic: 1_500n, complete: true })
  })

  it('reduces the basis pro-rata on a withdrawal', () => {
    // 1,000 in for 1,000 shares, then 250 shares out → 750 of basis remains.
    expect(computeCostBasis([dep(1, 1_000n, 1_000n), wd(2, 250n)], 750n, true)).toEqual({ basisAtomic: 750n, complete: true })
  })

  it('orders events by block and transaction index, not by input order', () => {
    expect(computeCostBasis([wd(5, 500n), dep(1, 1_000n, 1_000n)], 500n, true)).toEqual({ basisAtomic: 500n, complete: true })
  })

  it('reads the quote side from token1 when quote is token1', () => {
    const e: EngineEvent = { action: 'deposit', sharesAtomic: 10n, amount0Atomic: 0n, amount1Atomic: 400n, blockNumber: 1n, txIndex: 0 }
    expect(computeCostBasis([e], 10n, false)).toEqual({ basisAtomic: 400n, complete: true })
  })

  it('is incomplete when a deposit included the non-quote token', () => {
    expect(computeCostBasis([dep(1, 1_000n, 1_000n, 5n)], 1_000n, true)).toEqual({ basisAtomic: null, complete: false })
  })

  it('is incomplete when replayed shares do not match on-chain shares', () => {
    expect(computeCostBasis([dep(1, 1_000n, 1_000n)], 1_200n, true)).toEqual({ basisAtomic: null, complete: false })
  })

  it('is incomplete when a withdrawal burns more than was recorded', () => {
    expect(computeCostBasis([dep(1, 1_000n, 100n), wd(2, 150n)], 0n, true)).toEqual({ basisAtomic: null, complete: false })
  })

  it('is zero and complete with no events and no shares', () => {
    expect(computeCostBasis([], 0n, true)).toEqual({ basisAtomic: 0n, complete: true })
  })
})
