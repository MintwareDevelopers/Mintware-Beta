// harvestGateway orchestration (audit closeout O-4 / A-4). Mocks: chain client, signer, wallet client,
// router seam, and the ledger indexer; real viem event codec. Locks: restake is the DEFAULT, the buffer
// path never touches card_spend_buffers and credits come from the ledger, index failure = nothing settled.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'

const PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const SEAT = '0x18ae000000000000000000000000000000000663' as const
const POOL = '0x' + 'ab'.repeat(32)
const COLLECT_TX = ('0x' + '11'.repeat(32)) as `0x${string}`
const COMPOUND_TX = ('0x' + '33'.repeat(32)) as `0x${string}`
const SWAP_TX = ('0x' + '44'.repeat(32)) as `0x${string}`
const GROSS = 10_000_000n
let compoundDeferredNextCompound = false
// Round-4 durability tests (Codex live-watch, 2026-09-10) need a Harvested event that reports a nonzero
// PAIRED leg, so swapPairedToQuote actually gets called — every other existing test fixture reports 0
// paired fees, so the swap step (and therefore its swap_tx) never enters the picture for them.
let pairedFeesNextHarvest = 0n
let compoundRevertsNextCompound = false
let collectReceiptThrowsNext = false

const writes: Array<{ functionName: string; args?: unknown[]; gas?: bigint }> = []
const publicClient = {
  chain: { id: 46630 },
  readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === 'quoteAsset') return '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
    throw new Error(`unexpected read ${functionName}`)
  }),
  simulateContract: vi.fn(async () => ({ result: [GROSS, 0n] })),
  estimateContractGas: vi.fn(async () => 500_000n),
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => {
    if (collectReceiptThrowsNext && hash === COLLECT_TX) throw new Error('ECONNRESET while polling for collect receipt')
    return {
    status: compoundRevertsNextCompound && hash === COMPOUND_TX ? 'reverted' : 'success',
    blockNumber: 500n,
    logs: hash === COLLECT_TX ? [{
      address: PM,
      topics: encodeEventTopics({ abi: LP_GATEWAY_ABI, eventName: 'Harvested', args: { recipient: SEAT } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [GROSS, pairedFeesNextHarvest]),
    }] : hash === COMPOUND_TX && compoundDeferredNextCompound ? [{
      address: PM,
      topics: encodeEventTopics({ abi: LP_GATEWAY_ABI, eventName: 'CompoundDeferred' }),
      data: encodeAbiParameters([{ type: 'uint256' }], [10_800_000n]),
    }] : [],
    }
  }),
}

vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: null, staging: null, poolAddress: null }),
  gatewayPublicClient: () => publicClient,
}))
vi.mock('@/lib/web3/oracleSigner', () => ({ getOracleSigner: async () => ({ address: SEAT }) }))
const swapMock = vi.fn(async () => ({ quoteOut: 0n, txHash: null as string | null, needsReconciliation: false }))
vi.mock('@/lib/gateway/routerSwap', () => ({
  swapPairedToQuote: (...a: unknown[]) => swapMock(...(a as [])),
}))
vi.mock('viem', async (orig) => ({
  ...(await orig<typeof import('viem')>()),
  createWalletClient: () => ({
    writeContract: async (a: { functionName: string; args?: unknown[]; gas?: bigint }) => {
      writes.push({ functionName: a.functionName, args: a.args, gas: a.gas })
      return a.functionName === 'compoundQuote' ? COMPOUND_TX : a.functionName === 'approve' ? ('0x' + '22'.repeat(32)) : COLLECT_TX
    },
  }),
}))
const indexMock = vi.fn()
const pendingMock = vi.fn()
const markMock = vi.fn()
const claimMock = vi.fn(async () => undefined)
const releaseMock = vi.fn(async () => undefined)
vi.mock('@/lib/gateway/ledger', () => ({
  indexHarvestLogs: (a: unknown) => indexMock(a),
  listPendingRestake: (...a: unknown[]) => pendingMock(...a),
  claimRestake: (...a: unknown[]) => claimMock(...(a as [])),
  releaseRestake: (...a: unknown[]) => releaseMock(...(a as [])),
  markRestaked: (...a: unknown[]) => markMock(...a),
}))

