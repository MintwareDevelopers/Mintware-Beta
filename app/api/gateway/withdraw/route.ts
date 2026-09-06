import { isAddress, isHex, decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveRouteInstance } from '@/lib/gateway/registry'

export const dynamic = 'force-dynamic'

// Principal withdrawal — separate from spend, and explicitly subject to the current pool price / IL:
// the client tx returns the depositor's pro-rata of BOTH legs, no par claim. This route verifies that
// client tx and syncs gateway_positions (shares from chain, cost basis reduced proportionally).
export const POST = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const body = (await req.json().catch(() => ({}))) as { address?: string; txHash?: string; pool?: string }
  const address = body.address?.toLowerCase()
  const txHash = body.txHash
  if (!address || !isAddress(address)) return ctx.json({ success: false, error: 'address_required' }, 400)
  if (!txHash || !isHex(txHash)) return ctx.json({ success: false, error: 'txHash_required' }, 400)

  const inst = await resolveRouteInstance(ctx.supabase, cfg, body.pool ?? null)
  if (!inst) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

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

  const { data: existing } = await ctx.supabase
    .from('gateway_positions')
    .select('id, entry_nav')
    .eq('user_wallet', address)
    .eq('pool_address', inst.poolAddress)
    .eq('chain_id', inst.chainId)
    .maybeSingle()

  // Reduce cost basis proportionally to the shares burned (fully exit ⇒ 0).
  const priorBasis = existing?.entry_nav != null ? BigInt(String(existing.entry_nav)) : 0n
  const priorShares = onChainShares + sharesBurned
  const newBasis = onChainShares === 0n || priorShares === 0n ? 0n : (priorBasis * onChainShares) / priorShares

  if (existing?.id) {
    await ctx.supabase
      .from('gateway_positions')
      .update({ shares: onChainShares.toString(), entry_nav: newBasis.toString(), updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  }

  return ctx.json({ success: true, sharesBurned, quoteOut, pairedOut, shares: onChainShares, costBasisAtomic: newBasis })
})
