// ROUND-3 EXPLOIT REPLAY — cron abuse + ledger idempotency.
// Incident classes: unauthenticated cron/webhook endpoints (countless "GET /cron/run" incidents),
// header-trusting cron auth (`x-vercel-cron`), double-settlement on retry (the classic non-idempotent
// payout job), reorg-indexed logs (Optimism/Polygon indexer incidents).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase, type FakeDb } from '@/lib/gateway/__audit__/fakeSupabase'
import { indexHarvestLogs, listPendingRestake, claimRestake, releaseRestake, markRestaked, listStuckRestaking, LedgerWriteError, type LedgerClient } from '@/lib/gateway/ledger'

const harvestAll = vi.fn(async () => ({ harvested: 0 }))
const deployAll = vi.fn(async () => ({ deployed: 0 }))
const snapshotAll = vi.fn(async () => ({}))
const discover = vi.fn(async () => ({}))
vi.mock('@/lib/gateway/harvest', () => ({ harvestAll: () => harvestAll() }))
vi.mock('@/lib/gateway/deploy', () => ({ deployAll: () => deployAll() }))
vi.mock('@/lib/gateway/snapshot', () => ({ snapshotAll: () => snapshotAll() }))
vi.mock('@/lib/gateway/alerts', () => ({ syncRangeAlerts: async () => ({}) }))
vi.mock('@/lib/gateway/circuitBreaker', () => ({ runCircuitBreaker: async () => ({}) }))
vi.mock('@/lib/gateway/discovery', () => ({ discoverAndIngest: () => discover(), fetchHotPools: async () => [] }))
vi.mock('@/lib/web2/supabase', () => ({ getServiceClient: () => ({}) }))

describe('unauthenticated cron trigger — MITIGATED', () => {
  beforeEach(() => { vi.stubEnv('CRON_SECRET', 'test-cron-secret-not-real'); harvestAll.mockClear(); deployAll.mockClear(); snapshotAll.mockClear() })
  afterEach(() => vi.unstubAllEnvs())

  it('GET/POST without bearer → 401; a spoofed `x-vercel-cron: 1` header is NOT an auth path; the money functions never run', async () => {
    const routes = [
      ['gateway-harvest', harvestAll], ['gateway-deploy', deployAll], ['gateway-snapshot', snapshotAll],
    ] as const
    for (const [name, spy] of routes) {
      const mod = await import(`@/app/api/(rewards)/cron/${name}/route`)
      for (const method of ['GET', 'POST']) {
        const res = await (method === 'GET' ? mod.GET : mod.POST)(new NextRequest(`https://x.test/api/cron/${name}`, { method, headers: { 'x-vercel-cron': '1', 'user-agent': 'vercel-cron/1.0' } }))
        expect(res.status).toBe(401)
      }
      expect(spy).not.toHaveBeenCalled()
      // wrong secret, same length → still 401 (constant-time compare)
      const res = await mod.POST(new NextRequest(`https://x.test/api/cron/${name}`, { method: 'POST', headers: { authorization: 'Bearer test-cron-secret-not-rea1' } }))
      expect(res.status).toBe(401)
    }
    // live probe 2026-09-08: GET https://mintware.finance/api/cron/gateway-{harvest,deploy,discover,snapshot} → 401, with x-vercel-cron → 401
  })
})

