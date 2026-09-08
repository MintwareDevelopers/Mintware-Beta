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
import { listActiveInstances } from '@/lib/gateway/registry'
import { skimPerformanceFee } from '@/lib/gateway/harvestMath'
import { swapPairedToQuote } from '@/lib/gateway/routerSwap'
import { indexHarvestLogs, listPendingRestake, claimRestake, releaseRestake, markRestaked, type IndexOutcome, type LedgerClient } from '@/lib/gateway/ledger'

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
      collectTx: `0x${string}`
      grossAtomic: bigint
      feeAtomic: bigint
      creditedAtomic: bigint
      recipients: number
      destination: HarvestDestination
      index: IndexOutcome | null
    }
  | { ok: false; status: number; error: string; reason: Reason; index?: IndexOutcome | null }

export type HarvestDestination = 'buffer' | 'restake'

/** Where harvested net fees go. Audit closeout O-4: **'restake' is the default** — `compoundQuote` lifts NAV
 *  pro-rata on-chain, so fee income provably reaches depositors with no off-chain claim. 'buffer' (the
 *  per-depositor IOU ledger) is opt-in: `LP_GATEWAY_HARVEST_DESTINATION=buffer`. Resolved here (not in
 *  opsConfig.ts, whose 'buffer' default predates the closeout) so the safe default is enforced on the
 *  money path regardless. */
