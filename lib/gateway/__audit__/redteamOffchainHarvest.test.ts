// RED-TEAM PoC (off-chain, 2026-09-08) — A-4 / R-3 / O-4, exploited end-to-end through harvestGateway().
//
// ORIGINAL FINDING (kept as the attack steps below): fee credits were weighted by DB `gateway_positions.shares`
// (written only by the user-invoked record routes) — NOT by on-chain sharesOf. A depositor who had fully
// withdrawn on-chain kept a stale DB share row and collected other depositors' fee income into a linked
// `card_spend_buffers` row, which the card rail authorizes against (CARD_BUFFER_ENABLED → reserve_card_buffer),
// via a non-atomic read-modify-write that `lib/org/bufferMonitor.ts` could silently overwrite.
//
// STATUS AFTER CLOSE-OUT (docs/developers/audits/closeout/registry-ledger.md §2) — the suite is FLIPPED:
// every attack step is replayed unchanged and the assertions now lock the DEFENSE:
//   • credits are weighted by sharesOf/totalShares read ON-CHAIN AT THE HARVEST BLOCK (lib/gateway/ledger.ts);
//   • the stale DB row for a fully-withdrawn wallet is worth exactly 0;
//   • `card_spend_buffers` is never written by any gateway code; credits live in `gateway_fee_credits`,
//     written atomically by `record_gateway_harvest` (idempotent on chain_id/tx_hash/log_index);
//   • the DEFAULT destination is `restake` (compoundQuote lifts NAV on-chain — no IOU exists at all);
//   • `bufferMonitor.syncBufferBalance` REFUSES a gateway-funded buffer (`gateway_funded`) instead of zeroing it.
// Mocks: chain client (per-block share balances), signer, wallet client, router seam; real viem event codec.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters } from 'viem'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { fakeSupabase, type FakeDb } from './fakeSupabase'

const PM = '0x24ff5d2bb29b5448bdf96db0fcdf0553ebda3b11' as const
const SEAT = '0x18ae000000000000000000000000000000000663' as const
const POOL = '0x' + 'ab'.repeat(32)
const ALICE = '0xa11ce00000000000000000000000000000000001' // withdrew 100% on-chain, DB row stale
const BOB = '0xb0b0000000000000000000000000000000000002' // the only real remaining depositor
const COLLECT_TX = ('0x' + '11'.repeat(32)) as `0x${string}`
const APPROVE_TX = ('0x' + '22'.repeat(32)) as `0x${string}`
const COMPOUND_TX = ('0x' + '33'.repeat(32)) as `0x${string}`
const COLLECT_BLOCK = 500n
const GROSS = 10_000_000n // 10 USDG of collected fees
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

// The attack precondition, unchanged: Alice's on-chain shares are ZERO at the harvest block; Bob holds all.
const onChainSharesAt = (block: bigint): Record<string, bigint> =>
  block === COLLECT_BLOCK ? { [ALICE]: 0n, [BOB]: 1_000_000_000n } : { [ALICE]: 1_000_000_000n, [BOB]: 1_000_000_000n }
const totalSharesAt = (block: bigint) => (block === COLLECT_BLOCK ? 1_000_000_000n : 2_000_000_000n)

const harvestedLog = {
  address: PM,
  topics: encodeEventTopics({ abi: LP_GATEWAY_ABI, eventName: 'Harvested', args: { recipient: SEAT } }),
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [GROSS, 0n]),
}

const writes: Array<{ functionName: string; args?: unknown[] }> = []
const publicClient = {
  chain: { id: 46630 },
  getBlockNumber: vi.fn(async () => COLLECT_BLOCK),
  // decoded-log shape (viem getLogs with `events`): the collect we just mined is the only Harvested log
  getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
    fromBlock <= COLLECT_BLOCK && toBlock >= COLLECT_BLOCK
      ? [{ eventName: 'Harvested', blockNumber: COLLECT_BLOCK, transactionHash: COLLECT_TX, logIndex: 0, address: PM, args: { quoteFees: GROSS, pairedFees: 0n, recipient: SEAT } }]
      : []),
  readContract: vi.fn(async ({ functionName, args, blockNumber }: { functionName: string; args?: unknown[]; blockNumber?: bigint }) => {
    if (functionName === 'quoteAsset') return USDG
    if (functionName === 'totalShares') return totalSharesAt(blockNumber ?? 0n)
    if (functionName === 'sharesOf') return onChainSharesAt(blockNumber ?? 0n)[String(args?.[0]).toLowerCase()] ?? 0n
    throw new Error(`unexpected read ${functionName}`)
  }),
  simulateContract: vi.fn(async () => ({ result: [GROSS, 0n] })),
  waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({
    status: 'success',
    blockNumber: COLLECT_BLOCK,
    logs: hash === COLLECT_TX ? [harvestedLog] : [],
  })),
}

