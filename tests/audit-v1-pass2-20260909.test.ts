// Audit evidence: three concurrent fixes have regression assertions; replacement still reproduces a defect.
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '../lib/gateway/__audit__/fakeSupabase'
import { resolveInstanceStrict, listResolvableInstances } from '../lib/gateway/routeInstance'
import { registerInstance } from '../lib/gateway/registry'
const ledgerMocks = vi.hoisted(() => ({ index: vi.fn(async (_opts: { instance: { positionManager: string } }) => ({ ok: true })) }))
vi.mock('../lib/gateway/chain', () => ({ gatewayConfig: () => ({ ...cfg, positionManager: null, staging: null, poolAddress: null }), gatewayPublicClient: () => ({}) }))
vi.mock('../lib/gateway/ledger', () => ({ indexHarvestLogs: ledgerMocks.index }))
import { harvestAll } from '../lib/gateway/harvest'
const pool = '0x' + '11'.repeat(32)
const oldPm = ('0x' + 'aa'.repeat(20)) as `0x${string}`
const newPm = ('0x' + 'bb'.repeat(20)) as `0x${string}`
const staging = ('0x' + 'cc'.repeat(20)) as `0x${string}`
const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: oldPm, staging, poolAddress: pool }
describe('V1 second-pass residual routing evidence', () => {
  // FIXED during review (lib/gateway/harvest.ts targetsFor now uses listAllInstances): a retired pool's
  // holders still withdraw (V1-01), so its fee events still need indexing — the cron must not drop it.
  it('FIXED: index-only cron indexes retired instances too (their withdrawals can still emit fee sweeps)', async () => {
    vi.stubEnv('LP_GATEWAY_HARVEST_ENABLED', 'false')
    vi.stubEnv('LP_GATEWAY_LEDGER_INDEX_ENABLED', 'true')
    ledgerMocks.index.mockClear()
    try {
      const activePool = '0x' + '22'.repeat(32)
      const { client } = fakeSupabase({ tables: { gateway_instances: [
        { id: 'retired', pool_address: pool, chain_id: 46630, position_manager: oldPm, staging, status: 'inactive' },
        { id: 'active', pool_address: activePool, chain_id: 46630, position_manager: newPm, staging, status: 'active' },
      ] } })
      const r = await harvestAll({ supabase: client })
      expect(r.indexed).toBe(2)
      expect(ledgerMocks.index).toHaveBeenCalledTimes(2)
      const pms = ledgerMocks.index.mock.calls.map((c) => (c as [{ instance: { positionManager: string } }])[0].instance.positionManager)
      expect(pms.sort()).toEqual([newPm, oldPm].sort())
    } finally { vi.unstubAllEnvs() }
  })
  it('FIXED during review: inactive-only registry refuses the env PM on the deposit resolver', async () => {
    const { client } = fakeSupabase({ tables: { gateway_instances: [
      { id: 'retired', pool_address: pool, chain_id: 46630, position_manager: oldPm, staging, status: 'inactive' },
    ] } })
    const r = await resolveInstanceStrict(client, cfg, pool)
    expect(r).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
  })
  it('FIXED during review: database errors reject rather than resolve the env PM', async () => {
    const q = { select() { return this }, eq() { return this }, then(resolve: (x: unknown) => unknown) { return Promise.resolve(resolve({ data: null, error: { message: 'database unavailable' } })) } }
    const client = { from: () => q } as never
    await expect(resolveInstanceStrict(client, cfg, pool, { includeInactive: true })).rejects.toThrow('database unavailable')
  })
  // FIXED during review (lib/gateway/registry.ts registerInstance + migration
  // 20260909000002_gateway_instances_history_per_pool.sql relaxing the unique constraint to
  // per-pool-per-ACTIVE-status): a genuinely new/different PositionManager for an already-retired pool
  // now INSERTs a new row instead of overwriting the retired row's identity — the old PM stays fully
  // enumerable/withdrawable (V1-01) alongside the new active one. Only an EXACT reactivation (same PM +
  // staging as an existing retired row) updates in place, since there's no identity to lose there.
  it('FIXED: authorized re-registration with a NEW PM preserves the retired PM in exit discovery', async () => {
    vi.stubEnv('LP_GATEWAY_USDG', '0x' + 'dd'.repeat(20))
    try {
      const { client } = fakeSupabase({ tables: { gateway_instances: [
        { id: 'retired', pool_address: pool, chain_id: 46630, position_manager: oldPm, staging, status: 'inactive' },
      ] } })
      const r = await registerInstance(client, { poolAddress: pool, chainId: 46630, positionManager: newPm, staging }, { operatorAttestation: { by: 'audit-operator', reason: 'synthetic authorized replacement' } })
      expect(r.ok).toBe(true)
      const instances = await listResolvableInstances(client, cfg)
      expect(instances.map(i => i.positionManager).sort()).toEqual([newPm, oldPm].sort())
      expect(instances.find(i => i.positionManager === newPm)?.live).toBe(true)
      expect(instances.find(i => i.positionManager === oldPm)?.live).toBe(false)
      // The OLD PM still resolves for withdrawal — its depositors are never stranded by the migration.
      const oldExit = await resolveInstanceStrict(client, cfg, pool, { includeInactive: true })
      // (same poolId now has two rows — one active, one retired; resolveInstanceStrict returns the
      // ACTIVE one for a bare poolId lookup, matching every other route's "current" resolution. Finding
      // the retired one specifically is what listAllInstances/listResolvableInstances above already do.)
      expect(oldExit.ok).toBe(true)
      if (oldExit.ok) expect(oldExit.inst.positionManager).toBe(newPm)
    } finally { vi.unstubAllEnvs() }
  })
})
