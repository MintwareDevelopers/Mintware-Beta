import { decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveInstanceStrict } from '@/lib/gateway/routeInstance'
import { bindSignedRecord } from '@/lib/gateway/recordAuth'
import { nextWithdrawBasis } from '@/lib/gateway/basisMath'

export const dynamic = 'force-dynamic'

// Principal withdrawal — separate from spend, and explicitly subject to the current pool price / IL:
// the client tx returns the depositor's pro-rata of BOTH legs, no par claim. This route verifies that
// client tx and syncs gateway_positions (shares from chain, cost basis reduced proportionally).
//
// M-04 (security review 2026-09-06): signed-message (action-bound) so only the owner records their own
// tx (the Withdrawn event's user must equal the recovered signer), and the proportional basis reduction
// is idempotent per tx_hash (gateway_deposit_events UNIQUE) so a replayed txHash can't deflate it twice.
// O-10 (round-2): signed txHash/pool strict-compared to the body; single-use signature (`bindSignedRecord`).
// O-2: strict pool resolution (404 on a miss while the registry is populated).
export const POST = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>
  const address = ctx.user!.address
  const bound = bindSignedRecord(body)
  if (!bound.ok) {
    if (bound.error === 'txHash_required') return ctx.json({ success: false, error: 'txHash_required' }, 400)
    if (bound.error === 'auth_replayed') return ctx.json({ success: false, error: 'auth_replayed' }, 409)
    return ctx.json({ success: false, error: 'auth_payload_mismatch' }, 401)
  }
  const { txHash, pool } = bound.bound

  const r = await resolveInstanceStrict(ctx.supabase, cfg, pool)
  if (!r.ok) return ctx.json({ success: false, error: r.error }, r.status)
  const inst = r.inst

  const client = gatewayPublicClient(cfg)
  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash })
  } catch {
    return ctx.json({ success: false, error: 'tx_not_found' }, 404)
  }
  if (receipt.status !== 'success') return ctx.json({ success: false, error: 'tx_reverted' }, 400)
  if (receipt.to?.toLowerCase() !== inst.positionManager.toLowerCase()) {
    return ctx.json({ success: false, error: 'wrong_contract' }, 400)
  }

  let sharesBurned = 0n
  let quoteOut = 0n
  let pairedOut = 0n
  let found = false
  for (const lg of receipt.logs) {
    if (lg.address.toLowerCase() !== inst.positionManager.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: LP_GATEWAY_ABI, data: lg.data, topics: lg.topics })
      if (ev.eventName === 'Withdrawn' && String(ev.args.user).toLowerCase() === address) {
        sharesBurned = ev.args.sharesBurned as bigint
        quoteOut = ev.args.quoteOut as bigint
        pairedOut = ev.args.pairedOut as bigint
        found = true
        break
      }
    } catch {
      /* not a gateway event */
    }
  }
  if (!found) return ctx.json({ success: false, error: 'no_withdraw_event' }, 400)

  const onChainShares = (await client.readContract({
    address: inst.positionManager,
    abi: LP_GATEWAY_ABI,
    functionName: 'sharesOf',
    args: [address as `0x${string}`],
  })) as bigint

  // Idempotency gate: claim this tx BEFORE reducing the basis. A UNIQUE(tx_hash) conflict means the
  // withdraw was already recorded → the proportional reduction is skipped so a replay can't deflate the
  // basis repeatedly (which would fabricate a growing "loss" on the dashboard).
  const { error: evErr } = await ctx.supabase.from('gateway_deposit_events').insert({
    tx_hash: txHash,
    address,
    kind: 'withdraw',
    pool_address: inst.poolAddress,
    chain_id: inst.chainId,
    quote_out: quoteOut.toString(),
  })
  const alreadyRecorded = evErr?.code === '23505'
  if (evErr && !alreadyRecorded) {
    ctx.log.error('gateway.withdraw', 'event insert failed', { error: evErr.message })
    return ctx.json({ success: false, error: 'record_failed' }, 500)
  }

  const { data: existing } = await ctx.supabase
    .from('gateway_positions')
    .select('id, entry_nav')
    .eq('user_wallet', address)
    .eq('pool_address', inst.poolAddress)
    .eq('chain_id', inst.chainId)
    .maybeSingle()

  // Reduce cost basis proportionally to the shares burned (fully exit ⇒ 0); unchanged on a replay.
  const priorBasis = existing?.entry_nav != null ? BigInt(String(existing.entry_nav)) : 0n
  const newBasis = nextWithdrawBasis(priorBasis, onChainShares, sharesBurned, alreadyRecorded)

  if (existing?.id) {
    // Shares always sync to on-chain truth; basis stays put on a replay.
    await ctx.supabase
      .from('gateway_positions')
      .update({ shares: onChainShares.toString(), entry_nav: newBasis.toString(), updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  }
  // No row ⇒ the deposit was never recorded (O-1 legacy). Deliberately NOT creating one here: entry_nav
  // is NOT NULL DEFAULT 0, so a synthetic row would fabricate a "gain" equal to the whole position. The
  // Portfolio is chain-first and shows the position (basis unknown) regardless.

  return ctx.json({ success: true, sharesBurned, quoteOut, pairedOut, shares: onChainShares, costBasisAtomic: newBasis, idempotentReplay: alreadyRecorded })
}, { auth: 'signed-message', action: 'mintware-gateway-withdraw' })
