import { describe, it, expect } from 'vitest'
import { normalizePool, buildManifest } from './manifest'

const POOLID = '0x' + '1'.repeat(64)
const ADDR = (n: string) => '0x' + n.repeat(40)

const valid = {
  chainId: 8453,
  poolId: POOLID,
  currency0: ADDR('a'),
  currency1: ADDR('b'),
  fee: 3000,
  tickSpacing: 60,
  hooks: ADDR('c'),
  vault: ADDR('d'),
  kind: 'community',
  managed: false,
}

describe('normalizePool', () => {
  it('accepts + lowercases a well-formed entry, defaults routing flags', () => {
    const r = normalizePool({ ...valid, currency0: ADDR('A') })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pool.currency0).toBe(ADDR('a')) // lowercased
    expect(r.pool.routing).toEqual({ exactInputOnly: false, hasCircuitBreaker: true, dynamicFee: false })
    expect(r.pool.kind).toBe('community')
  })

  it('managed pools are exact-input-only; dynamic fee is flagged', () => {
    const r = normalizePool({ ...valid, managed: true, fee: 'dynamic' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pool.fee).toBe('dynamic')
    expect(r.pool.routing).toMatchObject({ exactInputOnly: true, dynamicFee: true })
  })

  it('defaults kind to community; honors bluechip', () => {
    expect((normalizePool({ ...valid, kind: 'weird' }) as { pool: { kind: string } }).pool?.kind).toBe('community')
    expect((normalizePool({ ...valid, kind: 'bluechip' }) as { pool: { kind: string } }).pool?.kind).toBe('bluechip')
  })

  it('rejects malformed data (never advertise an unroutable pool)', () => {
    expect(normalizePool({ ...valid, poolId: '0xshort' })).toMatchObject({ ok: false, error: 'bad_poolId' })
    expect(normalizePool({ ...valid, currency0: 'nope' })).toMatchObject({ ok: false, error: 'bad_currency0' })
    expect(normalizePool({ ...valid, hooks: '0x123' })).toMatchObject({ ok: false, error: 'bad_hooks' })
    expect(normalizePool({ ...valid, tickSpacing: 0 })).toMatchObject({ ok: false, error: 'bad_tickSpacing' })
    expect(normalizePool({ ...valid, chainId: 1.5 })).toMatchObject({ ok: false, error: 'bad_chainId' })
    expect(normalizePool({ ...valid, fee: 2_000_000 })).toMatchObject({ ok: false, error: 'bad_fee' })
  })
})

describe('buildManifest', () => {
  it('drops invalid entries and keeps valid ones (no fabrication)', () => {
    const m = buildManifest([valid, { junk: true }, { ...valid, poolId: 'bad' }, { ...valid, kind: 'bluechip' }])
    expect(m.pools).toHaveLength(2)
    expect(m.name).toBe('Mintware Liquidity')
    expect(m.pools.map((p) => p.kind).sort()).toEqual(['bluechip', 'community'])
  })

  it('empty when nothing is configured', () => {
    expect(buildManifest([]).pools).toEqual([])
  })
})
