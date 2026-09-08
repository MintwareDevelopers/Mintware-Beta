import { describe, it, expect, vi, beforeEach } from 'vitest'
import { indexHarvestLogs, readSharesAtBlock, listPendingRestake, markRestaked, reconcileSeat, type LedgerClient } from './ledger'

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────
const PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const SEAT = '0x18ae000000000000000000000000000000000663' as const
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168' as const
const POOL = '0x' + 'ab'.repeat(32)
const ALICE = '0xa11ce00000000000000000000000000000000001' // withdrew 100% on-chain but keeps a stale DB row
const BOB = '0xb0b0000000000000000000000000000000000002'
const CAROL = '0xca201000000000000000000000000000000000003' // only ever seen via a Deposited log
const INST = { positionManager: PM, poolAddress: POOL, chainId: 46630 }
const TX1 = ('0x' + '11'.repeat(32)) as `0x${string}`
const TX2 = ('0x' + '22'.repeat(32)) as `0x${string}`

type Row = Record<string, unknown>
/** In-memory supabase: tables + the record_gateway_harvest RPC emulated with the SAME idempotency
 *  contract as the Postgres function (unique log key → 'duplicate', credits written once). */
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    gateway_index_cursors: [], gateway_known_depositors: [], gateway_positions: [], gateway_harvest_logs: [], gateway_fee_credits: [],
    gateway_fee_ledger_reconciliation: [], gateway_fee_balances: [], card_spend_buffers: [], ...seed,
  }
  const rpcCalls: unknown[] = []
  let rpcFailNext = false
  function from(table: string) {
    const rows = (tables[table] ??= [])
    const filters: [string, unknown][] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row | Row[] | undefined
    let conflict: string[] | null = null
    let ignoreDup = false
    const hit = () => rows.filter((r) => filters.every(([c, v]) => String(r[c]).toLowerCase() === String(v).toLowerCase()))
    const exec = async () => {
      if (op === 'select') return { data: hit(), error: null }
      if (op === 'update') { for (const r of hit()) Object.assign(r, payload as Row); return { data: null, error: null } }
      if (op === 'upsert') {
        for (const r of Array.isArray(payload) ? payload : [payload as Row]) {
          const ex = conflict ? rows.find((e) => conflict!.every((c) => String(e[c]).toLowerCase() === String(r[c]).toLowerCase())) : undefined
          if (ex) { if (!ignoreDup) Object.assign(ex, r) } else rows.push({ ...r })
        }
        return { data: null, error: null }
      }
      rows.push(...(Array.isArray(payload) ? payload : [payload as Row]))
      return { data: null, error: null }
    }
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
      insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
      update: (p: Row) => { op = 'update'; payload = p; return b },
      upsert: (p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = 'upsert'; payload = p; conflict = o?.onConflict?.split(',') ?? null; ignoreDup = !!o?.ignoreDuplicates; return b
      },
      maybeSingle: async () => { const r = await exec(); return { data: (r.data as Row[])?.[0] ?? null, error: null } },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    }
    return b
  }
  async function rpc(fn: string, args: { p_log: Row; p_credits: Row[]; p_settlement: string }) {
    rpcCalls.push({ fn, args })
    if (fn !== 'record_gateway_harvest') throw new Error(`unexpected rpc ${fn}`)
    if (rpcFailNext) { rpcFailNext = false; return { data: null, error: { message: 'boom' } } }
    const logs = tables.gateway_harvest_logs
    const key = (r: Row) => `${r.chain_id}:${String(r.tx_hash).toLowerCase()}:${r.log_index}`
    let row = logs.find((r) => key(r) === key(args.p_log))
    if (!row) { row = { id: `log-${logs.length + 1}`, ...args.p_log, settlement: 'pending', credited_atomic: '0', unallocated_atomic: '0' }; logs.push(row) }
    if (row.settlement !== 'pending' || BigInt(String(row.credited_atomic)) > 0n) return { data: 'duplicate', error: null }
    if (args.p_settlement === 'pending') return { data: 'ok', error: null }
    let sum = 0n
    for (const c of args.p_credits) {
      if (BigInt(String(c.credit_atomic)) <= 0n) continue
      tables.gateway_fee_credits.push({ ...c, tx_hash: args.p_log.tx_hash, log_index: args.p_log.log_index, position_manager: args.p_log.position_manager, chain_id: args.p_log.chain_id })
      sum += BigInt(String(c.credit_atomic))
    }
    if (sum > BigInt(String(args.p_log.net_quote_atomic))) throw new Error('credits exceed net')
    Object.assign(row, { settlement: 'credited', credited_atomic: sum.toString(), unallocated_atomic: (BigInt(String(args.p_log.net_quote_atomic)) - sum).toString() })
    return { data: 'ok', error: null }
  }
  return { client: { from, rpc } as never, tables, rpcCalls, failNextRpc: () => { rpcFailNext = true } }
}