vi.mock('@/lib/gateway/chain', () => ({
  gatewayConfig: () => ({ chainId: 46630, rpcUrl: 'https://rpc.example', positionManager: null, staging: null, poolAddress: null }),
  gatewayPublicClient: () => publicClient,
}))
vi.mock('@/lib/web3/oracleSigner', () => ({ getOracleSigner: async () => ({ address: SEAT }) }))
vi.mock('@/lib/gateway/routerSwap', () => ({
  swapPairedToQuote: async () => ({ quoteOut: 0n, txHash: null }),
  swapQuoteToPaired: async () => ({ pairedOut: 0n, txHash: null }),
}))
vi.mock('viem', async (orig) => ({
  ...(await orig<typeof import('viem')>()),
  createWalletClient: () => ({
    writeContract: async (a: { functionName: string; args?: unknown[] }) => {
      writes.push({ functionName: a.functionName, args: a.args })
      return a.functionName === 'compoundQuote' ? COMPOUND_TX : a.functionName === 'approve' ? APPROVE_TX : COLLECT_TX
    },
  }),
}))

import { harvestGateway } from '../harvest'

/** `record_gateway_harvest` emulated with the SAME contract as the plpgsql function: one log row keyed by
 *  (chain_id, tx_hash, log_index) → 'duplicate' on any re-run, credits written once, Σ credits ≤ net. */
const recordGatewayHarvest: NonNullable<FakeDb['rpc']> = async (fn, args, db) => {
  if (fn !== 'record_gateway_harvest') throw new Error(`unexpected rpc ${fn}`)
  const { p_log, p_credits, p_settlement } = args as { p_log: Record<string, unknown>; p_credits: Array<Record<string, unknown>>; p_settlement: string }
  const logs = (db.tables.gateway_harvest_logs ??= [])
  const credits = (db.tables.gateway_fee_credits ??= [])
  const key = (r: Record<string, unknown>) => `${r.chain_id}:${String(r.tx_hash).toLowerCase()}:${r.log_index}`
  let row = logs.find((r) => key(r) === key(p_log))
  if (!row) { row = { id: `log-${logs.length + 1}`, ...p_log, settlement: 'pending', credited_atomic: '0' }; logs.push(row) }
  if (row.settlement !== 'pending' || BigInt(String(row.credited_atomic)) > 0n) return { data: 'duplicate', error: null }
  if (p_settlement === 'pending') return { data: 'ok', error: null }
  let sum = 0n
  for (const c of p_credits) {
    if (BigInt(String(c.credit_atomic)) <= 0n) continue
    credits.push({ ...c, tx_hash: p_log.tx_hash, log_index: p_log.log_index, chain_id: p_log.chain_id })
    sum += BigInt(String(c.credit_atomic))
  }
  if (sum > BigInt(String(p_log.net_quote_atomic))) throw new Error('credits exceed net')
  Object.assign(row, { settlement: 'credited', credited_atomic: sum.toString() })
  return { data: 'ok', error: null }
}

/** The exact pre-close-out world: stale DB shares for Alice, linked card buffers at 0. */
function attackDb() {
  return fakeSupabase({
    rpc: recordGatewayHarvest,
    uniques: { harvest_events: [['collect_tx']] },
    tables: {
      harvest_events: [],
      gateway_index_cursors: [],
      gateway_known_depositors: [],
      gateway_harvest_logs: [],
      gateway_fee_credits: [],
      gateway_positions: [
        { id: 'p-alice', user_wallet: ALICE, pool_address: POOL, chain_id: 46630, shares: '1000000000', entry_nav: '1000000000' }, // STALE: withdrew on-chain
        { id: 'p-bob', user_wallet: BOB, pool_address: POOL, chain_id: 46630, shares: '1000000000', entry_nav: '1000000000' },
      ],
      // linked buffers (the A-4 "when linked" case). card_spend_buffers.buffer_balance_atomic is what
      // lib/org/cardAuthorize.ts (CARD_BUFFER_ENABLED) authorizes card swipes against via reserve_card_buffer.
      card_spend_buffers: [
        { id: 'b-alice', gateway_position_id: 'p-alice', buffer_balance_atomic: '0' },
        { id: 'b-bob', gateway_position_id: 'p-bob', buffer_balance_atomic: '0' },
      ],
    },
  })
}