import { harvestGateway, harvestAll, resolveHarvestDestination } from './harvest'

type Row = Record<string, unknown>
function fakeDb(opts: { failInsertOn?: string } = {}) {
  const tables: Record<string, Row[]> = { harvest_events: [], card_spend_buffers: [{ id: 'buf', buffer_balance_atomic: '0' }], gateway_positions: [], gateway_instances: [] }
  const touched = new Set<string>()
  function from(table: string) {
    const rows = (tables[table] ??= [])
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row | undefined
    let returning = false
    let inIds: unknown[] | null = null
    const b = {
      select: () => { if (op !== 'select') returning = true; return b },
      eq: () => b,
      // round-3 F-3: the two-phase restake does `.update().in('id', ids).eq('settlement', …).select('id')` and
      // verifies the returned row count == ids.length — echo one row per id so the transition "succeeds".
      in: (_c: string, vs: unknown[]) => { inIds = vs; return b },
      insert: (p: Row) => { op = 'insert'; payload = p; touched.add(`${table}:insert`); return b },
      update: (p: Row) => { op = 'update'; payload = p; touched.add(`${table}:update`); return b },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        // Round-4 durability test support (Codex live-watch, 2026-09-10): simulate a genuinely FAILED
        // insert on the requested table, instead of always succeeding — proves the caller's own insert
        // result is actually checked, not just that a happy-path insert lands.
        if (op === 'insert' && opts.failInsertOn === table) {
          return Promise.resolve({ data: null, error: { message: 'simulated insert failure' } }).then(res)
        }
        if (op === 'insert') rows.push(payload!)
        const data = op === 'select' ? rows : op === 'update' && returning ? (inIds ?? []).map((id) => ({ id })) : null
        return Promise.resolve({ data, error: null }).then(res)
      },
    }
    return b
  }
  return { client: { from } as never, tables, touched }
}

const okIndex = (over: Partial<Record<string, unknown>> = {}) => ({ ok: true, fromBlock: 1n, toBlock: 500n, harvestLogs: 1, recorded: 1, duplicates: 0, newDepositors: 0, creditedAtomic: 9_000_000n, unallocatedAtomic: 0n, ...over })

beforeEach(() => {
  writes.length = 0
  compoundDeferredNextCompound = false
  compoundRevertsNextCompound = false
  collectReceiptThrowsNext = false
  pairedFeesNextHarvest = 0n
  indexMock.mockReset(); pendingMock.mockReset(); markMock.mockReset(); claimMock.mockClear(); releaseMock.mockClear()
  swapMock.mockReset(); swapMock.mockResolvedValue({ quoteOut: 0n, txHash: null, needsReconciliation: false })
  process.env.LP_GATEWAY_HARVEST_ENABLED = 'true'
  process.env.LP_GATEWAY_PERF_FEE_BPS = '1000'
  delete process.env.LP_GATEWAY_HARVEST_DESTINATION
  delete process.env.LP_GATEWAY_LEDGER_INDEX_ENABLED
})

describe('resolveHarvestDestination', () => {
  it("Earn-vs-LP decision (2026-09-08): ALWAYS 'restake' now -- the A-4 buffer ledger is dropped, so even an explicit 'buffer' no longer opts into it", () => {
    expect(resolveHarvestDestination({})).toBe('restake')
    expect(resolveHarvestDestination({ LP_GATEWAY_HARVEST_DESTINATION: 'nonsense' })).toBe('restake')
    expect(resolveHarvestDestination({ LP_GATEWAY_HARVEST_DESTINATION: 'BUFFER' })).toBe('restake')
  })
})

