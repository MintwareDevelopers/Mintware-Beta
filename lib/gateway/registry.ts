import { encodeAbiParameters, keccak256 } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'

type SupabaseClient = ReturnType<typeof getServiceClient>

export type ReadClient = {
  readContract: (args: any) => Promise<unknown>
  getCode?: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>
}

export type MarketPoolKey = {
  currency0: `0x${string}`
  currency1: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
}

/** Canonical Uniswap v4 pool identity, matching PoolIdLibrary.toId. */
export function computePoolId(key: MarketPoolKey): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ] }],
    [key],
  ))
}

/** Disable a registered MarketEngine and append the curator action to the registry history. */
export async function deactivateInstance(
  supabase: SupabaseClient,
  input: { poolAddress: string; chainId: number; by: string; reason: string },
): Promise<{ ok: boolean; error?: string }> {
  const pool = input.poolAddress.toLowerCase()
  if (!input.reason.trim()) return { ok: false, error: 'reason_required' }
  const { data: rows, error: readError } = await supabase
    .from('gateway_instances')
    .select('id, position_manager, market_engine_address, status')
    .eq('pool_address', pool)
    .eq('chain_id', input.chainId)
  if (readError) return { ok: false, error: readError.message }
  const active = ((rows ?? []) as Record<string, unknown>[]).find((row) => row.status === 'active')
  if (!active) return { ok: false, error: rows?.length ? 'not_active' : 'not_found' }
  const engine = String(active.market_engine_address ?? active.position_manager ?? '').toLowerCase()
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('gateway_instances')
    .update({ status: 'inactive', deactivated_at: now, deactivated_by: input.by, deactivate_reason: input.reason, updated_at: now })
    .eq('id', String(active.id))
    .eq('status', 'active')
  if (error) return { ok: false, error: error.message }
  try {
    await supabase.from('gateway_instance_history').insert({
      pool_address: pool,
      chain_id: input.chainId,
      action: 'deactivate',
      position_manager: engine,
      prev_position_manager: engine,
      actor: input.by,
      reason: input.reason,
      meta: { marketEngineAddress: engine },
    })
  } catch { /* history is observational; the guarded registry update is authoritative */ }
  return { ok: true }
}