const instance = { positionManager: PM, poolAddress: POOL, chainId: 46630 }

beforeEach(() => {
  writes.length = 0
  publicClient.readContract.mockClear()
  process.env.LP_GATEWAY_HARVEST_ENABLED = 'true'
  process.env.LP_GATEWAY_PERF_FEE_BPS = '1000'
  delete process.env.LP_GATEWAY_HARVEST_DESTINATION
  for (const k of Object.keys(process.env)) if (k.startsWith('LP_GATEWAY_INDEX_')) delete process.env[k]
})

describe('A-4 _FIXED: stale DB shares are worth nothing; credits are weighed by on-chain sharesOf at the harvest block', () => {
  it('defense holds (buffer destination): a fully-withdrawn depositor (on-chain 0 shares) is credited NOTHING; the sole real LP gets the whole net; card_spend_buffers is never written', async () => {
    process.env.LP_GATEWAY_HARVEST_DESTINATION = 'buffer' // opt-in: the per-depositor IOU ledger (the surface the attack targeted)
    const { db, client } = attackDb()

    const out = await harvestGateway({ supabase: client, instance })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.grossAtomic).toBe(GROSS)
    expect(out.feeAtomic).toBe(1_000_000n)
    expect(out.destination).toBe('buffer')
    expect(out.creditedAtomic).toBe(9_000_000n)
    expect(out.recipients).toBe(1) // ONE credit row, not two

    // the attack's payout target is untouched: card_spend_buffers stays at 0 for both linked rows
    const alice = db.tables.card_spend_buffers.find((b) => b.id === 'b-alice')!
    const bob = db.tables.card_spend_buffers.find((b) => b.id === 'b-bob')!
    expect(BigInt(String(alice.buffer_balance_atomic))).toBe(0n) // was 4.5 USDG to a wallet with ZERO on-chain shares
    expect(BigInt(String(bob.buffer_balance_atomic))).toBe(0n) // no IOU is written into the card rail's table at all
    expect(db.calls.filter((c) => c.table === 'card_spend_buffers' && c.op !== 'select')).toHaveLength(0)

    // the credit lives in the ledger's own table, weighted by on-chain shares: Bob 9 USDG, Alice absent
    const credits = db.tables.gateway_fee_credits
    expect(credits).toHaveLength(1)
    expect(credits[0]).toMatchObject({ user_wallet: BOB, credit_atomic: '9000000', shares_at_block: '1000000000' })
    expect(credits.find((c) => c.user_wallet === ALICE)).toBeUndefined()
    expect(db.tables.gateway_harvest_logs[0]).toMatchObject({ tx_hash: COLLECT_TX, total_shares_at_block: '1000000000', net_quote_atomic: '9000000', settlement: 'credited' })

    // the orchestration DID read sharesOf for every known depositor — pinned to the harvest block
    const shareReads = publicClient.readContract.mock.calls
      .map((c) => c[0] as { functionName: string; args?: unknown[]; blockNumber?: bigint })
      .filter((c) => c.functionName === 'sharesOf' || c.functionName === 'totalShares')
    expect(shareReads.length).toBeGreaterThanOrEqual(3) // totalShares + sharesOf(alice) + sharesOf(bob)
    expect(shareReads.every((c) => c.blockNumber === COLLECT_BLOCK)).toBe(true)
    expect(shareReads.map((c) => String(c.args?.[0] ?? '').toLowerCase()).filter(Boolean).sort()).toEqual([ALICE, BOB].sort())
    // DB `shares` column is never a weighting input (the position rows are only an address source)
    expect(db.calls.filter((c) => c.table === 'gateway_positions').every((c) => c.op === 'select')).toBe(true)
  })

  it('defense holds (DEFAULT destination = restake): no per-user credit exists at all — Σ pending net is compounded on-chain via compoundQuote', async () => {
    const { db, client } = attackDb()
    const out = await harvestGateway({ supabase: client, instance })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.destination).toBe('restake')
    expect(out.creditedAtomic).toBe(9_000_000n) // the amount compounded, not credited to anyone off-chain
    expect(out.recipients).toBe(0)
    expect(writes.map((w) => w.functionName)).toEqual(['harvest', 'approve', 'compoundQuote'])
    expect(writes[2].args).toEqual([9_000_000n])
    expect(db.tables.gateway_fee_credits).toHaveLength(0)
    expect(db.tables.gateway_harvest_logs[0]).toMatchObject({ settlement: 'restake', settle_tx: COMPOUND_TX })
    expect(db.tables.card_spend_buffers.every((b) => String(b.buffer_balance_atomic) === '0')).toBe(true)
    // no sharesOf reads are even needed for restake — NAV lifts pro-rata for whoever holds shares on-chain
    expect(publicClient.readContract.mock.calls.some((c) => (c[0] as { functionName: string }).functionName === 'sharesOf')).toBe(false)
  })

  it('defense holds: the credit write is atomic + idempotent — a re-run over the same log (cursor reset) credits nothing twice', async () => {
    process.env.LP_GATEWAY_HARVEST_DESTINATION = 'buffer'
    const { db, client } = attackDb()
    const first = await harvestGateway({ supabase: client, instance })
    expect(first.ok).toBe(true)
    // the run-level guard: the same collect tx is refused outright
    const rerun = await harvestGateway({ supabase: client, instance })
    expect(rerun).toMatchObject({ ok: false, reason: 'duplicate' })
    // the log-level guard: even with the cursor lost, the indexer's atomic RPC returns 'duplicate'
    db.tables.gateway_index_cursors.length = 0
    db.tables.harvest_events.length = 0
    const again = await harvestGateway({ supabase: client, instance })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.index).toMatchObject({ harvestLogs: 1, recorded: 0, duplicates: 1, creditedAtomic: 0n })
    expect(db.tables.gateway_fee_credits).toHaveLength(1) // still exactly one 9 USDG credit for Bob
  })
})