describe('harvestGateway', () => {
  it('RESTAKE (default): collect → index as pending → compound Σ pending net on-chain → mark restaked; no DB credit, no buffer write', async () => {
    indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
    pendingMock.mockResolvedValue({ ids: ['log-1', 'log-2'], netAtomic: 9_000_000n + 1_800_000n }) // this collect + an older withdraw sweep
    const { client, tables, touched } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r).toMatchObject({ ok: true, destination: 'restake', creditedAtomic: 10_800_000n, collectTx: COLLECT_TX })
    expect(indexMock).toHaveBeenCalledWith(expect.objectContaining({ settlement: 'pending', minToBlock: 500n }))
    expect(writes.map((w) => w.functionName)).toEqual(['harvest', 'approve', 'compoundQuote'])
    expect(writes[2].args).toEqual([10_800_000n])
    // round-3 F-3: logs are CLAIMED (pending→restaking) before the compound tx is sent, MARKED after it mines
    expect(claimMock).toHaveBeenCalledWith(expect.anything(), ['log-1', 'log-2'])
    expect(markMock).toHaveBeenCalledWith(expect.anything(), ['log-1', 'log-2'], COMPOUND_TX)
    expect(releaseMock).not.toHaveBeenCalled()
    expect(touched.has('card_spend_buffers:update')).toBe(false)
    expect(tables.harvest_events[0]).toMatchObject({ collect_tx: COLLECT_TX, amount_harvested_atomic: '10000000', fee_skimmed_atomic: '1000000', amount_credited_atomic: '10800000' })
  })

  it('IA-4: compoundQuote defers re-staging (yield source at capacity) — NAV-lifting compound still records, compoundDeferred surfaced for the operator, no release/retry', async () => {
    compoundDeferredNextCompound = true
    indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
    pendingMock.mockResolvedValue({ ids: ['log-1', 'log-2'], netAtomic: 9_000_000n + 1_800_000n })
    const { client, tables } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r).toMatchObject({ ok: true, destination: 'restake', creditedAtomic: 10_800_000n, compoundDeferred: true })
    // still marks restaked (the compound MINED — NAV rose either way) and still records the harvest event
    expect(markMock).toHaveBeenCalledWith(expect.anything(), ['log-1', 'log-2'], COMPOUND_TX)
    expect(releaseMock).not.toHaveBeenCalled()
    expect(tables.harvest_events[0]).toMatchObject({ amount_credited_atomic: '10800000' })
  })

  it("Earn-vs-LP decision (2026-09-08): setting LP_GATEWAY_HARVEST_DESTINATION='buffer' no longer does anything -- the A-4 buffer path is dropped, so harvest still restakes", async () => {
    process.env.LP_GATEWAY_HARVEST_DESTINATION = 'buffer'
    indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
    pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
    const { client, tables, touched } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r).toMatchObject({ ok: true, destination: 'restake', creditedAtomic: 9_000_000n })
    expect(indexMock).toHaveBeenCalledWith(expect.objectContaining({ settlement: 'pending' }))
    expect(writes.map((w) => w.functionName)).toEqual(['harvest', 'approve', 'compoundQuote']) // still restakes, never a buffer credit
    expect(touched.has('card_spend_buffers:update')).toBe(false)
    expect(tables.harvest_events[0]).toMatchObject({ amount_credited_atomic: '9000000' })
  })

  it('index failure ⇒ nothing settled (no compound, no credit), run recorded with 0 credited, safe to retry', async () => {
    indexMock.mockResolvedValue({ ...okIndex(), ok: false, error: 'record_failed', recorded: 0, creditedAtomic: 0n })
    const { client, tables } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r).toMatchObject({ ok: false, reason: 'index', error: 'ledger_index_failed:record_failed' })
    expect(writes.map((w) => w.functionName)).toEqual(['harvest'])
    expect(pendingMock).not.toHaveBeenCalled()
    expect(tables.harvest_events[0]).toMatchObject({ amount_credited_atomic: '0' })
  })

  it('below the dust floor: no tx, but prior sweeps are still indexed', async () => {
    publicClient.simulateContract.mockResolvedValueOnce({ result: [1n, 0n] } as never)
    indexMock.mockResolvedValue(okIndex({ harvestLogs: 1, creditedAtomic: 0n }))
    // V1-02 fix: below the dust floor now also checks for an existing pending-restake backlog before
    // bailing out — genuinely nothing pending here, so it should still fall through to reason:'nothing'.
    pendingMock.mockResolvedValue({ ids: [], netAtomic: 0n })
    const { client } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r).toMatchObject({ ok: false, reason: 'nothing' })
    expect(writes).toHaveLength(0)
    expect(indexMock).toHaveBeenCalledTimes(1)
  })

  // V1-02 — FIXED 2026-09-09 (independent Codex audit). Below the dust floor used to skip settling an
  // EXISTING pending-restake backlog entirely (a prior withdraw/deploy sweep, or a previously-failed
  // compound) — it could sit unsettled indefinitely whenever new trading stayed quiet. Now the backlog
  // gets compounded on its own even when there's no fresh collect worth its own gas.
  it('FIXED: below the dust floor, an EXISTING pending backlog still gets settled (no fresh collect needed)', async () => {
    publicClient.simulateContract.mockResolvedValueOnce({ result: [1n, 0n] } as never) // below floor
    indexMock.mockResolvedValue(okIndex({ harvestLogs: 1, creditedAtomic: 0n }))
    pendingMock.mockResolvedValue({ ids: ['old-sweep'], netAtomic: 100_000_000n }) // a real 100 USDG backlog
    const { client } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.creditedAtomic).toBe(100_000_000n)
    // No 'harvest' collect call (still below floor, still saves that gas) — but the backlog DID compound.
    expect(writes.map((w) => w.functionName)).toEqual(['approve', 'compoundQuote'])
    expect(claimMock).toHaveBeenCalledWith(expect.anything(), ['old-sweep'])
    expect(markMock).toHaveBeenCalled()
  })

  it('round-4 audit fix: a deterministic NotDeployed revert on the pre-simulate short-circuits (no real tx sent), instead of falling through to a guaranteed-revert real transaction', async () => {
    publicClient.simulateContract.mockRejectedValueOnce(new Error('ContractFunctionExecutionError: execution reverted: NotDeployed()'))
    indexMock.mockResolvedValue(okIndex({ harvestLogs: 0, creditedAtomic: 0n }))
    // V1-02 fix: same "is there a backlog worth settling" check runs here too — genuinely empty.
    pendingMock.mockResolvedValue({ ids: [], netAtomic: 0n })
    const { client } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r).toMatchObject({ ok: false, reason: 'nothing', error: 'pre-harvest simulate: NotDeployed' })
    expect(writes).toHaveLength(0) // no real tx sent — the old behavior fell through and paid real gas for a guaranteed revert
    expect(indexMock).toHaveBeenCalledTimes(1) // prior sweeps are still indexed even when skipped
  })

  it('round-4 audit fix: a TRANSIENT pre-simulate failure (not a deterministic contract revert) still falls through to the real tx, unchanged from before', async () => {
    publicClient.simulateContract.mockRejectedValueOnce(new Error('HttpRequestError: timeout of 10000ms exceeded'))
    indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
    pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
    const { client } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r.ok).toBe(true)
    expect(writes.map((w) => w.functionName)).toEqual(['harvest', 'approve', 'compoundQuote'])
  })

  it('round-4 audit fix: harvest() and compoundQuote() gas is a real estimate (buffered), not the old fixed literal, when estimation succeeds', async () => {
    indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
    pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
    const { client } = fakeDb()
    await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    const harvestWrite = writes.find((w) => w.functionName === 'harvest')
    const compoundWrite = writes.find((w) => w.functionName === 'compoundQuote')
    // mock estimateContractGas returns 500_000n; buffered +75% = 875_000n — below the old fixed floors
    // (900_000n / 400_000n), so the floor still wins for harvest but the estimate wins for compound.
    expect(harvestWrite?.gas).toBe(900_000n) // floor: 875_000n < 900_000n
    expect(compoundWrite?.gas).toBe(875_000n) // estimate wins: 875_000n > 400_000n
  })

  it('round-4 audit fix: a legitimately heavier paired-token transfer now gets a real gas budget instead of silently reverting forever under the old fixed floor', async () => {
    publicClient.estimateContractGas.mockResolvedValueOnce(1_100_000n) // exceeds the old fixed 900_000n floor
    indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
    pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
    const { client } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r.ok).toBe(true) // would have needed more gas than the old 900_000n literal ever allowed
    const harvestWrite = writes.find((w) => w.functionName === 'harvest')
    expect(harvestWrite?.gas).toBeGreaterThan(900_000n)
  })

  // Round-4 durability fix (Codex live-watch, 2026-09-10 — corrected an earlier, too-optimistic claim
  // that this was already durable): a real submitted swap_tx must survive even when the LATER
  // claim/compound/mark sequence fails independently. Before this fix, none of these failure paths ever
  // called record() at all, so the swap_tx ended up nowhere in harvest_events.
  describe('durable recording of a real swap_tx even when the later restake/compound step fails (Codex live-watch, 2026-09-10)', () => {
    // Adversarial-review finding (2026-09-10): every OTHER failure path in this function was fixed to
    // preserve a real submitted tx's hash — the collect tx's OWN confirmation-throw path (the very first
    // on-chain call) was missed and still returned with no insert at all.
    it('a collect tx that was submitted but whose receipt-wait throws still durably records collect_tx (swap never attempted)', async () => {
      collectReceiptThrowsNext = true
      const { client, tables } = fakeDb()
      const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      expect(r).toMatchObject({ ok: false, error: 'harvest_failed' })
      expect(tables.harvest_events[0]).toMatchObject({ collect_tx: COLLECT_TX, swap_tx: null, swap_needs_reconciliation: false })
      expect(swapMock).not.toHaveBeenCalled() // never got far enough to attempt a swap
    })

    it('claim failure still durably records this run\'s collect_tx + swap_tx (credited: 0)', async () => {
      pairedFeesNextHarvest = 500_000n
      swapMock.mockResolvedValueOnce({ quoteOut: 300_000n, txHash: SWAP_TX, needsReconciliation: false })
      claimMock.mockRejectedValueOnce(new Error('claim rpc failed'))
      indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
      pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
      const { client, tables } = fakeDb()
      const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      expect(r).toMatchObject({ ok: false, error: 'restake_claim_failed' })
      expect(tables.harvest_events[0]).toMatchObject({ collect_tx: COLLECT_TX, swap_tx: SWAP_TX, amount_credited_atomic: '0' })
    })

    it('a reverted compound still durably records this run\'s collect_tx + swap_tx (credited: 0)', async () => {
      pairedFeesNextHarvest = 500_000n
      swapMock.mockResolvedValueOnce({ quoteOut: 300_000n, txHash: SWAP_TX, needsReconciliation: false })
      compoundRevertsNextCompound = true
      indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
      pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
      const { client, tables } = fakeDb()
      const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      expect(r).toMatchObject({ ok: false, error: 'compound_reverted' })
      expect(releaseMock).toHaveBeenCalledWith(expect.anything(), ['log-1']) // claimed shares released back to pending
      expect(tables.harvest_events[0]).toMatchObject({ collect_tx: COLLECT_TX, swap_tx: SWAP_TX, amount_credited_atomic: '0' })
    })

    it('a restake-mark failure (compound mined, but the ledger mark itself fails) still durably records collect_tx + swap_tx (credited: 0)', async () => {
      pairedFeesNextHarvest = 500_000n
      swapMock.mockResolvedValueOnce({ quoteOut: 300_000n, txHash: SWAP_TX, needsReconciliation: false })
      markMock.mockRejectedValueOnce(new Error('mark rpc failed'))
      indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
      pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
      const { client, tables } = fakeDb()
      const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      expect(r).toMatchObject({ ok: false, error: 'restake_mark_failed' })
      expect(tables.harvest_events[0]).toMatchObject({ collect_tx: COLLECT_TX, swap_tx: SWAP_TX, amount_credited_atomic: '0' })
    })

    it('a FAILED harvest_events insert is logged loudly, not silently swallowed (even on the success path)', async () => {
      indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
      pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
      const { client } = fakeDb({ failInsertOn: 'harvest_events' })
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const r = await harvestGateway({ supabase: client, log, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      // The on-chain side still fully succeeded (compound mined, NAV lifted) — only the APP-LEVEL record
      // of it failed to persist. That must be loud, not invisible.
      expect(r.ok).toBe(true)
      expect(log.error).toHaveBeenCalledWith('gateway.harvest', expect.stringContaining('NOT persisted'), expect.objectContaining({ error: 'simulated insert failure' }))
    })

    it('threads swapPairedToQuote\'s needsReconciliation signal through to the persisted row (reconciliation cron, user directive 2026-09-10: "built it")', async () => {
      pairedFeesNextHarvest = 500_000n
      swapMock.mockResolvedValueOnce({ quoteOut: 0n, txHash: SWAP_TX, needsReconciliation: true })
      indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
      pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
      const { client, tables } = fakeDb()
      const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      expect(r.ok).toBe(true)
      expect(tables.harvest_events[0]).toMatchObject({ swap_tx: SWAP_TX, swap_needs_reconciliation: true })
    })

    it('leaves swap_needs_reconciliation false when the swap was fully measured', async () => {
      pairedFeesNextHarvest = 500_000n
      swapMock.mockResolvedValueOnce({ quoteOut: 300_000n, txHash: SWAP_TX, needsReconciliation: false })
      indexMock.mockResolvedValue(okIndex({ creditedAtomic: 0n }))
      pendingMock.mockResolvedValue({ ids: ['log-1'], netAtomic: 9_000_000n })
      const { client, tables } = fakeDb()
      const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      expect(r.ok).toBe(true)
      expect(tables.harvest_events[0]).toMatchObject({ swap_tx: SWAP_TX, swap_needs_reconciliation: false })
    })

    it('a pure backlog-only settle failure (no fresh collect this run) does NOT write a useless all-null harvest_events row', async () => {
      // Below the dust floor (no fresh collect) but WITH an existing pending backlog — the earlyExit path.
      publicClient.simulateContract.mockResolvedValueOnce({ result: [1n, 0n] } as never)
      indexMock.mockResolvedValue(okIndex({ harvestLogs: 1, creditedAtomic: 0n }))
      pendingMock.mockResolvedValue({ ids: ['old-sweep'], netAtomic: 100_000_000n })
      claimMock.mockRejectedValueOnce(new Error('claim rpc failed'))
      const { client, tables } = fakeDb()
      const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
      expect(r).toMatchObject({ ok: false, error: 'restake_claim_failed' })
      // Nothing NEW happened this run (no collectTx) — recordOnFailure is a deliberate no-op here; the
      // pending amount itself stays protected by claimRestake/releaseRestake, not by a harvest_events row.
      expect(tables.harvest_events).toHaveLength(0)
    })
  })

  it('fails closed when disabled', async () => {
    delete process.env.LP_GATEWAY_HARVEST_ENABLED
    const { client } = fakeDb()
    const r = await harvestGateway({ supabase: client, instance: { positionManager: PM, poolAddress: POOL, chainId: 46630 } })
    expect(r).toMatchObject({ ok: false, reason: 'disabled', status: 503 })
    expect(indexMock).not.toHaveBeenCalled()
  })
})

