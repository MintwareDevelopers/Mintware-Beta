// Harvest seam: convert the harvested paired leg (e.g. PONS) → the quote asset (USDG) via a Uniswap V4
// swap through the target chain's Universal Router. Fail-safe: when the executor isn't wired it returns
// { quoteOut: 0n, txHash: null } — the harvest still records honestly, the unconverted paired fees simply
// stay in the recipient wallet for a later sweep. Never invents a conversion. Enabling it requires
// NEXT_PUBLIC_MW_ROUTER_ENABLED === 'true' AND LP_GATEWAY_ROUTER_ADDRESS set.
//
// User directive (2026-09-10): "Finish paired-token fee conversion." Researched before writing a single
// line: Robinhood Chain TESTNET (46630 — where the LP Gateway is actually deployed today) has NO Uniswap
// V4 deployment at all, confirmed directly against Uniswap's own official deployments page
// (developers.uniswap.org/docs/protocols/v4/deployments) — this is not a config gap on our side, the
// infrastructure genuinely doesn't exist there. Robinhood Chain MAINNET (4663) does have a real, actively
// used (50+ on-chain transactions observed directly on its block explorer) Universal Router at
// 0x8876789976dEcBfCbBbe364623C63652db8C0904 — so this implementation targets THAT, and is INERT until
// (unless) the gateway itself is ever deployed to mainnet: `LP_GATEWAY_ROUTER_ADDRESS` stays unset on the
// current testnet deployment, so the fail-closed no-op branch below is what actually runs today.
//
// ⚠ HONEST VERIFICATION SCOPE — read before ever setting LP_GATEWAY_ROUTER_ADDRESS in a real deploy:
// The mainnet router's OWN verified "source" on the block explorer is a stub file (`StubContract.sol`) —
// its real implementation is not published, so nothing here could be checked against real Solidity
// source. What this encoding IS based on:
//   1. Directly verified, live, on 2026-09-10: the router's real on-chain function selectors (via the
//      Robinhood Chain mainnet block explorer's Read/Write Contract tab) show TWO `execute` overloads
//      plus Robinhood-specific extras (`executeSigned`, `SPOKE_POOL`, `signedRouteContext`) — consistent
//      with a genuinely modified fork, not a stock deployment, matching what's claimed below.
//   2. A third-party integrator's technical documentation (docs.bags.fm/robinhood/trade-tokens) describing
//      the exact modified V4 swap struct, command byte, and action sequence used below — NOT Uniswap's or
//      Robinhood's own official docs (neither publishes this; both were checked directly and came up
//      empty). This is the best available public source, but it is still third-party, not verified against
//      the actual bytecode or a live simulation.
// NOT verified: no fork test was run (no mainnet RPC access in this sandbox), no bytecode decompilation,
// no live test transaction. An operator MUST verify with a small, monitored test swap — ideally a real
// fork test against Robinhood Chain mainnet — before this is ever trusted with real funds. Gated behind
// two independent flags for exactly this reason (both off by default): NEXT_PUBLIC_MW_ROUTER_ENABLED and
// LP_GATEWAY_ROUTER_ADDRESS.

import { encodeAbiParameters, encodePacked } from 'viem'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { readCurrentTick, type GatewayPoolKey } from '@/lib/gateway/poolState'
import { pairedToQuoteAtSpot, applyToleranceBps } from '@/lib/gateway/v4Math'
import { estimateGasWithFloor } from '@/lib/gateway/gasEstimate'

type Logger = { warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void }

export type SwapResult = { quoteOut: bigint; txHash: string | null }

// Robinhood Chain's modified Universal Router — see the header note above for exactly what this encoding
// is (and isn't) verified against.
const UNIVERSAL_ROUTER_ABI = [
  {
    type: 'function', stateMutability: 'payable', name: 'execute',
    inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }],
    outputs: [],
  },
] as const