describe('A-4 _FIXED: the "concurrent overwrite loses the credit" class is closed at both ends', () => {
  it('defense holds: harvest never read-modify-writes card_spend_buffers, and bufferMonitor REFUSES to sync a gateway-funded buffer', async () => {
    // Before: lib/org/bufferMonitor.ts#syncBufferBalance overwrote buffer_balance_atomic with usdc.balanceOf(bufferAddr),
    // erasing the harvest IOU (fees sit in the SEAT wallet, not in the member's buffer wallet).
    process.env.LP_GATEWAY_HARVEST_DESTINATION = 'buffer'
    const { db, client } = attackDb()
    await harvestGateway({ supabase: client, instance })
    // 1) nothing in the card rail's table changed — there is no RMW to race
    expect(db.calls.filter((c) => c.table === 'card_spend_buffers' && (c.op === 'update' || c.op === 'upsert'))).toHaveLength(0)
    // 2) the recorded harvest event proves the 9 USDG net landed at the seat (recipient), backing the ledger claim
    expect(String(db.tables.harvest_events[0].amount_credited_atomic)).toBe('9000000')
    expect(db.tables.gateway_harvest_logs[0]).toMatchObject({ recipient: SEAT })

    // 3) a chain-truth sync of a gateway-funded buffer is refused before any RPC — it can never zero the IOU
    const { syncBufferBalance } = await import('@/lib/org/bufferMonitor')
    const { client: orgDb } = fakeSupabase({
      tables: {
        orgs: [{ id: 'org-1', treasury_vault_address: '0x' + '44'.repeat(20), treasury_chain_id: 84532 }],
        card_spend_buffers: [{ id: 'b-bob', org_card_id: 'card-bob', member_wallet: BOB, gateway_position_id: 'p-bob', buffer_balance_atomic: '9000000' }],
      },
    })
    const sync = await syncBufferBalance({ supabase: orgDb, orgId: 'org-1', orgCardId: 'card-bob' })
    expect(sync).toEqual({ ok: false, reason: 'gateway_funded' })
  })
})
