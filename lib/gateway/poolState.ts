// Read a Uniswap-V4 pool's live Slot0 (sqrtPrice + current tick) off-chain. V4 exposes NO public
// getSlot0 — pool state lives in the singleton PoolManager and is read via `extsload` at a computed
// storage slot (the StateLibrary pattern). We replicate that slot math here so the app can show the
// pool's current tick + whether it sits inside a gateway's fixed [tickLower, tickUpper] range.

import { keccak256, encodeAbiParameters, concat, pad } from 'viem'

export type GatewayPoolKey = {
  currency0: `0x${string}`
  currency1: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
}

// PoolManager._pools mapping lives at storage slot 6 (Uniswap V4 core StateLibrary.POOLS_SLOT).
const POOLS_SLOT = pad('0x06', { size: 32 })

const EXTSLOAD_ABI = [
  { type: 'function', stateMutability: 'view', name: 'extsload', inputs: [{ name: 'slot', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
] as const

/** V4 PoolId = keccak256(abi.encode(PoolKey)). */
export function poolIdOf(key: GatewayPoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      }],
      [key],
    ),
  )
}

/** Read Slot0 (sqrtPriceX96 + tick) from the PoolManager via extsload. Returns null on any failure —
 *  the caller treats an unreadable tick as "unknown" (never a false in-range claim). */
export async function readCurrentTick(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { readContract: (a: any) => Promise<unknown> }
  poolManager: `0x${string}`
  poolKey: GatewayPoolKey
}): Promise<{ tick: number; sqrtPriceX96: bigint } | null> {
  try {
    const poolId = poolIdOf(opts.poolKey)
    const stateSlot = keccak256(concat([poolId, POOLS_SLOT])) // keccak256(poolId ++ POOLS_SLOT)
    const raw = (await opts.client.readContract({
      address: opts.poolManager,
      abi: EXTSLOAD_ABI,
      functionName: 'extsload',
      args: [stateSlot],
    })) as `0x${string}`
    const word = BigInt(raw)
    const sqrtPriceX96 = word & ((1n << 160n) - 1n)
    const tick = Number(BigInt.asIntN(24, (word >> 160n) & 0xffffffn)) // int24, sign-extended
    return { tick, sqrtPriceX96 }
  } catch {
    return null
  }
}
