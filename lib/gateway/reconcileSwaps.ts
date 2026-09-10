// Automated fee-conversion swap reconciliation — the one remaining real gap independent Codex live-watch
// review kept flagging in the paired-token fee-conversion work (user directive, 2026-09-10: "built it").
//
// swapPairedToQuote (routerSwap.ts) sometimes can't measure a real swap's proceeds AT HARVEST TIME — the
// receipt confirmation itself failed transiently (RPC drop/timeout), or the swap confirmed successfully
// but no qualifying ERC-20 Transfer(quoteAsset → owner) log was found in its receipt. Either way, the
// swap_tx is durably recorded (this session's earlier fix) and flagged `swap_needs_reconciliation`
// (migration 20260910000001). This module re-checks those flagged rows later:
//   1. CLAIM the row (a guarded update — see claimRow below) before touching chain at all.
//   2. Re-fetch the swap_tx's OWN receipt from chain — never guesses, only ever reads real on-chain state.
//   3. Not yet mined ⇒ release the claim, leave flagged, retry next run.
//   4. Reverted ⇒ a DEFINITIVE terminal outcome (proceeds are zero, always, on a confirmed revert) ⇒
//      resolved, outcome 'reverted'.
//   5. Success ⇒ re-run the EXACT SAME measureSwapProceeds algorithm swapPairedToQuote itself uses:
//      - still no qualifying Transfer log ⇒ resolved, outcome 'unmeasurable' — a permanent characteristic
//        of that specific transaction (retrying again can never produce a different answer); flagged for
//        manual operator review via the outcome column, never retried forever.
//      - net ≤ 0 ⇒ resolved, outcome 'zero' — a definitive, now-measured answer.
//      - net > 0 ⇒ REAL RECOVERY: skims the SAME performance fee a normal harvest would (perfFeeBps,
//        imported from harvest.ts — never a second, drifting copy), then submits a genuine on-chain
//        compoundQuote(netAtomic) (approve + compound) to credit the NET proceeds into NAV. Resolved,
//        outcome 'recovered', swap_reconciliation_tx set to the real compound tx hash, and the original
//        row's own fee_skimmed_atomic/amount_credited_atomic updated to reflect what was actually credited
//        — the same fields a normal harvest's own record() call would have populated at the time.
//
// ⚠ CLAIM/LOCK — adversarial-review finding (2026-09-10, closed same day it was found). The first version
// of this module had NO claim step: it only flipped `swap_needs_reconciliation` to false AFTER a recovery
// compoundQuote() confirmed. An independent adversarial review (a Workflow reproducing this session's
// Codex live-watch pattern) wrote a real repro test PROVING two overlapping reconcile-cron runs both
// independently submit compoundQuote() for the same recovered amount, double-crediting NAV — the exact
// "claim before the on-chain call, not after" bug harvest.ts's own claimRestake/markRestaked/releaseRestake
// lifecycle (lib/gateway/ledger.ts) exists to prevent for the structurally identical compound call. Fixed:
// `claimRow` performs a GUARDED update (`.eq('swap_needs_reconciliation', true).is('swap_reconciliation_
// claimed_at', null)`) before any chain read/write — a second concurrent claim attempt for the same row
// then affects 0 rows and is skipped immediately, mirroring ledger.ts's `.eq('settlement', from)` guard
// exactly. `releaseRow` reverses the claim (sets claimed_at back to null) on any failure that did NOT
// actually submit an on-chain tx, so the row stays retryable; the claim is deliberately left SET (never
// auto-released, never auto-retried) when a tx WAS submitted but its outcome is unknown (an RPC drop while
// waiting for the compound receipt) — the same "ambiguous, needs manual review" posture harvest.ts's own
// `compound_receipt_unknown` outcome uses for the identical situation.
//
// Fail-closed + OFF by default, same posture as every other gateway money-moving cron:
//   LP_GATEWAY_RECONCILE_ENABLED=true  → runs (needs the gateway signer seat — required even for the
//   read-only outcomes below, since the owner address to check Transfer logs against comes from it; no
//   signer this run ⇒ the whole pass skips rather than guess at the owner address).
//
// Known, disclosed residuals (not fixed — genuinely narrow, and each would need real new schema/design,
// not a quick patch):
//   - `owner` is re-derived from the CURRENT `getOracleSigner('gateway')` every reconcile run, not the
//     seat that actually executed the original swap. If the gateway seat is ever rotated between a
//     harvest and its later reconciliation, `measureSwapProceeds` checks Transfer logs against the WRONG
//     address and the row resolves 'unmeasurable' even though real proceeds exist. Seat rotation is a
//     deliberate, rare, operator-controlled action (see deployments.md's `<ROLE>_ORACLE_PRIVY_AUTH_KEY`) —
//     accepted for now; a real fix would persist the harvest-time owner address per row.
//   - A pool whose PositionManager is fully REMOVED from the registry (not merely deactivated — deactivated
//     instances still resolve, see listAllInstances) strands its pending rows in `still-pending` forever
//     with no separate alert distinguishing "transiently unresolvable" from "permanently orphaned." Full
//     deregistration is not a normal operational event in this codebase today; accepted rather than adding
//     a dedicated escalation path for a case that doesn't currently happen.

