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
  const updates: Array<{ id: string; payload: Row }> = []
  function from(table: string) {
    let op: 'select' | 'update' = 'select'
    let payload: Row | undefined
    let eqId: string | undefined
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => { if (op === 'update' && col === 'id') eqId = val as string; return b },
      order: () => b,
      limit: () => b,
      update: (p: Row) => { op = 'update'; payload = p; return b },
      then: (res: (v: unknown) => unknown) => {
        if (op === 'update') {
          updates.push({ id: eqId!, payload: payload! })
          const idx = tables[table].findIndex((r) => r.id === eqId)
          if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...payload }
          return Promise.resolve({ data: null, error: updateShouldFail ? { message: 'simulated update failure' } : null }).then(res)
        }
        return Promise.resolve({ data: tables[table], error: null }).then(res)
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

const pendingRow = (over: Partial<Row> = {}) => ({ id: 'row-1', pool_address: POOL, chain_id: 46630, swap_tx: SWAP_TX, ...over })

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

  it('RECOVERS real positive proceeds: approves, compounds, resolves with the recovery tx recorded', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, ROUTER, SEAT, 500_000n)] }
    allowanceForApprove = 0n // forces an approve
    const { client, tables } = fakeDb([pendingRow()])
    const r = await reconcilePendingSwaps({ supabase: client })
    expect(r.recovered).toBe(1)
    expect(r.results[0]).toMatchObject({ status: 'resolved', outcome: 'recovered', recoveredAtomic: '500000', recoveryTx: COMPOUND_TX })
    expect(tables.harvest_events[0]).toMatchObject({
      swap_needs_reconciliation: false, swap_reconciliation_outcome: 'recovered', swap_reconciliation_tx: COMPOUND_TX,
    })
    expect(writes.map((w) => w.functionName)).toEqual(['approve', 'compoundQuote'])
    expect(writes[1].args).toEqual([500_000n])
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

  it('logs a critical escalation (not silent) when the compound MINES but the row update itself fails — the exact double-compound risk window', async () => {
    receiptForSwapTx = { status: 'success', logs: [transferLog(QUOTE_ASSET, ROUTER, SEAT, 500_000n)] }
    allowanceForApprove = 10n ** 18n
    updateShouldFail = true
    const { client } = fakeDb([pendingRow()])
    const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
    const r = await reconcilePendingSwaps({ supabase: client, log })
    expect(r.recovered).toBe(1) // the on-chain recovery genuinely happened
    expect(log.error).toHaveBeenCalledWith('gateway.reconcile', expect.stringContaining('Manual operator intervention required'), expect.objectContaining({ compoundTx: COMPOUND_TX }))
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
})
