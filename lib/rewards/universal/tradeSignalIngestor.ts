import type { RawTradeSignal, TradeSignalRecord } from './types'

function normalizeAddress(value: string | null | undefined): string | null {
  return value ? value.toLowerCase() : null
}

function normalizeBigintLike(value: string | bigint): string {
  return typeof value === 'bigint' ? value.toString() : value
}

export function makeTradeSignalId(raw: Pick<RawTradeSignal, 'chain_id' | 'tx_hash' | 'log_index'>): string {
  return `${raw.chain_id}:${raw.tx_hash.toLowerCase()}:${raw.log_index}`
}

export function normalizeTradeSignal(raw: RawTradeSignal): TradeSignalRecord {
  return {
    id: makeTradeSignalId(raw),
    chain_id: raw.chain_id,
    pool_id: raw.pool_id,
    tx_hash: raw.tx_hash.toLowerCase(),
    log_index: raw.log_index,
    block_number: raw.block_number,
    swapper: raw.swapper.toLowerCase(),
    referrer: normalizeAddress(raw.referrer),
    amount_in_raw: normalizeBigintLike(raw.amount_in),
    amount_out_raw: normalizeBigintLike(raw.amount_out),
    dynamic_fee_bps: raw.dynamic_fee_bps,
    capture_amount_raw: normalizeBigintLike(raw.capture_amount),
    tick_after: raw.tick_after,
    pyth_timestamp: raw.pyth_timestamp,
    hook_data: raw.hook_data ?? null,
    observed_at: raw.observed_at ?? null,
  }
}

export function normalizeTradeSignals(rawSignals: RawTradeSignal[]): TradeSignalRecord[] {
  return rawSignals
    .map(normalizeTradeSignal)
    .sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index)
}