describe('harvestAll — index-only mode', () => {
  it('with only LP_GATEWAY_LEDGER_INDEX_ENABLED, indexes every instance without a signer or a tx', async () => {
    delete process.env.LP_GATEWAY_HARVEST_ENABLED
    process.env.LP_GATEWAY_LEDGER_INDEX_ENABLED = 'true'
    indexMock.mockResolvedValue(okIndex())
    const { client, tables } = fakeDb()
    tables.gateway_instances.push({ id: 'i1', pool_address: POOL, chain_id: 46630, position_manager: PM, staging: '0x' + 'dd'.repeat(20), quote_asset: '0x' + '11'.repeat(20), status: 'active' })
    const r = await harvestAll({ supabase: client })
    expect(r).toMatchObject({ harvested: 0, indexed: 1 })
    expect(r.indexResults).toHaveLength(1)
    expect(writes).toHaveLength(0)
    expect(indexMock).toHaveBeenCalledWith(expect.objectContaining({ settlement: 'pending', instance: expect.objectContaining({ positionManager: PM }) }))
  })
  it('both flags off ⇒ disabled, nothing indexed', async () => {
    delete process.env.LP_GATEWAY_HARVEST_ENABLED
    const { client } = fakeDb()
    const r = await harvestAll({ supabase: client })
    expect(r.results[0]).toMatchObject({ reason: 'disabled' })
    expect(indexMock).not.toHaveBeenCalled()
  })
})
