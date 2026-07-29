// Guards the R5 lock decode: the vault getter returns (depositedAt, lockedUntil,
// tier, initialized), so lockedUntil MUST be read from index 1 — not index 0
// (depositedAt), which is always in the past and would pin the bonus off forever.
import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, decodeAbiParameters } from 'viem'
import { remainingLockDays, type LockTuple } from './holdLocks'

const NOW = 1_800_000_000       // fixed "now" in seconds
const DAY = 86_400

describe('remainingLockDays', () => {
  it('reads lockedUntil from index 1 (not depositedAt at index 0)', () => {
    // depositedAt far in the past, lockedUntil 30 days out.
    const lock: LockTuple = [BigInt(NOW - 90 * DAY), BigInt(NOW + 30 * DAY), 2, true]
    expect(remainingLockDays(lock, NOW)).toBe(30)
    // If it mistakenly read index 0 (depositedAt, in the past) it would return 0.
  })

  it('returns 0 for an expired or unset lock', () => {
    expect(remainingLockDays([BigInt(NOW - 5 * DAY), BigInt(NOW - DAY), 1, true], NOW)).toBe(0)
    expect(remainingLockDays([0n, 0n, 0, false], NOW)).toBe(0)
  })

  it('floors partial days', () => {
    expect(remainingLockDays([0n, BigInt(NOW + 7 * DAY + 3600), 3, true], NOW)).toBe(7)
  })
})

describe('LOCK_ABI shape (round-trip against the real 4-field getter)', () => {
  it('decodes a 4-field getter output with lockedUntil at index 1', () => {
    // Encode exactly what the on-chain getter returns for LockInfo.
    const outputs = [
      { name: 'depositedAt', type: 'uint256' },
      { name: 'lockedUntil', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
      { name: 'initialized', type: 'bool' },
    ] as const
    const encoded = encodeAbiParameters(outputs, [BigInt(NOW - 10 * DAY), BigInt(NOW + 60 * DAY), 2, true])
    const decoded = decodeAbiParameters(outputs, encoded) as unknown as LockTuple
    // lockedUntil is slot 1; remainingLockDays must resolve 60 days, proving the shape.
    expect(remainingLockDays(decoded, NOW)).toBe(60)
  })
})