const ERC20_ABI = [
  { type: 'function', stateMutability: 'nonpayable', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', stateMutability: 'view', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', stateMutability: 'view', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

// Universal Router Commands.sol: V4_SWAP. Uniswap V4 Actions.sol: SWAP_EXACT_IN_SINGLE / SETTLE_ALL /
// TAKE_ALL. These three are STANDARD, unmodified Uniswap constants (cross-referenced against the
// third-party integration doc, which quotes the identical byte values) — the router's modification is
// entirely inside the ExactInputSingleParams struct below (the extra minHopPriceX36 field), not in these
// command/action selectors.
const V4_SWAP_COMMAND = 0x10
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06
const ACTION_SETTLE_ALL = 0x0c
const ACTION_TAKE_ALL = 0x0f

const POOL_KEY_COMPONENTS = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const

/** Builds the full `execute(commands, inputs, deadline)` calldata for a single-hop V4 exact-input swap on
 *  Robinhood Chain's MODIFIED Universal Router. Pure and deterministic — exported so the exact bytes this
 *  produces are unit-testable independent of any live chain call (see the header note for what this
 *  encoding is and isn't verified against). `minHopPriceX36` is always 0 (disabled) per the integration
 *  doc this was sourced from — Robinhood's own risk-control field, not something this gateway needs to
 *  set for a simple exact-in single-hop swap. */
export function buildV4SwapCalldata(opts: {
  poolKey: GatewayPoolKey
  zeroForOne: boolean
  amountIn: bigint
  amountOutMinimum: bigint
  inputCurrency: `0x${string}`
  outputCurrency: `0x${string}`
  deadline: bigint
}): { commands: `0x${string}`; inputs: readonly `0x${string}`[]; deadline: bigint } {
  const { poolKey, zeroForOne, amountIn, amountOutMinimum, inputCurrency, outputCurrency, deadline } = opts

  const swapParams = encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'poolKey', type: 'tuple', components: POOL_KEY_COMPONENTS },
        { name: 'zeroForOne', type: 'bool' },
        { name: 'amountIn', type: 'uint128' },
        { name: 'amountOutMinimum', type: 'uint128' },
        { name: 'minHopPriceX36', type: 'uint256' },
        { name: 'hookData', type: 'bytes' },
      ],
    }],
    [{ poolKey, zeroForOne, amountIn, amountOutMinimum, minHopPriceX36: 0n, hookData: '0x' }],
  )
  const settleParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inputCurrency, amountIn])
  const takeParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outputCurrency, amountOutMinimum])

  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL])
  const v4SwapInput = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swapParams, settleParams, takeParams]])
  const commands = encodePacked(['uint8'], [V4_SWAP_COMMAND])

  return { commands, inputs: [v4SwapInput], deadline }
}

function swapSlippageBps(): number {
  const n = Number(process.env.LP_GATEWAY_SWAP_SLIPPAGE_BPS ?? '100') // same default/knob deploy.ts's own zap uses
  return Number.isFinite(n) && n >= 0 && n < 10_000 ? n : 100
}

