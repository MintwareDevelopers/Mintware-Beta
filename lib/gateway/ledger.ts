// LP-gateway harvest fee ledger — event-indexed, on-chain-share-weighted, atomically written
// (audit closeout 2026-09-08: O-4 / R-3 / HO-6 / A-4).
//
// What it replaces: `harvest.ts` used to weight credits by `gateway_positions.shares` from the DB (never
// `sharesOf`), read-modify-write them into `card_spend_buffers` (which the card rail authorizes against and
// `lib/org/bufferMonitor.ts` overwrites), and only ever looked at the ONE collect tx the cron just sent —
// missing every fee sweep the contract performs inside withdraw/deploy (`_sweepFees`, same `Harvested`
// event).
//
// What this does instead:
//   1. INDEX   — `getLogs` for `Deposited` + `Harvested` on the position manager from a persisted cursor
//                (`gateway_index_cursors`) up to a confirmed tip, in bounded chunks. Every `Deposited` user
//                joins `gateway_known_depositors` (∪ DB positions) — the read-set for step 2.
//   2. WEIGH   — for each `Harvested` log, read `totalShares()` and `sharesOf(user)` for every known
//                depositor AT THE HARVEST BLOCK (`blockNumber`), skim the perf fee, split the quote leg
//                with `proRataByOnchainShares` (denominator = on-chain total; unknown holders' slice is
//                reported as unallocated, never re-assigned).
//   3. WRITE   — ONE Postgres call, `record_gateway_harvest(p_log, p_credits, p_settlement)`: inserts the
//                log row + every credit in one transaction under `FOR UPDATE`, idempotent on the UNIQUE
//                (chain_id, tx_hash, log_index). A retry / concurrent cron gets 'duplicate' and writes nothing.
//   Settlement: 'credited' (buffer destination — per-depositor IOUs) or 'pending' (restake destination —
//   the harvest cron later compounds Σ pending net on-chain and marks them 'restake').
//
// Own tables only (`gateway_harvest_logs`, `gateway_fee_credits`, `gateway_fee_payouts`, …). Nothing here
// touches `card_spend_buffers`. Amounts are atomic units of the pool's quote asset (USDG, 6dp).

import { getServiceClient } from '@/lib/web2/supabase'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { skimPerformanceFee, proRataByOnchainShares } from '@/lib/gateway/harvestMath'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
}

