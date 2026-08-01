// =============================================================================
// lib/web2/router/quoterReader.ts — QuoterReader backed by the Uniswap V4 Quoter
//
// Reads an exact-input single-pool quote from the vendored V4Quoter lens
// (`v4-periphery/src/lens/V4Quoter.sol`) via eth_call. The V4Quoter is called
// through `simulateContract` (it is non-view — it drives the PoolManager and
// returns via the quoter-revert pattern), so any missing pool / no-liquidity /
// revert simply throws and the caller (quoteInternalPool) falls back to LI.FI.
//
// The on-chain call is INJECTABLE (`simulate`) so this is unit-testable without a
// chain. Server-only in production (needs an RPC endpoint).
// =============================================================================

import type { ListedPool } from './types'
import type { QuoterReader, RawPoolQuote } from './internalQuote'
import { isZeroForOne } from './listing'

/** IV4Quoter.quoteExactInputSingle ABI fragment. */
export const V4_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

const UINT128_MAX = (1n << 128n) - 1n

/** Injectable on-chain call: given a pool + amount, returns amountOut (base units). */
export type QuoteSimulateFn = (pool: ListedPool, zeroForOne: boolean, amountIn: bigint) => Promise<bigint>

export interface QuoterReaderOptions {
  /** The token being SOLD — determines swap direction + which side is the buy token. */
  tokenIn: string
  /** Decimals of the buy token (the OTHER side of the pool from tokenIn). */
  buyTokenDecimals: number
  /** USD value of 1.0 whole buy token, if known (from LI.FI). */
  buyTokenPriceUsd?: number | null
  /** Internal-swap gas estimate in USD, if known (e.g. LI.FI's gas as a proxy). */
  gasCostUsd?: number | null
}

/**
 * Build a QuoterReader from an injected on-chain call. The reader normalizes the
 * raw amountOut into a RawPoolQuote; price/gas come from `opts` (the pool price
 * itself is sourced off-chain from LI.FI — see resolveSwapRoute's shared price).
 *
 * priceImpactPct is intentionally null: the V4 Quoter does not return a mid price,
 * so we do not fabricate an impact figure. Safety instead rests on pickBest's
 * strict gas-inclusive USD-improvement rule and MWRouter's amountOutMinimum floor.
 */
export function createQuoterReader(simulate: QuoteSimulateFn, opts: QuoterReaderOptions): QuoterReader {
  return {
    async quote(pool: ListedPool, amountIn: bigint): Promise<RawPoolQuote | null> {
      if (amountIn <= 0n || amountIn > UINT128_MAX) return null
      const zeroForOne = isZeroForOne(pool, opts.tokenIn)
      const amountOut = await simulate(pool, zeroForOne, amountIn)
      if (amountOut <= 0n) return null
      return {
        grossOut: amountOut,
        buyTokenPriceUsd: opts.buyTokenPriceUsd ?? null,
        gasCostUsd: opts.gasCostUsd ?? null,
        priceImpactPct: null,
        buyTokenDecimals: opts.buyTokenDecimals,
      }
    },
  }
}

/**
 * Production simulate: eth_call the V4Quoter via a viem public client. Kept as a
 * thin factory so the viem import stays out of the pure path. `publicClient` is a
 * viem client with `simulateContract`; typed loosely to avoid a hard viem dep here.
 */
export function viemQuoteSimulate(
  // Loosely typed to accept any viem PublicClient without pulling its heavy
  // generic simulateContract signature into this module.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: { simulateContract: (args: any) => Promise<{ result: unknown }> },
  quoterAddress: string,
): QuoteSimulateFn {
  return async (pool, zeroForOne, amountIn) => {
    const { result } = await publicClient.simulateContract({
      address: quoterAddress as `0x${string}`,
      abi: V4_QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          poolKey: {
            currency0: pool.currency0 as `0x${string}`,
            currency1: pool.currency1 as `0x${string}`,
            fee: pool.fee,
            tickSpacing: pool.tickSpacing,
            hooks: pool.hooks as `0x${string}`,
          },
          zeroForOne,
          exactAmount: amountIn,
          hookData: '0x',
        },
      ],
    })
    const tuple = result as readonly [bigint, bigint]
    return tuple[0]
  }
}

/** Derive USD-per-whole-buy-token from a LI.FI quote (input USD ÷ output whole). */
export function deriveBuyTokenPriceUsd(
  fromAmountUsd: number | null | undefined,
  lifiBuyAmount: bigint,
  buyTokenDecimals: number,
): number | null {
  if (fromAmountUsd == null || !Number.isFinite(fromAmountUsd) || fromAmountUsd <= 0) return null
  if (lifiBuyAmount <= 0n) return null
  if (!Number.isInteger(buyTokenDecimals) || buyTokenDecimals < 0 || buyTokenDecimals > 36) return null
  const whole = Number(lifiBuyAmount) / 10 ** buyTokenDecimals
  if (!Number.isFinite(whole) || whole <= 0) return null
  const price = fromAmountUsd / whole
  return Number.isFinite(price) ? price : null
}
