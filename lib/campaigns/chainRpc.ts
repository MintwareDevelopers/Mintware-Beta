// =============================================================================
// chainRpc.ts — Chain RPC client abstraction
// Ticket 3: Daily bridge verification
//
// Uses raw JSON-RPC (not viem) to preserve full control over batch call
// structure. eth_getLogs is the core primitive — one call per chain covers
// all participant wallets simultaneously via topics[2] OR filter.
//
// Chain support: Core DAO (chainId 1116) to start, extensible via env vars.
// =============================================================================

// ---------------------------------------------------------------------------
// Bridge contract
//
// PENDING: Core DAO bridge contract address awaiting Molten confirmation.
// The Transfer event sig is the standard ERC-20 transfer — correct assumption
// for most bridge implementations where the destination contract mints/releases
// tokens to recipient wallets. Update once Molten confirms the exact contract
// and whether a custom event ABI should be used instead.
// ---------------------------------------------------------------------------
export const CORE_DAO_BRIDGE_CONTRACT =
  process.env.CORE_DAO_BRIDGE_CONTRACT ?? '0x__PENDING_MOLTEN_CONFIRMATION__'

// ERC-20 Transfer(address indexed from, address indexed to, uint256 value)
// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_EVENT_SIG =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

// Core DAO average block time in seconds
const CORE_DAO_BLOCK_TIME_SECS = 3

// Max wallet addresses per eth_getLogs topics[2] OR filter.
// Stay conservative — some RPC providers cap at 100, others allow 500+.
// bridgeVerifier will chunk participant lists and make multiple calls if needed.
export const LOGS_ADDRESS_CHUNK_SIZE = 100

// ---------------------------------------------------------------------------
// Chain config registry
// Add new chains here as Mintware expands beyond Core DAO.
// ---------------------------------------------------------------------------
interface ChainConfig {
  rpcUrl: string
  blockTimeSecs: number
  chainId: number
}

function getChainConfig(chain: string): ChainConfig {
  switch (chain.toLowerCase()) {
    case 'core':
    case 'core_dao':
    case 'coredao':
      return {
        rpcUrl: process.env.CORE_DAO_RPC_URL ?? 'https://rpc.coredao.org',
        blockTimeSecs: CORE_DAO_BLOCK_TIME_SECS,
        chainId: 1116,
      }
    // Future chains:
    // case 'base':
    //   return { rpcUrl: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org', blockTimeSecs: 2, chainId: 8453 }
    default:
      throw new Error(`[chainRpc] Unsupported chain: "${chain}". Add it to chainRpc.ts getChainConfig().`)
  }
}

// Export for use in bridgeVerifier
export function getRpcUrl(chain: string): string {
  return getChainConfig(chain).rpcUrl
}

export function getBlockTimeSecs(chain: string): number {
  return getChainConfig(chain).blockTimeSecs
}

// ---------------------------------------------------------------------------
// JSON-RPC primitives
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params: unknown[]
  id: number
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: { code: number; message: string }
}

/** Single JSON-RPC call */
async function jsonRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  id = 1
): Promise<T> {
  const body: JsonRpcRequest = { jsonrpc: '2.0', method, params, id }
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`[chainRpc] HTTP ${res.status} from ${rpcUrl} calling ${method}`)
  }
  const data: JsonRpcResponse<T> = await res.json()
  if (data.error) {
    throw new Error(`[chainRpc] RPC error ${data.error.code}: ${data.error.message}`)
  }
  return data.result as T
}

/** Batched JSON-RPC — single HTTP request, N method calls */
async function jsonRpcBatch<T>(
  rpcUrl: string,
  calls: Array<{ method: string; params: unknown[] }>
): Promise<Array<T | null>> {
  if (calls.length === 0) return []

  const body: JsonRpcRequest[] = calls.map((c, i) => ({
    jsonrpc: '2.0',
    method: c.method,
    params: c.params,
    id: i + 1,
  }))

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`[chainRpc] HTTP ${res.status} from ${rpcUrl} on batch call`)
  }

  const responses: JsonRpcResponse<T>[] = await res.json()

  // Responses may come back out of order — sort by id
  const sorted = [...responses].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
  return sorted.map((r) => (r.error ? null : (r.result ?? null)))
}

