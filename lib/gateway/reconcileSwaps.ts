// Automated fee-conversion swap reconciliation — the one remaining real gap independent Codex live-watch
// review kept flagging in the paired-token fee-conversion work (user directive, 2026-09-10: "built it").
//
// swapPairedToQuote (routerSwap.ts) sometimes can't measure a real swap's proceeds AT HARVEST TIME — the
// receipt confirmation itself failed transiently (RPC drop/timeout), or the swap confirmed successfully
// but no qualifying ERC-20 Transfer(quoteAsset → owner) log was found in its receipt. Either way, the
// swap_tx is durably recorded (this session's earlier fix) and flagged `swap_needs_reconciliation`
// (migration 20260910000001). This module re-checks those flagged rows later:
//   1. Re-fetch the swap_tx's OWN receipt from chain — never guesses, only ever reads real on-chain state.
//   2. Not yet mined ⇒ skip this run, leave flagged, retry next run.
//   3. Reverted ⇒ a DEFINITIVE terminal outcome (proceeds are zero, always, on a confirmed revert) ⇒
//      resolved, outcome 'reverted'.
//   4. Success ⇒ re-run the EXACT SAME measureSwapProceeds algorithm swapPairedToQuote itself uses:
//      - still no qualifying Transfer log ⇒ resolved, outcome 'unmeasurable' — a permanent characteristic
//        of that specific transaction (retrying again can never produce a different answer); flagged for
//        manual operator review via the outcome column, never retried forever.
//      - net ≤ 0 ⇒ resolved, outcome 'zero' — a definitive, now-measured answer.
//      - net > 0 ⇒ REAL RECOVERY: submits a genuine on-chain compoundQuote(amount) (approve + compound,
//        the SAME pattern harvest.ts's settlePendingBacklog already uses) to actually credit these
//        proceeds into NAV — the same effect a normal harvest's own swap would have had. Resolved, outcome
//        'recovered', swap_reconciliation_tx set to the real compound tx hash.
//
// Fail-closed + OFF by default, same posture as every other gateway money-moving cron:
//   LP_GATEWAY_RECONCILE_ENABLED=true  → runs (needs the gateway signer seat — required even for the
//   read-only outcomes below, since the owner address to check Transfer logs against comes from it; no
//   signer this run ⇒ the whole pass skips rather than guess at the owner address).
// Idempotent: a row is only ever resolved ONCE (swap_needs_reconciliation flips to false, gated by its own
// DB update) — never reprocessed once resolved. Every branch above is a definitive on-chain answer or an
// explicit "still pending, try again later" — never a guess.

import { createWalletClient, http } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listAllInstances } from '@/lib/gateway/registry'
import { measureSwapProceeds } from '@/lib/gateway/routerSwap'
import { estimateGasWithFloor } from '@/lib/gateway/gasEstimate'

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
type PendingReason = 'receipt_not_found' | 'no_registered_instance' | 'approve_failed' | 'compound_reverted' | 'compound_receipt_unknown'

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

