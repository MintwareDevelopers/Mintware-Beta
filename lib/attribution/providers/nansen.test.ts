// =============================================================================
// Nansen graded-risk adapter — label→flag mapping + inert-without-key fetcher.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { mapNansenLabelsToRiskFlags, buildNansenRiskFetcher, type NansenLabel } from './nansen'

describe('mapNansenLabelsToRiskFlags', () => {
  it('maps illicit labels to the right risk types', () => {
    const flags = mapNansenLabelsToRiskFlags([
      { label: 'Tornado Cash Depositor', category: 'defi' },
      { label: 'OFAC Sanctioned', category: 'others' },
    ])
    expect(flags.find(f => f.type === 'mixer')?.severity).toBe(0.9)
    expect(flags.find(f => f.type === 'sanctioned')?.severity).toBe(1)
  })

  it('dedupes to one flag per type, keeping the highest severity', () => {
    const flags = mapNansenLabelsToRiskFlags([
      { label: 'Phishing scam' }, { label: 'Wallet drainer / stolen funds' },
    ])
    expect(flags.filter(f => f.type === 'scam')).toHaveLength(1)
    expect(flags.find(f => f.type === 'scam')?.severity).toBe(0.9) // drainer/stolen > phishing
  })

  it('returns no flags for clean labels', () => {
    expect(mapNansenLabelsToRiskFlags([
      { label: 'Uniswap LP', category: 'defi' }, { label: 'Smart Trader', category: 'smart_money' },
    ])).toEqual([])
  })

  it('handles empty / missing fields', () => {
    expect(mapNansenLabelsToRiskFlags([])).toEqual([])
    expect(mapNansenLabelsToRiskFlags([{}])).toEqual([])
  })
})

describe('buildNansenRiskFetcher', () => {
  it('is inert (no flags) when NANSEN_API_KEY is unset', async () => {
    const prev = process.env.NANSEN_API_KEY
    delete process.env.NANSEN_API_KEY
    const flags = await buildNansenRiskFetcher(async () => [{ label: 'Sanctioned' }])(
      '0x1111111111111111111111111111111111111111',
    )
    expect(flags).toEqual([]) // never calls the reader without a key
    if (prev !== undefined) process.env.NANSEN_API_KEY = prev
  })

  it('maps labels when a key is present, and fails open on reader error', async () => {
    process.env.NANSEN_API_KEY = 'test-key'
    const ok = await buildNansenRiskFetcher(async () => [{ label: 'Tornado mixer' }])('0xabc')
    expect(ok.find(f => f.type === 'mixer')).toBeTruthy()
    const failed = await buildNansenRiskFetcher(async () => { throw new Error('vendor down') })('0xabc')
    expect(failed).toEqual([])
    delete process.env.NANSEN_API_KEY
  })
})
