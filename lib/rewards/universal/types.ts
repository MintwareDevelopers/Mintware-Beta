export type TradeQuality = 'noise' | 'referral' | 'toxic'
export type AttributionBand = 'low' | 'mid' | 'high'
export type AllocationRecipientType = 'lp_pool' | 'trader' | 'referrer' | 'treasury'

export interface RawTradeSignal {
  chain_id: number
  pool_id: string
  tx_hash: string
  log_index: number
  block_number: number
  swapper: string
  referrer?: string | null
  amount_in: string | bigint
  amount_out: string | bigint
  dynamic_fee_bps: number
  capture_amount: string | bigint
  tick_after: number
  pyth_timestamp: number
  hook_data?: string | null
  observed_at?: string | null
}

export interface TradeSignalRecord {
  id: string
  chain_id: number
  pool_id: string
  tx_hash: string
  log_index: number
  block_number: number
  swapper: string
  referrer: string | null
  amount_in_raw: string
  amount_out_raw: string
  dynamic_fee_bps: number
  capture_amount_raw: string
  tick_after: number
  pyth_timestamp: number
  hook_data: string | null
  observed_at: string | null
}

export interface TradeClassificationContext {
  amount_out_usd: number
  capture_usd?: number
  attribution_band: AttributionBand
  referral_eligible?: boolean
}

export interface ClassifiedTradeSignal extends TradeSignalRecord {
  quality: TradeQuality
  attribution_band: AttributionBand
  amount_out_usd: number
  capture_usd: number
  fee_usd: number
  reasons: string[]
}

export interface UniversalAllocationPolicy {
  lp_share_bps: number
  referrer_share_bps: number
  trader_rebate_bps: number
  treasury_share_bps: number
  minimum_rebate_band?: AttributionBand
  treasury_address: string
}

export interface UniversalAllocationEntry {
  recipient: string
  recipient_type: AllocationRecipientType
  source_trade_ids: string[]
  quality: TradeQuality
  amount_usd: number
}

export interface UniversalAllocationSummary {
  entries: UniversalAllocationEntry[]
  total_value_usd: number
  total_allocated_usd: number
}

export interface UniversalMerkleLeaf {
  recipient: string
  amount_usdc_wei: string
  proof: string[]
}

export interface UniversalMerkleResult {
  root: string
  leaves: UniversalMerkleLeaf[]
  total_usdc_wei: string
  tree_dump: object
}
