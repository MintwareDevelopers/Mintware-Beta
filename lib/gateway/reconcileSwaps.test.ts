// Automated fee-conversion swap reconciliation (user directive, 2026-09-10: "built it"). Mocks: chain
// client, signer, registry lookup, gas estimation; REAL measureSwapProceeds (from routerSwap.ts, not
// mocked) so these tests exercise genuine Transfer-log decoding, not a re-implemented stub. Real viem
// event-topic encoding for building test receipts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'

const PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const SEAT = ('0x' + '18'.repeat(20)) as `0x${string}`
const ROUTER = ('0x' + 'dd'.repeat(20)) as `0x${string}`
const QUOTE_ASSET = ('0x' + '5f'.repeat(20)) as `0x${string}`
const POOL = '0x' + 'ab'.repeat(32)
const SWAP_TX = ('0x' + '44'.repeat(32)) as `0x${string}`
const APPROVE_TX = ('0x' + '55'.repeat(32)) as `0x${string}`
const COMPOUND_TX = ('0x' + '66'.repeat(32)) as `0x${string}`

const TRANSFER_EVENT_ABI = [
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
] as const
function transferLog(token: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: TRANSFER_EVENT_ABI, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  }
}

let receiptForSwapTx: { status: 'success' | 'reverted'; logs: unknown[] } | null | undefined
let allowanceForApprove = 0n
const writes: Array<{ functionName: string; args?: unknown[] }> = []
const publicClient = {
  chain: { id: 46630 },
  readContract: vi.fn(async ({ functionName }: { address: string; functionName: string }) => {
    if (functionName === 'quoteAsset') return QUOTE_ASSET
    if (functionName === 'allowance') return allowanceForApprove
    throw new Error(`unexpected read ${functionName}`)
  }),
  getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => {
    if (hash !== SWAP_TX) throw new Error('no receipt for this hash')
    if (receiptForSwapTx === null) throw new Error('receipt not found (still pending)')
    return receiptForSwapTx
  }),
  estimateContractGas: vi.fn(async () => 500_000n),
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({
    status: hash === APPROVE_TX ? 'success' : compoundRevertsNext ? 'reverted' : 'success',
  })),
}
let compoundRevertsNext = false

vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => (gatewayConfigured ? { chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: null, staging: null, poolAddress: null } : null),
  gatewayPublicClient: () => publicClient,
}))
let gatewayConfigured = true

const signerMock = vi.fn(async () => ({ address: SEAT }))
vi.mock('@/lib/web3/oracleSigner', () => ({ getOracleSigner: (...a: unknown[]) => signerMock(...(a as [])) }))

const listInstancesMock = vi.fn(async (): Promise<Array<{ positionManager: `0x${string}`; poolAddress: string; chainId: number }>> => [
  { positionManager: PM, poolAddress: POOL, chainId: 46630 },
])
vi.mock('@/lib/gateway/registry', () => ({ listAllInstances: (...a: unknown[]) => listInstancesMock(...(a as [])) }))

vi.mock('viem', async (orig) => ({
  ...(await orig<typeof import('viem')>()),
  createWalletClient: () => ({
    writeContract: async (a: { functionName: string; args?: unknown[] }) => {
      writes.push({ functionName: a.functionName, args: a.args })
      return a.functionName === 'approve' ? APPROVE_TX : COMPOUND_TX
    },
  }),
}))

import { reconcilePendingSwaps } from './reconcileSwaps'

