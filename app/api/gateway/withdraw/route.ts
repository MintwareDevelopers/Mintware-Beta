import { decodeEventLog } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { marketEnginePublicClient } from '@/lib/gateway/chain'
import { listMarketEngines, marketEngineConfig, resolveMarketEngine, type MarketEngineInstance } from '@/lib/gateway/marketEngine'
import { MARKET_ENGINE_ABI } from '@/lib/web3/artifacts/marketEngine'
import { bindSignedRecord } from '@/lib/gateway/recordAuth'

export const dynamic = 'force-dynamic'
export const POST = createHandler(async (req, ctx) => {
  const cfg = marketEngineConfig()
  if (!cfg) return ctx.json({ success: false, error: 'market_engine_not_configured' }, 503)
  const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>
  const address = ctx.user!.address
  const bound = bindSignedRecord(body)
  if (!bound.ok) return ctx.json({ success: false, error: bound.error }, bound.error === 'auth_replayed' ? 409 : bound.error === 'txHash_required' ? 400 : 401)
  const { txHash, pool } = bound.bound
  const client = marketEnginePublicClient(cfg)
  let receipt
  try { receipt = await client.getTransactionReceipt({ hash: txHash }) } catch { return ctx.json({ success: false, error: 'tx_not_found' }, 404) }
  if (receipt.status !== 'success') return ctx.json({ success: false, error: 'tx_reverted' }, 400)
  if (!receipt.to) return ctx.json({ success: false, error: 'wrong_contract' }, 400)
  let inst: MarketEngineInstance | null = null
  try {
    const rows = await listMarketEngines(ctx.supabase, cfg.chainId, false)
    inst = rows.find((x) => x.poolAddress === pool?.toLowerCase() && x.engineAddress === receipt.to!.toLowerCase()) ?? null
    if (!inst && rows.length === 0) {
      const fallback = await resolveMarketEngine(ctx.supabase, cfg, pool, true)
      if (fallback?.engineAddress === receipt.to.toLowerCase()) inst = fallback
    }
  } catch { return ctx.json({ success: false, error: 'registry_unavailable' }, 503) }
  if (!inst?.verified) return ctx.json({ success: false, error: 'pool_not_live' }, 404)
  let sharesBurned = 0n; let amount0 = 0n; let amount1 = 0n; let found = false
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== inst.engineAddress.toLowerCase()) continue
    try {
      const event = decodeEventLog({ abi: MARKET_ENGINE_ABI, data: log.data, topics: log.topics })
      if (event.eventName === 'Withdrawn' && String(event.args.account).toLowerCase() === address && String(event.args.recipient).toLowerCase() === address) {
        sharesBurned = event.args.sharesBurned; amount0 = event.args.amount0; amount1 = event.args.amount1; found = true; break
      }
    } catch { /* unrelated engine log */ }
  }
  if (!found) return ctx.json({ success: false, error: 'no_withdraw_event' }, 400)
  const onChainShares = await client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`], blockNumber: receipt.blockNumber })
  const { error } = await ctx.supabase.from('market_engine_tx_events').insert({ tx_hash: txHash, user_wallet: address, pool_address: inst.poolAddress, chain_id: inst.chainId, market_engine_address: inst.engineAddress, action: 'withdraw', shares_atomic: sharesBurned.toString(), amount0_atomic: amount0.toString(), amount1_atomic: amount1.toString(), block_number: receipt.blockNumber.toString(), transaction_index: receipt.transactionIndex })
  if (error && error.code !== '23505') { ctx.log.error('market-engine.withdraw', 'position record failed', { error: error.message }); return ctx.json({ success: false, error: 'record_failed' }, 500) }
  return ctx.json({ success: true, sharesBurned: sharesBurned.toString(), amount0: amount0.toString(), amount1: amount1.toString(), shares: BigInt(onChainShares).toString(), idempotentReplay: Boolean(error) })
}, { auth: 'signed-message', action: 'mintware-gateway-withdraw' })
