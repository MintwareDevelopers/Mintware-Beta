import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayPublicClient } from '@/lib/gateway/chain'
import { listMarketEngines, marketEngineConfig, resolveMarketEngine } from '@/lib/gateway/marketEngine'
import { MARKET_ENGINE_ABI } from '@/lib/web3/artifacts/marketEngine'
import { createTokenBucket } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'
const ipBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5, maxKeys: 5_000 })
export const GET = createHandler(async (req, ctx) => {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  if (!ipBucket.take(ip)) return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  const cfg = marketEngineConfig()
  if (!cfg) return ctx.json({ success: false, error: 'market_engine_not_configured' }, 503)
  const address = req.nextUrl.searchParams.get('address')?.toLowerCase()
  if (!address || !isAddress(address)) return ctx.json({ success: false, error: 'address_required' }, 400)
  const rows = await listMarketEngines(ctx.supabase, cfg.chainId, false)
  const fallback = rows.length === 0 ? await resolveMarketEngine(ctx.supabase, cfg, null) : null
  const instances = fallback ? [fallback] : rows
  const { data: recordedEvents } = await ctx.supabase.from('market_engine_tx_events').select('pool_address,market_engine_address').eq('user_wallet', address).eq('chain_id', cfg.chainId)
  const recordedKeys = new Set((recordedEvents ?? []).map((e: { pool_address: string; market_engine_address: string }) => `${e.pool_address.toLowerCase()}:${e.market_engine_address.toLowerCase()}`))
  const client = gatewayPublicClient(cfg)
  const outcomes = await Promise.all(instances.filter((x) => x.verified).map(async (inst) => {
    try {
      const [shares, supply, nav] = await Promise.all([
        client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] }),
        client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'totalSupply' }),
        client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'totalNav' }),
      ])
      if (BigInt(shares) === 0n) return { ok: true as const, position: null }
      const value = BigInt(supply) === 0n ? 0n : BigInt(shares) * BigInt(nav) / BigInt(supply)
      return { ok: true as const, position: { poolAddress: inst.poolAddress, marketEngine: inst.engineAddress, positionManager: inst.engineAddress, pairLabel: inst.pairLabel ?? inst.poolAddress.slice(0, 12), chainId: inst.chainId, shares: String(shares), positionValueAtomic: value.toString(), costBasisAtomic: null, unrealizedPnlAtomic: null, recorded: recordedKeys.has(`${inst.poolAddress.toLowerCase()}:${inst.engineAddress.toLowerCase()}`), costBasisComplete: true, source: 'source' in inst ? inst.source : 'registry', live: inst.status === 'active' && !('source' in inst && inst.source === 'env-fallback'), bufferBalanceAtomic: null, sourceReadable: true } }
    } catch (e) { ctx.log.warn('market-engine.positions', 'chain read failed', { pool: inst.poolAddress, error: String(e) }); return { ok: false as const, poolAddress: inst.poolAddress } }
  }))
  const positions = outcomes.flatMap((x) => x.ok && x.position ? [x.position] : [])
  const failedPools = outcomes.flatMap((x) => x.ok ? [] : [x.poolAddress])
  return ctx.json({ success: true, positions, complete: failedPools.length === 0, failedPools })
})