type Row = Record<string, unknown>
function fakeDb(rows: Row[]) {
  const tables: Record<string, Row[]> = { harvest_events: rows }
  const updates: Array<{ ids: string[]; payload: Row }> = []
  function from(table: string) {
    let op: 'select' | 'update' = 'select'
    let payload: Row | undefined
    // Real filter application (not a pass-through) — needed to genuinely exercise the claim guard: a
    // guarded update must only affect rows matching ALL accumulated filters, exactly like real
    // supabase-js/PostgREST semantics, so a test can prove a second claim attempt affects 0 rows.
    const filters: Array<{ col: string; kind: 'eq' | 'is'; val: unknown }> = []
    const matches = (row: Row) => filters.every((f) => {
      const v = row[f.col]
      if (f.kind === 'is') return f.val === null ? v == null : v === f.val
      return v === f.val
    })
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => { filters.push({ col, kind: 'eq', val }); return b },
      is: (col: string, val: unknown) => { filters.push({ col, kind: 'is', val }); return b },
      order: () => b,
      limit: () => b,
      update: (p: Row) => { op = 'update'; payload = p; return b },
      then: (res: (v: unknown) => unknown) => {
        if (op === 'update') {
          const matched = tables[table].filter(matches)
          // Scoped to the RESOLVE update specifically (the one setting swap_reconciliation_outcome) —
          // not the claim/release updates, so tests can simulate "the resolve write fails after a real
          // on-chain recovery" without also breaking the claim step itself.
          const isResolveUpdate = payload != null && 'swap_reconciliation_outcome' in payload
          const error = updateShouldFail && isResolveUpdate ? { message: 'simulated update failure' } : null
          // A failed write must NOT actually mutate the row — matches real Postgres/Supabase semantics
          // (an errored UPDATE never commits) and is what makes the "the resolve write fails" test
          // scenarios meaningful (the row's fields must stay exactly as the claim step left them).
          if (!error) for (const row of matched) Object.assign(row, payload)
          updates.push({ ids: matched.map((r) => r.id as string), payload: payload! })
          const data = error ? null : matched.map((r) => ({ id: r.id }))
          return Promise.resolve({ data, error }).then(res)
        }
        return Promise.resolve({ data: tables[table].filter(matches), error: null }).then(res)
      },
    }
    return b
  }
  return { client: { from } as never, tables, updates }
}
let updateShouldFail = false

beforeEach(() => {
  receiptForSwapTx = undefined
  allowanceForApprove = 0n
  compoundRevertsNext = false
  gatewayConfigured = true
  updateShouldFail = false
  writes.length = 0
  publicClient.readContract.mockClear()
  publicClient.getTransactionReceipt.mockClear()
  publicClient.estimateContractGas.mockClear()
  signerMock.mockReset(); signerMock.mockResolvedValue({ address: SEAT })
  listInstancesMock.mockReset(); listInstancesMock.mockResolvedValue([{ positionManager: PM, poolAddress: POOL, chainId: 46630 }])
  process.env.LP_GATEWAY_RECONCILE_ENABLED = 'true'
})

const pendingRow = (over: Partial<Row> = {}) => ({
  id: 'row-1', pool_address: POOL, chain_id: 46630, swap_tx: SWAP_TX,
  swap_needs_reconciliation: true, swap_reconciliation_claimed_at: null,
  ...over,
})