/** A chain with share balances PER BLOCK — so a read at the wrong block is detectable. */
function mockChain(opts: {
  tip: bigint
  logs: Array<{ eventName: 'Deposited' | 'Harvested'; blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number; args: Record<string, unknown> }>
  sharesAt: (block: bigint) => Record<string, bigint>
  totalAt: (block: bigint) => bigint
  seatBalance?: bigint
  failGetLogs?: boolean
}) {
  const reads: Array<{ functionName: string; blockNumber?: bigint; args?: unknown[] }> = []
  const client: LedgerClient & { reads: typeof reads; getLogs: ReturnType<typeof vi.fn> } = {
    reads,
    getBlockNumber: async () => opts.tip,
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      if (opts.failGetLogs) throw new Error('rpc down')
      return opts.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
    }),
    readContract: async ({ functionName, args, blockNumber, address }: { functionName: string; args?: unknown[]; blockNumber?: bigint; address: string }) => {
      reads.push({ functionName, blockNumber, args })
      if (functionName === 'balanceOf') return opts.seatBalance ?? 0n
      if (address.toLowerCase() !== PM) throw new Error(`unexpected address ${address}`)
      if (functionName === 'harvestRecipient') return SEAT
      if (functionName === 'quoteAsset') return USDG
      if (blockNumber == null) throw new Error(`${functionName} read without a blockNumber pin`)
      if (functionName === 'totalShares') return opts.totalAt(blockNumber)
      if (functionName === 'sharesOf') return opts.sharesAt(blockNumber)[String(args?.[0]).toLowerCase()] ?? 0n
      throw new Error(`unexpected read ${functionName}`)
    },
  }
  return client
}

const harvested = (blockNumber: bigint, transactionHash: `0x${string}`, quoteFees: bigint, pairedFees = 0n, logIndex = 3) =>
  ({ eventName: 'Harvested' as const, blockNumber, transactionHash, logIndex, args: { quoteFees, pairedFees, recipient: SEAT } })
const deposited = (blockNumber: bigint, transactionHash: `0x${string}`, user: string, logIndex = 1) =>
  ({ eventName: 'Deposited' as const, blockNumber, transactionHash, logIndex, args: { user, quoteIn: 1n, sharesMinted: 1n } })

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('LP_GATEWAY_INDEX_') || k === 'LP_GATEWAY_PERF_FEE_BPS') delete process.env[k]
  process.env.LP_GATEWAY_PERF_FEE_BPS = '1000'
  process.env.LP_GATEWAY_INDEX_CONFIRMATIONS = '0'
  process.env.LP_GATEWAY_INDEX_START_BLOCK = '100'
})

