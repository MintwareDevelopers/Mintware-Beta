import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { publishUniversalEpochToDistributor } from './distributionBridge'

export interface UniversalBridgeReportItem {
  epoch_id: string
  distribution_id?: string
  campaign_id?: string
  published?: boolean
  error?: string
}

export interface UniversalBridgeReport {
  attempted: number
  bridged: number
  results: UniversalBridgeReportItem[]
}

export async function bridgeUniversalEpochsToDistributor(limit = 25): Promise<UniversalBridgeReport> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('universal_reward_epochs')
    .select('id')
    .is('distribution_id', null)
    .not('merkle_root', 'is', null)
    .order('epoch_start', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`[universalBridgeCron] failed to load bridgeable epochs: ${error.message}`)
  }

  const results: UniversalBridgeReportItem[] = []
  for (const row of data ?? []) {
    try {
      const result = await publishUniversalEpochToDistributor(row.id)
      results.push(result)
    } catch (err) {
      results.push({
        epoch_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    attempted: (data ?? []).length,
    bridged: results.filter((item) => item.distribution_id).length,
    results,
  }
}
