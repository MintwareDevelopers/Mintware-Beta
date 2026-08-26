// Shared card spend-buffer REFILL core — redeems a slice of the member's OWN senior shares into their
// registered buffer wallet by submitting MintwarePaymentGateway.refillBuffer via the oracle/Privy
// signer in the RELAYER_ROLE seat (getOracleSigner('root')) — the SAME on-demand pattern settleSwipe
// uses. Extracted so BOTH triggers run identical code: the reactive capture-webhook (buffer just
// drained) and the steady-state cron. No auth here — the CALLER gates. Spec: docs/developers/
// card-spend-buffer-spec.md (Option A, §5).
//
// DARK-LAUNCHED: fail-closed and OFF by default. `refillCardBuffer` no-ops unless
// CARD_BUFFER_REFILL_ENABLED === 'true', the card has auto_refill_enabled, a live permit, a registered
// buffer, and the oracle signer + gateway resolve. It moves real on-chain funds only once all of that
// is true — every gate below returns before the write otherwise.

import { createPublicClient, createWalletClient, http, keccak256, toBytes, isHex } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { viemChainFor } from '@/lib/web3/chains'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { VAULT_ABI, GATEWAY_ABI } from '@/lib/web3/artifacts/treasuryV2'
import { bufferTargetAtomic, type BufferSizingParams } from '@/lib/cards/bufferSizing'
import { refillPlan, checkRefillRate, type RefillRateState } from '@/lib/cards/bufferPolicy'

type Reason =
  | 'disabled' | 'not_found' | 'not_enabled' | 'no_buffer' | 'at_target' | 'rate_capped'
  | 'not_activated' | 'permit_expired' | 'permit_malformed' | 'config' | 'chain' | 'read' | 'signer' | 'tx'

export type RefillOutcome =
  | { ok: true; txHash: `0x${string}`; explorerUrl: string; refilledAtomic: bigint; breakerTripped: boolean }
  | { ok: false; status: number; error: string; reason: Reason; detail?: string }

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
}

const nowSecs = () => Math.floor(Date.now() / 1000)
const big = (v: unknown) => BigInt(String(v ?? '0'))

/** Top one card's spend buffer back toward its computed target, bounded by the refill-rate breaker.
 *  Idempotent per attempt: a card_buffer_refills row is created first and its uuid seeds the on-chain
 *  refillId (keccak256), so the Gateway's refillDone[refillId] guard makes a duplicate submit a no-op.
 *
 *  `trigger` is recorded on the ledger row: 'reactive' (capture webhook) | 'cron' | 'manual'. */
