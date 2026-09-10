// LP-gateway harvest orchestration — the yield-first income path. Collects pool fees on-chain
// (zero-liquidity-delta, principal untouched) via the position manager's owner (getOracleSigner('gateway'),
// a DEDICATED Privy seat — re-audit A-3: never the shared root the card/x402 flows use), converts the
// paired leg to the quote asset via the MW meta-router, then settles the harvested QUOTE income through
// the event-indexed ledger (lib/gateway/ledger.ts). YIELD-FIRST + no principal-spend: this only ever
// moves harvested FEE income, never LP shares.
//
// Audit closeout 2026-09-08 (O-4 / R-3 / HO-6 / A-4): the credit step no longer weights by DB shares,
// no longer read-modify-writes `card_spend_buffers`, and no longer looks only at the one collect tx it
// just sent. Pipeline per instance: collect → convert paired leg → INDEX every `Harvested` log since the
// persisted cursor (cron harvests AND withdraw/deploy sweeps) → settle:
//   * 'restake' (DEFAULT until an operator flips it) — compound Σ pending net back into the PM via
//     `compoundQuote` (lifts NAV pro-rata ON-CHAIN, no DB claim at all), mark logs 'restake';
//   * 'buffer' — per-depositor credits weighted by on-chain sharesOf/totalShares at the harvest block,
//     written atomically by `record_gateway_harvest` into `gateway_fee_credits` (an IOU against the seat
//     wallet; `gateway_fee_balances` / `gateway_fee_ledger_reconciliation` audit it).
// The card rail never reads any of these tables.
//
// DARK-LAUNCHED, fail-closed, OFF by default: no-ops unless LP_GATEWAY_HARVEST_ENABLED === 'true' and
// the gateway config + oracle signer resolve. Index-only mode (no tx, no signer) runs when
// LP_GATEWAY_LEDGER_INDEX_ENABLED === 'true' — it only reads chain + writes the ledger.

import { createWalletClient, http, decodeEventLog } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listAllInstances } from '@/lib/gateway/registry'
import { skimPerformanceFee } from '@/lib/gateway/harvestMath'
import { swapPairedToQuote } from '@/lib/gateway/routerSwap'
import { indexHarvestLogs, listPendingRestake, claimRestake, releaseRestake, markRestaked, type IndexOutcome, type LedgerClient } from '@/lib/gateway/ledger'
import { estimateGasWithFloor, isDeterministicContractRevert } from '@/lib/gateway/gasEstimate'