/** Structural chain client — a viem PublicClient satisfies it; tests pass a mock. */
export type LedgerClient = {
  getBlockNumber: () => Promise<bigint>
  getLogs: (args: any) => Promise<readonly any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
  readContract: (args: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type LedgerInstance = { positionManager: `0x${string}`; poolAddress: string; chainId: number }
export type Settlement = 'credited' | 'pending'

export type IndexOutcome = {
  ok: boolean
  error?: string
  fromBlock: bigint
  toBlock: bigint
  harvestLogs: number
  recorded: number
  duplicates: number
  newDepositors: number
  creditedAtomic: bigint
  unallocatedAtomic: bigint
}

const HARVESTED_EVENT = LP_GATEWAY_ABI.find((x) => x.type === 'event' && x.name === 'Harvested')!
const DEPOSITED_EVENT = LP_GATEWAY_ABI.find((x) => x.type === 'event' && x.name === 'Deposited')!

const envInt = (k: string, d: number, min = 0) => {
  const n = Number(process.env[k] ?? d)
  return Number.isInteger(n) && n >= min ? n : d
}
export const ledgerKnobs = () => ({
  confirmations: BigInt(envInt('LP_GATEWAY_INDEX_CONFIRMATIONS', 1)),
  chunkBlocks: BigInt(envInt('LP_GATEWAY_INDEX_CHUNK_BLOCKS', 5_000, 1)),
  maxBlocksPerRun: BigInt(envInt('LP_GATEWAY_INDEX_MAX_BLOCKS', 50_000, 1)),
  initialWindow: BigInt(envInt('LP_GATEWAY_INDEX_INITIAL_WINDOW', 10_000, 1)),
  startBlock: process.env.LP_GATEWAY_INDEX_START_BLOCK ? BigInt(process.env.LP_GATEWAY_INDEX_START_BLOCK) : null,
  perfFeeBps: (() => { const n = envInt('LP_GATEWAY_PERF_FEE_BPS', 1000); return n <= 10_000 ? n : 1000 })(),
  readBatch: envInt('LP_GATEWAY_INDEX_READ_BATCH', 40, 1),
})

type RawLog = {
  eventName?: string
  args?: Record<string, unknown>
  blockNumber: bigint | number | string
  transactionHash: `0x${string}`
  logIndex: number | bigint
  address?: string
}

const big = (v: unknown) => BigInt(String(v ?? '0'))
const lower = (s: unknown) => String(s ?? '').toLowerCase()

/** Everything the ledger will read `sharesOf` for: DB positions ∪ known-depositor table. */
async function loadKnownDepositors(supabase: SupabaseClient, inst: LedgerInstance): Promise<Set<string>> {
  const set = new Set<string>()
  const { data: known } = await supabase
    .from('gateway_known_depositors')
    .select('user_wallet')
    .eq('chain_id', inst.chainId)
    .eq('position_manager', inst.positionManager.toLowerCase())
  for (const r of (known ?? []) as Array<{ user_wallet: string }>) set.add(lower(r.user_wallet))
  const { data: pos } = await supabase
    .from('gateway_positions')
    .select('user_wallet')
    .eq('pool_address', inst.poolAddress.toLowerCase())
    .eq('chain_id', inst.chainId)
  for (const r of (pos ?? []) as Array<{ user_wallet: string }>) set.add(lower(r.user_wallet))
  return set
}

async function rememberDepositors(supabase: SupabaseClient, inst: LedgerInstance, wallets: Map<string, bigint>) {
  if (wallets.size === 0) return
  const rows = [...wallets.entries()].map(([user_wallet, first_seen_block]) => ({
    chain_id: inst.chainId, position_manager: inst.positionManager.toLowerCase(), user_wallet, first_seen_block: Number(first_seen_block),
  }))
  await supabase.from('gateway_known_depositors').upsert(rows, { onConflict: 'chain_id,position_manager,user_wallet', ignoreDuplicates: true })
}

/** sharesOf(user) for every holder + totalShares(), all pinned to `blockNumber`. Batched, never a
 *  multicall (the gateway chain config has no multicall3 address). */
export async function readSharesAtBlock(
  client: LedgerClient,
  positionManager: `0x${string}`,
  holders: readonly string[],
  blockNumber: bigint,
  batch = 40,
): Promise<{ totalShares: bigint; shares: Map<string, bigint> }> {
  const totalShares = big(await client.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName: 'totalShares', blockNumber }))
  const shares = new Map<string, bigint>()
  for (let i = 0; i < holders.length; i += batch) {
    const slice = holders.slice(i, i + batch)
    const vals = await Promise.all(
      slice.map((h) => client.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName: 'sharesOf', args: [h], blockNumber })),
    )
    slice.forEach((h, j) => shares.set(h, big(vals[j])))
  }
  return { totalShares, shares }
}

