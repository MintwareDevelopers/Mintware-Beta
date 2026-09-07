import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveRouteInstance } from '@/lib/gateway/registry'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { readCurrentTick, type GatewayPoolKey } from '@/lib/gateway/poolState'

export const dynamic = 'force-dynamic'

const DYNAMIC_FEE_FLAG = 0x800000 // Uniswap V4: top bit set ⇒ dynamic fee (no fixed rate)

// Public: the on-chain coordinates a client needs to deposit into a pool's gateway — the position
// manager (deposit target), chain id + RPC (to submit on the right network), the USDG address (the token
// to approve), and the pool's FEE TIER (read from the V4 PoolKey) so the UI can show the real trailing
// Fee/TVL % (Est. APR) instead of a guess. Resolves the live instance for `pool`; 503 until configured.
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const inst = await resolveRouteInstance(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'))
  if (!inst) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const client = gatewayPublicClient(cfg)
  const read = (fn: 'poolKey' | 'poolManager' | 'tickLower' | 'tickUpper') =>
    client.readContract({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: fn })

  // Fee tier + range ticks + PoolManager from the position manager; then the pool's live tick via
  // extsload (poolState). Best-effort — a read failure just omits that field (never a false claim).
  let feePips: number | null = null
  let dynamicFee = false
  let inRange: boolean | null = null
  let currentTick: number | null = null
  try {
    const [key, poolManager, tickLower, tickUpper] = (await Promise.all([
      read('poolKey'), read('poolManager'), read('tickLower'), read('tickUpper'),
    ])) as [GatewayPoolKey & { fee: number | bigint }, `0x${string}`, number, number]

    const raw = Number(key.fee)
    if (Number.isFinite(raw)) {
      dynamicFee = (raw & DYNAMIC_FEE_FLAG) !== 0
      feePips = dynamicFee ? null : raw
    }
    const slot0 = await readCurrentTick({ client, poolManager, poolKey: key })
    if (slot0) {
      currentTick = slot0.tick
      inRange = slot0.tick >= Number(tickLower) && slot0.tick <= Number(tickUpper)
    }
  } catch (e) {
    ctx.log.warn('gateway.meta', 'pool state read failed', { error: String(e) })
  }

  return ctx.json({
    success: true,
    meta: {
      positionManager: inst.positionManager,
      poolAddress: inst.poolAddress,
      chainId: inst.chainId,
      rpcUrl: cfg.rpcUrl,
      usdg: process.env.LP_GATEWAY_USDG ?? null,
      feePips, // e.g. 3000 = 0.30%; null when dynamic or unreadable
      dynamicFee,
      inRange, // true/false when readable; null = unknown (earning-fees status)
      currentTick,
      live: true,
    },
  })
})
