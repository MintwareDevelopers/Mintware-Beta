// Audit evidence: these tests assert the observed bugs, not the desired fixed behavior.
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '../lib/gateway/__audit__/fakeSupabase'
import { resolveInstanceStrict, listResolvableInstances } from '../lib/gateway/routeInstance'

const mocks = vi.hoisted(() => ({
  pending: vi.fn(async () => ({ ids: ['old-sweep'], netAtomic: 100_000_000n })),
  index: vi.fn(async () => ({ ok: true, recorded: 1 })),
  write: vi.fn(),
}))
vi.mock('../lib/gateway/chain', () => ({
  gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.example' }),
  gatewayPublicClient: () => ({ chain: { id: 46630 }, simulateContract: async () => ({ result: [0n, 0n] }) }),
}))
vi.mock('../lib/web3/oracleSigner', () => ({ getOracleSigner: async () => ({ address: '0x' + 'aa'.repeat(20) }) }))
vi.mock('viem', async (original) => ({
  ...await original<typeof import('viem')>(),
  createWalletClient: () => ({ writeContract: mocks.write }),
}))
vi.mock('../lib/gateway/ledger', () => ({
  indexHarvestLogs: mocks.index, listPendingRestake: mocks.pending,
  claimRestake: vi.fn(), releaseRestake: vi.fn(), markRestaked: vi.fn(),
}))
import { harvestGateway } from '../lib/gateway/harvest'
import { readGatewayPoolState, withdrawLegsQuote } from '../lib/gateway/positionReader'

describe('V1 audit evidence (current defective behavior)', () => {
  it('withdrawal quote ignores quote parked in the PM after a deferred compound', async () => {
    const pm = ('0x' + 'aa'.repeat(20)) as `0x${string}`
    const values: Record<string, unknown> = {
      totalShares: 100_000_000n, totalNav: 100_000_000n, tokenId: 0n,
      tickLower: -100, tickUpper: 100, quoteIsCurrency0: true,
      staging: '0x' + 'bb'.repeat(20), stagedAssets: 0n,
    }
    const state = await readGatewayPoolState({
      positionManager: pm,
      client: { readContract: async ({ functionName }: { functionName: string }) => values[functionName] } as never,
    })
    // On-chain _idle() includes the PM's parked 100 USDG; the UI's idle read does not.
    expect(state.totalNav).toBe(100_000_000n)
    expect(state.idleAtomic).toBe(0n)
    expect(withdrawLegsQuote(state.totalShares, state)).toEqual({ quoteOut: 0n, pairedOut: 0n, lpQuotable: true })
  })
  // V1-01 — FIXED 2026-09-09 (lib/gateway/routeInstance.ts: `includeInactive` on resolveInstanceStrict,
  // listResolvableInstances now enumerates retired rows). This test originally proved the bug (a
  // deactivated instance 404'd for withdrawal and vanished from the portfolio); flipped to prove the
  // fix, per this project's established PoC-flips-once-fixed convention. Full regression coverage lives
  // in lib/gateway/routeInstance.test.ts.
  it('FIXED: an inactive funded instance still resolves for withdrawal (includeInactive) and stays in the portfolio', async () => {
    const pool = '0x' + '11'.repeat(32)
    const activePool = '0x' + '22'.repeat(32)
    const pm = ('0x' + 'aa'.repeat(20)) as `0x${string}`
    const db = fakeSupabase({ tables: { gateway_instances: [
      { pool_address: pool, chain_id: 46630, position_manager: pm, status: 'inactive' },
      { pool_address: activePool, chain_id: 46630, position_manager: '0x' + 'bb'.repeat(20), status: 'active' },
    ] } })
    const cfg = { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: null, staging: null, poolAddress: null }
    // Deposit-eligibility path (no includeInactive) is UNCHANGED — still a 404, deposits stay closed.
    expect(await resolveInstanceStrict(db.client, cfg, pool)).toEqual({ ok: false, status: 404, error: 'pool_not_live' })
    // Withdraw/read path now resolves it — live:false (no new deposits), ok:true (fully actionable).
    const r = await resolveInstanceStrict(db.client, cfg, pool, { includeInactive: true })
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.inst.positionManager).toBe(pm); expect(r.inst.live).toBe(false) }
    // The portfolio aggregate enumerates it too now (retired ≠ invisible).
    expect((await listResolvableInstances(db.client, cfg)).some(i => i.positionManager === pm)).toBe(true)
  })

  it('zero newly collectable fees prevent settlement of a substantial previous sweep', async () => {
    vi.stubEnv('LP_GATEWAY_HARVEST_ENABLED', 'true')
    vi.stubEnv('LP_GATEWAY_HARVEST_MIN_ATOMIC', '1000000')
    try {
      const r = await harvestGateway({
        supabase: {} as never,
        instance: { chainId: 46630, poolAddress: '0x' + '11'.repeat(32), positionManager: ('0x' + 'aa'.repeat(20)) as `0x${string}` },
      })
      expect(r).toMatchObject({ ok: false, reason: 'nothing' })
      expect(mocks.index).toHaveBeenCalled()
      expect(mocks.pending).not.toHaveBeenCalled()
      expect(mocks.write).not.toHaveBeenCalled()
    } finally { vi.unstubAllEnvs() }
  })
})