describe('reconcilePendingSwaps', () => {
  it('fails closed when disabled (default)', async () => {
    delete process.env.LP_GATEWAY_RECONCILE_ENABLED
    const { client } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r).toMatchObject({ ran: false, reason: 'disabled', checked: 0 })
  })

  it('no-ops when the gateway is not configured', async () => {
    gatewayConfigured = false
    const { client } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r).toMatchObject({ ran: false, reason: 'config' })
  })

  it('reports nothing_pending when there are no flagged rows', async () => {
    const { client } = fakeDb([])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r).toMatchObject({ ran: true, reason: 'nothing_pending', checked: 0 })
  })

  it('skips the ENTIRE pass when the oracle signer is unavailable — never guesses the owner address', async () => {
    signerMock.mockRejectedValueOnce(new Error('privy unavailable'))
    const { client } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r).toMatchObject({ ran: false, reason: 'signer', checked: 0 })
    expect(publicClient.getTransactionReceipt).not.toHaveBeenCalled()
  })

  it('leaves a row pending (still-pending) when the receipt is not found yet — never resolves a guess', async () => {
    receiptForSwapTx = null
    const { client, tables } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.checked).toBe(1)
    expect(r.results[0]).toMatchObject({ status: 'still-pending', reason: 'receipt_not_found' })
    expect(tables.harvest_events[0].swap_needs_reconciliation).not.toBe(false) // untouched
  })

  it('leaves a row pending when no position manager is registered for its pool', async () => {
    listInstancesMock.mockResolvedValue([])
    const { client } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.results[0]).toMatchObject({ status: 'still-pending', reason: 'no_registered_instance' })
    expect(publicClient.getTransactionReceipt).not.toHaveBeenCalled()
  })

  it('resolves REVERTED — a confirmed revert is definitive, never retried', async () => {
    receiptForSwapTx = { status: 'reverted', logs: [] }
    const { client, tables } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r).toMatchObject({ checked: 1, recovered: 0 })
    expect(r.results[0]).toMatchObject({ status: 'resolved', outcome: 'reverted' })
    expect(tables.harvest_events[0]).toMatchObject({ swap_needs_reconciliation: false, swap_reconciliation_outcome: 'reverted' })
    expect(writes).toHaveLength(0) // no recovery tx attempted
  })

  it('resolves UNMEASURABLE when confirmed successful but still no qualifying Transfer log — flagged for manual review, never retried forever', async () => {
    receiptForSwapTx = { status: 'success', logs: [] }
    const { client, tables } = fakeDb([pendingRow()])
    const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
    const r = await reconcilePendingSwaps({ supabase: client, log })
    expect(r.results[0]).toMatchObject({ status: 'resolved', outcome: 'unmeasurable' })
    expect(tables.harvest_events[0]).toMatchObject({ swap_needs_reconciliation: false, swap_reconciliation_outcome: 'unmeasurable' })
    expect(log.warn).toHaveBeenCalledWith('gateway.reconcile', expect.stringContaining('manual operator review'), expect.anything())
  })

  it('resolves ZERO when the net measured proceeds are <= 0 — a definitive, now-measured answer', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, SEAT, ROUTER, 100_000n)] } // outgoing only, net negative → clamped
    const { client, tables } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.results[0]).toMatchObject({ status: 'resolved', outcome: 'zero' })
    expect(tables.harvest_events[0]).toMatchObject({ swap_needs_reconciliation: false, swap_reconciliation_outcome: 'zero' })
    expect(writes).toHaveLength(0)
  })

  // Adversarial-review finding (2026-09-10): the first version compounded the FULL recovered amount,
  // silently skipping the platform's own performance fee a normal harvest always applies. Fixed: skims
  // the SAME perfFeeBps (default 10%, from harvest.ts, reused not duplicated) before compounding, and
  // persists both the net credited amount AND the skimmed fee back into the row.
  it('RECOVERS real positive proceeds: skims the SAME performance fee a normal harvest would, compounds the NET amount, and persists both into the row', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, ROUTER, SEAT, 500_000n)] }
    allowanceForApprove = 0n // forces an approve
    const { client, tables } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.recovered).toBe(1)
    // 500,000 gross - 10% default perf fee (50,000) = 450,000 net credited
    expect(r.results[0]).toMatchObject({ status: 'resolved', outcome: 'recovered', recoveredAtomic: '450000', recoveryTx: COMPOUND_TX })
    expect(tables.harvest_events[0]).toMatchObject({
      swap_needs_reconciliation: false, swap_reconciliation_outcome: 'recovered', swap_reconciliation_tx: COMPOUND_TX,
      amount_credited_atomic: '450000', fee_skimmed_atomic: '50000',
    })
    expect(writes.map((w) => w.functionName)).toEqual(['approve', 'compoundQuote'])
    expect(writes[1].args).toEqual([450_000n]) // compounds the NET amount, not the gross recovered amount
  })

  it('skips the approve call when existing allowance already covers the recovered amount', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, ROUTER, SEAT, 500_000n)] }
    allowanceForApprove = 10n ** 18n
    const { client } = fakeDb([pendingRow()])
    await reconcilePendingSwaps({ supabase: client })
    expect(writes.map((w) => w.functionName)).toEqual(['compoundQuote'])
  })

  it('leaves the row pending (never resolved) when the recovery compound tx reverts — safe to retry, never double-reports as recovered', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, ROUTER, SEAT, 500_000n)] }
    allowanceForApprove = 10n ** 18n
    compoundRevertsNext = true
    const { client, tables } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.recovered).toBe(0)
    expect(r.results[0]).toMatchObject({ status: 'still-pending', reason: 'compound_reverted' })
    expect(tables.harvest_events[0].swap_needs_reconciliation).not.toBe(false)
  })

  // Post-fix: this is now a BOOKKEEPING gap only, not a double-compound risk — the row stays CLAIMED
  // (claimRow's guard means a future pass can't re-select it while claimed_at is set), so the loud log
  // wording changed to reflect that it's a bookkeeping correction, not an active double-submission threat.
  it('logs a loud (not silent) error when the compound MINES but the row update itself fails — row stays claimed, no double-submission risk', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, ROUTER, SEAT, 500_000n)] }
    allowanceForApprove = 10n ** 18n
    updateShouldFail = true
    const { client, tables } = fakeDb([pendingRow()])
    const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
    const r = await reconcilePendingSwaps({ supabase: client, log })
    expect(r.recovered).toBe(1) // the on-chain recovery genuinely happened
    expect(log.error).toHaveBeenCalledWith('gateway.reconcile', expect.stringContaining('bookkeeping correction'), expect.objectContaining({ compoundTx: COMPOUND_TX }))
    // The row stays claimed (never released) — a future pass cannot re-select it and re-submit.
    expect(tables.harvest_events[0].swap_reconciliation_claimed_at).not.toBeNull()
    expect(tables.harvest_events[0].swap_needs_reconciliation).toBe(true) // the resolve write failed, so this is honestly still true
  })

  it('processes multiple pending rows independently in one pass, continuing past an error on one row', async () => {
    const POOL_2 = '0x' + 'cd'.repeat(32)
    const PM_2 = ('0x' + '77'.repeat(20)) as `0x${string}`
    listInstancesMock.mockResolvedValue([
      { positionManager: PM, poolAddress: POOL, chainId: 46630 },
      { positionManager: PM_2, poolAddress: POOL_2, chainId: 46630 },
    ])
    receiptForSwapTx = { status: 'success', logs: [] } // both rows reach the quoteAsset read; row-1 resolves 'unmeasurable' (no Transfer log)
    publicClient.readContract.mockImplementation(async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === 'quoteAsset' && address.toLowerCase() === PM_2.toLowerCase()) throw new Error('rpc error reading quoteAsset for row-2')
      if (functionName === 'quoteAsset') return QUOTE_ASSET
      if (functionName === 'allowance') return allowanceForApprove
      throw new Error(`unexpected read ${functionName}`)
    })
    const { client, tables } = fakeDb([pendingRow({ id: 'row-1' }), pendingRow({ id: 'row-2', pool_address: POOL_2 })])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.checked).toBe(2)
    expect(r.results.find((x) => x.rowId === 'row-1')).toMatchObject({ status: 'resolved', outcome: 'unmeasurable' })
    expect(r.results.find((x) => x.rowId === 'row-2')).toMatchObject({ status: 'error' })
    expect(tables.harvest_events.find((x) => x.id === 'row-1')).toMatchObject({ swap_needs_reconciliation: false })
    // row-2's failure left it untouched, safe to retry next pass
    expect(tables.harvest_events.find((x) => x.id === 'row-2')?.swap_needs_reconciliation).not.toBe(false)
  })

  it('resolves a defensive edge case — a row flagged pending with a null swap_tx (should never happen) rather than looping on it forever', async () => {
    const { client, tables } = fakeDb([pendingRow({ swap_tx: null })])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.results[0]).toMatchObject({ status: 'resolved', outcome: 'unmeasurable' })
    expect(tables.harvest_events[0].swap_needs_reconciliation).toBe(false)
    expect(publicClient.getTransactionReceipt).not.toHaveBeenCalled()
  })

  // THE validation test for the double-compound fix. An independent adversarial review (a Workflow
  // reproducing this session's Codex live-watch pattern) wrote a repro test against the PRE-fix code
  // proving two overlapping reconcile-cron calls both independently submitted compoundQuote() for the
  // same recovered amount (empirically observed: compoundQuote_call_count: 2). This is the same shape of
  // test against the FIXED code, proving claimRow's guarded update actually closes it: only ONE of two
  // truly concurrent calls against the SAME pending row may claim it; the other must see 0 rows affected
  // by its own guarded update and skip without ever calling compoundQuote.
  it('two concurrent reconcilePendingSwaps calls racing the SAME row: only ONE claims it and submits compoundQuote — never both', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, ROUTER, SEAT, 500_000n)] }
    allowanceForApprove = 10n ** 18n
    const { client, tables } = fakeDb([pendingRow()])
    const [r1, r2] = await Promise.all([
      reconcilePendingSwaps({ supabase: client }),
      reconcilePendingSwaps({ supabase: client }),
    ])
    const compoundCalls = writes.filter((w) => w.functionName === 'compoundQuote')
    expect(compoundCalls).toHaveLength(1) // the empirically-critical assertion — never 2
    expect(r1.recovered + r2.recovered).toBe(1) // exactly one run recovered it, not both, not neither
    expect(tables.harvest_events[0]).toMatchObject({ swap_needs_reconciliation: false, swap_reconciliation_outcome: 'recovered' })
    // The run that lost the race must report the row as already claimed, not as its own error/failure.
    const loser = r1.recovered === 1 ? r2 : r1
    expect(loser.results.some((x) => x.status === 'still-pending' && (x as { reason?: string }).reason === 'already_claimed')).toBe(true)
  })
})