// ---------------------------------------------------------------------------
// eth_getLogs
// ---------------------------------------------------------------------------

export interface EthLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string   // hex
  transactionHash: string
  transactionIndex: string
  blockHash: string
  logIndex: string
  removed: boolean
}

interface GetLogsParams {
  address?: string
  topics?: Array<string | string[] | null>
  fromBlock: string   // hex or 'latest' or 'earliest'
  toBlock: string
}

/**
 * Single eth_getLogs call. Returns raw log array.
 * This is the core primitive for batch bridge verification.
 */
export async function ethGetLogs(
  rpcUrl: string,
  params: GetLogsParams
): Promise<EthLog[]> {
  return jsonRpc<EthLog[]>(rpcUrl, 'eth_getLogs', [params])
}

// ---------------------------------------------------------------------------
// Block timestamp resolution
//
// eth_getLogs returns block numbers, not timestamps.
// We need timestamps to verify tx.timestamp > participant.joined_at.
// Strategy: collect unique block numbers from all matched logs,
// then batch eth_getBlockByNumber to resolve timestamps in ONE extra round-trip.
// ---------------------------------------------------------------------------

interface BlockHeader {
  number: string      // hex
  timestamp: string   // hex
  hash: string
}

/**
 * Resolves timestamps for an array of unique block numbers.
 * Uses JSON-RPC batch — one HTTP request for all blocks.
 * Returns a Map<blockNumberHex, unixTimestampSeconds>.
 */
export async function getBlockTimestamps(
  rpcUrl: string,
  blockNumbers: string[]
): Promise<Map<string, number>> {
  const unique = [...new Set(blockNumbers)]
  if (unique.length === 0) return new Map()

  const results = await jsonRpcBatch<BlockHeader>(
    rpcUrl,
    unique.map((bn) => ({ method: 'eth_getBlockByNumber', params: [bn, false] }))
  )

  const map = new Map<string, number>()
  unique.forEach((bn, i) => {
    const block = results[i]
    if (block?.timestamp) {
      map.set(bn, parseInt(block.timestamp, 16))
    }
  })
  return map
}

// ---------------------------------------------------------------------------
// Block number estimation from timestamp
//
// Converts a Unix timestamp (or ISO string) to an approximate block number.
// Used to set fromBlock on eth_getLogs — keeps the search window tight.
// ---------------------------------------------------------------------------

/** Returns current block number as a decimal integer */
export async function getLatestBlockNumber(rpcUrl: string): Promise<number> {
  const hex = await jsonRpc<string>(rpcUrl, 'eth_blockNumber', [])
  return parseInt(hex, 16)
}

/**
 * Estimates the block number for a given timestamp.
 * Safe to use as a fromBlock — may be slightly before the actual block,
 * which is fine (we just scan a few extra blocks).
 */
export async function timestampToBlockNumber(
  rpcUrl: string,
  chain: string,
  isoTimestamp: string
): Promise<string> {
  const targetSecs = Math.floor(new Date(isoTimestamp).getTime() / 1000)
  const nowSecs = Math.floor(Date.now() / 1000)
  const latestBlock = await getLatestBlockNumber(rpcUrl)
  const blockTimeSecs = getBlockTimeSecs(chain)

  const secondsAgo = nowSecs - targetSecs
  const blocksAgo = Math.floor(secondsAgo / blockTimeSecs)

  // Subtract 10 blocks as safety margin
  const estimatedBlock = Math.max(0, latestBlock - blocksAgo - 10)
  return '0x' + estimatedBlock.toString(16)
}

