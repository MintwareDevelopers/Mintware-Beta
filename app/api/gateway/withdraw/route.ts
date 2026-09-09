import { decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveInstanceStrict } from '@/lib/gateway/routeInstance'
import { bindSignedRecord } from '@/lib/gateway/recordAuth'

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

  // Round-4 audit fix (Medium): same atomicity fix as the deposit route (see its comment) — one RPC
  // does the idempotency claim + proportional basis reduction under a single transaction, with the
  // reduction expressed against the row's CURRENT value at write time.
  const { data: rpcData, error: rpcErr } = await ctx.supabase.rpc('record_gateway_withdraw_event', {
    p_tx_hash: txHash,
    p_address: address,
    p_pool_address: inst.poolAddress,
    p_chain_id: inst.chainId,
    p_quote_out: quoteOut.toString(),
    p_on_chain_shares: onChainShares.toString(),
    p_shares_burned: sharesBurned.toString(),
  })
  if (rpcErr) {
    ctx.log.error('gateway.withdraw', 'record_gateway_withdraw_event failed', { error: rpcErr.message })
    return ctx.json({ success: false, error: 'record_failed' }, 500)
  }
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as { cost_basis_atomic: string | number | null; already_recorded: boolean; position_found: boolean } | undefined
  // No row ⇒ the deposit was never recorded (O-1 legacy) — the RPC deliberately does not synthesize one
  // (entry_nav defaults to 0, so a synthetic row would fabricate a "gain" equal to the whole position).
  // The Portfolio is chain-first and shows the position (basis unknown) regardless.
  const newBasis = row?.position_found && row.cost_basis_atomic != null ? BigInt(String(row.cost_basis_atomic)) : 0n
  const alreadyRecorded = row?.already_recorded ?? false

  return ctx.json({ success: true, sharesBurned, quoteOut, pairedOut, shares: onChainShares, costBasisAtomic: newBasis, idempotentReplay: alreadyRecorded })
}, { auth: 'signed-message', action: 'mintware-gateway-withdraw' })