describe('indexHarvestLogs — on-chain-share-weighted credit (A-4 / R-3 / HO-6)', () => {
  it('weights by sharesOf/totalShares AT THE HARVEST BLOCK: a fully-withdrawn wallet with a stale DB row gets NOTHING', async () => {
    const { client: db, tables } = fakeDb({
      gateway_positions: [
        { user_wallet: ALICE, pool_address: POOL, chain_id: 46630, shares: '1000000000' }, // STALE — 0 on-chain
        { user_wallet: BOB, pool_address: POOL, chain_id: 46630, shares: '1000000000' },
      ],
    })
    const chain = mockChain({
      tip: 120n,
      logs: [harvested(110n, TX1, 10_000_000n)], // 10 USDG gross
      sharesAt: (b) => (b === 110n ? { [ALICE]: 0n, [BOB]: 1_000_000_000n } : { [ALICE]: 1_000_000_000n, [BOB]: 1_000_000_000n }),
      totalAt: (b) => (b === 110n ? 1_000_000_000n : 2_000_000_000n),
    })
    const out = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(out).toMatchObject({ ok: true, harvestLogs: 1, recorded: 1, duplicates: 0, creditedAtomic: 9_000_000n, unallocatedAtomic: 0n })
    // every share read was pinned to block 110
    const shareReads = chain.reads.filter((r) => r.functionName === 'sharesOf' || r.functionName === 'totalShares')
    expect(shareReads.length).toBeGreaterThan(0)
    expect(shareReads.every((r) => r.blockNumber === 110n)).toBe(true)
    // Bob gets the whole net (10 − 10% skim = 9 USDG); Alice nothing
    const credits = tables.gateway_fee_credits
    expect(credits).toHaveLength(1)
    expect(credits[0]).toMatchObject({ user_wallet: BOB, credit_atomic: '9000000', shares_at_block: '1000000000' })
    expect(credits.find((c) => c.user_wallet === ALICE)).toBeUndefined()
    // the log row carries the on-chain total + skim + settlement
    expect(tables.gateway_harvest_logs[0]).toMatchObject({ tx_hash: TX1, log_index: 3, quote_fees_atomic: '10000000', fee_skimmed_atomic: '1000000', net_quote_atomic: '9000000', total_shares_at_block: '1000000000', settlement: 'credited', credited_atomic: '9000000' })
    // card_spend_buffers is NEVER touched
    expect(tables.card_spend_buffers).toHaveLength(0)
    // cursor advanced to the tip
    expect(tables.gateway_index_cursors[0]).toMatchObject({ chain_id: 46630, position_manager: PM, last_indexed_block: 120 })
  })

  it('is idempotent on (chain_id, tx_hash, log_index): a re-run after a cursor reset credits nothing twice', async () => {
    const { client: db, tables } = fakeDb({ gateway_positions: [{ user_wallet: BOB, pool_address: POOL, chain_id: 46630 }] })
    const chain = mockChain({ tip: 120n, logs: [harvested(110n, TX1, 10_000_000n)], sharesAt: () => ({ [BOB]: 5n }), totalAt: () => 5n })
    const first = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(first.recorded).toBe(1)
    tables.gateway_index_cursors.length = 0 // simulate a lost / reset cursor → the same range is rescanned
    const second = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(second).toMatchObject({ ok: true, harvestLogs: 1, recorded: 0, duplicates: 1, creditedAtomic: 0n })
    expect(tables.gateway_fee_credits).toHaveLength(1)
  })

  it('credits sweeps emitted by withdraw/deploy (same Harvested event, different tx) exactly like a cron harvest', async () => {
    const { client: db, tables } = fakeDb({ gateway_positions: [{ user_wallet: BOB, pool_address: POOL, chain_id: 46630 }] })
    const chain = mockChain({
      tip: 130n,
      logs: [harvested(110n, TX1, 1_000_000n, 0n, 3), harvested(125n, TX2, 2_000_000n, 7n, 9)], // TX2 = a withdraw's sweep
      sharesAt: () => ({ [BOB]: 1n }), totalAt: () => 1n,
    })
    const out = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(out).toMatchObject({ harvestLogs: 2, recorded: 2, creditedAtomic: 2_700_000n })
    expect(tables.gateway_harvest_logs.map((l) => [l.tx_hash, l.log_index, l.paired_fees_atomic])).toEqual([[TX1, 3, '0'], [TX2, 9, '7']])
  })

  it('discovers depositors from Deposited logs (never in the DB) and reads their sharesOf too', async () => {
    const { client: db, tables } = fakeDb()
    const chain = mockChain({
      tip: 120n,
      logs: [deposited(105n, TX2, CAROL), harvested(110n, TX1, 4_000_000n)],
      sharesAt: () => ({ [CAROL]: 3n, [BOB]: 1n }), totalAt: () => 4n,
    })
    const out = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(out.newDepositors).toBe(1)
    expect(tables.gateway_known_depositors[0]).toMatchObject({ user_wallet: CAROL, first_seen_block: 105 })
    // Carol (known via the log) is credited 3/4 of 3.6; Bob (unknown to us) is NOT — his slice is unallocated, never re-assigned
    expect(tables.gateway_fee_credits).toEqual([expect.objectContaining({ user_wallet: CAROL, credit_atomic: '2700000' })])
    expect(out.unallocatedAtomic).toBe(900_000n)
    expect(tables.gateway_harvest_logs[0].unallocated_atomic).toBe('900000')
  })

  it("'pending' settlement (restake) records the log with NO credits and no per-user reads; the cron compounds later", async () => {
    const { client: db, tables } = fakeDb({ gateway_positions: [{ user_wallet: BOB, pool_address: POOL, chain_id: 46630 }] })
    const chain = mockChain({ tip: 120n, logs: [harvested(110n, TX1, 10_000_000n)], sharesAt: () => ({ [BOB]: 1n }), totalAt: () => 1n })
    const out = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'pending' })
    expect(out).toMatchObject({ recorded: 1, creditedAtomic: 0n })
    expect(chain.reads.some((r) => r.functionName === 'sharesOf')).toBe(false)
    expect(tables.gateway_fee_credits).toHaveLength(0)
    expect(tables.gateway_harvest_logs[0]).toMatchObject({ settlement: 'pending', net_quote_atomic: '9000000' })
    const pending = await listPendingRestake(db, INST)
    expect(pending).toEqual({ ids: ['log-1'], netAtomic: 9_000_000n })
    await markRestaked(db, pending.ids, TX2)
    expect(tables.gateway_harvest_logs[0]).toMatchObject({ settlement: 'restake', settle_tx: TX2 })
    expect(await listPendingRestake(db, INST)).toEqual({ ids: [], netAtomic: 0n })
  })

  it('does NOT advance the cursor when the atomic write fails (re-run picks the log up again)', async () => {
    const { client: db, tables, failNextRpc } = fakeDb({ gateway_positions: [{ user_wallet: BOB, pool_address: POOL, chain_id: 46630 }] })
    const chain = mockChain({ tip: 120n, logs: [harvested(110n, TX1, 10_000_000n)], sharesAt: () => ({ [BOB]: 1n }), totalAt: () => 1n })
    failNextRpc()
    const out = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(out).toMatchObject({ ok: false, error: 'record_failed', recorded: 0 })
    expect(tables.gateway_index_cursors).toHaveLength(0)
    const again = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(again).toMatchObject({ ok: true, recorded: 1 })
  })

  it('does NOT advance the cursor on a getLogs failure', async () => {
    const { client: db, tables } = fakeDb()
    const chain = mockChain({ tip: 120n, logs: [], sharesAt: () => ({}), totalAt: () => 0n, failGetLogs: true })
    const out = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(out).toMatchObject({ ok: false, error: 'get_logs_failed' })
    expect(tables.gateway_index_cursors).toHaveLength(0)
  })

  it('resumes from the persisted cursor and honours confirmations / chunking / per-run cap', async () => {
    process.env.LP_GATEWAY_INDEX_CONFIRMATIONS = '2'
    process.env.LP_GATEWAY_INDEX_CHUNK_BLOCKS = '5'
    process.env.LP_GATEWAY_INDEX_MAX_BLOCKS = '12'
    const { client: db, tables } = fakeDb({ gateway_index_cursors: [{ chain_id: 46630, position_manager: PM, last_indexed_block: 99 }] })
    const chain = mockChain({ tip: 200n, logs: [], sharesAt: () => ({}), totalAt: () => 0n })
    const out = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(out).toMatchObject({ ok: true, fromBlock: 100n, toBlock: 111n })
    const ranges = chain.getLogs.mock.calls.map((c) => [(c[0] as { fromBlock: bigint }).fromBlock, (c[0] as { toBlock: bigint }).toBlock])
    expect(ranges).toEqual([[100n, 104n], [105n, 109n], [110n, 111n]])
    expect(tables.gateway_index_cursors[0].last_indexed_block).toBe(111)
    // next run continues from 112 and stops at the confirmed tip (198)
    const next = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(next).toMatchObject({ fromBlock: 112n, toBlock: 123n })
  })

  it('minToBlock forces the range to include a just-mined collect receipt despite confirmations', async () => {
    process.env.LP_GATEWAY_INDEX_CONFIRMATIONS = '5'
    const { client: db } = fakeDb({ gateway_positions: [{ user_wallet: BOB, pool_address: POOL, chain_id: 46630 }] })
    const chain = mockChain({ tip: 120n, logs: [harvested(120n, TX1, 1_000_000n)], sharesAt: () => ({ [BOB]: 1n }), totalAt: () => 1n })
    const without = await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(without.harvestLogs).toBe(0)
    const { client: db2 } = fakeDb({ gateway_positions: [{ user_wallet: BOB, pool_address: POOL, chain_id: 46630 }] })
    const withMin = await indexHarvestLogs({ supabase: db2, client: chain, instance: INST, settlement: 'credited', minToBlock: 120n })
    expect(withMin).toMatchObject({ harvestLogs: 1, recorded: 1, toBlock: 120n })
  })

  it('a Deposited in the same block as a Harvested joins the read-set before weighing', async () => {
    const { client: db, tables } = fakeDb()
    const chain = mockChain({
      tip: 120n,
      logs: [harvested(110n, TX1, 1_000_000n, 0n, 5), deposited(110n, TX2, CAROL, 2)], // out of order on purpose
      sharesAt: () => ({ [CAROL]: 1n }), totalAt: () => 1n,
    })
    await indexHarvestLogs({ supabase: db, client: chain, instance: INST, settlement: 'credited' })
    expect(tables.gateway_fee_credits).toEqual([expect.objectContaining({ user_wallet: CAROL, credit_atomic: '900000' })])
  })
})