const ERC20_APPROVE_ABI = [
  { type: 'function', stateMutability: 'nonpayable', name: 'approve', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

export type HarvestInstance = { positionManager: `0x${string}`; poolAddress: string; chainId: number }

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
}

type Reason = 'disabled' | 'config' | 'signer' | 'tx' | 'nothing' | 'duplicate' | 'index'
export type HarvestOutcome =
  | {
      ok: true
      // V1-02 fix (independent Codex audit, 2026-09-09): optional now — a run that settles an existing
      // pending-restake backlog WITHOUT a fresh on-chain collect() (dust floor / deterministic-revert
      // short-circuit, see settlePendingBacklog below) has no collect tx of its own to report.
      collectTx?: `0x${string}`
      grossAtomic: bigint
      feeAtomic: bigint
      creditedAtomic: bigint
      recipients: number
      destination: HarvestDestination
      index: IndexOutcome | null
      // IA-4: true when the on-chain `compoundQuote` deferred re-staging (the yield source's cap was
      // full) — NAV was still lifted (the harvested quote sits in the PM's own balance, which its
      // `_idle()` counts fully), just not yet earning; purely informational, nothing to retry here.
      compoundDeferred?: boolean
    }
  | { ok: false; status: number; error: string; reason: Reason; index?: IndexOutcome | null }

export type HarvestDestination = 'buffer' | 'restake'

/** Where harvested net fees go. **Earn-vs-LP decision (docs/developers/lp-gateway-earn-vs-lp-decision.md,
 *  2026-09-08): the A-4 buffer ledger is DROPPED — LP-Gateway V1 never grows a protocol-custodied buffer, so
 *  this ALWAYS returns 'restake' now regardless of `LP_GATEWAY_HARVEST_DESTINATION`.** `'buffer'` stays in
 *  the `HarvestDestination` type only because the 4b code path below and `ledger.ts`'s credit-writing
 *  machinery are unchanged (kept as dead code rather than ripped out, to avoid touching the DB
 *  schema/migrations in the same pass) — it is simply never reachable from here any more. `compoundQuote`
 *  lifts NAV pro-rata on-chain, so fee income provably reaches depositors with no off-chain claim. */
export function resolveHarvestDestination(_env: Record<string, string | undefined> = process.env): HarvestDestination {
  return 'restake'
}

const big = (v: unknown) => BigInt(String(v ?? '0'))
const perfFeeBps = () => {
  const n = Number(process.env.LP_GATEWAY_PERF_FEE_BPS ?? '1000') // default 10%
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : 1000
}
// Dust guard (Krystal precedent — "don't burn gas harvesting dust"). Min collectable QUOTE fees, in
// atomic units, below which harvest is skipped BEFORE any tx (we pre-simulate the collect via eth_call).
// Default 1 USDG (6dp). Set 0 to disable the floor.
const harvestMinAtomic = () => big(process.env.LP_GATEWAY_HARVEST_MIN_ATOMIC ?? '1000000')

const harvestEnabled = () => process.env.LP_GATEWAY_HARVEST_ENABLED === 'true'
const indexEnabled = () => process.env.LP_GATEWAY_LEDGER_INDEX_ENABLED === 'true'

// V1 pass-2 fix (independent Codex audit, 2026-09-09): targets EVERY registered instance, active or
// retired — not just active ones. A retired instance's underlying LP position can still be generating
// fees for its existing depositors (the operator's deposit-eligibility decision is unrelated to whether
// its position should keep earning/harvesting/indexing), and the index-only mode in particular exists
// specifically to keep the fee ledger reconciled from withdraw/deploy sweeps — a retired pool's holders
// still withdraw (V1-01) and those events still need indexing. Falls back to the single env rig only
// when the registry has never held a row at all (genuine bootstrap — same rule as routeInstance.ts).
function targetsFor(all: Awaited<ReturnType<typeof listAllInstances>>, cfg: NonNullable<ReturnType<typeof gatewayConfig>>): HarvestInstance[] {
  return all.length
    ? all.map((i) => ({ positionManager: i.positionManager, poolAddress: i.poolAddress, chainId: i.chainId }))
    : cfg.positionManager && cfg.poolAddress
      ? [{ positionManager: cfg.positionManager, poolAddress: cfg.poolAddress, chainId: cfg.chainId }]
      : []
}

/** Harvest EVERY registered gateway, active or retired (+ the single-env fallback, bootstrap-only).
 *  The cron entry point. Modes: harvest (collect + index + settle) when LP_GATEWAY_HARVEST_ENABLED;
 *  index-only (no tx, no signer) when only LP_GATEWAY_LEDGER_INDEX_ENABLED; else disabled. */
export async function harvestAll(opts: { supabase: SupabaseClient; log?: Logger }): Promise<{ harvested: number; indexed: number; results: HarvestOutcome[]; indexResults: IndexOutcome[] }> {
  if (!harvestEnabled() && !indexEnabled()) {
    return { harvested: 0, indexed: 0, indexResults: [], results: [{ ok: false, status: 503, error: 'gateway harvest is not enabled', reason: 'disabled' }] }
  }
  const cfg = gatewayConfig()
  if (!cfg) return { harvested: 0, indexed: 0, indexResults: [], results: [{ ok: false, status: 503, error: 'gateway_not_configured', reason: 'config' }] }
  const targets = targetsFor(await listAllInstances(opts.supabase, cfg.chainId), cfg)
  const results: HarvestOutcome[] = []
  const indexResults: IndexOutcome[] = []
  let harvested = 0
  let indexed = 0
  for (const instance of targets) {
    if (harvestEnabled()) {
      const r = await harvestGateway({ supabase: opts.supabase, log: opts.log, instance })
      results.push(r)
      if (r.ok) harvested++
      if ('index' in r && r.index) { indexResults.push(r.index); if (r.index.ok) indexed++ }
    } else {
      // index-only: sweeps from withdraw/deploy still get credited without the cron ever sending a tx
      const idx = await indexHarvestLogs({
        supabase: opts.supabase, client: gatewayPublicClient(cfg) as unknown as LedgerClient, instance, log: opts.log,
        settlement: resolveHarvestDestination() === 'buffer' ? 'credited' : 'pending',
      })
      indexResults.push(idx)
      if (idx.ok) indexed++
    }
  }
  return { harvested, indexed, results, indexResults }
}

/** V1-02 fix (independent Codex audit, 2026-09-09). Settles an EXISTING pending-restake backlog
 *  (already-indexed `Harvested` logs — cron collects, or withdraw/deploy sweeps — that were never
 *  compounded) via the same claim → approve → compoundQuote → mark two-phase flow the normal post-collect
 *  path uses. Extracted so it can run standalone from the dust-floor / deterministic-revert
 *  short-circuits below, WITHOUT requiring a fresh on-chain collect() — the two concerns ("is a new
 *  collect() worth its own gas" and "is there a backlog worth settling") are independent, and the bug
 *  this fixes was conflating them: a below-floor fresh harvest used to skip straight past this step
 *  every time, so a real backlog (e.g. from a withdraw/deploy sweep, or a prior failed settlement) could
 *  sit unsettled indefinitely whenever ongoing trading stayed quiet. Returns `null` when there's nothing
 *  to settle (`amount <= 0`) — the caller decides what to do in that case. */
async function settlePendingBacklog(opts: {
  supabase: SupabaseClient
  log?: Logger
  instance: HarvestInstance
  publicClient: ReturnType<typeof gatewayPublicClient>
  wallet: ReturnType<typeof createWalletClient>
  account: Awaited<ReturnType<typeof getOracleSigner>>
  index: IndexOutcome | null
  swappedNet?: bigint
  collectTx?: `0x${string}`
  swapTx?: string | null
  grossAtomic?: bigint
  feeAtomic?: bigint
}): Promise<HarvestOutcome | null> {
  const { supabase, log, instance, publicClient, wallet, account, index, swappedNet = 0n, collectTx, swapTx = null, grossAtomic = 0n, feeAtomic = 0n } = opts
  const pending = await listPendingRestake(supabase, instance)
  const amount = pending.netAtomic + swappedNet
  if (amount <= 0n) return null

  // Round-4 audit fix (Codex live-watch, 2026-09-10 — corrected the prior version's overstated
  // durability claim). Two real gaps fixed here:
  //  (a) the insert's own result is now CHECKED and logged loudly on failure — it used to be silently
  //      swallowed (a failed write left NOTHING recording this run, with no trace it happened at all).
  //  (b) when this run's OWN collect/swap already happened (`collectTx` set), a `harvest_events` row for
  //      it is now written on EVERY exit path below, not just the success path. Several failure returns
  //      used to skip record() entirely, so a real, already-submitted swap's `swapTx` could end up
  //      recorded NOWHERE in this app's own tables if the LATER claim/compound/mark step then failed
  //      independently — Codex: "a real, submitted swap can end up recorded nowhere in this app's own
  //      tables." `harvest_events_collect_tx_uidx` (the existing unique index on collect_tx) is what makes
  //      this safe to attempt from more than one exit path — at most one of these paths ever runs per
  //      call, so at most one insert is attempted per collect_tx per invocation; a genuine retry produces
  //      a NEW collect_tx (harvest() is a fresh transaction each call), so this never self-blocks a
  //      legitimate future retry. A pure backlog-only settle attempt (no fresh collect this run,
  //      `collectTx` undefined — the earlyExit call site above) has nothing new of its own to lose on
  //      failure; its pending amounts stay protected by claimRestake/releaseRestake regardless, so
  //      recordOnFailure is a deliberate no-op there rather than writing a useless all-null row.
  const record = async (credited: bigint) => {
    const { error } = await supabase.from('harvest_events').insert({
      pool_address: instance.poolAddress, chain_id: instance.chainId, collect_tx: collectTx ?? null, swap_tx: swapTx,
      amount_harvested_atomic: grossAtomic.toString(), fee_skimmed_atomic: feeAtomic.toString(), amount_credited_atomic: credited.toString(),
    })
    if (error) {
      log?.error('gateway.harvest', 'harvest_events insert failed — this run\'s record (incl. swap_tx, if any) was NOT persisted; a real on-chain event may now be untracked', {
        error: error.message, collectTx: collectTx ?? null, swapTx,
      })
    }
  }
  const recordOnFailure = () => (collectTx ? record(0n) : Promise.resolve())

  // Round-3 audit F-3 — two-phase settlement so a mined compound can never be compounded twice: claim
  // (pending → restaking, count-verified) → compound → mark (restaking → restake + tx, count-verified);
  // a compound that never mined releases the claim.
  try {
    await claimRestake(supabase, pending.ids)
  } catch (e) {
    log?.error('gateway.harvest', 'restake claim failed — nothing sent', { error: String(e) })
    await recordOnFailure()
    return { ok: false, status: 500, error: 'restake_claim_failed', reason: 'tx', index }
  }
  let ch: `0x${string}` | undefined
  let mined = false
  let compoundDeferred = false
  try {
    const quoteAsset = (await publicClient.readContract({ address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'quoteAsset' })) as `0x${string}`
    const ah = await wallet.writeContract({ address: quoteAsset, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [instance.positionManager, amount], account, chain: publicClient.chain })
    await publicClient.waitForTransactionReceipt({ hash: ah })
    const compoundArgs = { address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'compoundQuote', args: [amount], account } as const
    const { gas: compoundGas } = await estimateGasWithFloor(publicClient, compoundArgs, 400_000n)
    ch = await wallet.writeContract({ ...compoundArgs, chain: publicClient.chain, gas: compoundGas })
    const rc = await publicClient.waitForTransactionReceipt({ hash: ch })
    mined = rc.status === 'success'
    if (!mined) {
      await releaseRestake(supabase, pending.ids).catch((e) => log?.error('gateway.harvest', 'restake release failed after revert', { error: String(e) }))
      await recordOnFailure()
      return { ok: false, status: 502, error: 'compound_reverted', reason: 'tx', index }
    }
    for (const lg of rc.logs ?? []) {
      if (lg.address?.toLowerCase() !== instance.positionManager.toLowerCase()) continue
      try {
        const ev = decodeEventLog({ abi: LP_GATEWAY_ABI, data: lg.data, topics: lg.topics })
        if (ev.eventName === 'CompoundDeferred') compoundDeferred = true
      } catch { /* not a gateway event */ }
    }
    if (compoundDeferred) {
      log?.warn('gateway.harvest', 'compound deferred re-staging — yield source at capacity; harvested quote parked in the PM, NAV still lifted', { pool: instance.poolAddress, amount: amount.toString() })
    }
  } catch (e) {
    log?.error('gateway.harvest', 'restake/compound failed', { error: String(e) })
    if (ch === undefined) {
      await releaseRestake(supabase, pending.ids).catch((e2) => log?.error('gateway.harvest', 'restake release failed', { error: String(e2) }))
      await recordOnFailure()
      return { ok: false, status: 502, error: 'compound_failed', reason: 'tx', index }
    }
    log?.error('gateway.harvest', 'compound sent but receipt unknown — rows left in `restaking`, operator must finalise', { settleTx: ch })
    await recordOnFailure()
    return { ok: false, status: 502, error: 'compound_receipt_unknown', reason: 'tx', index }
  }
  try {
    await markRestaked(supabase, pending.ids, ch)
  } catch (e) {
    log?.error('gateway.harvest', 'compound mined but ledger mark failed — rows left in `restaking`, operator must finalise', { error: String(e), settleTx: ch })
    await recordOnFailure()
    return { ok: false, status: 500, error: 'restake_mark_failed', reason: 'tx', index }
  }
  await record(amount)
  return { ok: true, collectTx, grossAtomic, feeAtomic, creditedAtomic: amount, recipients: 0, destination: 'restake', index, compoundDeferred }
}

export async function harvestGateway(opts: { supabase: SupabaseClient; log?: Logger; instance: HarvestInstance }): Promise<HarvestOutcome> {
  const { supabase, log, instance } = opts
  if (!harvestEnabled()) {
    return { ok: false, status: 503, error: 'gateway harvest is not enabled', reason: 'disabled' }
  }
  const cfg = gatewayConfig()
  if (!cfg) return { ok: false, status: 503, error: 'gateway_not_configured', reason: 'config' }
  const destination = resolveHarvestDestination()

  const publicClient = gatewayPublicClient(cfg)
  let account
  try {
    account = await getOracleSigner('gateway') // the position manager's owner seat — dedicated, never the shared root
  } catch (e) {
    log?.error('gateway.harvest', 'oracle signer unavailable', { error: String(e) })
    return { ok: false, status: 503, error: 'harvest_signer_unavailable', reason: 'signer' }
  }
  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(cfg.rpcUrl) })

  // 0) gas-saving dust guard: pre-simulate the collect (eth_call as the owner, no gas, no state change)
  //    to read the collectable fees, and skip the real tx when the quote leg is below the floor and there
  //    is no paired leg worth swapping. Fails OPEN (proceeds) if the simulate itself errors — it's an
  //    optimization, not a safety gate. Even when skipped, the ledger still indexes prior sweeps.
  //
  // V1-02 fix (independent Codex audit, 2026-09-09): a below-floor/deterministic-revert short-circuit
  // must ALSO settle an existing pending-restake backlog before bailing — but that settlement (its own
  // real RPC calls + a DB write) must NOT run inside this try block. It did in an earlier version of
  // this fix, and any error from IT (even one unrelated to the pre-simulate itself) was then wrongly
  // caught by the `catch` below and misread as "the pre-simulate failed, proceed to a real collect" —
  // exactly the failure mode this whole guard exists to prevent. `earlyExit` just records WHY the guard
  // wants to skip; the actual backlog settlement + return happens after the try/catch, unconditionally.
  let earlyExit: { errorMsg: string } | null = null
  try {
    const sim = await publicClient.simulateContract({
      address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'harvest',
      args: [BigInt(Math.floor(Date.now() / 1000) + 600)], account,
    })
    const [eq, ep] = ((sim as { result?: readonly [bigint, bigint] }).result ?? [0n, 0n]) as readonly [bigint, bigint]
    if (eq < harvestMinAtomic() && ep === 0n) {
      log?.info('gateway.harvest', 'below harvest floor — skipped (no gas spent)', {
        expectedQuote: eq.toString(), floor: harvestMinAtomic().toString(), pool: instance.poolAddress,
      })
      earlyExit = { errorMsg: 'below harvest floor — skipped to save gas' }
    }
  } catch (e) {
    // Round-4 audit fix (Medium): a DETERMINISTIC contract-level revert (e.g. `NotDeployed()` for a pool
    // with no position yet) means the real tx is guaranteed to revert too — short-circuit instead of
    // paying real gas for a doomed transaction on every single cron tick against that pool.
    const deterministic = isDeterministicContractRevert(e, ['NotDeployed'])
    if (deterministic) {
      log?.info('gateway.harvest', 'pre-harvest simulate hit a deterministic revert — skipped (no gas spent)', { reason: deterministic, pool: instance.poolAddress })
      earlyExit = { errorMsg: `pre-harvest simulate: ${deterministic}` }
    } else {
      log?.warn('gateway.harvest', 'pre-harvest simulate failed; proceeding', { error: String(e) })
    }
  }
  if (earlyExit) {
    const index = await indexHarvestLogs({
      supabase, client: publicClient as unknown as LedgerClient, instance, log, settlement: destination === 'buffer' ? 'credited' : 'pending',
    })
    // A below-floor/guaranteed-revert FRESH collect must not also skip settling an EXISTING pending
    // backlog (a prior withdraw/deploy sweep, or a previously-failed compound) — those are two
    // independent questions. Only actually bail with nothing done when there's truly nothing to settle.
    if (destination === 'restake') {
      const settled = await settlePendingBacklog({ supabase, log, instance, publicClient, wallet, account, index })
      if (settled) return settled
    }
    return { ok: false, status: 200, error: earlyExit.errorMsg, reason: 'nothing', index }
  }

  // 1) collect fees (zero-liquidity-delta) → harvestRecipient (the oracle seat). Idempotent-safe: a
  //    revert (no fees) just yields zero, and the collect tx keys the harvest_events unique index.
  let collectTx: `0x${string}`
  let collectBlock: bigint | undefined
  let quoteFees = 0n
  let pairedFees = 0n
  try {
    const harvestArgs = { address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'harvest', args: [BigInt(Math.floor(Date.now() / 1000) + 600)], account } as const
    // Round-4 audit fix (Medium): estimate for real instead of a fixed 900_000n literal — a paired token
    // with a legitimately heavier (but never-reverting) transfer cost used to permanently starve this
    // pool's automated harvest once its real cost exceeded the fixed budget.
    const { gas } = await estimateGasWithFloor(publicClient, harvestArgs, 900_000n)
    collectTx = await wallet.writeContract({ ...harvestArgs, chain: publicClient.chain, gas })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: collectTx })
    if (receipt.status !== 'success') return { ok: false, status: 502, error: 'harvest_reverted', reason: 'tx' }
    collectBlock = receipt.blockNumber != null ? BigInt(receipt.blockNumber) : undefined
    for (const lg of receipt.logs) {
      if (lg.address.toLowerCase() !== instance.positionManager.toLowerCase()) continue
      try {
        const ev = decodeEventLog({ abi: LP_GATEWAY_ABI, data: lg.data, topics: lg.topics })
        if (ev.eventName === 'Harvested') {
          quoteFees = ev.args.quoteFees as bigint
          pairedFees = ev.args.pairedFees as bigint
        }
      } catch { /* not a gateway event */ }
    }
  } catch (e) {
    log?.error('gateway.harvest', 'harvest tx failed', { error: String(e) })
    return { ok: false, status: 502, error: 'harvest_failed', reason: 'tx' }
  }

  // idempotency on the RUN: never record the same collect twice (the ledger has its own per-log key)
  const { data: dupe } = await supabase.from('harvest_events').select('id').eq('collect_tx', collectTx).maybeSingle()
  if (dupe) return { ok: false, status: 200, error: 'already recorded', reason: 'duplicate' }

  // 2) convert the paired leg → quote via the MW router (seam; no-op returns 0 swapped when unavailable).
  // ⚠ Known residuals, NOT fully closed (Codex live-watch, 2026-09-10 — corrected after Codex disputed an
  // earlier, too-optimistic version of this comment; see .claude/rules/lp-gateway.md's V1-07 note for the
  // full list). swapPairedToQuote preserves swapTx even when confirmation/measurement fails after a real
  // submit (routerSwap.ts) — but the `record(...)` calls below and in settlePendingBacklog that would
  // persist that hash into `harvest_events.swap_tx` (a) never check their own insert's result, and (b)
  // several failure returns in settlePendingBacklog (claim failure, compound revert, compound-receipt-
  // unknown, restake-mark failure) skip calling record() entirely — so a real, submitted swap can end up
  // recorded NOWHERE in this app's own tables, not just "pending reconciliation." Recovery today is fully
  // manual and not even reliably possible from this app's own data. No automated reconciliation job exists
  // either way. This is a genuine gap in what "finish paired-token fee conversion" asked for, not optional
  // follow-on scope — do not present the fee-conversion work as complete while this stands.
  let swapTx: string | null = null
  let swappedQuote = 0n
  if (pairedFees > 0n) {
    const swap = await swapPairedToQuote({ positionManager: instance.positionManager, account, wallet, publicClient, pairedAmount: pairedFees, log })
    swappedQuote = swap.quoteOut
    swapTx = swap.txHash
  }
  const grossAtomic = quoteFees + swappedQuote
  const { feeAtomic } = skimPerformanceFee(grossAtomic, perfFeeBps())

  // 3) INDEX — every Harvested log since the cursor (this collect + any withdraw/deploy sweeps), weighed at
  //    each harvest block and written atomically. `minToBlock` guarantees the receipt we just waited on is
  //    in range even with confirmations > 0.
  const index = await indexHarvestLogs({
    supabase, client: publicClient as unknown as LedgerClient, instance, log,
    settlement: destination === 'buffer' ? 'credited' : 'pending', minToBlock: collectBlock,
  })
  if (!index.ok) {
    log?.error('gateway.harvest', 'ledger index failed — nothing settled this run (safe to retry)', { error: index.error, pool: instance.poolAddress })
    // Round-4 audit fix (Codex live-watch, 2026-09-10): check this insert's own result — a failed write
    // here used to be silently swallowed, losing swapTx (if a swap already happened this run) with
    // nothing logged about it.
    const { error: insertError } = await supabase.from('harvest_events').insert({
      pool_address: instance.poolAddress, chain_id: instance.chainId, collect_tx: collectTx, swap_tx: swapTx,
      amount_harvested_atomic: grossAtomic.toString(), fee_skimmed_atomic: '0', amount_credited_atomic: '0',
    })
    if (insertError) {
      log?.error('gateway.harvest', 'harvest_events insert ALSO failed on the index-failure path — this run\'s record (incl. swap_tx, if any) was NOT persisted', {
        error: insertError.message, collectTx, swapTx,
      })
    }
    return { ok: false, status: 502, error: `ledger_index_failed:${index.error}`, reason: 'index', index }
  }

  // Round-4 audit fix (Codex live-watch, 2026-09-10): same insert-result check as settlePendingBacklog's
  // own record() — a failed write here used to be silently swallowed too.
  const record = async (credited: bigint) => {
    const { error } = await supabase.from('harvest_events').insert({
      pool_address: instance.poolAddress, chain_id: instance.chainId, collect_tx: collectTx, swap_tx: swapTx,
      amount_harvested_atomic: grossAtomic.toString(), fee_skimmed_atomic: feeAtomic.toString(), amount_credited_atomic: credited.toString(),
    })
    if (error) {
      log?.error('gateway.harvest', 'harvest_events insert failed — this run\'s record (incl. swap_tx, if any) was NOT persisted; a real on-chain event may now be untracked', {
        error: error.message, collectTx, swapTx,
      })
    }
  }

  // 4a) RESTAKE (default): compound Σ pending net (all un-settled logs, not just this collect) + the
  //     swapped paired leg back into the PM — lifts NAV pro-rata for ALL holders on-chain, no share mint.
  //     The paired-leg proceeds are not part of any Harvested log's quote_fees, so they ride along here.
  if (destination === 'restake') {
    const { netAtomic: swappedNet } = skimPerformanceFee(swappedQuote, perfFeeBps())
    // V1-02 fix: this collect's own logic is now shared with the dust-floor/deterministic-revert
    // short-circuits above via settlePendingBacklog — one claim→approve→compoundQuote→mark
    // implementation instead of two copies that could quietly drift apart.
    const settled = await settlePendingBacklog({ supabase, log, instance, publicClient, wallet, account, index, swappedNet, collectTx, swapTx, grossAtomic, feeAtomic })
    if (settled) return settled
    // Nothing to compound even after this collect — still record the run (a real collect DID happen).
    await record(0n)
    return { ok: true, collectTx, grossAtomic, feeAtomic, creditedAtomic: 0n, recipients: 0, destination, index }
  }

  // 4b) BUFFER (opt-in): the index step already wrote every per-depositor credit atomically. Nothing moves
  //     on-chain; the net stays in the seat wallet as the IOU backing (reconcile via reconcileSeat). The
  //     swapped paired-leg proceeds are NOT credited per-user here (residual — see closeout record).
  await record(index.creditedAtomic)
  return {
    ok: true, collectTx, grossAtomic, feeAtomic, creditedAtomic: index.creditedAtomic,
    recipients: index.recorded, destination, index,
  }
}