/** Index + credit every Harvested log for one instance from the persisted cursor to the confirmed tip. */
export async function indexHarvestLogs(opts: {
  supabase: SupabaseClient
  client: LedgerClient
  instance: LedgerInstance
  settlement: Settlement
  log?: Logger
  /** force the range to include this block (e.g. the receipt block of a collect tx we just mined) */
  minToBlock?: bigint
}): Promise<IndexOutcome> {
  const { supabase, client, instance, settlement, log } = opts
  const k = ledgerKnobs()
  const pm = instance.positionManager.toLowerCase() as `0x${string}`
  const out: IndexOutcome = { ok: true, fromBlock: 0n, toBlock: 0n, harvestLogs: 0, recorded: 0, duplicates: 0, newDepositors: 0, creditedAtomic: 0n, unallocatedAtomic: 0n }

  // 1) range
  const tip = await client.getBlockNumber()
  let safeTip = tip > k.confirmations ? tip - k.confirmations : 0n
  if (opts.minToBlock != null && opts.minToBlock > safeTip && opts.minToBlock <= tip) safeTip = opts.minToBlock
  const { data: cur } = await supabase
    .from('gateway_index_cursors')
    .select('last_indexed_block')
    .eq('chain_id', instance.chainId)
    .eq('position_manager', pm)
    .maybeSingle()
  let from: bigint
  if (cur && (cur as { last_indexed_block: unknown }).last_indexed_block != null) {
    from = big((cur as { last_indexed_block: unknown }).last_indexed_block) + 1n
  } else if (k.startBlock != null) {
    from = k.startBlock
  } else {
    from = safeTip > k.initialWindow ? safeTip - k.initialWindow : 0n
  }
  if (from > safeTip) return { ...out, fromBlock: from, toBlock: safeTip }
  const hardEnd = from + k.maxBlocksPerRun - 1n
  const end = hardEnd < safeTip ? hardEnd : safeTip
  out.fromBlock = from
  out.toBlock = end

  const known = await loadKnownDepositors(supabase, instance)

  // 2) chunked scan; the cursor only advances past a chunk once EVERY log in it is recorded
  for (let a = from; a <= end; a += k.chunkBlocks) {
    const b = a + k.chunkBlocks - 1n < end ? a + k.chunkBlocks - 1n : end
    let logs: RawLog[]
    try {
      logs = (await client.getLogs({ address: pm, events: [DEPOSITED_EVENT, HARVESTED_EVENT], fromBlock: a, toBlock: b })) as RawLog[]
    } catch (e) {
      log?.error('gateway.ledger', 'getLogs failed — cursor NOT advanced', { from: a.toString(), to: b.toString(), error: String(e) })
      return { ...out, ok: false, error: 'get_logs_failed', toBlock: a - 1n }
    }
    logs.sort((x, y) => {
      const bx = big(x.blockNumber), by = big(y.blockNumber)
      return bx === by ? Number(x.logIndex) - Number(y.logIndex) : bx < by ? -1 : 1
    })

    // 2a) new depositors first (a Deposited in the same block as a Harvested must be in the read-set)
    const fresh = new Map<string, bigint>()
    for (const l of logs) {
      if (l.eventName !== 'Deposited') continue
      const u = lower(l.args?.user)
      if (u && !known.has(u)) { known.add(u); fresh.set(u, big(l.blockNumber)) }
    }
    if (fresh.size) { await rememberDepositors(supabase, instance, fresh); out.newDepositors += fresh.size }

    // 2b) harvest logs → weigh at block → atomic write
    for (const l of logs) {
      if (l.eventName !== 'Harvested') continue
      out.harvestLogs++
      const blockNumber = big(l.blockNumber)
      const quoteFees = big(l.args?.quoteFees)
      const pairedFees = big(l.args?.pairedFees)
      const { feeAtomic, netAtomic } = skimPerformanceFee(quoteFees, k.perfFeeBps)

      let totalShares = 0n
      let shares = new Map<string, bigint>()
      let credits: { user_wallet: string; shares_at_block: string; credit_atomic: string }[] = []
      let unallocated = netAtomic
      if (settlement === 'credited' && netAtomic > 0n) {
        try {
          ;({ totalShares, shares } = await readSharesAtBlock(client, pm, [...known], blockNumber, k.readBatch))
        } catch (e) {
          log?.error('gateway.ledger', 'sharesOf@block read failed — cursor NOT advanced', { block: blockNumber.toString(), error: String(e) })
          return { ...out, ok: false, error: 'shares_read_failed', toBlock: a - 1n }
        }
        const split = proRataByOnchainShares(netAtomic, [...shares].map(([user, s]) => ({ user, shares: s })), totalShares)
        credits = split.credits.map((c) => ({ user_wallet: c.user, shares_at_block: (shares.get(c.user) ?? 0n).toString(), credit_atomic: c.creditAtomic.toString() }))
        unallocated = split.unallocatedAtomic
      } else if (netAtomic > 0n) {
        // pending (restake): still pin totalShares for the record; no per-user reads needed
        try {
          totalShares = big(await client.readContract({ address: pm, abi: LP_GATEWAY_ABI, functionName: 'totalShares', blockNumber }))
        } catch { totalShares = 0n }
      }

      const p_log = {
        chain_id: instance.chainId, tx_hash: lower(l.transactionHash), log_index: Number(l.logIndex), block_number: blockNumber.toString(),
        position_manager: pm, pool_address: instance.poolAddress.toLowerCase(),
        quote_fees_atomic: quoteFees.toString(), paired_fees_atomic: pairedFees.toString(), recipient: lower(l.args?.recipient),
        total_shares_at_block: totalShares.toString(), perf_fee_bps: k.perfFeeBps,
        fee_skimmed_atomic: feeAtomic.toString(), net_quote_atomic: netAtomic.toString(),
      }
      const { data, error } = await supabase.rpc('record_gateway_harvest', { p_log, p_credits: credits, p_settlement: settlement })
      if (error) {
        log?.error('gateway.ledger', 'record_gateway_harvest failed — cursor NOT advanced', { tx: p_log.tx_hash, error: error.message })
        return { ...out, ok: false, error: 'record_failed', toBlock: a - 1n }
      }
      if (String(data) === 'duplicate') { out.duplicates++; continue }
      out.recorded++
      if (settlement === 'credited') {
        out.creditedAtomic += credits.reduce((s, c) => s + BigInt(c.credit_atomic), 0n)
        out.unallocatedAtomic += unallocated
      }
    }

    // 2c) advance the cursor past this fully-recorded chunk
    await supabase.from('gateway_index_cursors').upsert(
      { chain_id: instance.chainId, position_manager: pm, last_indexed_block: Number(b), updated_at: new Date().toISOString() },
      { onConflict: 'chain_id,position_manager' },
    )
  }
  return out
}

