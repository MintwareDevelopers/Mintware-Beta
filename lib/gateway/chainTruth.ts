// Chain-truth reads for the LP gateway — the ONE place that turns "known depositor addresses" into
// on-chain holdings. DB rows are only the address source; every money number here comes from
// `sharesOf` / `totalShares` / `totalNav` on the PositionManager, all pinned to ONE block so the
// snapshot is internally consistent.
//
// Read strategy: Multicall3 (aggregate3) when the chain has it — override the address with
// `LP_GATEWAY_MULTICALL3`, default is the canonical deployment — and a chunked per-call fallback when
// multicall is unavailable/reverts. Either way the result is the same shape. A failure on ANY instance
// rejects the whole read so the caller can degrade EXPLICITLY (never a silently-partial board).
//
// Portfolio owner: `readInstanceHoldings` + `positionValueAtomic` (lib/gateway/positionReader.ts) are the
// helpers to use for a chain-truth portfolio total; `gateway_positions` rows supply addresses/cost basis
// only.

import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import type { InstanceHoldings } from '@/lib/gateway/leaderboard'

// Structural client: a viem PublicClient satisfies it; tests pass a mock. viem's generics are too
// heavy to pin here, so the ABI is fixed at the call site and results are cast.
export type ChainReader = {
  readContract: (args: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
  multicall?: (args: any) => Promise<unknown> // eslint-disable-line @typescript-eslint/no-explicit-any
  getBlockNumber?: () => Promise<bigint>
}

export type InstanceReadSpec = {
  poolAddress: string
  positionManager: `0x${string}`
  /** Known depositor wallets for this instance (from gateway_positions; addresses only). */
  wallets: readonly string[]
}

export type ChainHoldingsSnapshot = {
  blockNumber: bigint | null
  holdings: InstanceHoldings[]
}

export const CANONICAL_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const CHUNK = 20 // per-call fallback concurrency

function multicallAddress(): `0x${string}` | null {
  const env = process.env.LP_GATEWAY_MULTICALL3
  if (env === 'off' || env === 'false' || env === '0') return null
  return (env && /^0x[0-9a-fA-F]{40}$/.test(env) ? env : CANONICAL_MULTICALL3) as `0x${string}`
}

type Call = { address: `0x${string}`; abi: typeof LP_GATEWAY_ABI; functionName: string; args?: readonly unknown[] }

function planCalls(instances: readonly InstanceReadSpec[]): Call[] {
  const calls: Call[] = []
  for (const inst of instances) {
    calls.push({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: 'totalShares' })
    calls.push({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: 'totalNav' })
    for (const w of inst.wallets) {
      calls.push({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: 'sharesOf', args: [w as `0x${string}`] })
    }
  }
  return calls
}

async function viaMulticall(client: ChainReader, calls: Call[], blockNumber: bigint | null, mc: `0x${string}`): Promise<bigint[]> {
  if (!client.multicall) throw new Error('multicall_unsupported')
  const res = (await client.multicall({
    contracts: calls,
    multicallAddress: mc,
    allowFailure: false,
    ...(blockNumber != null ? { blockNumber } : {}),
  })) as unknown[]
  if (!Array.isArray(res) || res.length !== calls.length) throw new Error('multicall_shape')
  return res.map((r) => BigInt(r as bigint))
}

async function viaPerCall(client: ChainReader, calls: Call[], blockNumber: bigint | null): Promise<bigint[]> {
  const out: bigint[] = new Array(calls.length)
  for (let i = 0; i < calls.length; i += CHUNK) {
    const slice = calls.slice(i, i + CHUNK)
    const vals = await Promise.all(
      slice.map((c) => client.readContract({ ...c, ...(blockNumber != null ? { blockNumber } : {}) })),
    )
    for (let j = 0; j < vals.length; j++) out[i + j] = BigInt(vals[j] as bigint)
  }
  return out
}

/** Read every instance's totals + each known wallet's shares at one block. Throws on any failure. */
export async function readInstanceHoldings(opts: {
  client: ChainReader
  instances: readonly InstanceReadSpec[]
  /** Pin reads to this block; default = latest at call time (read once, then reused for all calls). */
  blockNumber?: bigint | null
}): Promise<ChainHoldingsSnapshot> {
  const { client, instances } = opts
  let blockNumber: bigint | null = opts.blockNumber ?? null
  if (blockNumber == null && client.getBlockNumber) {
    try { blockNumber = await client.getBlockNumber() } catch { blockNumber = null }
  }

  const specs = instances.map((i) => ({ ...i, wallets: [...new Set(i.wallets.map((w) => w.toLowerCase()))] }))
  const calls = planCalls(specs)
  if (calls.length === 0) return { blockNumber, holdings: [] }

  let values: bigint[]
  const mc = multicallAddress()
  if (mc && client.multicall) {
    try {
      values = await viaMulticall(client, calls, blockNumber, mc)
    } catch {
      values = await viaPerCall(client, calls, blockNumber)
    }
  } else {
    values = await viaPerCall(client, calls, blockNumber)
  }

  const holdings: InstanceHoldings[] = []
  let cursor = 0
  for (const inst of specs) {
    const totalShares = values[cursor++]
    const totalNav = values[cursor++]
    const shares = new Map<string, bigint>()
    for (const w of inst.wallets) shares.set(w, values[cursor++])
    holdings.push({ poolAddress: inst.poolAddress.toLowerCase(), totalShares, totalNav, shares })
  }
  return { blockNumber, holdings }
}