import { createWalletClient, http } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listAllInstances } from '@/lib/gateway/registry'
import { measureSwapProceeds } from '@/lib/gateway/routerSwap'
import { estimateGasWithFloor } from '@/lib/gateway/gasEstimate'
import { skimPerformanceFee } from '@/lib/gateway/harvestMath'
import { perfFeeBps } from '@/lib/gateway/harvest'

const ERC20_ABI = [
  { type: 'function', stateMutability: 'nonpayable', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', stateMutability: 'view', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
}

type ReconcileOutcome = 'reverted' | 'zero' | 'unmeasurable' | 'recovered'
type PendingReason = 'already_claimed' | 'receipt_not_found' | 'no_registered_instance' | 'approve_failed' | 'compound_reverted' | 'compound_receipt_unknown'

export type ReconcileRowResult =
  | { rowId: string; status: 'still-pending'; reason: PendingReason }
  | { rowId: string; status: 'resolved'; outcome: ReconcileOutcome; recoveredAtomic?: string; recoveryTx?: string }
  | { rowId: string; status: 'error'; error: string }

export type ReconcileSummary = {
  ran: boolean
  reason?: 'disabled' | 'config' | 'signer' | 'nothing_pending'
  checked: number
  recovered: number
  results: ReconcileRowResult[]
}

const reconcileEnabled = () => process.env.LP_GATEWAY_RECONCILE_ENABLED === 'true'
const batchSize = () => {
  const n = Number(process.env.LP_GATEWAY_RECONCILE_BATCH_SIZE ?? '25')
  return Number.isInteger(n) && n > 0 && n <= 200 ? n : 25
}

type Row = { id: string; pool_address: string; chain_id: number; swap_tx: string | null }

/** Step 1 — CLAIM this row before touching chain at all. Guarded: only succeeds if the row is still
 *  flagged pending AND not already claimed by another (possibly overlapping) run. Returns false when the
 *  guard fails (0 rows updated) — the caller must skip the row entirely, never proceed to any on-chain
 *  call, exactly mirroring ledger.ts#claimRestake's `.eq('settlement', from)` guard for the identical
 *  double-submission hazard on harvest.ts's own compoundQuote call. */
async function claimRow(supabase: SupabaseClient, rowId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('harvest_events')
    .update({ swap_reconciliation_claimed_at: new Date().toISOString() })
    .eq('id', rowId)
    .eq('swap_needs_reconciliation', true)
    .is('swap_reconciliation_claimed_at', null)
    .select('id')
  if (error) return false
  return Array.isArray(data) && data.length === 1
}

/** Step 3a (failure, nothing submitted on-chain) — hand the row back to the unclaimed pool so a future
 *  pass can retry it. NEVER call this after a chain WRITE has actually been submitted and its outcome is
 *  unknown — see the header note on why that case stays claimed instead. */
async function releaseRow(supabase: SupabaseClient, rowId: string, log?: Logger): Promise<void> {
  const { error } = await supabase.from('harvest_events').update({ swap_reconciliation_claimed_at: null }).eq('id', rowId)
  if (error) log?.error('gateway.reconcile', 'failed to release claim — row stuck claimed until manually cleared', { rowId, error: error.message })
}

/** Step 3b (success or definitive terminal outcome) — resolve the row. `credited`/`feeSkimmed` are only
 *  meaningful (and only passed) on a 'recovered' outcome — mirrors what a normal harvest's own record()
 *  call populates, so a recovered row reads identically to one credited at harvest time. */
async function resolveRow(
  supabase: SupabaseClient, rowId: string, outcome: ReconcileOutcome,
  extra: { recoveryTx?: string; creditedAtomic?: bigint; feeSkimmedAtomic?: bigint } = {},
): Promise<boolean> {
  const { error } = await supabase.from('harvest_events').update({
    swap_needs_reconciliation: false,
    swap_reconciled_at: new Date().toISOString(),
    swap_reconciliation_outcome: outcome,
    ...(extra.recoveryTx ? { swap_reconciliation_tx: extra.recoveryTx } : {}),
    ...(extra.creditedAtomic != null ? { amount_credited_atomic: extra.creditedAtomic.toString() } : {}),
    ...(extra.feeSkimmedAtomic != null ? { fee_skimmed_atomic: extra.feeSkimmedAtomic.toString() } : {}),
  }).eq('id', rowId)
  return !error
}

/** Runs ONE reconciliation pass across every pool with pending-reconciliation `harvest_events` rows.
 *  The cron entry point (`app/api/(rewards)/cron/gateway-reconcile-swaps/route.ts`). */
export async function reconcilePendingSwaps(opts: { supabase: SupabaseClient; log?: Logger }): Promise<ReconcileSummary> {
  const { supabase, log } = opts
  if (!reconcileEnabled()) return { ran: false, reason: 'disabled', checked: 0, recovered: 0, results: [] }
  const cfg = gatewayConfig()
  if (!cfg) return { ran: false, reason: 'config', checked: 0, recovered: 0, results: [] }

  const { data: rows, error: listError } = await supabase
    .from('harvest_events')
    .select('id, pool_address, chain_id, swap_tx')
    .eq('swap_needs_reconciliation', true)
    .is('swap_reconciliation_claimed_at', null)
    .order('created_at', { ascending: true })
    .limit(batchSize())
  if (listError) {
    log?.error('gateway.reconcile', 'failed to list pending-reconciliation rows', { error: listError.message })
    return { ran: false, reason: 'config', checked: 0, recovered: 0, results: [] }
  }
  const pending = (rows ?? []) as Row[]
  if (pending.length === 0) return { ran: true, reason: 'nothing_pending', checked: 0, recovered: 0, results: [] }

  // The owner address to check Transfer logs against comes from the signer — every gateway instance
  // shares this ONE dedicated seat (getOracleSigner('gateway')), so it's resolved once for the whole
  // pass. No signer this run ⇒ we genuinely cannot know which address to check for, so the whole pass
  // skips (never guesses an owner) rather than partially processing with a wrong address.
  let account: Awaited<ReturnType<typeof getOracleSigner>>
  try {
    account = await getOracleSigner('gateway')
  } catch (e) {
    log?.error('gateway.reconcile', 'oracle signer unavailable — cannot determine the owner address to check, skipping this pass entirely', { error: String(e) })
    return { ran: false, reason: 'signer', checked: 0, recovered: 0, results: [] }
  }
  const owner = (account as { address: `0x${string}` }).address
  const publicClient = gatewayPublicClient(cfg)
  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(cfg.rpcUrl) })

  const instances = await listAllInstances(supabase, cfg.chainId)
  const pmForPool = new Map<string, `0x${string}`>()
  for (const inst of instances) pmForPool.set(`${inst.chainId}:${inst.poolAddress.toLowerCase()}`, inst.positionManager)

  const results: ReconcileRowResult[] = []
  let recovered = 0

  for (const row of pending) {
    if (!row.swap_tx) {
      // Should never happen — swap_needs_reconciliation is only ever set alongside a real swap_tx
      // (routerSwap.ts never flags it when txHash is null). Defensive: resolve out rather than loop
      // forever on a row that can never actually be checked. No claim taken (nothing to release).
      await resolveRow(supabase, row.id, 'unmeasurable')
      results.push({ rowId: row.id, status: 'resolved', outcome: 'unmeasurable' })
      continue
    }

    const positionManager = pmForPool.get(`${row.chain_id}:${row.pool_address.toLowerCase()}`)
    if (!positionManager) {
      log?.warn('gateway.reconcile', 'no registered position manager for this pool — cannot resolve quoteAsset, leaving row pending', {
        rowId: row.id, pool: row.pool_address, chainId: row.chain_id,
      })
      results.push({ rowId: row.id, status: 'still-pending', reason: 'no_registered_instance' })
      continue
    }

    // CLAIM before any chain call — see claimRow's own doc + the header note for exactly what this closes.
    const claimed = await claimRow(supabase, row.id)
    if (!claimed) {
      // Another (possibly overlapping) pass already claimed this row, or it resolved between our list
      // query and now. Either way: skip entirely, no chain call, no double-submission risk.
      results.push({ rowId: row.id, status: 'still-pending', reason: 'already_claimed' })
      continue
    }

    // From here on the row is OURS. Every exit path below must either releaseRow (safe: nothing on-chain
    // was submitted) or resolveRow (terminal) — the one exception is a submitted-but-unconfirmed compound,
    // which deliberately stays claimed (see the header note).
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: row.swap_tx as `0x${string}` }).catch(() => null)
      if (!receipt) {
        await releaseRow(supabase, row.id, log)
        results.push({ rowId: row.id, status: 'still-pending', reason: 'receipt_not_found' })
        continue
      }
      if (receipt.status !== 'success') {
        const ok = await resolveRow(supabase, row.id, 'reverted')
        if (!ok) log?.error('gateway.reconcile', 'failed to persist a resolved (reverted) outcome — row stays claimed, needs manual review', { rowId: row.id })
        results.push({ rowId: row.id, status: 'resolved', outcome: 'reverted' })
        continue
      }

      const quoteAsset = (await publicClient.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName: 'quoteAsset' })) as `0x${string}`
      const net = measureSwapProceeds(receipt.logs, quoteAsset, owner)
      if (net === null) {
        const ok = await resolveRow(supabase, row.id, 'unmeasurable')
        if (!ok) log?.error('gateway.reconcile', 'failed to persist a resolved (unmeasurable) outcome — row stays claimed, needs manual review', { rowId: row.id })
        log?.warn('gateway.reconcile', 'swap confirmed successful but STILL no qualifying Transfer log on re-check — a permanent characteristic of this tx, needs manual operator review', {
          rowId: row.id, swapTx: row.swap_tx,
        })
        results.push({ rowId: row.id, status: 'resolved', outcome: 'unmeasurable' })
        continue
      }

      const recoveredAmount = net > 0n ? net : 0n
      if (recoveredAmount <= 0n) {
        const ok = await resolveRow(supabase, row.id, 'zero')
        if (!ok) log?.error('gateway.reconcile', 'failed to persist a resolved (zero) outcome — row stays claimed, needs manual review', { rowId: row.id })
        results.push({ rowId: row.id, status: 'resolved', outcome: 'zero' })
        continue
      }

      // Real recovery: same performance-fee skim a normal harvest applies (adversarial-review finding,
      // 2026-09-10 — the first version compounded the FULL recovered amount, silently skipping the
      // platform's own fee), then approve + compoundQuote — the SAME pattern harvest.ts's
      // settlePendingBacklog uses — to credit the NET amount into NAV.
      const { feeAtomic, netAtomic } = skimPerformanceFee(recoveredAmount, perfFeeBps())
      if (netAtomic <= 0n) {
        // The whole recovered amount is fee — nothing left to compound. Still a genuine, measured
        // recovery: record it as such (0 credited, fee = the full recovered amount) rather than 'zero'
        // (which would incorrectly imply nothing was ever there).
        const ok = await resolveRow(supabase, row.id, 'recovered', { creditedAtomic: 0n, feeSkimmedAtomic: feeAtomic })
        if (!ok) log?.error('gateway.reconcile', 'failed to persist a resolved (recovered, fully fee) outcome — row stays claimed, needs manual review', { rowId: row.id })
        results.push({ rowId: row.id, status: 'resolved', outcome: 'recovered', recoveredAtomic: '0' })
        continue
      }

      const currentAllowance = (await publicClient.readContract({
        address: quoteAsset, abi: ERC20_ABI, functionName: 'allowance', args: [owner, positionManager],
      })) as bigint
      if (currentAllowance < netAtomic) {
        const approveArgs = { address: quoteAsset, abi: ERC20_ABI, functionName: 'approve', args: [positionManager, netAtomic], account } as const
        const { gas: approveGas } = await estimateGasWithFloor(publicClient, approveArgs, 80_000n)
        const approveTx = await wallet.writeContract({ ...approveArgs, chain: publicClient.chain, gas: approveGas })
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx })
        if (approveReceipt.status !== 'success') {
          // The approve itself reverted — nothing of value moved. Safe to release and retry.
          await releaseRow(supabase, row.id, log)
          log?.error('gateway.reconcile', 'recovery approval failed — releasing claim, will retry', { rowId: row.id, approveTx })
          results.push({ rowId: row.id, status: 'still-pending', reason: 'approve_failed' })
          continue
        }
      }

      const compoundArgs = { address: positionManager, abi: LP_GATEWAY_ABI, functionName: 'compoundQuote', args: [netAtomic], account } as const
      const { gas: compoundGas } = await estimateGasWithFloor(publicClient, compoundArgs, 400_000n)
      let compoundTx: `0x${string}`
      try {
        compoundTx = await wallet.writeContract({ ...compoundArgs, chain: publicClient.chain, gas: compoundGas })
      } catch (e) {
        // The write itself never got a tx hash back — nothing was submitted. Safe to release and retry.
        await releaseRow(supabase, row.id, log)
        log?.error('gateway.reconcile', 'recovery compound submission failed — releasing claim, will retry', { rowId: row.id, error: String(e) })
        results.push({ rowId: row.id, status: 'still-pending', reason: 'compound_reverted' })
        continue
      }
      let compoundReceipt: { status: string }
      try {
        compoundReceipt = await publicClient.waitForTransactionReceipt({ hash: compoundTx })
      } catch (e) {
        // The compound WAS submitted — its outcome is now genuinely unknown (RPC drop/timeout). This is
        // exactly the ambiguous case the claim must NOT be released for: releasing it would let a future
        // pass re-submit a second compoundQuote for the same amount while the first might still mine.
        // Persist the hash for visibility and stop here — deliberately never auto-retried, matching
        // harvest.ts's own compound_receipt_unknown posture for the identical situation.
        await supabase.from('harvest_events').update({ swap_reconciliation_tx: compoundTx }).eq('id', row.id).catch(() => undefined)
        log?.error('gateway.reconcile', 'recovery compound submitted but could not be confirmed — row LEFT CLAIMED, will NOT be auto-retried. Manual operator verification required (check compoundTx on-chain, then resolve or release the row by hand)', {
          rowId: row.id, compoundTx, error: String(e),
        })
        results.push({ rowId: row.id, status: 'still-pending', reason: 'compound_receipt_unknown' })
        continue
      }
      if (compoundReceipt.status !== 'success') {
        // A confirmed revert — nothing was credited. Safe to release and retry.
        await releaseRow(supabase, row.id, log)
        log?.error('gateway.reconcile', 'recovery compound reverted — releasing claim, will retry', { rowId: row.id, compoundTx })
        results.push({ rowId: row.id, status: 'still-pending', reason: 'compound_reverted' })
        continue
      }

      const ok = await resolveRow(supabase, row.id, 'recovered', { recoveryTx: compoundTx, creditedAtomic: netAtomic, feeSkimmedAtomic: feeAtomic })
      if (!ok) {
        // The recovery tx ALREADY MINED — NAV is already lifted on-chain. Only the bookkeeping row failed
        // to update, but it stays CLAIMED (claimRow's guard means a future pass can't re-select it while
        // claimed_at is set) — so this is a bookkeeping gap, not a double-compound risk. Still loud.
        log?.error('gateway.reconcile', 'recovery compound MINED but the row update failed — bookkeeping (amount_credited_atomic/outcome) not persisted; row stays claimed so no double-submission risk, but needs manual bookkeeping correction', {
          rowId: row.id, compoundTx, netAtomic: netAtomic.toString(), feeAtomic: feeAtomic.toString(),
        })
      }
      recovered++
      log?.info('gateway.reconcile', 'recovered previously-unmeasured swap proceeds into NAV', {
        rowId: row.id, recoveredAtomic: recoveredAmount.toString(), netAtomic: netAtomic.toString(), feeAtomic: feeAtomic.toString(), compoundTx,
      })
      results.push({ rowId: row.id, status: 'resolved', outcome: 'recovered', recoveredAtomic: netAtomic.toString(), recoveryTx: compoundTx })
    } catch (e) {
      // Anything unexpected before any on-chain WRITE (a receipt/read-contract failure inside the try
      // block above them is already handled by its own .catch — this covers truly unanticipated errors).
      // Release rather than leave permanently claimed, since nothing here should have reached a write.
      await releaseRow(supabase, row.id, log)
      log?.error('gateway.reconcile', 'reconciliation check failed for this row — releasing claim, will retry', { rowId: row.id, error: String(e) })
      results.push({ rowId: row.id, status: 'error', error: String(e) })
    }
  }

  return { ran: true, checked: pending.length, recovered, results }
}