export async function refillCardBuffer(opts: {
  supabase: SupabaseClient
  orgId: string
  orgCardId: string
  trigger?: 'reactive' | 'cron' | 'manual'
  log?: Logger
}): Promise<RefillOutcome> {
  const { supabase, orgId, orgCardId, log } = opts
  const trigger = opts.trigger ?? 'reactive'

  // ── dark-launch master gate (fail-closed, OFF by default) ──
  if (process.env.CARD_BUFFER_REFILL_ENABLED !== 'true') {
    return { ok: false, status: 503, error: 'card buffer refill is not enabled', reason: 'disabled' }
  }

  const { data: org } = await supabase
    .from('orgs')
    .select('treasury_vault_address, treasury_chain_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org?.treasury_vault_address || !org.treasury_chain_id) {
    return { ok: false, status: 409, error: 'treasury not set up yet', reason: 'config' }
  }

  const { data: buf } = await supabase
    .from('card_spend_buffers')
    .select('*')
    .eq('org_card_id', orgCardId)
    .maybeSingle()
  if (!buf) return { ok: false, status: 404, error: 'no buffer configured for this card', reason: 'not_found' }
  if (!buf.auto_refill_enabled) return { ok: false, status: 409, error: 'auto-refill disabled for this card', reason: 'not_enabled' }
  if (!buf.buffer_address) return { ok: false, status: 409, error: 'card buffer wallet not registered on-chain', reason: 'no_buffer' }

  // ── compute the target from the (agent-tuned) sizing inputs, then the refill deficit ──
  const sizing: BufferSizingParams = {
    meanDemandLeadTimeAtomic: big(buf.mean_demand_leadtime_atomic),
    demandStdevAtomic: big(buf.demand_stdev_atomic),
    sigmaPeriodSecs: Number(buf.sigma_period_secs),
    leadTimeSecs: Number(buf.lead_time_secs),
    serviceLevelBps: Number(buf.service_level_bps),
  }
  const target = bufferTargetAtomic(sizing)

  const plan = refillPlan({
    bufferBalanceAtomic: big(buf.buffer_balance_atomic),
    targetAtomic: target,
    minRefillAtomic: big(buf.min_refill_atomic),
  })
  // persist the freshly-computed target regardless (cheap, keeps the row honest)
  await supabase.from('card_spend_buffers').update({ buffer_target_atomic: target.toString(), updated_at: new Date().toISOString() }).eq('id', buf.id)
  if (!plan.shouldRefill) return { ok: false, status: 200, error: 'buffer already at or above target', reason: 'at_target' }

  // ── refill-rate circuit breaker ──
  const rateState: RefillRateState = {
    windowStartSecs: Number(buf.refill_window_start_secs),
    refilledInWindowAtomic: big(buf.refilled_in_window_atomic),
  }
  const rate = checkRefillRate(
    rateState,
    plan.refillAmountAtomic,
    { capAtomic: big(buf.refill_rate_cap_atomic), windowSecs: Number(buf.refill_window_secs), breakerOpen: !!buf.breaker_open },
    nowSecs(),
  )
  if (!rate.allowed || rate.allowedAmountAtomic <= 0n) {
    // persist the rolled window even on a hard block, and log the trip
    await supabase.from('card_spend_buffers').update({
      refill_window_start_secs: rate.nextState.windowStartSecs,
      refilled_in_window_atomic: rate.nextState.refilledInWindowAtomic.toString(),
      updated_at: new Date().toISOString(),
    }).eq('id', buf.id)
    await supabase.from('card_buffer_refills').insert({
      org_card_id: orgCardId, member_wallet: buf.member_wallet, refill_id: 'ratecap:' + keccak256(toBytes(`${buf.id}:${nowSecs()}`)),
      amount_atomic: plan.refillAmountAtomic.toString(), status: 'rate_capped', breaker_tripped: true, trigger, reason: 'refill-rate cap / breaker',
    })
    return { ok: false, status: 429, error: 'refill-rate cap reached (or breaker open)', reason: 'rate_capped' }
  }
  const refillAmount = rate.allowedAmountAtomic

  // ── card permit (the member's standing consent to burn their shares) ──
  const { data: card } = await supabase
    .from('org_cards')
    .select('permit_max_daily_usdc, permit_nonce, permit_deadline, permit_signature')
    .eq('id', orgCardId).single()
  if (!card?.permit_signature) return { ok: false, status: 409, error: 'card not activated — member must sign a standing permit first', reason: 'not_activated' }
  const permitDeadline = big(card.permit_deadline)
  if (permitDeadline <= BigInt(nowSecs())) return { ok: false, status: 409, error: 'the member’s standing permit has expired', reason: 'permit_expired' }
  if (!isHex(card.permit_signature)) return { ok: false, status: 500, error: 'stored permit signature is malformed', reason: 'permit_malformed' }

  const rpcUrl = rpcForChain(org.treasury_chain_id)
  const chain = viemChainFor(org.treasury_chain_id)
  if (!rpcUrl || !chain) return { ok: false, status: 400, error: 'unsupported chain', reason: 'chain' }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  let gateway: `0x${string}`
  try {
    gateway = (await publicClient.readContract({
      address: org.treasury_vault_address as `0x${string}`, abi: VAULT_ABI, functionName: 'gateway',
    })) as `0x${string}`
  } catch {
    return { ok: false, status: 502, error: 'treasury_read_failed', reason: 'read' }
  }

  let account
  try {
    account = await getOracleSigner('root')
  } catch (e) {
    log?.error('cards.refill', 'oracle signer unavailable', { error: String(e) })
    return { ok: false, status: 503, error: 'refill_signer_unavailable', reason: 'signer' }
  }
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })

  // Create the ledger row first — its uuid seeds a stable, idempotent on-chain refillId.
  const { data: ledger, error: insErr } = await supabase.from('card_buffer_refills').insert({
    org_card_id: orgCardId, member_wallet: buf.member_wallet, refill_id: 'pending',
    amount_atomic: refillAmount.toString(), status: 'pending', breaker_tripped: rate.breakerTripped, trigger,
  }).select('id').single()
  if (insErr || !ledger) return { ok: false, status: 500, error: 'could not open refill ledger row', reason: 'config', detail: String(insErr?.message) }
  const refillId = keccak256(toBytes(String(ledger.id)))
  await supabase.from('card_buffer_refills').update({ refill_id: refillId }).eq('id', ledger.id)

  const permit = {
    user: buf.member_wallet as `0x${string}`,
    maxDailySpendUSDC: big(card.permit_max_daily_usdc),
    nonce: big(card.permit_nonce),
    deadline: permitDeadline,
  }

  let txHash: `0x${string}`
  try {
    txHash = await walletClient.writeContract({
      address: gateway, abi: GATEWAY_ABI, functionName: 'refillBuffer',
      args: [refillId, permit.user, refillAmount, permit, card.permit_signature as `0x${string}`],
      account, chain, gas: 700_000n,
    })
    // A mined tx is not a successful tx — refillBuffer can revert (status 0) and still be included.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      await supabase.from('card_buffer_refills').update({ status: 'failed', tx_hash: txHash, reason: 'reverted on-chain' }).eq('id', ledger.id)
      return { ok: false, status: 502, error: 'refill_reverted', reason: 'tx', detail: txHash }
    }
  } catch (e) {
    await supabase.from('card_buffer_refills').update({ status: 'failed', reason: String(e) }).eq('id', ledger.id)
    log?.error('cards.refill', 'refillBuffer failed', { error: String(e) })
    return { ok: false, status: 502, error: 'refill_failed', reason: 'tx', detail: String(e) }
  }

  // ── success: advance the rate window, optimistically credit the cached balance (the monitor
  //    reconciles against on-chain), and close the ledger row. ──
  await supabase.from('card_buffer_refills')
    .update({ status: 'confirmed', tx_hash: txHash, confirmed_at: new Date().toISOString() })
    .eq('id', ledger.id)
  await supabase.from('card_spend_buffers').update({
    buffer_balance_atomic: (big(buf.buffer_balance_atomic) + refillAmount).toString(),
    refill_window_start_secs: rate.nextState.windowStartSecs,
    refilled_in_window_atomic: rate.nextState.refilledInWindowAtomic.toString(),
    last_refill_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', buf.id)

  const explorerUrl = (org.treasury_chain_id === 5042002 ? 'https://testnet.arcscan.app/tx/' : 'https://sepolia.basescan.org/tx/') + txHash
  return { ok: true, txHash, explorerUrl, refilledAtomic: refillAmount, breakerTripped: rate.breakerTripped }
}
