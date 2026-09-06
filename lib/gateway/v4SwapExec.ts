// V4 swap executor for the harvest (paired→quote) and deploy zap (quote→paired) seams. Submits an
// exact-in single-pool swap through the Uniswap Universal Router with a QUOTE→MIN-OUT slippage guard
// (V4 Quoter gives the expected out; we require expected×(1−slippage)). Reads the exact PoolKey from the
// position manager so it always swaps the right pool.
//
// ⚠ MONEY-MOVING + UNTESTED IN CI. Hard-gated: no-ops (returns 0 out) unless LP_GATEWAY_ROUTER_ADDRESS +
// LP_GATEWAY_QUOTER are set. It MUST be fork-tested against the real pool before enabling on any network
// that holds value — the seam fails closed (deploy/harvest simply skip the conversion) until then.

import { encodeAbiParameters, encodeFunctionData, http, createWalletClient } from 'viem'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'

type Logger = { warn: (t: string, m: string, c?: Record<string, unknown>) => void; error: (t: string, m: string, c?: Record<string, unknown>) => void }

// V4 action opcodes (v4-periphery Actions) used in a Universal Router V4_SWAP.
const SWAP_EXACT_IN_SINGLE = 0x06
const SETTLE_ALL = 0x0c
const TAKE_ALL = 0x0f
const V4_SWAP_COMMAND = '0x10'

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

const POOL_KEY_COMPONENTS = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const

const UNIVERSAL_ROUTER_ABI = [
  { type: 'function', stateMutability: 'payable', name: 'execute', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
] as const

const V4_QUOTER_ABI = [
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'quoteExactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: POOL_KEY_COMPONENTS },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
  },
] as const

const PERMIT2_ABI = [
  { type: 'function', stateMutability: 'nonpayable', name: 'approve', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [] },
] as const

const ERC20_ABI = [
  { type: 'function', stateMutability: 'view', name: 'balanceOf', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'nonpayable', name: 'approve', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

type PoolKey = { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` }

function slippageBps(): number {
  const n = Number(process.env.LP_GATEWAY_SWAP_SLIPPAGE_BPS ?? '100') // default 1%
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : 100
}

/** Exact-in single-pool swap via the Universal Router, guarded by a V4-Quoter min-out. Returns the
 *  quote-terms output actually received. No-ops (0) when unconfigured or on any failure — never a bad swap. */
export async function executeV4Swap(opts: {
  publicClient: { readContract: (a: any) => Promise<unknown>; simulateContract: (a: any) => Promise<{ result: unknown }>; waitForTransactionReceipt: (a: any) => Promise<{ status: string }> }
  account: unknown
  chain: unknown
  rpcUrl: string
  positionManager: `0x${string}`
  direction: 'pairedToQuote' | 'quoteToPaired'
  amountIn: bigint
  log?: Logger
}): Promise<{ amountOut: bigint; txHash: string | null }> {
  const { publicClient, account, chain, rpcUrl, positionManager, direction, amountIn, log } = opts
  const router = process.env.LP_GATEWAY_ROUTER_ADDRESS as `0x${string}` | undefined
  const quoter = process.env.LP_GATEWAY_QUOTER as `0x${string}` | undefined
  if (amountIn <= 0n) return { amountOut: 0n, txHash: null }
  if (!router || !quoter) {
    log?.warn('gateway.swap', 'router/quoter not configured — swap seam no-op', { direction })
    return { amountOut: 0n, txHash: null }
  }

  try {
    const read = (fn: string) => publicClient.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName: fn })
    const [poolKey, quoteAsset, pairedAsset] = (await Promise.all([read('poolKey'), read('quoteAsset'), read('pairedAsset')])) as [PoolKey, `0x${string}`, `0x${string}`]
    const inputToken = direction === 'pairedToQuote' ? pairedAsset : quoteAsset
    const outputToken = direction === 'pairedToQuote' ? quoteAsset : pairedAsset
    const zeroForOne = inputToken.toLowerCase() === poolKey.currency0.toLowerCase()

    // 1) quote → min-out slippage floor
    const q = (await publicClient.simulateContract({
      address: quoter, abi: V4_QUOTER_ABI, functionName: 'quoteExactInputSingle',
      args: [{ poolKey, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
    })) as { result: readonly [bigint, bigint] }
    const expectedOut = q.result[0]
    if (expectedOut <= 0n) return { amountOut: 0n, txHash: null }
    const minOut = (expectedOut * BigInt(10_000 - slippageBps())) / 10_000n

    // viem's wallet-client generics don't survive the loose external-caller types here; the executor is
    // gated + fork-test-required, so a local any keeps it honest without fighting the type system.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wallet = createWalletClient({ account: account as never, chain: chain as never, transport: http(rpcUrl) }) as any

    // 2) approve Permit2 → Universal Router for the input token
    await wallet.writeContract({ address: inputToken, abi: ERC20_ABI, functionName: 'approve', args: [PERMIT2, amountIn], account: account as never, chain: chain as never })
    await wallet.writeContract({ address: PERMIT2, abi: PERMIT2_ABI, functionName: 'approve', args: [inputToken, router, amountIn, Math.floor(Date.now() / 1000) + 1800], account: account as never, chain: chain as never })

    // 3) build the V4_SWAP: SWAP_EXACT_IN_SINGLE → SETTLE_ALL(input) → TAKE_ALL(output, minOut)
    const actions = ('0x' + [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL].map((a) => a.toString(16).padStart(2, '0')).join('')) as `0x${string}`
    const swapParams = encodeAbiParameters(
      [{ type: 'tuple', components: [{ name: 'poolKey', type: 'tuple', components: POOL_KEY_COMPONENTS }, { name: 'zeroForOne', type: 'bool' }, { name: 'amountIn', type: 'uint128' }, { name: 'amountOutMinimum', type: 'uint128' }, { name: 'hookData', type: 'bytes' }] }],
      [{ poolKey, zeroForOne, amountIn, amountOutMinimum: minOut, hookData: '0x' }],
    )
    const settleParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inputToken, amountIn])
    const takeParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outputToken, minOut])
    const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swapParams, settleParams, takeParams]])

    const before = (await publicClient.readContract({ address: outputToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [(account as { address: `0x${string}` }).address] })) as bigint

    const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [V4_SWAP_COMMAND, [input], BigInt(Math.floor(Date.now() / 1000) + 600)] })
    const txHash = await wallet.sendTransaction({ account: account as never, chain: chain as never, to: router, data })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') return { amountOut: 0n, txHash }

    const after = (await publicClient.readContract({ address: outputToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [(account as { address: `0x${string}` }).address] })) as bigint
    return { amountOut: after > before ? after - before : 0n, txHash }
  } catch (e) {
    log?.error('gateway.swap', 'v4 swap failed', { error: String(e), direction })
    return { amountOut: 0n, txHash: null }
  }
}
