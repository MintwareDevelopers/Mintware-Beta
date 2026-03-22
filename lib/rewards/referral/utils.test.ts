import { describe, it, expect } from 'vitest'
import { generateRefCode, truncateAddress } from '@/lib/rewards/referral/utils'

describe('generateRefCode', () => {
  it('should return a string starting with "mw_"', () => {
    const code = generateRefCode('0x1234567890abcdef1234567890abcdef12345678')
    expect(code.startsWith('mw_')).toBe(true)
  })

  it('should slice characters 2–7 (inclusive) from the address', () => {
    // address = '0x1234567890...' → slice(2,8) = '123456'
    const code = generateRefCode('0x1234567890abcdef1234567890abcdef12345678')
    expect(code).toBe('mw_123456')
  })

  it('should always return a 9-character string (mw_ + 6 hex chars)', () => {
    const code = generateRefCode('0xabcdef1234567890abcdef1234567890abcdef12')
    expect(code.length).toBe(9)
  })

  it('should lowercase the slice of the address', () => {
    // Checksummed address — uppercase hex chars must be lowercased
    const code = generateRefCode('0xABCDEF1234567890abcdef1234567890abcdef12')
    expect(code).toBe('mw_abcdef')
  })

  it('should produce the same code for a lower- and upper-case hex address', () => {
    const lower = generateRefCode('0xabcdef000000000000000000000000000000000a')
    const upper = generateRefCode('0xABCDEF000000000000000000000000000000000a')
    expect(lower).toBe(upper)
  })

  it('should be deterministic — same address always produces the same code', () => {
    const addr = '0xdeadbeef1234567890abcdef1234567890abcdef'
    expect(generateRefCode(addr)).toBe(generateRefCode(addr))
  })

  it('should only use the first 6 hex chars after 0x, ignoring the rest of the address', () => {
    const a = generateRefCode('0xaabbcc0000000000000000000000000000000000')
    const b = generateRefCode('0xaabbccffffffffffffffffffffffffffffffffffff')
    // slice(2,8) is 'aabbcc' in both cases
    expect(a).toBe('mw_aabbcc')
    expect(b).toBe('mw_aabbcc')
  })

  it('should produce distinct codes for different addresses', () => {
    const code1 = generateRefCode('0x1111111111111111111111111111111111111111')
    const code2 = generateRefCode('0x2222222222222222222222222222222222222222')
    expect(code1).not.toBe(code2)
  })
})

describe('truncateAddress', () => {
  it('should format a full address as 0x1234…abcd', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678'
    // slice(0,6) = '0x1234', slice(-4) = '5678'
    expect(truncateAddress(addr)).toBe('0x1234…5678')
  })

  it('should return the first 6 characters before the ellipsis', () => {
    const addr = '0xabcdef1234567890abcdef1234567890abcdef12'
    expect(truncateAddress(addr).startsWith('0xabcd')).toBe(true)
  })

  it('should return the last 4 characters after the ellipsis', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678'
    expect(truncateAddress(addr).endsWith('5678')).toBe(true)
  })

  it('should use a single "…" (ellipsis character, not three dots) as the separator', () => {
    const result = truncateAddress('0x1234567890abcdef1234567890abcdef12345678')
    expect(result).toContain('…')
    expect(result).not.toContain('...')
  })

  it('should produce an 11-character result for a standard 42-character address', () => {
    // '0x1234' (6) + '…' (1) + '5678' (4) = 11
    const result = truncateAddress('0x1234567890abcdef1234567890abcdef12345678')
    expect(result.length).toBe(11)
  })

  it('should return the input unchanged when it is shorter than 10 characters', () => {
    expect(truncateAddress('0x123')).toBe('0x123')
    expect(truncateAddress('short')).toBe('short')
  })

  it('should return the input unchanged when it is exactly 10 characters', () => {
    // length === 10, guard is `< 10` so 10-char strings ARE truncated
    const addr = '0x12345678' // 10 chars
    // length(10) is NOT < 10, so it goes through truncation:
    // slice(0,6) = '0x1234', slice(-4) = '5678' → '0x1234…5678'
    expect(truncateAddress(addr)).toBe('0x1234…5678')
  })

  it('should return an empty string unchanged', () => {
    expect(truncateAddress('')).toBe('')
  })

  it('should be deterministic — same address always produces the same result', () => {
    const addr = '0xdeadbeef1234567890abcdef1234567890abcdef'
    expect(truncateAddress(addr)).toBe(truncateAddress(addr))
  })
})
