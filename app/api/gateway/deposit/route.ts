import { isAddress, isHex, decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'

export const dynamic = 'force-dynamic'

// Non-custodial: the depositor's own wallet sends deposit() (mints shares in the position manager).
// This route VERIFIES that client tx on-chain and mirrors the result into gateway_positions so the
// harvest cron knows the depositor set + shares, and the dashboard has a cost basis. No custody.
export const POST = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const body = (await req.json().catch(() => ({}))) as { address?: string; txHash?: string }
  const address = body.address?.toLowerCase()
  const txHash = body.txHash
  if (!address || !isAddress(address)) return ctx.json({ success: false, error: 'address_required' }, 400)
  if (!txHash || !isHex(txHash)) return ctx.json({ success: false, error: 'txHash_required' }, 400)

  const client = gatewayPublicClient(cfg)
  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash })
  } catch {
    return ctx.json({ success: false, error: 'tx_not_found' }, 404)
  }
  if (receipt.status !== 'success') return ctx.json({ success: false, error: 'tx_reverted' }, 400)
  if (receipt.to?.toLowerCase() !== cfg.positionManager.toLowerCase()) {
    return ctx.json({ success: false, error: 'wrong_contract' }, 400)
  }

  // The Deposited event, emitted by THIS position manager, for THIS user, is the trust anchor.
  let quoteIn = 0n
  let sharesMinted = 0n
  let found = false
  for (const lg of receipt.logs) {
    if (lg.address.toLowerCase() !== cfg.positionManager.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: LP_GATEWAY_ABI, data: lg.data, topics: lg.topics })
      if (ev.eventName === 'Deposited' && String(ev.args.user).toLowerCase() === address) {
        quoteIn = ev.args.quoteIn as bigint
        sharesMinted = ev.args.sharesMinted as bigint
        found = true
        break
      }
    } catch {
      /* not a gateway event */
    }
  }
  if (!found) return ctx.json({ success: false, error: 'no_deposit_event' }, 400)

  const onChainShares = (await client.readContract({
    address: cfg.positionManager,
    abi: LP_GATEWAY_ABI,
    functionName: 'sharesOf',
    args: [address as `0x${string}`],
  })) as bigint

  const { data: existing } = await ctx.supabase
    .from('gateway_positions')
    .select('entry_nav')
    .eq('user_wallet', address)
    .eq('pool_address', cfg.poolAddress)
    .eq('chain_id', cfg.chainId)
    .maybeSingle()
  const costBasis = (existing?.entry_nav != null ? BigInt(String(existing.entry_nav)) : 0n) + quoteIn

  const { error } = await ctx.supabase.from('gateway_positions').upsert(
    {
      user_wallet: address,
      pool_address: cfg.poolAddress,
      chain_id: cfg.chainId,
      shares: onChainShares.toString(),
      entry_nav: costBasis.toString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_wallet,pool_address,chain_id' },
  )
  if (error) {
    ctx.log.error('gateway.deposit', 'upsert failed', { error: error.message })
    return ctx.json({ success: false, error: 'record_failed' }, 500)
  }

  return ctx.json({ success: true, sharesMinted, shares: onChainShares, costBasisAtomic: costBasis })
})
