// =============================================================================
// Zerion adapter — pure-mapper tests against realistic fixtures (no live key).
// =============================================================================

import { describe, it, expect } from 'vitest'
import { mapZerionToActivity, type ZerionPosition, type ZerionTransaction } from './zerion'
import { computeScore } from '../score'

const NOW = Date.UTC(2025, 0, 1) // fixed clock
const ms = (iso: string) => Date.parse(iso)

const positions: ZerionPosition[] = [
  { attributes: { position_type: 'wallet', value: 48_000, fungible_info: { symbol: 'ETH' } }, relationships: { chain: { data: { id: 'ethereum' } } } },
  { attributes: { position_type: 'wallet', value: 10_000, fungible_info: { symbol: 'USDC' } }, relationships: { chain: { data: { id: 'base' } } } },
  { attributes: { position_type: 'deposit', value: 40_000, application_metadata: { name: 'Uniswap V3' }, fungible_info: { symbol: 'UNI-V3' } }, relationships: { chain: { data: { id: 'ethereum' } } } },
  { attributes: { position_type: 'wallet', value: 999, fungible_info: { symbol: 'SCAM' }, flags: { displayable: false } } }, // trash → skipped
  { attributes: { position_type: 'wallet', value: 0, fungible_info: { symbol: 'DUST' } } },                                    // zero → skipped
]

const transactions: ZerionTransaction[] = [
  { attributes: { operation_type: 'receive', mined_at: '2023-01-10T00:00:00Z', transfers: [{ direction: 'in', value: 30_000, fungible_info: { symbol: 'ETH' } }] }, relationships: { chain: { data: { id: 'ethereum' } } } },
  { attributes: { operation_type: 'deposit', mined_at: '2024-03-01T00:00:00Z', transfers: [{ direction: 'out', value: 40_000, fungible_info: { symbol: 'ETH' } }] }, relationships: { chain: { data: { id: 'ethereum' } } } },
  { attributes: { operation_type: 'trade', mined_at: '2024-06-01T00:00:00Z', transfers: [{ direction: 'in', value: 5_000, fungible_info: { symbol: 'USDC' } }, { direction: 'out', value: 4_800, fungible_info: { symbol: 'ETH' } }] }, relationships: { chain: { data: { id: 'base' } } } },
  { attributes: { operation_type: 'trade', mined_at: '2024-06-15T00:00:00Z', transfers: [{ direction: 'in', value: 8_000, fungible_info: { symbol: 'ETH' } }, { direction: 'out', value: 7_900, fungible_info: { symbol: 'USDC' } }] }, relationships: { chain: { data: { id: 'ethereum' } } } },
  { attributes: { operation_type: 'delegate', mined_at: '2024-09-01T00:00:00Z', transfers: [] }, relationships: { chain: { data: { id: 'ethereum' } } } },
]

const activity = mapZerionToActivity({ address: '0xabc', positions, transactions, nowMs: NOW })

describe('mapZerionToActivity', () => {
  it('derives chains, volume, delegations from tx history', () => {
    expect(activity.chains.sort()).toEqual(['base', 'ethereum'])
    expect(activity.lifetimeVolumeUsd).toBe(13_000) // 5000 + 8000, larger leg per trade
    expect(activity.delegations).toBe(1)
    expect(activity.totalTxCount).toBe(5)
    expect(activity.activeWeeks).toBe(5)
  })

  it('sets first/last seen from earliest/latest mined_at', () => {
    expect(activity.firstSeenMs).toBe(ms('2023-01-10T00:00:00Z'))
    expect(activity.lastSeenMs).toBe(ms('2024-09-01T00:00:00Z'))
  })

  it('maps holdings (skipping trash + zero) with holdDays from earliest receive', () => {
    expect(activity.positions.map(p => p.symbol).sort()).toEqual(['ETH', 'USDC'])
    const eth = activity.positions.find(p => p.symbol === 'ETH')!
    expect(eth.usdValue).toBe(48_000)
    expect(eth.holdDays).toBeGreaterThan(600) // received Jan 2023, now Jan 2025 → ~2y
    const usdc = activity.positions.find(p => p.symbol === 'USDC')!
    expect(usdc.holdDays).toBeLessThan(300)   // first received Jun 2024
  })

  it('maps a protocol deposit to an LP position with duration from first entry', () => {
    expect(activity.lpPositions).toHaveLength(1)
    const lp = activity.lpPositions[0]
    expect(lp.usdDepth).toBe(40_000)
    expect(lp.pool).toBe('Uniswap V3')
    expect(lp.active).toBe(true)
    expect(lp.durationDays).toBeGreaterThan(280) // deposited Mar 2024
  })

  it('leaves provider-external fields empty (composite provider fills them)', () => {
    expect(activity.govVotes).toBe(0)
    expect(activity.referrals).toEqual([])
    expect(activity.riskFlags).toEqual([])
  })

  it('produces a sane score end-to-end', () => {
    const r = computeScore(activity, NOW)
    expect(r.score).toBeGreaterThan(200)
    expect(r.signals.find(s => s.key === 'liquidity')!.score).toBeGreaterThan(0)
    expect(r.signals.find(s => s.key === 'holding')!.score).toBeGreaterThan(0)
    expect(r.signals.find(s => s.key === 'volume')!.score).toBeGreaterThan(0)
  })

  it('handles an empty wallet without throwing', () => {
    const empty = mapZerionToActivity({ address: '0x0', positions: [], transactions: [], nowMs: NOW })
    expect(empty.firstSeenMs).toBe(0)
    expect(empty.chains).toEqual([])
    expect(computeScore(empty, NOW).score).toBe(0)
  })
})
