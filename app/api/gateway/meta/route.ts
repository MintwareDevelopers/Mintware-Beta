import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayPublicClient } from '@/lib/gateway/chain'
import { marketEngineConfig, resolveMarketEngine, verifyMarketEngine } from '@/lib/gateway/marketEngine'
import { MARKET_ENGINE_ABI } from '@/lib/web3/artifacts/marketEngine'
import { createTokenBucket } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'
const ipBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5, maxKeys: 5_000 })
const ERC20_DECIMALS_ABI = [{ type: 'function', stateMutability: 'view', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }] }] as const

export const GET = createHandler(async (req, ctx) => {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  if (!ipBucket.take(ip)) return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  const cfg = marketEngineConfig()
  if (!cfg) return ctx.json({ success: false, error: 'market_engine_not_configured' }, 503)
  const pm = req.nextUrl.searchParams.get('pm')
  const inst = await resolveMarketEngine(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'), Boolean(pm), pm)
  if (!inst || !inst.verified) return ctx.json({ success: false, error: 'pool_not_live' }, 404)
  const client = gatewayPublicClient(cfg)
  const verified = await verifyMarketEngine({ client, address: inst.engineAddress, expectedPool: inst.poolAddress, chainId: cfg.chainId })
  if (!verified.ok) return ctx.json({ success: false, error: 'engine_verification_failed' }, 503)
  try {
    const [d0, d1, fee, tickLower, tickUpper, activated] = await Promise.all([
      client.readContract({ address: inst.token0, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' }),
      client.readContract({ address: inst.token1, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' }),
      Promise.resolve(verified.poolKey.fee),
      client.readContract({ address: inst.engineAddress, abi: [{ type: 'function', name: 'tickLower', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] }], functionName: 'tickLower' }),
      client.readContract({ address: inst.engineAddress, abi: [{ type: 'function', name: 'tickUpper', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] }], functionName: 'tickUpper' }),
      client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'activated' }),
    ])
    if (!activated) return ctx.json({ success: false, error: 'engine_inactive' }, 404)
    return ctx.json({ success: true, meta: { engineAddress: inst.engineAddress, positionManager: inst.engineAddress, poolAddress: inst.poolAddress, pairLabel: inst.pairLabel, chainId: cfg.chainId, rpcUrl: cfg.rpcUrl, usdg: verified.quoteAsset, quoteAsset: verified.quoteAsset, token0: verified.token0, token1: verified.token1, token0Decimals: Number(d0), token1Decimals: Number(d1), pairedAsset: verified.token0.toLowerCase() === verified.quoteAsset.toLowerCase() ? verified.token1 : verified.token0, pairedDecimals: verified.token0.toLowerCase() === verified.quoteAsset.toLowerCase() ? Number(d1) : Number(d0), feePips: Number(fee), dynamicFee: false, tickLower: Number(tickLower), tickUpper: Number(tickUpper), source: inst.source, live: inst.live, verified: true, supportsMin: true } })
  } catch (e) {
    ctx.log.warn('market-engine.meta', 'engine metadata read failed', { error: String(e) })
    return ctx.json({ success: false, error: 'engine_read_failed' }, 502)
  }
}, { rateLimit: { max: 30, windowMs: 60_000 } })
