import { describe, it, expect } from 'vitest'
import { centsToAtomicUsdc } from './lithic'

describe('centsToAtomicUsdc', () => {
  it('scales cents to atomic 6dp USDC exactly (integer math, no float)', () => {
    expect(centsToAtomicUsdc(100)).toBe(1_000_000n) // $1.00
    expect(centsToAtomicUsdc(1)).toBe(10_000n) // $0.01
    expect(centsToAtomicUsdc(123_456)).toBe(1_234_560_000n) // $1,234.56
  })
  it('rounds a non-integer cents value defensively (Lithic amounts are always integer cents)', () => {
    expect(centsToAtomicUsdc(100.4)).toBe(1_000_000n)
    expect(centsToAtomicUsdc(100.6)).toBe(1_010_000n)
  })
})
