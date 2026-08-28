// Shared card-settlement core — the exact settleSpend() call proven live (lib/proof/latestRun.ts leg 3,
// tx 0x7fd4b3f0…), extracted so BOTH the owner-clicked "Settle" button
// (app/api/orgs/[id]/cards/settle) AND the automatic capture webhook
// (app/api/cards/lithic/capture-webhook) run the identical code. No auth here — the CALLER decides
// who may invoke it (the button is owner-gated; the webhook is gated by Lithic signature + an explicit
// enable flag + a low auto-settle ceiling). This function only settles an already-approved swipe.
//
// It still moves real on-chain funds via the oracle/Privy signer in the RELAYER_ROLE seat
// (getOracleSigner('root')) — the same on-demand demo-settlement pattern, NOT a new always-on relayer.

import { createPublicClient, createWalletClient, http, keccak256, toBytes, zeroAddress, isHex } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { rpcForChain } from '@/lib/org/treasuryReader'
import { viemChainFor } from '@/lib/web3/chains'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { VAULT_ABI, GATEWAY_ABI } from '@/lib/web3/artifacts/treasuryV2'

/** $250 (6dp). At/above this, settleSpend also needs an edge-auth-signed ShortLivedHoldAuth, which
 *  neither the button nor the webhook builds — so this is a hard ceiling for BOTH paths. */
export const CARD_HIGH_VALUE_THRESHOLD = 250_000_000n

type Reason =
  | 'not_found' | 'not_approved' | 'already_settled' | 'over_threshold' | 'over_auto_cap'
  | 'not_activated' | 'permit_expired' | 'permit_malformed' | 'config' | 'chain' | 'read' | 'signer' | 'tx'

export type SettleOutcome =
  | { ok: true; txHash: `0x${string}`; explorerUrl: string; amountAtomicUsdc: bigint }
  | { ok: false; status: number; error: string; reason: Reason; detail?: string }

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) => void
}

/** Settle one approved, unsettled swipe event on-chain. Idempotent: the `settled` flag below and the
 *  deterministic `holdId = keccak256(event.id)` (holds[holdId].settled reverts a second attempt
 *  on-chain) both prevent a double-settle, so a duplicate webhook delivery is safe.
 *
 *  @param maxAtomicUsdc  optional LOWER ceiling than CARD_HIGH_VALUE_THRESHOLD — the auto-settle
 *                        safety valve. When set, an event above it is refused (`over_auto_cap`) so it
 *                        falls through to manual review instead of settling unsupervised. */
export async function settleSwipeEvent(opts: {
  supabase: SupabaseClient
  orgId: string
  eventId: string
  log?: Logger
  maxAtomicUsdc?: bigint
}): Promise<SettleOutcome> {
  const { supabase, orgId, eventId, log, maxAtomicUsdc } = opts

  const { data: org } = await supabase
    .from('orgs')
    .select('treasury_vault_address, treasury_chain_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org?.treasury_vault_address || !org.treasury_chain_id) {
    return { ok: false, status: 409, error: 'treasury not set up yet', reason: 'config' }
  }

  const { data: event } = await supabase
    .from('card_swipe_events')
    .select('id, org_card_id, member_wallet, amount_atomic_usdc, decision, settled')
    .eq('id', eventId).eq('org_id', orgId).maybeSingle()
  if (!event) return { ok: false, status: 404, error: 'event not found', reason: 'not_found' }
  if (event.decision !== 'approved') return { ok: false, status: 409, error: 'only approved swipes can settle', reason: 'not_approved' }
  if (event.settled) return { ok: false, status: 409, error: 'already settled', reason: 'already_settled' }

  const amountUSDC = BigInt(event.amount_atomic_usdc)
  if (amountUSDC >= CARD_HIGH_VALUE_THRESHOLD) {
    return { ok: false, status: 501, error: 'over $250 needs an edge-signed authorization leg — not wired yet', reason: 'over_threshold' }
  }
  // Auto-settle safety valve: above the configured ceiling, refuse so it goes to manual review.
  if (maxAtomicUsdc !== undefined && amountUSDC > maxAtomicUsdc) {
    return { ok: false, status: 409, error: 'above auto-settle ceiling — left for manual review', reason: 'over_auto_cap' }
  }

  const { data: card } = await supabase
    .from('org_cards')
    .select('permit_max_daily_usdc, permit_nonce, permit_deadline, permit_signature')
    .eq('id', event.org_card_id).single()
  if (!card?.permit_signature) return { ok: false, status: 409, error: 'card not activated — the member must sign a standing permit first', reason: 'not_activated' }
  const permitDeadline = BigInt(card.permit_deadline)
  if (permitDeadline <= BigInt(Math.floor(Date.now() / 1000))) {
    return { ok: false, status: 409, error: 'the member’s standing permit has expired — they must re-activate', reason: 'permit_expired' }
  }
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
    log?.error('cards.settle', 'oracle signer unavailable', { error: String(e) })
    return { ok: false, status: 503, error: 'settlement_signer_unavailable', reason: 'signer' }
  }
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })

  const holdId = keccak256(toBytes(event.id))
  const permit = {
    user: event.member_wallet as `0x${string}`,
    maxDailySpendUSDC: BigInt(card.permit_max_daily_usdc),
    nonce: BigInt(card.permit_nonce),
    deadline: permitDeadline,
  }
  const emptyEdgeAuth = { holdId: ('0x' + '0'.repeat(64)) as `0x${string}`, user: zeroAddress, amountUSDC: 0n, nonce: 0n, expiry: 0n }

  let txHash: `0x${string}`
  try {
    txHash = await walletClient.writeContract({
      address: gateway, abi: GATEWAY_ABI, functionName: 'settleSpend',
      args: [holdId, permit.user, amountUSDC, zeroAddress, permit, card.permit_signature as `0x${string}`, emptyEdgeAuth, '0x'],
      account, chain, gas: 700_000n,
    })
    // A tx that MINES is not a tx that SUCCEEDED — settleSpend can revert (e.g. the submitter lacks
    // RELAYER_ROLE, or the permit is stale) and still be included with status 0. Treat a reverted
    // receipt as a failure and DO NOT mark the event settled, or the feed lies (an unspent swipe
    // shows as paid, and the on-chain hold is never actually consumed).
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      log?.error('cards.settle', 'settleSpend reverted on-chain', { txHash })
      return { ok: false, status: 502, error: 'settle_reverted', reason: 'tx', detail: txHash }
    }
  } catch (e) {
    log?.error('cards.settle', 'settleSpend failed', { error: String(e) })
    return { ok: false, status: 502, error: 'settle_failed', reason: 'tx', detail: String(e) }
  }

  await supabase.from('card_swipe_events')
    .update({ settled: true, settle_tx: txHash, settled_at: new Date().toISOString() })
    .eq('id', eventId)

  const explorerUrl = 'https://sepolia.basescan.org/tx/' + txHash
  return { ok: true, txHash, explorerUrl, amountAtomicUsdc: amountUSDC }
}
