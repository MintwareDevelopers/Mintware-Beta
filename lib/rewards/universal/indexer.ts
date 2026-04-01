import { createPublicClient, http, parseAbiItem, type Address } from 'viem'
import { base, baseSepolia, type Chain } from 'viem/chains'
import { createSupabaseServiceClient } from '@/lib/web2/supabase'
import { upsertTradeSignals } from './store'
import type { RawTradeSignal } from './types'

const TRADE_SIGNAL_EVENT = parseAbiItem(
  'event TradeSignal(bytes32 indexed poolId,address indexed swapper,address indexed referrer,uint256 amountIn,uint256 amountOut,uint24 dynamicFee,uint256 captureAmount,int24 tickAfter,uint64 pythTimestamp,bytes hookData)'
)

type TradeSignalLog = {
  transactionHash: `0x${string}`
  logIndex: number
  blockNumber: bigint
  args: {
    poolId?: `0x${string}`
    swapper?: `0x${string}`
    referrer?: `0x${string}`
    amountIn?: bigint
    amountOut?: bigint
    dynamicFee?: number
    captureAmount?: bigint
    tickAfter?: number
    pythTimestamp?: bigint
    hookData?: `0x${string}`
  }
}

const DEFAULT_INITIAL_BLOCK_WINDOW = 2_000n
const DEFAULT_CONFIRMATIONS = 2n

function getChain(slug: string): Chain {
  switch (slug) {
    case 'base':
      return base
    case 'base_sepolia':
      return baseSepolia
    default:
      throw new Error(`[universalIndexer] Unsupported chain slug: "${slug}"`)
  }
}

function getRpcUrl(slug: string): string {
  switch (slug) {
    case 'base':
      return process.env.BASE_RPC_URL ?? 'https://mainnet.base.org'
    case 'base_sepolia':
      return process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
    default:
      throw new Error(`[universalIndexer] No RPC URL for chain slug: "${slug}"`)
  }
}

export function makeTradeSignalSyncKey(chainSlug: string, contractAddress: string): string {
  return `${chainSlug}:${contractAddress.toLowerCase()}`
}

export function resolveTradeSignalSyncRange(args: {
  latestBlock: bigint
  lastSyncedBlock?: bigint | null
  initialWindow?: bigint
  confirmations?: bigint
}): { fromBlock: bigint, toBlock: bigint } | null {
  const confirmations = args.confirmations ?? DEFAULT_CONFIRMATIONS
  const initialWindow = args.initialWindow ?? DEFAULT_INITIAL_BLOCK_WINDOW
  const safeTip = args.latestBlock > confirmations ? args.latestBlock - confirmations : 0n

  const fromBlock = args.lastSyncedBlock !== undefined && args.lastSyncedBlock !== null && args.lastSyncedBlock > 0n
    ? args.lastSyncedBlock + 1n
    : (safeTip > initialWindow ? safeTip - initialWindow : 0n)

  if (safeTip < fromBlock) return null
  return { fromBlock, toBlock: safeTip }
}

export function mapTradeSignalLog(chainId: number, log: TradeSignalLog): RawTradeSignal {
  if (!log.args.poolId || !log.args.swapper || log.args.amountIn === undefined || log.args.amountOut === undefined) {
    throw new Error('[universalIndexer] Incomplete TradeSignal log payload')
  }

  return {
    chain_id: chainId,
    pool_id: log.args.poolId,
    tx_hash: log.transactionHash,
    log_index: log.logIndex,
    block_number: Number(log.blockNumber),
    swapper: log.args.swapper,
    referrer: log.args.referrer ?? null,
    amount_in: log.args.amountIn.toString(),
    amount_out: log.args.amountOut.toString(),
    dynamic_fee_bps: Number(log.args.dynamicFee ?? 0),
    capture_amount: (log.args.captureAmount ?? 0n).toString(),
    tick_after: Number(log.args.tickAfter ?? 0),
    pyth_timestamp: Number(log.args.pythTimestamp ?? 0),
    hook_data: log.args.hookData ?? '0x',
    observed_at: null,
  }
}

export interface TradeSignalSyncResult {
  chain_slug: string
  contract_address: string
  from_block: bigint | null
  to_block: bigint | null
  scanned_logs: number
  upserted_rows: number
}

export async function syncTradeSignals(args: {
  chainSlug: string
  contractAddress: Address
  initialWindow?: bigint
  confirmations?: bigint
}): Promise<TradeSignalSyncResult> {
  const chain = getChain(args.chainSlug)
  const client = createPublicClient({
    chain,
    transport: http(getRpcUrl(args.chainSlug)),
  })

  const latestBlock = await client.getBlockNumber()
  const syncKey = makeTradeSignalSyncKey(args.chainSlug, args.contractAddress)
  const supabase = createSupabaseServiceClient()

  const { data: stateRow, error: stateErr } = await supabase
    .from('trade_signal_sync_state')
    .select('last_synced_block')
    .eq('sync_key', syncKey)
    .maybeSingle()

  if (stateErr) {
    throw new Error(`[universalIndexer] failed to load sync state: ${stateErr.message}`)
  }

  const range = resolveTradeSignalSyncRange({
    latestBlock,
    lastSyncedBlock: stateRow?.last_synced_block !== undefined && stateRow?.last_synced_block !== null
      ? BigInt(stateRow.last_synced_block)
      : null,
    initialWindow: args.initialWindow,
    confirmations: args.confirmations,
  })

  if (!range) {
    return {
      chain_slug: args.chainSlug,
      contract_address: args.contractAddress.toLowerCase(),
      from_block: null,
      to_block: null,
      scanned_logs: 0,
      upserted_rows: 0,
    }
  }

  const logs = await client.getLogs({
    address: args.contractAddress,
    event: TRADE_SIGNAL_EVENT,
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  })

  const rawSignals = logs.map((log) => mapTradeSignalLog(chain.id, log as TradeSignalLog))
  const rows = await upsertTradeSignals(rawSignals)

  const { error: upsertStateErr } = await supabase
    .from('trade_signal_sync_state')
    .upsert({
      sync_key: syncKey,
      chain_slug: args.chainSlug,
      contract_address: args.contractAddress.toLowerCase(),
      last_synced_block: Number(range.toBlock),
    }, { onConflict: 'sync_key' })

  if (upsertStateErr) {
    throw new Error(`[universalIndexer] failed to update sync state: ${upsertStateErr.message}`)
  }

  return {
    chain_slug: args.chainSlug,
    contract_address: args.contractAddress.toLowerCase(),
    from_block: range.fromBlock,
    to_block: range.toBlock,
    scanned_logs: logs.length,
    upserted_rows: rows.length,
  }
}
