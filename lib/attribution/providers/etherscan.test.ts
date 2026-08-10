import { describe, it, expect } from 'vitest'
import { mapEtherscanToActivity } from './etherscan'

const DAY = 86_400_000

describe('mapEtherscanToActivity', () => {
  const now = Date.UTC(2026, 0, 15) // fixed "now"
  const t = (daysAgo: number) => String(Math.floor((now - daysAgo * DAY) / 1000)) // unix seconds

  it('aggregates first-seen, chains, tx count, active weeks, volume, and a native holding', () => {
    const a = mapEtherscanToActivity({
      address: '0xabc0000000000000000000000000000000000abc',
      nowMs: now,
      priceUsd: { ethereum: 3000, 'matic-network': 1 },
      chains: [
        {
          name: 'ethereum', native: 'ethereum', nativeBalanceWei: (2n * 10n ** 18n).toString(), // 2 ETH
          txs: [
            { timeStamp: t(700), value: (1n * 10n ** 18n).toString() }, // 700d ago, 1 ETH
            { timeStamp: t(30),  value: (5n * 10n ** 17n).toString() }, // 30d ago, 0.5 ETH
          ],
        },
        {
          name: 'base', native: 'ethereum', nativeBalanceWei: '0',
          txs: [{ timeStamp: t(10), value: '0' }], // recent, no native value
        },
        {
          name: 'polygon', native: 'matic-network', nativeBalanceWei: '0',
          txs: [], // no activity → excluded from chains
        },
      ],
    })

    expect(a.address).toBe('0xabc0000000000000000000000000000000000abc')
    expect(a.chains.sort()).toEqual(['base', 'ethereum']) // polygon excluded (no txs)
    expect(a.totalTxCount).toBe(3)
    expect(a.activeWeeks).toBe(3) // three distinct weeks
    // volume ≈ (1 + 0.5) ETH * $3000 = $4500 (base tx had 0 value)
    expect(Math.round(a.lifetimeVolumeUsd)).toBe(4500)
    // first-seen = 700 days ago
    expect(Math.round((now - a.firstSeenMs) / DAY)).toBe(700)
    // one native holding: 2 ETH * $3000 = $6000, held since first-seen
    expect(a.positions).toHaveLength(1)
    expect(Math.round(a.positions[0].usdValue)).toBe(6000)
    expect(a.positions[0].holdDays).toBe(700)
    // fields the other providers fill stay empty
    expect(a.lpPositions).toEqual([])
    expect(a.referrals).toEqual([])
    expect(a.riskFlags).toEqual([])
    expect(a.govVotes).toBe(0)
  })

  it('returns an empty-but-valid profile for a wallet with no activity', () => {
    const a = mapEtherscanToActivity({
      address: '0x0000000000000000000000000000000000000000',
      nowMs: now, priceUsd: {},
      chains: [{ name: 'ethereum', native: 'ethereum', nativeBalanceWei: '0', txs: [] }],
    })
    expect(a.chains).toEqual([])
    expect(a.totalTxCount).toBe(0)
    expect(a.firstSeenMs).toBe(0)
    expect(a.positions).toEqual([])
  })
})
