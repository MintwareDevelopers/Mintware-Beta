// Harvest seam: convert the harvested paired leg (e.g. PONS) → the quote asset (USDG) via the MW
// meta-router. Kept a seam because on-chain swap EXECUTION on the target pool (Universal Router on
// Robinhood Chain) is a deploy/infra step, not code the app can safely fabricate. Fail-safe: when the
// executor isn't wired it returns { quoteOut: 0n, txHash: null } — the harvest still records honestly,
// the unconverted paired fees simply stay in the recipient wallet for a later sweep. Never invents a
// conversion. Enabling it requires NEXT_PUBLIC_MW_ROUTER_ENABLED === 'true' AND a wired executor.

import type { GatewayConfig } from '@/lib/gateway/chain'

type Logger = { warn: (tag: string, msg: string, ctx?: Record<string, unknown>) => void }

export type SwapResult = { quoteOut: bigint; txHash: string | null }

export async function swapPairedToQuote(opts: {
  cfg: GatewayConfig
  account: unknown
  wallet: unknown
  publicClient: unknown
  pairedAmount: bigint
  log?: Logger
}): Promise<SwapResult> {
  const { pairedAmount, log } = opts
  if (pairedAmount <= 0n) return { quoteOut: 0n, txHash: null }

  // Phase-1 gate: the router flow is opt-in AND needs an on-chain swap executor (Universal Router
  // address + route builder) that is wired at deploy, not here. Until then, no-op — never fabricate.
  const routerEnabled = process.env.NEXT_PUBLIC_MW_ROUTER_ENABLED === 'true'
  const executorWired = !!process.env.LP_GATEWAY_ROUTER_ADDRESS // set only once the executor is deployed
  if (!routerEnabled || !executorWired) {
    log?.warn('gateway.harvest', 'paired-leg swap seam not wired; leaving paired fees unconverted', {
      pairedAmount: pairedAmount.toString(),
    })
    return { quoteOut: 0n, txHash: null }
  }

  // TODO(deploy): build the paired→quote route via lib/web2/router/* and submit through the Universal
  // Router with an oracle-bounded slippage floor, then return the realized quote-out + tx hash.
  log?.warn('gateway.harvest', 'router executor configured but swap path not yet implemented', {})
  return { quoteOut: 0n, txHash: null }
}

// Earn-vs-LP decision (docs/developers/lp-gateway-earn-vs-lp-decision.md, 2026-09-08): the deploy-side zap
// (quote → paired, to acquire the second leg before `deploy()`) that used to live here is GONE. `deploy()`
// on `MintwareLpGatewayPositionManager` now executes that swap itself, atomically, in-contract — there is
// no off-chain step left that "acquires the paired leg" for the caller to supply. See
// `lib/gateway/deploy.ts` (sizes `swapAmount`/`minPairedOut` from live pool state) and the contract's own
// `_executeSwap`/`unlockCallback`. `swapPairedToQuote` above is UNRELATED and unaffected — it converts
// harvested paired-token FEES back to quote, a genuinely separate off-chain seam.