export async function swapPairedToQuote(opts: {
  // The SPECIFIC instance being harvested — harvest.ts iterates over every registered instance
  // (listAllInstances), not just cfg's single-env fallback. Using process.env.LP_GATEWAY_POSITION_MANAGER
  // here instead would be a real bug: it would silently swap against the WRONG pool's price/keys for
  // every instance other than the env-fallback one, or no-op entirely for all of them if that var is
  // unset while real registry instances exist.
  positionManager: `0x${string}`
  account: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallet: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any
  pairedAmount: bigint
  log?: Logger
}): Promise<SwapResult> {
  const { positionManager, account, wallet, publicClient, pairedAmount, log } = opts
  if (pairedAmount <= 0n) return { quoteOut: 0n, txHash: null }

  // Both flags independently gate this — see the header note for why. Neither is set for the current
  // testnet deployment, so this branch (never fabricating a conversion) is what actually runs today.
  const routerEnabled = process.env.NEXT_PUBLIC_MW_ROUTER_ENABLED === 'true'
  const routerAddress = process.env.LP_GATEWAY_ROUTER_ADDRESS as `0x${string}` | undefined
  if (!routerEnabled || !routerAddress) {
    log?.warn('gateway.harvest', 'paired-leg swap seam not wired; leaving paired fees unconverted', {
      pairedAmount: pairedAmount.toString(),
    })
    return { quoteOut: 0n, txHash: null }
  }

  try {
    const pm = (functionName: 'poolKey' | 'poolManager' | 'quoteAsset' | 'pairedAsset') =>
      publicClient.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName })
    const [poolKey, poolManager, quoteAsset, pairedAsset] = (await Promise.all([
      pm('poolKey'), pm('poolManager'), pm('quoteAsset'), pm('pairedAsset'),
    ])) as [GatewayPoolKey, `0x${string}`, `0x${string}`, `0x${string}`]

    const slot0 = await readCurrentTick({ client: publicClient, poolManager, poolKey })
    if (!slot0 || slot0.sqrtPriceX96 <= 0n) {
      log?.warn('gateway.harvest', 'pool price unreadable — leaving paired fees unconverted rather than guess a swap size', {})
      return { quoteOut: 0n, txHash: null }
    }
    const quoteIsCurrency0 = quoteAsset.toLowerCase() === poolKey.currency0.toLowerCase()
    // zeroForOne: swapping the PAIRED leg → quote. If quote is currency0, paired is currency1, so this
    // swap goes currency1 → currency0, i.e. zeroForOne = false; the mirror otherwise.
    const zeroForOne = !quoteIsCurrency0

    const expectedQuoteOut = pairedToQuoteAtSpot(pairedAmount, slot0.sqrtPriceX96, quoteIsCurrency0)
    const minQuoteOut = applyToleranceBps(expectedQuoteOut, swapSlippageBps())
    if (minQuoteOut <= 0n) {
      log?.warn('gateway.harvest', 'expected swap output rounds to zero — leaving paired fees unconverted', { pairedAmount: pairedAmount.toString() })
      return { quoteOut: 0n, txHash: null }
    }

    const owner = (account as { address: `0x${string}` }).address

    // Approve the router for the paired amount only if the current allowance is insufficient — never a
    // blanket/unlimited approval, minimizes standing allowance to what this specific harvest needs.
    const currentAllowance = (await publicClient.readContract({
      address: pairedAsset, abi: ERC20_ABI, functionName: 'allowance', args: [owner, routerAddress],
    })) as bigint
    if (currentAllowance < pairedAmount) {
      const approveArgs = { address: pairedAsset, abi: ERC20_ABI, functionName: 'approve', args: [routerAddress, pairedAmount], account } as const
      const { gas: approveGas } = await estimateGasWithFloor(publicClient, approveArgs, 80_000n)
      const approveTx = await wallet.writeContract({ ...approveArgs, chain: publicClient.chain, gas: approveGas })
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx })
      if (approveReceipt.status !== 'success') {
        log?.warn('gateway.harvest', 'router approval failed — leaving paired fees unconverted', { approveTx })
        return { quoteOut: 0n, txHash: null }
      }
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
    const { commands, inputs } = buildV4SwapCalldata({
      poolKey, zeroForOne, amountIn: pairedAmount, amountOutMinimum: minQuoteOut,
      inputCurrency: pairedAsset, outputCurrency: quoteAsset, deadline,
    })
    const swapArgs = { address: routerAddress, abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, deadline], account } as const

    // Balance-diff measurement, not an event-log parse — mirrors the same discipline
    // MintwareLpGatewayStaging.unstage() already uses elsewhere in this codebase (measure by balance
    // delta, X-3) rather than trusting a specific Swap-event shape this modified router's real event
    // signatures were never independently verified for.
    const quoteBalanceBefore = (await publicClient.readContract({ address: quoteAsset, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] })) as bigint

    const { gas: swapGas } = await estimateGasWithFloor(publicClient, swapArgs, 400_000n)
    const swapTx = await wallet.writeContract({ ...swapArgs, chain: publicClient.chain, gas: swapGas })

    // From here on, a REAL transaction has been submitted on-chain — losing `swapTx` now would mean the
    // paired fees might actually convert (or already have) with no record anywhere to reconcile against.
    // Codex live-watch caught an earlier version of this function letting any error past this point fall
    // through to the outer catch below, which discards the hash entirely (`txHash: null`) — indistinguishable
    // from "never submitted". Every path below this line returns `swapTx`, never null, even on failure.
    try {
      const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapTx })
      if (swapReceipt.status !== 'success') {
        log?.warn('gateway.harvest', 'router swap tx reverted — leaving paired fees unconverted', { swapTx })
        return { quoteOut: 0n, txHash: swapTx }
      }

      const quoteBalanceAfter = (await publicClient.readContract({ address: quoteAsset, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] })) as bigint
      const quoteOut = quoteBalanceAfter > quoteBalanceBefore ? quoteBalanceAfter - quoteBalanceBefore : 0n
      return { quoteOut, txHash: swapTx }
    } catch (e) {
      // The submit succeeded; only confirming it (or measuring its result) failed — e.g. an RPC drop or
      // timeout on waitForTransactionReceipt, not a revert. quoteOut is honestly unmeasured (0n, never
      // guessed), but the hash is preserved so an operator/ledger can look the tx up on-chain later rather
      // than silently losing track of a real on-chain swap.
      log?.warn('gateway.harvest', 'router swap submitted but could not be confirmed — txHash preserved for reconciliation, not treated as failed or unconverted', { swapTx, error: String(e) })
      return { quoteOut: 0n, txHash: swapTx }
    }
  } catch (e) {
    log?.warn('gateway.harvest', 'paired-leg swap failed before submission — leaving paired fees unconverted rather than fail the whole harvest', { error: String(e) })
    return { quoteOut: 0n, txHash: null }
  }
}

// Earn-vs-LP decision (docs/developers/lp-gateway-earn-vs-lp-decision.md, 2026-09-08): the deploy-side zap
// (quote → paired, to acquire the second leg before `deploy()`) that used to live here is GONE. `deploy()`
// on `MintwareLpGatewayPositionManager` now executes that swap itself, atomically, in-contract — there is
// no off-chain step left that "acquires the paired leg" for the caller to supply. See
// `lib/gateway/deploy.ts` (sizes `swapAmount`/`minPairedOut` from live pool state) and the contract's own
// `_executeSwap`/`unlockCallback`. `swapPairedToQuote` above is UNRELATED and unaffected — it converts
// harvested paired-token FEES back to quote, a genuinely separate off-chain seam.