// ── ledger: emulate record_gateway_harvest with the SAME semantics as the plpgsql (claim-first, FOR UPDATE, duplicate) ──
function emulateRpc(): FakeDb['rpc'] {
  return async (fn, args, db) => {
    if (fn !== 'record_gateway_harvest') return { data: null, error: { message: 'unknown fn' } }
    const log = args.p_log as Record<string, unknown>
    const credits = (args.p_credits as Array<Record<string, string>>) ?? []
    const settlement = String(args.p_settlement)
    db.tables.gateway_harvest_logs ??= []
    db.tables.gateway_fee_credits ??= []
    const key = (r: Record<string, unknown>) => `${r.chain_id}:${String(r.tx_hash).toLowerCase()}:${r.log_index}`
    let row = db.tables.gateway_harvest_logs.find((r) => key(r) === key(log))
    if (!row) { row = { id: `log-${db.tables.gateway_harvest_logs.length + 1}`, ...log, tx_hash: String(log.tx_hash).toLowerCase(), settlement: 'pending', credited_atomic: '0' }; db.tables.gateway_harvest_logs.push(row) }
    if (row.settlement !== 'pending' || BigInt(String(row.credited_atomic)) > 0n) return { data: 'duplicate', error: null }
    if (settlement === 'pending') return { data: 'ok', error: null }
    let sum = 0n
    for (const c of credits) { if (BigInt(c.credit_atomic) <= 0n) continue; db.tables.gateway_fee_credits.push({ ...c, tx_hash: row.tx_hash, log_index: row.log_index }); sum += BigInt(c.credit_atomic) }
    if (sum > BigInt(String(log.net_quote_atomic))) return { data: null, error: { message: 'credits exceed net' } }
    Object.assign(row, { settlement: 'credited', credited_atomic: sum.toString() })
    return { data: 'ok', error: null }
  }
}
const PM = ('0x' + 'aa'.repeat(20)) as `0x${string}`
const POOL = '0x' + 'ab'.repeat(32)
const ALICE = '0x' + '01'.repeat(20)
const inst = { positionManager: PM, poolAddress: POOL, chainId: 46630 }
function chain(logs: unknown[], tip = 120n): LedgerClient {
  return {
    getBlockNumber: async () => tip,
    getLogs: async () => logs,
    readContract: async (a: { functionName: string }) => (a.functionName === 'totalShares' ? 100n : 100n),
  }
}
const harvested = (tx: string, block = 110n) => ({ eventName: 'Harvested', args: { quoteFees: 10_000_000n, pairedFees: 0n, recipient: PM }, blockNumber: block, transactionHash: tx, logIndex: 3 })

describe('record_gateway_harvest idempotency under concurrency — MITIGATED (reasoned from the SQL, emulated here)', () => {
  it('two indexers racing on the same log: exactly one set of credits, the other sees duplicate', async () => {
    vi.stubEnv('LP_GATEWAY_INDEX_START_BLOCK', '100'); vi.stubEnv('LP_GATEWAY_INDEX_CONFIRMATIONS', '1'); vi.stubEnv('LP_GATEWAY_PERF_FEE_BPS', '1000')
    const { client, db } = fakeSupabase({ tables: { gateway_positions: [{ user_wallet: ALICE, pool_address: POOL, chain_id: 46630 }] }, rpc: emulateRpc() })
    const tx = '0x' + 'f1'.repeat(32)
    const [a, b] = await Promise.all([
      indexHarvestLogs({ supabase: client, client: chain([harvested(tx)]), instance: inst, settlement: 'credited' }),
      indexHarvestLogs({ supabase: client, client: chain([harvested(tx)]), instance: inst, settlement: 'credited' }),
    ])
    expect(a.recorded + b.recorded).toBe(1)
    expect(a.duplicates + b.duplicates).toBe(1)
    expect(db.tables.gateway_fee_credits.length).toBe(1)
    expect(db.tables.gateway_fee_credits[0]).toMatchObject({ user_wallet: ALICE, credit_atomic: '9000000' })
    vi.unstubAllEnvs()
    // In Postgres the second caller blocks on the unique index during the first's INSERT, then SELECT … FOR UPDATE
    // serialises it behind the commit; it sees settlement='credited' → 'duplicate'. Single transaction ⇒ no
    // half-written credits on crash.
  })
})

