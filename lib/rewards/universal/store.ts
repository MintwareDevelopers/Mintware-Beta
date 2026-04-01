import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { normalizeTradeSignals } from './tradeSignalIngestor'
import type { RawTradeSignal, TradeSignalRecord } from './types'

export function toTradeSignalRows(rawSignals: RawTradeSignal[]): TradeSignalRecord[] {
  return normalizeTradeSignals(rawSignals)
}

export async function upsertTradeSignals(rawSignals: RawTradeSignal[]): Promise<TradeSignalRecord[]> {
  const rows = toTradeSignalRows(rawSignals)
  if (rows.length === 0) return []

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('trade_signals')
    .upsert(rows, { onConflict: 'chain_id,tx_hash,log_index', ignoreDuplicates: false })

  if (error) {
    throw new Error(`[tradeSignalStore] trade_signals upsert failed: ${error.message}`)
  }

  return rows
}
