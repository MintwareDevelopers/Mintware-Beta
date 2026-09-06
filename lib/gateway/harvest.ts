// LP-gateway harvest orchestration — the yield-first buffer income path. Collects pool fees on-chain
// (zero-liquidity-delta, principal untouched) via the position manager's owner (getOracleSigner('root'),
// the SAME seat the card flow uses), converts the paired leg to the quote asset via the MW meta-router,
// skims the performance fee, and credits each depositor's spend buffer pro-rata to shares at harvest
// time. YIELD-FIRST + no principal-spend: this only ever moves harvested FEE income, never LP shares.
//
// DARK-LAUNCHED, fail-closed, OFF by default: no-ops unless LP_GATEWAY_HARVEST_ENABLED === 'true' and
// the gateway config + oracle signer resolve. Idempotent on the collect tx (harvest_events unique index).

import { createWalletClient, http, decodeEventLog } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { skimPerformanceFee, proRataBufferCredits, type SharePosition } from '@/lib/gateway/harvestMath'
import { swapPairedToQuote } from '@/lib/gateway/routerSwap'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
}

type Reason = 'disabled' | 'config' | 'signer' | 'tx' | 'nothing' | 'duplicate'
export type HarvestOutcome =
  | { ok: true; collectTx: `0x${string}`; grossAtomic: bigint; feeAtomic: bigint; creditedAtomic: bigint; recipients: number }
  | { ok: false; status: number; error: string; reason: Reason }

const big = (v: unknown) => BigInt(String(v ?? '0'))
const perfFeeBps = () => {
  const n = Number(process.env.LP_GATEWAY_PERF_FEE_BPS ?? '1000') // default 10%
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : 1000
}

export async function harvestGateway(opts: { supabase: SupabaseClient; log?: Logger }): Promise<HarvestOutcome> {
  const { supabase, log } = opts
  if (process.env.LP_GATEWAY_HARVEST_ENABLED !== 'true') {
    return { ok: false, status: 503, error: 'gateway harvest is not enabled', reason: 'disabled' }
  }
  const cfg = gatewayConfig()
  if (!cfg) return { ok: false, status: 503, error: 'gateway_not_configured', reason: 'config' }

  const publicClient = gatewayPublicClient(cfg)
  let account
  try {
    account = await getOracleSigner('root') // the position manager's owner seat
  } catch (e) {
    log?.error('gateway.harvest', 'oracle signer unavailable', { error: String(e) })
    return { ok: false, status: 503, error: 'harvest_signer_unavailable', reason: 'signer' }
  }
  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(cfg.rpcUrl) })

  // 1) collect fees (zero-liquidity-delta) → harvestRecipient (the oracle seat). Idempotent-safe: a
  //    revert (no fees) just yields zero, and the collect tx keys the harvest_events unique index.
  let collectTx: `0x${string}`
  let quoteFees = 0n
  let pairedFees = 0n
  try {
    collectTx = await wallet.writeContract({
      address: cfg.positionManager, abi: LP_GATEWAY_ABI, functionName: 'harvest',
      args: [BigInt(Math.floor(Date.now() / 1000) + 600)], account, chain: publicClient.chain, gas: 900_000n,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: collectTx })
    if (receipt.status !== 'success') return { ok: false, status: 502, error: 'harvest_reverted', reason: 'tx' }
    for (const lg of receipt.logs) {
      if (lg.address.toLowerCase() !== cfg.positionManager.toLowerCase()) continue
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

  // idempotency: never record/credit the same collect twice
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
  if (grossAtomic <= 0n) {
    await supabase.from('harvest_events').insert({
      pool_address: cfg.poolAddress, chain_id: cfg.chainId, collect_tx: collectTx, swap_tx: swapTx,
      amount_harvested_atomic: '0', fee_skimmed_atomic: '0', amount_credited_atomic: '0',
    })
    return { ok: false, status: 200, error: 'nothing harvested', reason: 'nothing' }
  }

  // 3) skim the performance fee, split the rest pro-rata by share
  const { feeAtomic, netAtomic } = skimPerformanceFee(grossAtomic, perfFeeBps())
  const { data: rows } = await supabase
    .from('gateway_positions')
    .select('id, user_wallet, shares')
    .eq('pool_address', cfg.poolAddress)
    .eq('chain_id', cfg.chainId)
  const positions: (SharePosition & { id: string })[] = ((rows ?? []) as Array<{ id: string; user_wallet: string; shares: unknown }>)
    .map((r) => ({ id: String(r.id), user: String(r.user_wallet), shares: big(r.shares) }))
    .filter((p) => p.shares > 0n)
  const credits = proRataBufferCredits(netAtomic, positions)

  // 4) credit each depositor's linked card spend buffer (yield-first income). A depositor with no linked
  //    buffer still has their share recorded in harvest_events aggregate; their spendable home follows the
  //    individual-spend-UI decision (phase-1: x402-only). Never burns shares here.
  let credited = 0n
  const byUser = new Map(positions.map((p) => [p.user, p.id]))
  for (const c of credits) {
    if (c.creditAtomic <= 0n) continue
    const posId = byUser.get(c.user)
    if (!posId) continue
    const { data: buf } = await supabase
      .from('card_spend_buffers')
      .select('id, buffer_balance_atomic')
      .eq('gateway_position_id', posId)
      .maybeSingle()
    if (!buf?.id) continue
    await supabase
      .from('card_spend_buffers')
      .update({ buffer_balance_atomic: (big(buf.buffer_balance_atomic) + c.creditAtomic).toString(), updated_at: new Date().toISOString() })
      .eq('id', buf.id)
    credited += c.creditAtomic
  }

  await supabase.from('harvest_events').insert({
    pool_address: cfg.poolAddress, chain_id: cfg.chainId, collect_tx: collectTx, swap_tx: swapTx,
    amount_harvested_atomic: grossAtomic.toString(), fee_skimmed_atomic: feeAtomic.toString(),
    amount_credited_atomic: credited.toString(),
  })

  return { ok: true, collectTx, grossAtomic, feeAtomic, creditedAtomic: credited, recipients: credits.length }
}
