import { isAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { marketEnginePublicClient } from '@/lib/gateway/chain'
import { marketEngineConfig, resolveMarketEngine } from '@/lib/gateway/marketEngine'
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
  const inst = await resolveMarketEngine(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'), true, req.nextUrl.searchParams.get('pm'))
  if (!inst || !inst.verified) return ctx.json({ success: false, error: 'pool_not_live' }, 404)
  try {
    const client = marketEnginePublicClient(cfg)
    const [shares, totalSupply, totalNav] = await Promise.all([
      client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] }),
      client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'totalSupply' }),
      client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'totalNav' }),
    ])
    const value = BigInt(totalSupply) === 0n ? 0n : BigInt(shares) * BigInt(totalNav) / BigInt(totalSupply)
    const { data: event } = await ctx.supabase.from('market_engine_tx_events').select('tx_hash').eq('user_wallet', address).eq('pool_address', inst.poolAddress).eq('chain_id', inst.chainId).eq('market_engine_address', inst.engineAddress).limit(1).maybeSingle()
    return ctx.json({ success: true, position: { shares: String(shares), positionValueAtomic: value.toString(), costBasisAtomic: null, unrealizedPnlAtomic: null, recorded: event != null, costBasisComplete: true, sourceReadable: true, history: [] }, poolState: null, totalNav: String(totalNav), totalSupply: String(totalSupply), source: inst.source, live: inst.live })
  } catch (e) {
    ctx.log.warn('market-engine.position', 'chain read failed', { error: String(e) })
    return ctx.json({ success: false, error: 'chain_read_failed' }, 502)
  }
})

export const POST = createHandler(async (_req, ctx) => ctx.json({ success: false, error: 'buffer_not_supported' }, 410), { auth: 'signed-message', action: 'mintware-gateway-buffer' })