// FIXED (round-3 F-3): restake settlement is two-phase and count-verified — claim (pending → restaking) BEFORE the
// compound is sent, mark (restaking → restake) after it mines, release (restaking → pending) only when nothing was sent.
// Every transition is ONE statement whose affected-row count must equal the id count, and a failure THROWS
// (LedgerWriteError) so harvest.ts stops instead of reporting ok. The PoCs are kept with flipped expectations.
describe('restake settle marking — FIXED (was Low/Medium): a mined compound can no longer be compounded twice', () => {
  it('a failed UPDATE now THROWS (harvest.ts leaves the rows `restaking`, never re-compounds); the pending pool excludes claimed logs', async () => {
    const { client, db } = fakeSupabase({ tables: { gateway_harvest_logs: [{ id: 'log-1', chain_id: 46630, position_manager: PM, settlement: 'pending', net_quote_atomic: '9000000' }] } })
    expect(await listPendingRestake(client, inst)).toEqual({ ids: ['log-1'], netAtomic: 9_000_000n })

    await claimRestake(client, ['log-1'])
    expect(db.tables.gateway_harvest_logs[0].settlement).toBe('restaking')
    expect(await listPendingRestake(client, inst)).toEqual({ ids: [], netAtomic: 0n }) // a second run finds nothing to compound

    // a client whose UPDATE fails (transient PostgREST 5xx / RLS misconfig / column rename) but never throws
    const failing = {
      from: (t: string) => t === 'gateway_harvest_logs'
        ? { update: () => ({ in: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }
        : (client as unknown as { from: (t: string) => unknown }).from(t),
    } as unknown as typeof client
    await expect(markRestaked(failing, ['log-1'], '0x' + 'c0'.repeat(32))).rejects.toBeInstanceOf(LedgerWriteError)
    expect(db.tables.gateway_harvest_logs[0].settlement).toBe('restaking') // stuck, visible to the operator — NOT pending
    expect(await listStuckRestaking(client)).toMatchObject([{ id: 'log-1' }])
    expect(await listPendingRestake(client, inst)).toEqual({ ids: [], netAtomic: 0n }) // the seat never compounds 9 USDG twice
  })

  it('mark is ONE statement with a row-count check: a set that is not fully claimed is refused as a whole (no partial mark)', async () => {
    const { client, db } = fakeSupabase({ tables: { gateway_harvest_logs: [
      { id: 'a', chain_id: 46630, position_manager: PM, settlement: 'restaking', net_quote_atomic: '1' },
      { id: 'b', chain_id: 46630, position_manager: PM, settlement: 'pending', net_quote_atomic: '2' }, // never claimed
    ] } })
    await expect(markRestaked(client, ['a', 'b'], '0x' + 'c0'.repeat(32))).rejects.toThrow(/mark: expected 2 rows, updated 1/)
    // the fake applies the statement like Postgres would (only the matching row changes) — the caller sees the mismatch and stops
    expect(db.tables.gateway_harvest_logs.map((r) => r.settlement)).toEqual(['restake', 'pending'])
  })

  it('release hands a claimed set back to the pending pool only from `restaking` (a marked row is never un-marked)', async () => {
    const { client, db } = fakeSupabase({ tables: { gateway_harvest_logs: [
      { id: 'a', chain_id: 46630, position_manager: PM, settlement: 'restaking', net_quote_atomic: '5' },
    ] } })
    await releaseRestake(client, ['a'])
    expect(db.tables.gateway_harvest_logs[0].settlement).toBe('pending')
    await claimRestake(client, ['a']); await markRestaked(client, ['a'], '0x' + 'c0'.repeat(32))
    await expect(releaseRestake(client, ['a'])).rejects.toThrow(/release: expected 1 rows, updated 0/)
    expect(db.tables.gateway_harvest_logs[0].settlement).toBe('restake')
  })
})

describe('re-org handling — THEORETICAL (Low), reasoned', () => {
  it('confirmations default 1 block; a log indexed then re-orged away stays credited (buffer) or compounded (restake) — reconcileSeat is the only detector', async () => {
    vi.stubEnv('LP_GATEWAY_INDEX_START_BLOCK', '100'); vi.stubEnv('LP_GATEWAY_INDEX_CONFIRMATIONS', '1')
    const { client, db } = fakeSupabase({ tables: {}, rpc: emulateRpc() })
    const tx = '0x' + 'f2'.repeat(32)
    // first read: log present at block 119 with tip 120 (1 confirmation) → recorded
    const r1 = await indexHarvestLogs({ supabase: client, client: chain([harvested(tx, 119n)], 120n), instance: inst, settlement: 'pending' })
    expect(r1.recorded).toBe(1)
    // the chain re-orgs: block 119 no longer contains the tx. The cursor is already at 119; nothing ever revisits it.
    const r2 = await indexHarvestLogs({ supabase: client, client: chain([], 125n), instance: inst, settlement: 'pending' })
    expect(r2.fromBlock).toBe(120n)
    expect(db.tables.gateway_harvest_logs.length).toBe(1) // phantom log persists → Σ pending includes fees the seat never received
    vi.unstubAllEnvs()
  })
})