describe('readSharesAtBlock', () => {
  it('pins every read to the block and batches holders', async () => {
    const chain = mockChain({ tip: 0n, logs: [], sharesAt: () => ({ [ALICE]: 1n, [BOB]: 2n, [CAROL]: 3n }), totalAt: () => 6n })
    const r = await readSharesAtBlock(chain, PM, [ALICE, BOB, CAROL], 77n, 2)
    expect(r.totalShares).toBe(6n)
    expect([...r.shares.entries()]).toEqual([[ALICE, 1n], [BOB, 2n], [CAROL, 3n]])
    expect(chain.reads.every((x) => x.blockNumber === 77n)).toBe(true)
  })
})

describe('reconcileSeat', () => {
  it('compares the live seat balance to the ledger view expectation', async () => {
    const { client: db } = fakeDb({
      gateway_fee_ledger_reconciliation: [{ chain_id: 46630, position_manager: PM, expected_seat_quote_atomic: '9000000', credited_atomic: '8000000' }],
    })
    const chain = mockChain({ tip: 0n, logs: [], sharesAt: () => ({}), totalAt: () => 0n, seatBalance: 9_500_000n })
    const r = await reconcileSeat({ supabase: db, client: chain, instance: INST })
    expect(r).toMatchObject({ recipient: SEAT, quoteAsset: USDG, seatBalanceAtomic: 9_500_000n, expectedSeatQuoteAtomic: 9_000_000n, deltaAtomic: 500_000n })
    expect(r.ledger?.credited_atomic).toBe('8000000')
  })
})
