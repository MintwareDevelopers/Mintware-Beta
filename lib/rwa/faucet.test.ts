import { describe, expect, it } from 'vitest'
import { canClaim } from './faucet'

describe('RWA dUSD faucet', () => {
  it('allows one claim per wallet per 24 h, case-insensitively', () => {
    const m = new Map<string, number>()
    const a = '0xAbCdEf0000000000000000000000000000000001'
    expect(canClaim(m, a, 1_000)).toBe(true)
    m.set(a.toLowerCase(), 1_000)
    expect(canClaim(m, a.toUpperCase().replace('0X', '0x'), 1_000 + 3_600_000)).toBe(false)
    expect(canClaim(m, a, 1_000 + 24 * 3_600_000)).toBe(true)
  })
})
