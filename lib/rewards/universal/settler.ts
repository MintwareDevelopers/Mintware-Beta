import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { allocateUniversalEpoch, epochEndFromStart, floorToEpochStart, makeUniversalEpochKey, type TradeSignalLedgerRow } from './epochAllocator'
import { buildUniversalMerkleTree } from './merkleBuilder'
import type { UniversalAllocationPolicy } from './types'

export interface UniversalEpochSettleResult {
  epoch_key: string
  chain_id: number
  pool_id: string
  trade_count: number
  total_value_usd: number
  total_allocated_usd: number
  merkle_root: string | null
  wallets_included: number
}

export interface UniversalSettleReport {
  epochs_settled: number
  signals_settled: number
  results: UniversalEpochSettleResult[]
}

function buildPolicyFromEnv(): UniversalAllocationPolicy {
  const treasuryAddress = (process.env.MINTWARE_TREASURY_ADDRESS ?? '').toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(treasuryAddress)) {
    throw new Error('[universalSettler] MINTWARE_TREASURY_ADDRESS must be set to a valid address')
  }

  return {
    lp_share_bps: Number(process.env.UNIVERSAL_LP_SHARE_BPS ?? 7000),
    referrer_share_bps: Number(process.env.UNIVERSAL_REFERRER_SHARE_BPS ?? 1500),
    trader_rebate_bps: Number(process.env.UNIVERSAL_TRADER_REBATE_BPS ?? 1000),
    treasury_share_bps: Number(process.env.UNIVERSAL_TREASURY_SHARE_BPS ?? 500),
    minimum_rebate_band: (process.env.UNIVERSAL_MIN_REBATE_BAND as 'low' | 'mid' | 'high' | undefined) ?? 'mid',
    treasury_address: treasuryAddress,
  }
}

function validatePolicy(policy: UniversalAllocationPolicy) {
  const total =
    policy.lp_share_bps +
    policy.referrer_share_bps +
    policy.trader_rebate_bps +
    policy.treasury_share_bps

  if (total !== 10_000) {
    throw new Error(`[universalSettler] policy shares must sum to 10000 bps, got ${total}`)
  }
}

export async function settleUniversalEpochs(): Promise<UniversalSettleReport> {
  const supabase = createSupabaseServiceClient()
  const policy = buildPolicyFromEnv()
  validatePolicy(policy)

  const settleDelayMinutes = Number(process.env.UNIVERSAL_SETTLE_DELAY_MINS ?? 10)
  const epochHours = Number(process.env.UNIVERSAL_EPOCH_DURATION_HOURS ?? 24)
  const stableDecimals = Number(process.env.UNIVERSAL_SETTLEMENT_DECIMALS ?? 6)
  const cutoffIso = new Date(Date.now() - settleDelayMinutes * 60_000).toISOString()

  const { data, error } = await supabase
    .from('trade_signals')
    .select('id, chain_id, pool_id, tx_hash, log_index, block_number, swapper, referrer, amount_in_raw, amount_out_raw, dynamic_fee_bps, capture_amount_raw, tick_after, pyth_timestamp, hook_data, observed_at, created_at')
    .is('settled_epoch_id', null)
    .lte('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(5000)

  if (error) {
    throw new Error(`[universalSettler] Failed to load trade signals: ${error.message}`)
  }

  const rows = (data ?? []) as TradeSignalLedgerRow[]
  if (rows.length === 0) {
    return { epochs_settled: 0, signals_settled: 0, results: [] }
  }

  const groups = new Map<string, TradeSignalLedgerRow[]>()
  for (const row of rows) {
    const epochStart = floorToEpochStart(row.created_at, epochHours)
    const epochKey = makeUniversalEpochKey(row.chain_id, row.pool_id, epochStart)
    const group = groups.get(epochKey) ?? []
    group.push(row)
    groups.set(epochKey, group)
  }

  const results: UniversalEpochSettleResult[] = []
  let signalsSettled = 0

  for (const [epochKey, signals] of groups) {
    const epochStart = floorToEpochStart(signals[0].created_at, epochHours)
    const epochEnd = epochEndFromStart(epochStart, epochHours)

    if (new Date(epochEnd).getTime() > Date.now() - settleDelayMinutes * 60_000) {
      continue
    }

    const allocation = await allocateUniversalEpoch({
      signals,
      policy,
      stableDecimals,
    })

    const merkle = allocation.summary.entries.some((entry) => /^0x[a-fA-F0-9]{40}$/.test(entry.recipient))
      ? buildUniversalMerkleTree(allocation.summary.entries)
      : null

    const { data: epochRow, error: epochErr } = await supabase
      .from('universal_reward_epochs')
      .insert({
        epoch_key: epochKey,
        chain_id: signals[0].chain_id,
        pool_id: signals[0].pool_id,
        epoch_start: epochStart,
        epoch_end: epochEnd,
        trade_count: signals.length,
        total_value_usd: allocation.summary.total_value_usd,
        total_allocated_usd: allocation.summary.total_allocated_usd,
        merkle_root: merkle?.root ?? null,
        total_usdc_wei: merkle?.total_usdc_wei ?? null,
        tree_json: merkle?.tree_dump ?? null,
        status: 'published',
      })
      .select('id')
      .single()

    if (epochErr || !epochRow) {
      throw new Error(`[universalSettler] Failed to insert epoch ${epochKey}: ${epochErr?.message}`)
    }

    const proofMap = new Map<string, string[]>()
    if (merkle) {
      for (const leaf of merkle.leaves) {
        proofMap.set(leaf.recipient.toLowerCase(), leaf.proof)
      }
    }

    const allocationRows = allocation.summary.entries.map((entry) => {
      const isWalletLeaf = /^0x[a-fA-F0-9]{40}$/.test(entry.recipient)
      const amountWei = isWalletLeaf ? String(Math.round(entry.amount_usd * 1e6)) : null
      return {
        epoch_id: epochRow.id,
        recipient: entry.recipient,
        recipient_type: entry.recipient_type,
        source_trade_ids: entry.source_trade_ids,
        quality: entry.quality,
        amount_usd: entry.amount_usd,
        amount_usdc_wei: amountWei,
        merkle_proof: isWalletLeaf ? (proofMap.get(entry.recipient.toLowerCase()) ?? []) : null,
        included_in_merkle: Boolean(isWalletLeaf),
      }
    })

    const { error: allocErr } = await supabase
      .from('universal_reward_allocations')
      .insert(allocationRows)

    if (allocErr) {
      throw new Error(`[universalSettler] Failed to insert allocations for ${epochKey}: ${allocErr.message}`)
    }

    const signalIds = signals.map((signal) => signal.id)
    const { error: settleErr } = await supabase
      .from('trade_signals')
      .update({ settled_epoch_id: epochRow.id })
      .in('id', signalIds)

    if (settleErr) {
      throw new Error(`[universalSettler] Failed to mark trade signals settled for ${epochKey}: ${settleErr.message}`)
    }

    results.push({
      epoch_key: epochKey,
      chain_id: signals[0].chain_id,
      pool_id: signals[0].pool_id,
      trade_count: signals.length,
      total_value_usd: allocation.summary.total_value_usd,
      total_allocated_usd: allocation.summary.total_allocated_usd,
      merkle_root: merkle?.root ?? null,
      wallets_included: merkle?.leaves.length ?? 0,
    })
    signalsSettled += signals.length
  }

  return {
    epochs_settled: results.length,
    signals_settled: signalsSettled,
    results,
  }
}
