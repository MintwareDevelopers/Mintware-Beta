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
  let engines: MarketEngineInstance[]
  try {
    engines = await listMarketEngines(ctx.supabase, cfg.chainId, false)
    if (engines.length === 0) {
      const fallback = await resolveMarketEngine(ctx.supabase, cfg, pool, true)
      if (fallback) engines = [fallback]
    }
  } catch { return ctx.json({ success: false, error: 'registry_unavailable' }, 503) }
  let amount0 = 0n; let amount1 = 0n; let sharesMinted = 0n; let found = false
  let inst: MarketEngineInstance | undefined
  for (const log of receipt.logs) {
    const candidate = engines.find((engine) => engine.verified && engine.poolAddress === pool?.toLowerCase() && engine.engineAddress === log.address.toLowerCase())
    if (!candidate) continue
    try {
      const event = decodeEventLog({ abi: MARKET_ENGINE_ABI, data: log.data, topics: log.topics })
      if (event.eventName === 'Deposited' && String(event.args.account).toLowerCase() === address) {
        inst = candidate; amount0 = event.args.amount0; amount1 = event.args.amount1; sharesMinted = event.args.shares; found = true; break
      }
    } catch { /* unrelated engine log */ }
  }
  if (!found || !inst) return ctx.json({ success: false, error: 'no_deposit_event' }, 400)
  const onChainShares = await client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] })
  const { error } = await ctx.supabase.from('market_engine_tx_events').insert({ tx_hash: txHash, user_wallet: address, pool_address: inst.poolAddress, chain_id: inst.chainId, market_engine_address: inst.engineAddress, action: 'deposit', shares_atomic: sharesMinted.toString(), amount0_atomic: amount0.toString(), amount1_atomic: amount1.toString(), block_number: receipt.blockNumber.toString(), transaction_index: receipt.transactionIndex })
  if (error && error.code !== '23505') { ctx.log.error('market-engine.deposit', 'position record failed', { error: error.message }); return ctx.json({ success: false, error: 'record_failed' }, 500) }
  return ctx.json({ success: true, sharesMinted: sharesMinted.toString(), shares: BigInt(onChainShares).toString(), idempotentReplay: Boolean(error) })
}, { auth: 'signed-message', action: 'mintware-gateway-deposit' })
