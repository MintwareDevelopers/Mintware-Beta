// =============================================================================
// oracle-watcher — block scanner
// Fetches WETH Transfer events from Base Sepolia and filters for registered agents.
// =============================================================================

import type { Env, TransferLog, PnlLog } from './types.js'
import { supabaseSelect } from './supabase.js'

const TRANSFER_TOPIC  = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const MAX_BLOCK_RANGE = 500   // ~16 mins of Base blocks (2s block time)
const KV_LAST_BLOCK   = 'last_block'

// ── RPC helper ────────────────────────────────────────────────────────────────

async function rpc<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(env.BASE_SEPOLIA_RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json() as { result: T; error?: { message: string } }
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message}`)
  return json.result
}

// ── Main scanner ──────────────────────────────────────────────────────────────

export interface ScanResult {
  logs:           TransferLog[]   // outflows from registered agents (for scoring)
  pnlLogs:        PnlLog[]        // all WETH flows involving agents (for PnL tracking)
  newLastBlock:   number
}

export async function scanForAgentActivity(env: Env): Promise<ScanResult> {
  // 1. Get current block
  const latestHex    = await rpc<string>(env, 'eth_blockNumber', [])
  const currentBlock = parseInt(latestHex, 16)

  // 2. Determine scan range
  const storedBlock = await env.OW_STATE.get(KV_LAST_BLOCK)
  const fromBlock   = storedBlock
    ? Math.max(parseInt(storedBlock) + 1, currentBlock - MAX_BLOCK_RANGE)
    : currentBlock - MAX_BLOCK_RANGE

  if (fromBlock > currentBlock) {
    console.log('[scanner] No new blocks to scan')
    return { logs: [], newLastBlock: currentBlock }
  }

  console.log(`[scanner] Scanning blocks ${fromBlock} → ${currentBlock}`)

  // 3. Fetch registered agent addresses
  const profiles = await supabaseSelect<{ address: string }>(
    env, 'ai_agent_profiles', 'select=address',
  )
  if (!profiles.length) {
    console.log('[scanner] No registered agents')
    return { logs: [], newLastBlock: currentBlock }
  }

  const agentSet = new Set(profiles.map(p => p.address.toLowerCase()))
  console.log(`[scanner] Watching ${agentSet.size} agents`)

  // 4. Fetch WETH Transfer logs in range
  const rawLogs = await rpc<TransferLog[]>(env, 'eth_getLogs', [{
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + currentBlock.toString(16),
    address:   env.WETH_ADDRESS,
    topics:    [TRANSFER_TOPIC],
  }])

  // 5a. Filter: outflows from registered agents (for scoring)
  const agentLogs = rawLogs.filter(log => {
    if (log.topics.length < 3) return false
    const from = '0x' + log.topics[1].slice(26).toLowerCase()
    return agentSet.has(from)
  })

  // 5b. Build PnL logs — all WETH flows involving agents (both directions)
  const pnlLogs: PnlLog[] = []
  for (const log of rawLogs) {
    if (log.topics.length < 3) continue
    const from = '0x' + log.topics[1].slice(26).toLowerCase()
    const to   = '0x' + log.topics[2].slice(26).toLowerCase()
    if (agentSet.has(from)) {
      pnlLogs.push({ transactionHash: log.transactionHash, agentAddress: from, direction: 'out', amountWei: log.data })
    } else if (agentSet.has(to)) {
      pnlLogs.push({ transactionHash: log.transactionHash, agentAddress: to,   direction: 'in',  amountWei: log.data })
    }
  }

  console.log(`[scanner] ${rawLogs.length} WETH transfers → ${agentLogs.length} from agents, ${pnlLogs.length} PnL events`)

  return { logs: agentLogs, pnlLogs, newLastBlock: currentBlock }
}

export async function saveLastBlock(env: Env, block: number): Promise<void> {
  await env.OW_STATE.put(KV_LAST_BLOCK, block.toString())
}
