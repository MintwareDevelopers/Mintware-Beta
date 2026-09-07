// LP-gateway circuit breaker (Krystal item 13, off-chain keeper). When enabled, a FIRING out-of-range
// alert (debounced, item 11) auto-flips the gateway's on-chain `paused` flag via the oracle signer — no
// new capital enters a pool that's stopped earning. It NEVER auto-unpauses (re-opening a just-recovered
// pool is a human decision) and never touches the deployed position (withdraw stays open regardless).
// OFF by default (LP_GATEWAY_CIRCUIT_BREAKER_ENABLED); needs the setPaused-capable contract (redeploy).

import { createWalletClient, http } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listActiveInstances } from '@/lib/gateway/registry'
import { circuitBreakerEnabled } from '@/lib/gateway/opsConfig'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = {
  info: (t: string, m: string, c?: Record<string, unknown>) => void
  warn: (t: string, m: string, c?: Record<string, unknown>) => void
}

export async function runCircuitBreaker(opts: { supabase: SupabaseClient; log?: Logger }): Promise<{ paused: number }> {
  if (!circuitBreakerEnabled()) return { paused: 0 }
  const cfg = gatewayConfig()
  if (!cfg) return { paused: 0 }

  const { data: fires } = await opts.supabase
    .from('gateway_alerts')
    .select('pool_address, chain_id')
    .eq('kind', 'out_of_range').eq('firing', true).is('resolved_at', null)
  if (!fires?.length) return { paused: 0 }

  const active = await listActiveInstances(opts.supabase, cfg.chainId)
  const byPool = new Map(active.map((i) => [`${i.poolAddress.toLowerCase()}:${i.chainId}`, { positionManager: i.positionManager, poolAddress: i.poolAddress, chainId: i.chainId }]))
  const resolve = (pool: string, chainId: number) =>
    byPool.get(`${pool.toLowerCase()}:${chainId}`) ??
    (cfg.positionManager && cfg.poolAddress && cfg.poolAddress === pool.toLowerCase() ? { positionManager: cfg.positionManager, poolAddress: cfg.poolAddress, chainId: cfg.chainId } : null)

  let account
  try {
    account = await getOracleSigner('gateway') // dedicated gateway-owner seat (re-audit A-3)
  } catch (e) {
    opts.log?.warn('gateway.breaker', 'oracle signer unavailable', { error: String(e) })
    return { paused: 0 }
  }
  const client = gatewayPublicClient(cfg)
  const wallet = createWalletClient({ account, chain: client.chain, transport: http(cfg.rpcUrl) })

  let paused = 0
  for (const f of fires as Array<{ pool_address: string; chain_id: number }>) {
    const inst = resolve(String(f.pool_address), Number(f.chain_id))
    if (!inst) continue
    try {
      const already = (await client.readContract({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: 'paused' })) as boolean
      if (already) continue
      const h = await wallet.writeContract({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: 'setPaused', args: [true], account, chain: client.chain, gas: 100_000n })
      await client.waitForTransactionReceipt({ hash: h })
      opts.log?.info('gateway.breaker', 'auto-paused deposits (sustained out-of-range)', { pool: inst.poolAddress })
      paused++
    } catch (e) {
      opts.log?.warn('gateway.breaker', 'setPaused failed', { error: String(e), pool: inst.poolAddress })
    }
  }
  return { paused }
}