async function resolveRow(
  supabase: SupabaseClient, rowId: string, outcome: ReconcileOutcome, recoveryTx?: string,
): Promise<boolean> {
  const { error } = await supabase.from('harvest_events').update({
    swap_needs_reconciliation: false,
    swap_reconciled_at: new Date().toISOString(),
    swap_reconciliation_outcome: outcome,
    ...(recoveryTx ? { swap_reconciliation_tx: recoveryTx } : {}),
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
      // forever on a row that can never actually be checked.
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

    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: row.swap_tx as `0x${string}` }).catch(() => null)
      if (!receipt) {
        results.push({ rowId: row.id, status: 'still-pending', reason: 'receipt_not_found' })
        continue
      }
      if (receipt.status !== 'success') {
        const ok = await resolveRow(supabase, row.id, 'reverted')
        if (!ok) log?.error('gateway.reconcile', 'failed to persist a resolved (reverted) outcome — will retry', { rowId: row.id })
        results.push({ rowId: row.id, status: 'resolved', outcome: 'reverted' })
        continue
      }

      const quoteAsset = (await publicClient.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName: 'quoteAsset' })) as `0x${string}`
      const net = measureSwapProceeds(receipt.logs, quoteAsset, owner)
      if (net === null) {
        const ok = await resolveRow(supabase, row.id, 'unmeasurable')
        if (!ok) log?.error('gateway.reconcile', 'failed to persist a resolved (unmeasurable) outcome — will retry', { rowId: row.id })
        log?.warn('gateway.reconcile', 'swap confirmed successful but STILL no qualifying Transfer log on re-check — a permanent characteristic of this tx, needs manual operator review', {
          rowId: row.id, swapTx: row.swap_tx,
        })
        results.push({ rowId: row.id, status: 'resolved', outcome: 'unmeasurable' })
        continue
      }

      const recoveredAmount = net > 0n ? net : 0n
      if (recoveredAmount <= 0n) {
        const ok = await resolveRow(supabase, row.id, 'zero')
        if (!ok) log?.error('gateway.reconcile', 'failed to persist a resolved (zero) outcome — will retry', { rowId: row.id })
        results.push({ rowId: row.id, status: 'resolved', outcome: 'zero' })
        continue
      }

      // Real recovery: approve + compoundQuote, the SAME pattern harvest.ts's settlePendingBacklog uses
      // to credit an amount into NAV — a genuine, separate on-chain effect mirroring what a normal
      // harvest's own swap would have contributed at the time.
      const currentAllowance = (await publicClient.readContract({
        address: quoteAsset, abi: ERC20_ABI, functionName: 'allowance', args: [owner, positionManager],
      })) as bigint
      if (currentAllowance < recoveredAmount) {
        const approveArgs = { address: quoteAsset, abi: ERC20_ABI, functionName: 'approve', args: [positionManager, recoveredAmount], account } as const
        const { gas: approveGas } = await estimateGasWithFloor(publicClient, approveArgs, 80_000n)
        const approveTx = await wallet.writeContract({ ...approveArgs, chain: publicClient.chain, gas: approveGas })
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx })
        if (approveReceipt.status !== 'success') {
          log?.error('gateway.reconcile', 'recovery approval failed — leaving row pending, will retry', { rowId: row.id, approveTx })
          results.push({ rowId: row.id, status: 'still-pending', reason: 'approve_failed' })
          continue
        }
      }

      const compoundArgs = { address: positionManager, abi: LP_GATEWAY_ABI, functionName: 'compoundQuote', args: [recoveredAmount], account } as const
      const { gas: compoundGas } = await estimateGasWithFloor(publicClient, compoundArgs, 400_000n)
      const compoundTx = await wallet.writeContract({ ...compoundArgs, chain: publicClient.chain, gas: compoundGas })
      const compoundReceipt = await publicClient.waitForTransactionReceipt({ hash: compoundTx })
      if (compoundReceipt.status !== 'success') {
        log?.error('gateway.reconcile', 'recovery compound reverted — leaving row pending, will retry', { rowId: row.id, compoundTx })
        results.push({ rowId: row.id, status: 'still-pending', reason: 'compound_reverted' })
        continue
      }

      const ok = await resolveRow(supabase, row.id, 'recovered', compoundTx)
      if (!ok) {
        // The recovery tx ALREADY MINED — NAV is already lifted on-chain. Only the bookkeeping row failed
        // to update. Loud, not silent: a re-run would otherwise try to recover the SAME proceeds again
        // (this row is still flagged pending), double-compounding. Escalated distinctly from every other
        // "will retry" case above.
        log?.error('gateway.reconcile', 'recovery compound MINED but the row update failed — row still flagged pending; a re-run will attempt to recover this SAME amount again, risking a double-compound. Manual operator intervention required NOW', {
          rowId: row.id, compoundTx, recoveredAmount: recoveredAmount.toString(),
        })
      }
      recovered++
      log?.info('gateway.reconcile', 'recovered previously-unmeasured swap proceeds into NAV', {
        rowId: row.id, recoveredAmount: recoveredAmount.toString(), compoundTx,
      })
      results.push({ rowId: row.id, status: 'resolved', outcome: 'recovered', recoveredAtomic: recoveredAmount.toString(), recoveryTx: compoundTx })
    } catch (e) {
      log?.error('gateway.reconcile', 'reconciliation check failed for this row — leaving pending, will retry', { rowId: row.id, error: String(e) })
      results.push({ rowId: row.id, status: 'error', error: String(e) })
    }
  }

  return { ran: true, checked: pending.length, recovered, results }
}
