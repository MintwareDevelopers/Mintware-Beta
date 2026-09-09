import { describe, it, expect } from 'vitest'
import { resolveInstanceStrict, listResolvableInstances, normalizePoolId } from './routeInstance'
import { fakeSupabase } from './__audit__/fakeSupabase'

// O-2 / HO-2 / R-1: the registry keys by poolId; a miss must be a 404 (never the env rig) whenever the
// registry has ≥1 active instance; the env fallback is served only while the registry is empty, tagged.
const ENV_PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const REG_PM = '0x00000000000000000000000000000000000000aa' as const
const REG_PM2 = '0x00000000000000000000000000000000000000bb' as const
const POOL_ID = '0x' + 'ab'.repeat(32)
const POOL_ID2 = '0x' + 'cd'.repeat(32)
const ENV_POOL = '0x' + 'ee'.repeat(32)
const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: ENV_PM, staging: null, poolAddress: ENV_POOL }
const row = (pool: string, pm: string, status = 'active') => ({
  pool_address: pool, chain_id: 46630, position_manager: pm, staging: '0x' + '11'.repeat(20), quote_asset: '0x' + '22'.repeat(20), status, pair_label: 'PONS / USDG',
})

describe('normalizePoolId', () => {
  it('accepts 20- or 32-byte hex (lowercased), rejects anything else', () => {
    expect(normalizePoolId(POOL_ID.toUpperCase())).toBe(POOL_ID)
    expect(normalizePoolId('0x' + 'AB'.repeat(20))).toBe('0x' + 'ab'.repeat(20))
    expect(normalizePoolId('pons-usdg')).toBe('')
    expect(normalizePoolId("'; drop table --")).toBe('')
  })
})

describe('resolveInstanceStrict — registry populated', () => {
  const db = () => fakeSupabase({ tables: { gateway_instances: [row(POOL_ID, REG_PM), row(POOL_ID2, REG_PM2, 'inactive')] } })

  it('poolId hit → the registry instance, source registry, live true', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID.toUpperCase())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.inst.positionManager).toBe(REG_PM)
      expect(r.inst.poolAddress).toBe(POOL_ID)
      expect(r.inst.source).toBe('registry')
      expect(r.inst.live).toBe(true)
      expect(r.inst.pairLabel).toBe('PONS / USDG')
    }
  })
  it('a pair-label slug (the old UI convention) is a 404, NOT the env rig', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, 'pons-usdg')
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
  it('an INACTIVE registry pool is a 404 (status respected), not the env rig', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID2)
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
  it('the env pool itself is NOT served while the registry is populated', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, ENV_POOL)
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
  it('an attacker-crafted param is a 404', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, "'; drop table --")
    expect(r.ok).toBe(false)
  })
  it('no pool param: the single active instance when unambiguous, else pool_required', async () => {
    const one = await resolveInstanceStrict(db().client, cfg, null)
    expect(one.ok && one.inst.positionManager).toBe(REG_PM)
    const two = fakeSupabase({ tables: { gateway_instances: [row(POOL_ID, REG_PM), row(POOL_ID2, REG_PM2)] } })
    const r = await resolveInstanceStrict(two.client, cfg, undefined)
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_required' })
  })
  // V1-01 fix (independent Codex audit, 2026-09-09): a depositor's shares don't stop existing when a
  // pool is deactivated — the portfolio must keep enumerating retired instances (never the env rig,
  // which is still registry-empty-only), just correctly flagged `live: false`. This replaces the OLD
  // assertion ("only active rows") that was itself the bug — deactivation silently dropped a funded
  // position from the portfolio with no normal way to see or exit it.
  it('listResolvableInstances returns BOTH active and retired registry rows (never the env rig)', async () => {
    const list = await listResolvableInstances(db().client, cfg)
    const byPm = new Map(list.map((i) => [i.positionManager, i]))
    expect(byPm.get(REG_PM)?.live).toBe(true)
    expect(byPm.get(REG_PM2)?.live).toBe(false) // retired, but still enumerated
    expect(list.every((i) => i.source === 'registry')).toBe(true)
  })
})