// ---------------------------------------------------------------------------
// Address encoding for topics filter
//
// Ethereum topics are 32 bytes. Addresses (20 bytes) must be left-padded.
// "0xabc123..." → "0x000000000000000000000000abc123..."
// ---------------------------------------------------------------------------
export function encodeTopicAddress(address: string): string {
  const clean = address.toLowerCase().replace('0x', '')
  return '0x' + clean.padStart(64, '0')
}

// ---------------------------------------------------------------------------
// fetchBridgeTransfers — the main exported function
//
// Single batch RPC operation covering all wallets for one chain.
// Chunked across LOGS_ADDRESS_CHUNK_SIZE to respect RPC provider limits.
// Returns all matching Transfer logs with resolved timestamps.
// ---------------------------------------------------------------------------

export interface BridgeTx {
  tx_hash: string
  wallet: string          // recipient (lowercase)
  block_number: string    // hex
  timestamp_secs: number  // resolved from block
  token_contract: string  // the ERC-20 that was transferred (= bridge contract here)
}

/**
 * Fetches all inbound bridge Transfer events for a list of wallet addresses.
 *
 * One eth_getLogs call per chunk of LOGS_ADDRESS_CHUNK_SIZE wallets.
 * One batched eth_getBlockByNumber call to resolve all block timestamps.
 *
 * @param chain - chain identifier ('core_dao')
 * @param walletAddresses - participant wallets to check (lowercase)
 * @param minJoinedAt - earliest joined_at across participants (ISO string) — sets fromBlock
 * @returns Array of bridge transactions, deduped by tx_hash + wallet
 */
export async function fetchBridgeTransfers(
  chain: string,
  walletAddresses: string[],
  minJoinedAt: string
): Promise<BridgeTx[]> {
  if (walletAddresses.length === 0) return []

  const rpcUrl = getRpcUrl(chain)
  const fromBlock = await timestampToBlockNumber(rpcUrl, chain, minJoinedAt)

  // Chunk wallet list to stay within RPC provider topic filter limits
  const chunks: string[][] = []
  for (let i = 0; i < walletAddresses.length; i += LOGS_ADDRESS_CHUNK_SIZE) {
    chunks.push(walletAddresses.slice(i, i + LOGS_ADDRESS_CHUNK_SIZE))
  }

  // One eth_getLogs call per chunk — all chunks share fromBlock/toBlock
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      ethGetLogs(rpcUrl, {
        address: CORE_DAO_BRIDGE_CONTRACT,
        topics: [
          TRANSFER_EVENT_SIG,
          null,                                          // topics[1]: from (any — bridge contract itself)
          chunk.map(encodeTopicAddress),                 // topics[2]: to (our participants, OR filter)
        ],
        fromBlock,
        toBlock: 'latest',
      }).catch((err) => {
        console.error('[chainRpc] eth_getLogs chunk error:', err)
        return [] as EthLog[]
      })
    )
  )

  const allLogs = chunkResults.flat()
  if (allLogs.length === 0) return []

  // Collect unique block numbers for timestamp resolution
  const blockNumbers = [...new Set(allLogs.map((l) => l.blockNumber))]
  const blockTimestamps = await getBlockTimestamps(rpcUrl, blockNumbers)

  // Map logs → BridgeTx, decode recipient from topics[2]
  const seen = new Set<string>() // dedup key: tx_hash + wallet
  const results: BridgeTx[] = []

  for (const log of allLogs) {
    if (log.removed) continue

    // topics[2] = padded recipient address
    const recipientTopic = log.topics[2]
    if (!recipientTopic) continue
    const wallet = '0x' + recipientTopic.slice(-40) // last 20 bytes

    const dedupKey = `${log.transactionHash}:${wallet}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    const timestamp_secs = blockTimestamps.get(log.blockNumber) ?? 0

    results.push({
      tx_hash: log.transactionHash,
      wallet,
      block_number: log.blockNumber,
      timestamp_secs,
      token_contract: log.address.toLowerCase(),
    })
  }

  return results
}
