// LP-gateway range-alert sync (Krystal item 11). For each active gateway, read the pool's live tick vs
// the gateway's fixed [tickLower, tickUpper]; open an 'out_of_range' alert when the deployed leg stops
// earning fees, and RESOLVE it when the pool comes back in range. Debounced: an open alert only starts
// "firing" once it has been continuously open past LP_GATEWAY_ALERT_DEBOUNCE_SECS (anti-whipsaw). Called
// by the gateway-snapshot cron. Read-only observability — reads chain + writes alert rows, no money moves.

import { getServiceClient } from '@/lib/web2/supabase'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listActiveInstances } from '@/lib/gateway/registry'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { readCurrentTick, type GatewayPoolKey } from '@/lib/gateway/poolState'

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { warn: (t: string, m: string, c?: Record<string, unknown>) => void }

const debounceSecs = () => {
  const n = Number(process.env.LP_GATEWAY_ALERT_DEBOUNCE_SECS ?? '21600') // 6h default (~1 snapshot cycle)
  return Number.isFinite(n) && n >= 0 ? n : 21600
}

export async function syncRangeAlerts(opts: { supabase: SupabaseClient; log?: Logger }): Promise<{ checked: number; firing: number }> {
  const cfg = gatewayConfig()
  if (!cfg) return { checked: 0, firing: 0 }
  const client = gatewayPublicClient(cfg)
  const active = await listActiveInstances(opts.supabase, cfg.chainId)
  const targets = active.length
    ? active.map((i) => ({ positionManager: i.positionManager, poolAddress: i.poolAddress, chainId: i.chainId }))
    : cfg.positionManager && cfg.poolAddress
      ? [{ positionManager: cfg.positionManager, poolAddress: cfg.poolAddress, chainId: cfg.chainId }]
      : []

  let checked = 0
  let firing = 0
  for (const inst of targets) {
    let inRange: boolean | null = null
    let detail: Record<string, number> | null = null
    try {
      const read = (fn: 'poolKey' | 'poolManager' | 'tickLower' | 'tickUpper') =>
        client.readContract({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: fn })
      const [key, pm, tickLower, tickUpper] = (await Promise.all([
        read('poolKey'), read('poolManager'), read('tickLower'), read('tickUpper'),
      ])) as [GatewayPoolKey, `0x${string}`, number, number]
      const slot0 = await readCurrentTick({ client, poolManager: pm, poolKey: key })
      if (slot0) {
        inRange = slot0.tick >= Number(tickLower) && slot0.tick <= Number(tickUpper)
        detail = { currentTick: slot0.tick, tickLower: Number(tickLower), tickUpper: Number(tickUpper) }
      }
    } catch (e) {
      opts.log?.warn('gateway.alerts', 'tick read failed', { error: String(e), pool: inst.poolAddress })
      continue
    }
    if (inRange == null) continue
    checked++

    const now = new Date().toISOString()
    const { data: open } = await opts.supabase
      .from('gateway_alerts')
      .select('id, first_seen_at')
      .eq('pool_address', inst.poolAddress).eq('chain_id', inst.chainId).eq('kind', 'out_of_range')
      .is('resolved_at', null).maybeSingle()

    if (inRange) {
      if (open?.id) await opts.supabase.from('gateway_alerts').update({ resolved_at: now, last_seen_at: now, firing: false }).eq('id', String(open.id))
      continue
    }
    // out of range
    if (!open?.id) {
      await opts.supabase.from('gateway_alerts').insert({
        pool_address: inst.poolAddress, chain_id: inst.chainId, kind: 'out_of_range',
        first_seen_at: now, last_seen_at: now, firing: false, detail,
      })
    } else {
      const fires = Date.now() - Date.parse(String(open.first_seen_at)) >= debounceSecs() * 1000
      await opts.supabase.from('gateway_alerts').update({ last_seen_at: now, firing: fires, detail }).eq('id', String(open.id))
      if (fires) firing++
    }
  }
  return { checked, firing }
}
