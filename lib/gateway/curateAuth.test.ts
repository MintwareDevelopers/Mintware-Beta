import { describe, it, expect } from 'vitest'
import { buildGatewayCurateMessage, parseCuratorAllowlist, isAllowlistedCurator, GATEWAY_CURATE_ACTION } from './curateAuth'

const A = '0xAbCdEf0000000000000000000000000000000001'
const B = '0x0000000000000000000000000000000000000002'

describe('buildGatewayCurateMessage', () => {
  it('is canonical: lower-cases every address, embeds the action tag + issuedAt, null for absent fields', () => {
    const m = buildGatewayCurateMessage({ address: A, issuedAt: 123, curateAction: 'approve', requestId: 'r1', positionManager: '0xABCD'.padEnd(42, '0'), poolAddress: '0xPOOL' })
    const p = JSON.parse(m)
    expect(p).toEqual({
      action: GATEWAY_CURATE_ACTION, address: A.toLowerCase(), curateAction: 'approve', requestId: 'r1',
      poolAddress: '0xpool', chainId: null, positionManager: '0xABCD'.padEnd(42, '0').toLowerCase(), staging: null, issuedAt: 123,
    })
    expect(GATEWAY_CURATE_ACTION).toBe('mintware-gateway-curate')
  })
  it('changes when any bound field changes (action / request / candidate / issuedAt)', () => {
    const base = { address: A, issuedAt: 1, curateAction: 'approve' as const, requestId: 'r1', positionManager: B }
    const m = buildGatewayCurateMessage(base)
    expect(buildGatewayCurateMessage({ ...base, curateAction: 'reject' })).not.toBe(m)
    expect(buildGatewayCurateMessage({ ...base, requestId: 'r2' })).not.toBe(m)
    expect(buildGatewayCurateMessage({ ...base, positionManager: A })).not.toBe(m)
    expect(buildGatewayCurateMessage({ ...base, issuedAt: 2 })).not.toBe(m)
    expect(buildGatewayCurateMessage({ ...base, address: A.toUpperCase().replace('0X', '0x') })).toBe(m) // case-insensitive address
  })
})

describe('parseCuratorAllowlist / isAllowlistedCurator', () => {
  it('parses a comma list, trims, lower-cases, drops junk', () => {
    expect(parseCuratorAllowlist(` ${A}, ${B} ,nope,0x12`)).toEqual([A.toLowerCase(), B])
    expect(parseCuratorAllowlist(undefined)).toEqual([])
    expect(parseCuratorAllowlist('')).toEqual([])
  })
  it('an empty allowlist admits nobody (fail closed); membership is case-insensitive', () => {
    expect(isAllowlistedCurator(A, [])).toBe(false)
    expect(isAllowlistedCurator(null, [A.toLowerCase()])).toBe(false)
    expect(isAllowlistedCurator(A.toUpperCase().replace('0X', '0x'), [A.toLowerCase()])).toBe(true)
    expect(isAllowlistedCurator(B, [A.toLowerCase()])).toBe(false)
  })
})
