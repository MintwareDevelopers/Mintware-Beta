// =============================================================================
// lib/web2/providers/mwInternal.ts — client provider for MWRouter internal swaps
//
// The third swap provider alongside lifi + molten. Selected PER-QUOTE (not per
// chain) when the meta-router (POST /api/swap/best-route) says a Mintware V4 pool
// beats LI.FI. `fetchBestRoute` gets the decision + builds an executable quote;
// `executeSwap` approves + calls MWRouter.swapExactInputSingle.
//
// Inert until Slice 2 is deployed: the route returns a non-internal winner unless
// the router is enabled, configured, and the pair is listed → fetchBestRoute → null
// → useQuote keeps the LI.FI quote.
// =============================================================================

import { encodeAbiParameters } from 'viem'
import type { PublicClient, WalletClient } from 'viem'
import { isRouterEnabled } from '@/lib/web2/router/config'

export interface MwInternalPoolKey {
  currency0: string
  currency1: string
  fee: number
  tickSpacing: number
  hooks: string
}

/** Executable internal quote — display fields mirror LifiQuote; the rest is the payload. */
export interface MwInternalQuote {
  provider: 'mw-internal'
  buyAmount: string            // net output (userOut), base units — display parity
  price: string                // '0' (aggregator parity; impact shown as null)
  estimatedGas: string
  fromAmountUSD?: string
  // execution payload
  router: string
  poolKey: MwInternalPoolKey
  zeroForOne: boolean
  amountIn: string             // base units (wei)
  amountOutMinimum: string     // base units (wei), net of slippage
}

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const MW_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        components: [
          {
            name: 'key',
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
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'tag', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

export interface FetchBestRouteInput {
  chainId: number
  tokenIn: string
  tokenOut: string
  amountInWei: string
  buyTokenDecimals: number
  lifiBuyAmount: string
  lifiGasCostUsd: number | null
  fromAmountUsd: number | null
  /** Slippage floor applied to the quoted net output. Default 50 bps (0.5%). */
  slippageBps?: number
  signal?: AbortSignal
}

/**
 * Ask the meta-router whether a Mintware pool wins. Returns an executable internal
 * quote only when the winner is `mw-internal`; otherwise null (caller keeps LI.FI).
 * Best-effort: any error → null.
 */
export async function fetchBestRoute(input: FetchBestRouteInput): Promise<MwInternalQuote | null> {
  if (!isRouterEnabled()) return null
  try {
    const res = await fetch('/api/swap/best-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        chainId: input.chainId,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amountIn: input.amountInWei,
        buyTokenDecimals: input.buyTokenDecimals,
        lifiBuyAmount: input.lifiBuyAmount,
        lifiGasCostUsd: input.lifiGasCostUsd,
        fromAmountUsd: input.fromAmountUsd,
      }),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (d?.winner !== 'mw-internal' || !d.pool || !d.best?.buyAmount) return null

    const userOut = BigInt(d.best.buyAmount)
    if (userOut <= 0n) return null
    const slippageBps = BigInt(input.slippageBps ?? 50)
    const minOut = userOut - (userOut * slippageBps) / 10_000n

    return {
      provider: 'mw-internal',
      buyAmount: userOut.toString(),
      price: '0',
      estimatedGas: '250000',
      fromAmountUSD: input.fromAmountUsd != null ? String(input.fromAmountUsd) : undefined,
      router: d.pool.router,
      poolKey: {
        currency0: d.pool.currency0,
        currency1: d.pool.currency1,
        fee: d.pool.fee,
        tickSpacing: d.pool.tickSpacing,
        hooks: d.pool.hooks,
      },
      zeroForOne: input.tokenIn.toLowerCase() === String(d.pool.currency0).toLowerCase(),
      amountIn: input.amountInWei,
      amountOutMinimum: minOut.toString(),
    }
  } catch {
    return null
  }
}

/**
 * Execute an internal swap: ensure the router has an allowance for the input token,
 * then call MWRouter.swapExactInputSingle. Returns the swap tx hash.
 */
export async function executeSwap(
  quote: MwInternalQuote,
  walletClient: WalletClient,
  publicClient: PublicClient,
  opts?: { campaignId?: string | null; referrer?: string | null },
): Promise<`0x${string}`> {
  const account = walletClient.account
  if (!account) throw new Error('Wallet not connected')
  const taker = account.address

  const tokenIn = (quote.zeroForOne ? quote.poolKey.currency0 : quote.poolKey.currency1) as `0x${string}`
  const router = quote.router as `0x${string}`
  const amountIn = BigInt(quote.amountIn)

  // Ensure allowance (approve exact amount if short).
  const allowance = (await publicClient.readContract({
    address: tokenIn,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [taker, router],
  })) as bigint
  if (allowance < amountIn) {
    const approveHash = await walletClient.writeContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [router, amountIn],
      account,
      chain: walletClient.chain,
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
  }

  const tag = encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }],
    [opts?.campaignId ?? '', opts?.referrer ?? ''],
  )
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200) // +20 min

  return walletClient.writeContract({
    address: router,
    abi: MW_ROUTER_ABI,
    functionName: 'swapExactInputSingle',
    args: [
      {
        key: {
          currency0: quote.poolKey.currency0 as `0x${string}`,
          currency1: quote.poolKey.currency1 as `0x${string}`,
          fee: quote.poolKey.fee,
          tickSpacing: quote.poolKey.tickSpacing,
          hooks: quote.poolKey.hooks as `0x${string}`,
        },
        zeroForOne: quote.zeroForOne,
        amountIn,
        amountOutMinimum: BigInt(quote.amountOutMinimum),
        recipient: taker,
        deadline,
        tag,
      },
    ],
    account,
    chain: walletClient.chain,
  })
}