describe('resolveInstanceStrict — includeInactive (V1-01 fix: exit/read discovery ≠ deposit eligibility)', () => {
  const db = () => fakeSupabase({ tables: { gateway_instances: [row(POOL_ID, REG_PM), row(POOL_ID2, REG_PM2, 'inactive')] } })

  it('without includeInactive, a retired pool still 404s (deposit-route behavior, unchanged)', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID2)
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
  it('with includeInactive, a retired pool resolves — live:false, but ok:true (withdraw/read routes)', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID2, { includeInactive: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.inst.positionManager).toBe(REG_PM2)
      expect(r.inst.live).toBe(false)
    }
  })
  it('with includeInactive, an ACTIVE pool still resolves live:true (no regression)', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID, { includeInactive: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.inst.live).toBe(true)
  })
  it('with includeInactive, a pool that never existed is still a 404 (not a blanket bypass)', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, '0x' + 'ff'.repeat(32), { includeInactive: true })
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
  it('with includeInactive and no pool param, the env-rig/ambiguity rules are unaffected when ≥1 is active', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, null, { includeInactive: true })
    expect(r.ok && r.inst.positionManager).toBe(REG_PM) // the sole ACTIVE row, not the retired one
  })
})

describe('resolveInstanceStrict — registry empty (env fallback allowed, tagged)', () => {
  it('the env pool (or no pool) → env rig with source env-fallback and live FALSE', async () => {
    const { client } = fakeSupabase()
    for (const p of [ENV_POOL, ENV_POOL.toUpperCase(), null]) {
      const r = await resolveInstanceStrict(client, cfg, p)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.inst.positionManager).toBe(ENV_PM)
        expect(r.inst.source).toBe('env-fallback')
        expect(r.inst.live).toBe(false)
      }
    }
  })
  it('any OTHER pool is a 404 even with the registry empty (no silent re-routing)', async () => {
    const { client } = fakeSupabase()
    expect(await resolveInstanceStrict(client, cfg, POOL_ID)).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
    expect(await resolveInstanceStrict(client, cfg, 'meme-usdg')).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
  it('a legacy label-keyed env pool still resolves for its own label only', async () => {
    const { client } = fakeSupabase()
    const legacy = { ...cfg, poolAddress: 'pons-usdg' }
    expect((await resolveInstanceStrict(client, legacy, 'PONS-USDG')).ok).toBe(true)
    expect((await resolveInstanceStrict(client, legacy, 'meme-usdg')).ok).toBe(false)
  })
  it('no env rig either → 503 gateway_not_configured', async () => {
    const { client } = fakeSupabase()
    const r = await resolveInstanceStrict(client, { ...cfg, positionManager: null }, ENV_POOL)
    expect(r).toEqual({ ok: false, status: 503, error: 'gateway_not_configured' })
    expect(await listResolvableInstances(client, { ...cfg, positionManager: null })).toEqual([])
  })
  it('listResolvableInstances yields the env rig only while the registry is empty', async () => {
    const { client } = fakeSupabase()
    const list = await listResolvableInstances(client, cfg)
    expect(list).toHaveLength(1)
    expect(list[0].source).toBe('env-fallback')
  })
})

describe('resolveInstanceStrict — positionManager (V1-01 pass-2 residual fix: superseded-PM exit routing)', () => {
  const OLD_PM = REG_PM // retired — this pool's original instance
  const NEW_PM = REG_PM2 // active — the pool was re-registered with a different PM
  const db = () => fakeSupabase({ tables: { gateway_instances: [
    row(POOL_ID, OLD_PM, 'inactive'),
    row(POOL_ID, NEW_PM, 'active'),
  ] } })

  it('a bare poolId lookup resolves the CURRENT active row (unchanged default)', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID, { includeInactive: true })
    expect(r.ok && r.inst.positionManager).toBe(NEW_PM)
  })
  it('naming the OLD (retired) PM explicitly resolves IT specifically, not the active one', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID, { includeInactive: true, positionManager: OLD_PM })
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.inst.positionManager).toBe(OLD_PM); expect(r.inst.live).toBe(false) }
  })
  it('naming the NEW (active) PM explicitly still resolves it too (not just a retired-only lookup)', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID, { positionManager: NEW_PM })
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.inst.positionManager).toBe(NEW_PM); expect(r.inst.live).toBe(true) }
  })
  it('naming a PM that never fronted this pool is a 404, not a silent fallback to the active one', async () => {
    const r = await resolveInstanceStrict(db().client, cfg, POOL_ID, { includeInactive: true, positionManager: '0x' + 'ff'.repeat(20) })
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
})