/** Restake destination: the un-settled (pending) logs whose net the cron should compound on-chain. */
export async function listPendingRestake(supabase: SupabaseClient, inst: LedgerInstance): Promise<{ ids: string[]; netAtomic: bigint }> {
  const { data } = await supabase
    .from('gateway_harvest_logs')
    .select('id, net_quote_atomic')
    .eq('chain_id', inst.chainId)
    .eq('position_manager', inst.positionManager.toLowerCase())
    .eq('settlement', 'pending')
  const rows = (data ?? []) as Array<{ id: string; net_quote_atomic: unknown }>
  return { ids: rows.map((r) => String(r.id)), netAtomic: rows.reduce((s, r) => s + big(r.net_quote_atomic), 0n) }
}

/** Mark pending logs as compounded on-chain (guarded: only rows still pending flip). */
export async function markRestaked(supabase: SupabaseClient, ids: string[], settleTx: string): Promise<void> {
  if (ids.length === 0) return
  for (const id of ids) {
    await supabase
      .from('gateway_harvest_logs')
      .update({ settlement: 'restake', settle_tx: settleTx.toLowerCase(), settled_at: new Date().toISOString() })
      .eq('id', id)
      .eq('settlement', 'pending')
  }
}

export type SeatReconciliation = {
  recipient: `0x${string}`
  quoteAsset: `0x${string}`
  seatBalanceAtomic: bigint
  expectedSeatQuoteAtomic: bigint
  /** seat − expected: ≥ 0 means the seat covers every IOU (+ Mintware's skim); < 0 = shortfall */
  deltaAtomic: bigint
  ledger: Record<string, string> | null
}

const ERC20_BALANCE_ABI = [
  { type: 'function', stateMutability: 'view', name: 'balanceOf', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

/** Reconciliation: live seat-wallet quote balance vs. the ledger view's expected holding
 *  (Σ owed + Σ pending + Σ unallocated + Σ skim). Read-only. */
export async function reconcileSeat(opts: { supabase: SupabaseClient; client: LedgerClient; instance: LedgerInstance }): Promise<SeatReconciliation> {
  const { supabase, client, instance } = opts
  const pm = instance.positionManager.toLowerCase() as `0x${string}`
  const recipient = lower(await client.readContract({ address: pm, abi: LP_GATEWAY_ABI, functionName: 'harvestRecipient' })) as `0x${string}`
  const quoteAsset = lower(await client.readContract({ address: pm, abi: LP_GATEWAY_ABI, functionName: 'quoteAsset' })) as `0x${string}`
  const seatBalanceAtomic = big(await client.readContract({ address: quoteAsset, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [recipient] }))
  const { data } = await supabase
    .from('gateway_fee_ledger_reconciliation')
    .select('*')
    .eq('chain_id', instance.chainId)
    .eq('position_manager', pm)
    .maybeSingle()
  const row = (data ?? null) as Record<string, unknown> | null
  const expected = big(row?.expected_seat_quote_atomic)
  return {
    recipient, quoteAsset, seatBalanceAtomic, expectedSeatQuoteAtomic: expected, deltaAtomic: seatBalanceAtomic - expected,
    ledger: row ? Object.fromEntries(Object.entries(row).map(([k2, v]) => [k2, String(v)])) : null,
  }
}

/** Per-depositor owed balances (credited − paid) for one instance — for a payout job / UI. */
export async function listFeeBalances(supabase: SupabaseClient, inst: LedgerInstance): Promise<Array<{ user: string; creditedAtomic: bigint; paidAtomic: bigint; owedAtomic: bigint }>> {
  const { data } = await supabase
    .from('gateway_fee_balances')
    .select('*')
    .eq('chain_id', inst.chainId)
    .eq('position_manager', inst.positionManager.toLowerCase())
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    user: String(r.user_wallet), creditedAtomic: big(r.credited_atomic), paidAtomic: big(r.paid_atomic), owedAtomic: big(r.owed_atomic),
  }))
}
