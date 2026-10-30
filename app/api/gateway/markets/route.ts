import { createHandler } from '@/lib/web2/routeHandler'
import { marketEnginePublicClient } from '@/lib/gateway/chain'
import { listMarketEngines, marketEngineConfig } from '@/lib/gateway/marketEngine'
import { MARKET_ENGINE_ABI } from '@/lib/web3/artifacts/marketEngine'
import { MARKET_CHAINS } from '@/lib/chains/marketChains'
import { createTokenBucket } from '@/lib/gateway/sparkline'

export const dynamic = 'force-dynamic'

// GET /api/gateway/markets — the LIVE markets: every active, on-chain-verified MarketEngine instance in the
// registry across the market chains (Base + Robinhood), with its NAV read from chain. This is the "Live
// markets" section of Markets; the GeckoTerminal feed (/api/gateway/discover) is the mainnet watchlist.
// A chain read failure drops that market's NAV to null rather than hiding the market. Cached 30 s.

const ERC20 = [
  { type: 'function', stateMutability: 'view', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', stateMutability: 'view', name: 'symbol', inputs: [], outputs: [{ type: 'string' }] },
] as const

export type LiveMarket = {
  poolAddress: string
  chainId: number
  pairLabel: string | null
  engineAddress: string
  quoteSymbol: string | null
  quoteDecimals: number | null
  /** marked NAV in quote units (decimals applied); null when the chain read failed */
  navQuote: number | null
  feePct: number | null
  /** deposits route through the deployment's configured chain only */
  depositable: boolean
}

const TTL_MS = 30_000
let cache: { at: number; markets: LiveMarket[] } | null = null
const ipBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5, maxKeys: 5_000 })

async function readMarket(inst: Awaited<ReturnType<typeof listMarketEngines>>[number], rpcUrl: string, depositable: boolean): Promise<LiveMarket> {
  const client = marketEnginePublicClient({ chainId: inst.chainId, rpcUrl })
  const [nav, decimals, symbol, key] = await Promise.all([
    client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'totalNav' }).catch(() => null),
    client.readContract({ address: inst.quoteAsset, abi: ERC20, functionName: 'decimals' }).catch(() => null),
    client.readContract({ address: inst.quoteAsset, abi: ERC20, functionName: 'symbol' }).catch(() => null),
    client.readContract({ address: inst.engineAddress, abi: MARKET_ENGINE_ABI, functionName: 'poolKey' }).catch(() => null),
  ])
  const dec = decimals == null ? null : Number(decimals)
  const fee = key == null ? null : Number((key as { fee: number | bigint }).fee)
  return {
    poolAddress: inst.poolAddress,
    chainId: inst.chainId,
    pairLabel: inst.pairLabel,
    engineAddress: inst.engineAddress,
    quoteSymbol: symbol == null ? null : String(symbol),
    quoteDecimals: dec,
    navQuote: nav == null || dec == null ? null : Number(nav) / 10 ** dec,
    feePct: fee == null || fee >= 0x800000 ? null : fee / 10_000,
    depositable,
  }
}

export const GET = createHandler(async (req, ctx) => {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  if (!ipBucket.take(ip)) return ctx.json({ success: false, error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  if (cache && Date.now() - cache.at < TTL_MS) return ctx.json({ success: true, markets: cache.markets })

  const cfg = marketEngineConfig()
  const perChain = await Promise.all(Object.values(MARKET_CHAINS).map(async (chain) => {
    try {
      const rows = (await listMarketEngines(ctx.supabase, chain.id, true)).filter((x) => x.verified)
      const rpcUrl = cfg?.chainId === chain.id ? cfg.rpcUrl : chain.rpc
      return await Promise.all(rows.map((inst) => readMarket(inst, rpcUrl, cfg?.chainId === chain.id)))
    } catch (e) {
      ctx.log.warn('market-engine.markets', 'chain registry read failed', { chainId: chain.id, error: String(e) })
      return []
    }
  }))
  const markets = perChain.flat().sort((a, b) => (b.navQuote ?? -1) - (a.navQuote ?? -1))
  cache = { at: Date.now(), markets }
  return ctx.json({ success: true, markets })
}, { rateLimit: { max: 60, windowMs: 60_000 } })