export function resolveHarvestDestination(env: Record<string, string | undefined> = process.env): HarvestDestination {
  return (env.LP_GATEWAY_HARVEST_DESTINATION ?? '').toLowerCase() === 'buffer' ? 'buffer' : 'restake'
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

function targetsFor(active: Awaited<ReturnType<typeof listActiveInstances>>, cfg: NonNullable<ReturnType<typeof gatewayConfig>>): HarvestInstance[] {
  return active.length
    ? active.map((i) => ({ positionManager: i.positionManager, poolAddress: i.poolAddress, chainId: i.chainId }))
    : cfg.positionManager && cfg.poolAddress
      ? [{ positionManager: cfg.positionManager, poolAddress: cfg.poolAddress, chainId: cfg.chainId }]
      : []
}

/** Harvest EVERY active gateway (registry + single-env fallback). The cron entry point.
 *  Modes: harvest (collect + index + settle) when LP_GATEWAY_HARVEST_ENABLED; index-only (no tx, no
 *  signer) when only LP_GATEWAY_LEDGER_INDEX_ENABLED; else disabled. */
export async function harvestAll(opts: { supabase: SupabaseClient; log?: Logger }): Promise<{ harvested: number; indexed: number; results: HarvestOutcome[]; indexResults: IndexOutcome[] }> {
  if (!harvestEnabled() && !indexEnabled()) {
    return { harvested: 0, indexed: 0, indexResults: [], results: [{ ok: false, status: 503, error: 'gateway harvest is not enabled', reason: 'disabled' }] }
  }
  const cfg = gatewayConfig()
  if (!cfg) return { harvested: 0, indexed: 0, indexResults: [], results: [{ ok: false, status: 503, error: 'gateway_not_configured', reason: 'config' }] }
  const targets = targetsFor(await listActiveInstances(opts.supabase, cfg.chainId), cfg)
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
      const index = await indexHarvestLogs({
        supabase, client: publicClient as unknown as LedgerClient, instance, log, settlement: destination === 'buffer' ? 'credited' : 'pending',
      })
      return { ok: false, status: 200, error: 'below harvest floor — skipped to save gas', reason: 'nothing', index }
    }
  } catch (e) {
    log?.warn('gateway.harvest', 'pre-harvest simulate failed; proceeding', { error: String(e) })
  }

  // 1) collect fees (zero-liquidity-delta) → harvestRecipient (the oracle seat). Idempotent-safe: a
  //    revert (no fees) just yields zero, and the collect tx keys the harvest_events unique index.
  let collectTx: `0x${string}`
  let collectBlock: bigint | undefined
  let quoteFees = 0n
  let pairedFees = 0n
  try {
    collectTx = await wallet.writeContract({
      address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'harvest',
      args: [BigInt(Math.floor(Date.now() / 1000) + 600)], account, chain: publicClient.chain, gas: 900_000n,
    })
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

  // 2) convert the paired leg → quote via the MW router (seam; no-op returns 0 swapped when unavailable)
  let swapTx: string | null = null
  let swappedQuote = 0n
  if (pairedFees > 0n) {
    const swap = await swapPairedToQuote({ cfg, account, wallet, publicClient, pairedAmount: pairedFees, log })
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
    await supabase.from('harvest_events').insert({
      pool_address: instance.poolAddress, chain_id: instance.chainId, collect_tx: collectTx, swap_tx: swapTx,
      amount_harvested_atomic: grossAtomic.toString(), fee_skimmed_atomic: '0', amount_credited_atomic: '0',
    })
    return { ok: false, status: 502, error: `ledger_index_failed:${index.error}`, reason: 'index', index }
  }

  const record = (credited: bigint) =>
    supabase.from('harvest_events').insert({
      pool_address: instance.poolAddress, chain_id: instance.chainId, collect_tx: collectTx, swap_tx: swapTx,
      amount_harvested_atomic: grossAtomic.toString(), fee_skimmed_atomic: feeAtomic.toString(), amount_credited_atomic: credited.toString(),
    })

  // 4a) RESTAKE (default): compound Σ pending net (all un-settled logs, not just this collect) + the
  //     swapped paired leg back into the PM — lifts NAV pro-rata for ALL holders on-chain, no share mint.
  //     The paired-leg proceeds are not part of any Harvested log's quote_fees, so they ride along here.
  if (destination === 'restake') {
    const pending = await listPendingRestake(supabase, instance)
    const { netAtomic: swappedNet } = skimPerformanceFee(swappedQuote, perfFeeBps())
    const amount = pending.netAtomic + swappedNet
    if (amount <= 0n) {
      await record(0n)
      return { ok: true, collectTx, grossAtomic, feeAtomic, creditedAtomic: 0n, recipients: 0, destination, index }
    }
    // Round-3 audit F-3 — two-phase settlement so a mined compound can never be compounded twice:
    // claim (pending → restaking, count-verified) → compound → mark (restaking → restake + tx, count-verified);
    // a compound that never mined releases the claim. A crash between compound and mark leaves `restaking` rows
    // that are excluded from the pending pool and surfaced to the operator (listStuckRestaking).
    try {
      await claimRestake(supabase, pending.ids)
    } catch (e) {
      log?.error('gateway.harvest', 'restake claim failed — nothing sent', { error: String(e) })
      return { ok: false, status: 500, error: 'restake_claim_failed', reason: 'tx', index }
    }
    let ch: `0x${string}` | undefined
    let mined = false
    try {
      const quoteAsset = (await publicClient.readContract({ address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'quoteAsset' })) as `0x${string}`
      const ah = await wallet.writeContract({ address: quoteAsset, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [instance.positionManager, amount], account, chain: publicClient.chain })
      await publicClient.waitForTransactionReceipt({ hash: ah })
      ch = await wallet.writeContract({ address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'compoundQuote', args: [amount], account, chain: publicClient.chain, gas: 400_000n })
      const rc = await publicClient.waitForTransactionReceipt({ hash: ch })
      mined = rc.status === 'success'
      if (!mined) {
        await releaseRestake(supabase, pending.ids).catch((e) => log?.error('gateway.harvest', 'restake release failed after revert', { error: String(e) }))
        return { ok: false, status: 502, error: 'compound_reverted', reason: 'tx', index }
      }
    } catch (e) {
      log?.error('gateway.harvest', 'restake/compound failed', { error: String(e) })
      // Only release if we KNOW nothing was sent; an ambiguous send (compound hash obtained, receipt unknown —
      // e.g. the receipt wait timed out) stays `restaking` for the operator to resolve on-chain rather than
      // risk a double compound.
      if (ch === undefined) {
        await releaseRestake(supabase, pending.ids).catch((e2) => log?.error('gateway.harvest', 'restake release failed', { error: String(e2) }))
        return { ok: false, status: 502, error: 'compound_failed', reason: 'tx', index }
      }
      log?.error('gateway.harvest', 'compound sent but receipt unknown — rows left in `restaking`, operator must finalise', { settleTx: ch })
      return { ok: false, status: 502, error: 'compound_receipt_unknown', reason: 'tx', index }
    }
    try {
      await markRestaked(supabase, pending.ids, ch)
    } catch (e) {
      // The compound MINED. Do not release (that would re-compound). Leave `restaking` + loud error.
      log?.error('gateway.harvest', 'compound mined but ledger mark failed — rows left in `restaking`, operator must finalise', { error: String(e), settleTx: ch })
      return { ok: false, status: 500, error: 'restake_mark_failed', reason: 'tx', index }
    }
    await record(amount)
    return { ok: true, collectTx, grossAtomic, feeAtomic, creditedAtomic: amount, recipients: 0, destination, index }
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
