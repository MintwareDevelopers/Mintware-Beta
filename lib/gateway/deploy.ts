// LP-gateway pair/deploy orchestration — moves staged (Morpho-earning) quote capital into the target
// V4 pool once a threshold is reached. Owner-gated on-chain (getOracleSigner('gateway') is the position
// manager's owner — a DEDICATED Privy seat, not the shared root); the paired leg is acquired by zapping via the MW router seam. YIELD/PRINCIPAL note:
// this deploys PRINCIPAL from staging into the LP (that's the product) — it never spends principal on a
// buffer; the yield-first rule governs the buffer path (harvest.ts), not this.
//
// DARK-LAUNCHED, fail-closed, OFF by default: no-ops unless LP_GATEWAY_DEPLOY_ENABLED === 'true' and the
// config + staging address + oracle signer resolve. Also no-ops (safely) while the zap seam is unwired.

import { createWalletClient, http } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI, LP_STAGING_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listActiveInstances } from '@/lib/gateway/registry'
import { swapQuoteToPaired } from '@/lib/gateway/routerSwap'
import { readCurrentTick, type GatewayPoolKey } from '@/lib/gateway/poolState'
import { getSqrtPriceAtTick, getLiquidityForAmounts, isInRange, applyToleranceBps } from '@/lib/gateway/v4Math'

export type DeployInstance = { positionManager: `0x${string}`; staging: `0x${string}` }

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { info: (t: string, m: string, c?: Record<string, unknown>) => void; warn: (t: string, m: string, c?: Record<string, unknown>) => void; error: (t: string, m: string, c?: Record<string, unknown>) => void }

type Reason =
  | 'disabled' | 'config' | 'signer' | 'below_threshold' | 'zap_unwired' | 'tx' | 'duplicate'
  | 'min_liquidity_unset' // kept for callers that match on it: the computed floor came out 0
  | 'out_of_range' // spot is outside the gateway's fixed range — a balanced two-leg deploy is not what the cron intended
  | 'price_unreadable' // slot0 / pool coordinates unreadable — no honest floor can be set
export type DeployOutcome =
  | { ok: true; deployTx: `0x${string}`; quoteDeployedAtomic: bigint; pairedDeployedAtomic: bigint; minLiquidity: bigint }
  | { ok: false; status: number; error: string; reason: Reason }

const deployRatioBps = () => {
  const n = Number(process.env.LP_GATEWAY_DEPLOY_RATIO_BPS ?? '5000') // default 50% deployed / 50% idle
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 5000
}

// O-9 / HO-8: the sandwich floor is computed PER POOL from spot, not one global absolute-L env value.
export const DEFAULT_DEPLOY_TOL_BPS = 100 // 1% below the liquidity the amounts fund at the current spot
const deployTolBps = () => {
  const n = Number(process.env.LP_GATEWAY_DEPLOY_TOL_BPS ?? String(DEFAULT_DEPLOY_TOL_BPS))
  return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : DEFAULT_DEPLOY_TOL_BPS
}

export type MinLiquidityInput = {
  sqrtPriceX96: bigint // live slot0
  tickLower: number
  tickUpper: number
  quoteIsCurrency0: boolean
  quoteToDeploy: bigint
  pairedOut: bigint
  tolBps?: number // default DEFAULT_DEPLOY_TOL_BPS
  envFloor?: bigint // optional operator floor (LP_GATEWAY_DEPLOY_MIN_LIQUIDITY) — max(computed, env)
}
export type MinLiquidityResult =
  | { ok: true; minLiquidity: bigint; expectedLiquidity: bigint; envFloorApplied: boolean }
  | { ok: false; reason: 'out_of_range' | 'min_liquidity_unset' }

/** Mirror of the contract's own `LiquidityAmounts.getLiquidityForAmounts(spot, A, B, amount0, amount1)`
 *  (the exact L `deploy()` mints), haircut by `tolBps`. Out of range ⇒ refuse (a one-sided mint is not
 *  the balanced deploy the cron sized); computed 0 ⇒ refuse (never switch the M-03 floor off). The env
 *  value is only ever an ADDITIONAL floor — it can raise the bar, never lower it. */
export function computeDeployMinLiquidity(i: MinLiquidityInput): MinLiquidityResult {
  const sqrtA = getSqrtPriceAtTick(i.tickLower)
  const sqrtB = getSqrtPriceAtTick(i.tickUpper)
  if (!isInRange(i.sqrtPriceX96, sqrtA, sqrtB)) return { ok: false, reason: 'out_of_range' }
  const [amount0, amount1] = i.quoteIsCurrency0 ? [i.quoteToDeploy, i.pairedOut] : [i.pairedOut, i.quoteToDeploy]
  const expectedLiquidity = getLiquidityForAmounts(i.sqrtPriceX96, sqrtA, sqrtB, amount0, amount1)
  const computed = applyToleranceBps(expectedLiquidity, i.tolBps ?? DEFAULT_DEPLOY_TOL_BPS)
  if (computed <= 0n) return { ok: false, reason: 'min_liquidity_unset' }
  const env = i.envFloor ?? 0n
  const envFloorApplied = env > computed
  return { ok: true, minLiquidity: envFloorApplied ? env : computed, expectedLiquidity, envFloorApplied }
}

// L-02: per-pool-per-window idempotency window. A concurrent/retried cron run within the same window
// claims the SAME (position_manager, chain, window_key) row — the UNIQUE index makes the second claim
// conflict, so at most ONE deploy tx fires per pool per window and a retry can't compound-deploy.
const deployWindowSecs = () => {
  const n = Number(process.env.LP_GATEWAY_DEPLOY_WINDOW_SECS ?? '3600') // default 1h
  return Number.isInteger(n) && n >= 1 ? n : 3600
}
export function deployWindowKey(nowMs: number, windowSecs: number): number {
  return Math.floor(Math.floor(nowMs / 1000) / windowSecs)
}

/** Deploy staged capital for EVERY active gateway (registry + single-env fallback). Cron entry point. */
export async function deployAll(opts: { supabase: SupabaseClient; log?: Logger }): Promise<{ deployed: number; results: DeployOutcome[] }> {
  if (process.env.LP_GATEWAY_DEPLOY_ENABLED !== 'true') {
    return { deployed: 0, results: [{ ok: false, status: 503, error: 'gateway deploy is not enabled', reason: 'disabled' }] }
  }
  const cfg = gatewayConfig()
  if (!cfg) return { deployed: 0, results: [{ ok: false, status: 503, error: 'gateway_not_configured', reason: 'config' }] }
  const active = await listActiveInstances(opts.supabase, cfg.chainId)
  const targets: DeployInstance[] = active.length
    ? active.map((i) => ({ positionManager: i.positionManager, staging: i.staging }))
    : cfg.positionManager && cfg.staging
      ? [{ positionManager: cfg.positionManager, staging: cfg.staging }]
      : []
  const results: DeployOutcome[] = []
  let deployed = 0
  for (const instance of targets) {
    const r = await deployGateway({ supabase: opts.supabase, log: opts.log, instance })
    results.push(r)
    if (r.ok) deployed++
  }
  return { deployed, results }
}

export async function deployGateway(opts: { supabase?: SupabaseClient; log?: Logger; instance: DeployInstance }): Promise<DeployOutcome> {
  const { log, instance } = opts
  if (process.env.LP_GATEWAY_DEPLOY_ENABLED !== 'true') {
    return { ok: false, status: 503, error: 'gateway deploy is not enabled', reason: 'disabled' }
  }
  const cfg = gatewayConfig()
  if (!cfg) return { ok: false, status: 503, error: 'gateway_not_configured', reason: 'config' }

  const publicClient = gatewayPublicClient(cfg)
  const staged = (await publicClient.readContract({
    address: instance.staging, abi: LP_STAGING_ABI, functionName: 'stagedAssets',
  })) as bigint

  const threshold = BigInt(process.env.LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC ?? '0')
  if (threshold === 0n || staged < threshold) {
    return { ok: false, status: 200, error: 'staged balance below deploy threshold', reason: 'below_threshold' }
  }

  let account
  try {
    account = await getOracleSigner('gateway') // dedicated gateway-owner seat (re-audit A-3), never the shared root
  } catch (e) {
    log?.error('gateway.deploy', 'oracle signer unavailable', { error: String(e) })
    return { ok: false, status: 503, error: 'deploy_signer_unavailable', reason: 'signer' }
  }
  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(cfg.rpcUrl) })

  // IL control: deploy only a FRACTION of staged into the IL-bearing LP; the rest stays idle in Morpho,
  // earning lending yield with ZERO impermanent loss. LP_GATEWAY_DEPLOY_RATIO_BPS (default 5000 = 50%)
  // is the knob — lower it for a more conservative (lower-IL) posture on a volatile meme pool.
  // Re-audit A-3 (F-06) + red-team RT-9a: the old `staged × ratio` was PER-RUN (converged to ~100% deployed),
  // and a NAV-based target re-opened after every drawdown — a dumping paired token let the honest top-up
  // rule cycle 2/3 of principal into the pool. Target the fraction of PRINCIPAL AT COST instead:
  // deployable = ratio·(staged + deployedPrincipal) − deployedPrincipal. Cost basis never falls with price,
  // so a drawdown NEVER triggers a top-up. Mirrors the contract's own MAX_DEPLOY_BPS check (which would
  // revert anyway) and honours a tighter operator ratio.
  const deployedPrincipal = (await publicClient.readContract({
    address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'deployedPrincipal',
  })) as bigint
  const principal = staged + deployedPrincipal
  const target = (principal * BigInt(deployRatioBps())) / 10_000n
  const deployable = target > deployedPrincipal ? target - deployedPrincipal : 0n
  if (deployable <= 0n) {
    return { ok: false, status: 200, error: 'deployed fraction is already at/above the target ratio', reason: 'below_threshold' }
  }
  // Split the deployable amount: half stays quote, half zaps to the paired leg (balanced-range target).
  const quoteToDeploy = deployable / 2n
  const zap = await swapQuoteToPaired({ cfg, account, wallet, publicClient, quoteAmount: deployable - quoteToDeploy, log })
  if (zap.pairedOut <= 0n) {
    // Fail-closed: without the paired leg deploy() can't proceed. The seam is honest, not a bad swap.
    return { ok: false, status: 200, error: 'paired-leg zap not available', reason: 'zap_unwired' }
  }

  // Re-audit A-3 + round-2 O-9 (HO-8): the M-03 sandwich floor is computed PER POOL from the live spot —
  // the exact liquidity the contract will mint for (quoteToDeploy, pairedOut) at this price, haircut by
  // LP_GATEWAY_DEPLOY_TOL_BPS (default 1%). A single global absolute-L env value cannot be right for
  // every pool (L depends on decimals, price and range); it now survives only as an OPTIONAL extra floor
  // (max(computed, env)). Fail-closed: unreadable price, out-of-range spot, or a computed 0 ⇒ refuse.
  // Checked BEFORE the window claim so a refusal never locks the window.
  let floor: MinLiquidityResult
  try {
    const pm = (functionName: 'poolKey' | 'poolManager' | 'tickLower' | 'tickUpper' | 'quoteAsset') =>
      publicClient.readContract({ address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName })
    const [poolKey, poolManager, tickLower, tickUpper, quoteAsset] = (await Promise.all([
      pm('poolKey'), pm('poolManager'), pm('tickLower'), pm('tickUpper'), pm('quoteAsset'),
    ])) as [GatewayPoolKey, `0x${string}`, number | bigint, number | bigint, `0x${string}`]
    const slot0 = await readCurrentTick({ client: publicClient, poolManager, poolKey })
    if (!slot0 || slot0.sqrtPriceX96 <= 0n) {
      return { ok: false, status: 200, error: 'pool price unreadable — refusing to deploy without a real slippage floor', reason: 'price_unreadable' }
    }
    floor = computeDeployMinLiquidity({
      sqrtPriceX96: slot0.sqrtPriceX96,
      tickLower: Number(tickLower),
      tickUpper: Number(tickUpper),
      quoteIsCurrency0: quoteAsset.toLowerCase() === poolKey.currency0.toLowerCase(),
      quoteToDeploy,
      pairedOut: zap.pairedOut,
      tolBps: deployTolBps(),
      envFloor: BigInt(process.env.LP_GATEWAY_DEPLOY_MIN_LIQUIDITY ?? '0'),
    })
  } catch (e) {
    log?.error('gateway.deploy', 'pool coordinates unreadable', { error: String(e) })
    return { ok: false, status: 200, error: 'pool coordinates unreadable — refusing to deploy without a real slippage floor', reason: 'price_unreadable' }
  }
  if (!floor.ok) {
    return floor.reason === 'out_of_range'
      ? { ok: false, status: 200, error: 'spot is outside the gateway range — a balanced deploy would be one-sided; skipped', reason: 'out_of_range' }
      : { ok: false, status: 200, error: 'computed minLiquidity is 0 — refusing to deploy without a slippage floor', reason: 'min_liquidity_unset' }
  }
  const minLiquidity = floor.minLiquidity
  if (floor.envFloorApplied) {
    log?.warn('gateway.deploy', 'LP_GATEWAY_DEPLOY_MIN_LIQUIDITY exceeds the spot-computed floor — env floor applied (deploy reverts if the pool cannot mint it)', {
      computed: floor.expectedLiquidity.toString(), env: minLiquidity.toString(),
    })
  }

  // L-02 idempotency claim: reserve this pool's deploy window BEFORE submitting the tx. If another run
  // already claimed it (UNIQUE conflict, 23505), no-op instead of compound-deploying. Requires a
  // service client (always supplied by the cron); without one we can't guard, so we warn and proceed.
  const windowKey = deployWindowKey(Date.now(), deployWindowSecs())
  if (opts.supabase) {
    const { error: claimErr } = await opts.supabase.from('gateway_deploy_events').insert({
      position_manager: instance.positionManager.toLowerCase(),
      chain_id: cfg.chainId,
      window_key: windowKey,
    })
    if (claimErr) {
      if (claimErr.code === '23505') {
        log?.info('gateway.deploy', 'deploy already claimed this window — skipping', {
          positionManager: instance.positionManager.toLowerCase(), windowKey,
        })
        return { ok: false, status: 200, error: 'deploy already attempted this window', reason: 'duplicate' }
      }
      log?.error('gateway.deploy', 'deploy claim insert failed', { error: claimErr.message })
      return { ok: false, status: 500, error: 'deploy_claim_failed', reason: 'tx' }
    }
  } else {
    log?.warn('gateway.deploy', 'no service client — deploy idempotency guard skipped')
  }

  try {
    // M-03 slippage floor (absolute L units) — spot-computed per pool above; deploy() reverts below it.
    const deployTx = await wallet.writeContract({
      address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'deploy',
      args: [quoteToDeploy, zap.pairedOut, minLiquidity, BigInt(Math.floor(Date.now() / 1000) + 600)],
      account, chain: publicClient.chain, gas: 1_200_000n,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx })
    if (receipt.status !== 'success') return { ok: false, status: 502, error: 'deploy_reverted', reason: 'tx' }
    // Record the settled tx against the claim (best-effort; the claim row already bounds the window).
    if (opts.supabase) {
      await opts.supabase
        .from('gateway_deploy_events')
        .update({ deploy_tx: deployTx.toLowerCase(), quote_deployed_atomic: quoteToDeploy.toString(), paired_deployed_atomic: zap.pairedOut.toString() })
        .eq('position_manager', instance.positionManager.toLowerCase())
        .eq('chain_id', cfg.chainId)
        .eq('window_key', windowKey)
    }
    return { ok: true, deployTx, quoteDeployedAtomic: quoteToDeploy, pairedDeployedAtomic: zap.pairedOut, minLiquidity }
  } catch (e) {
    log?.error('gateway.deploy', 'deploy tx failed', { error: String(e) })
    return { ok: false, status: 502, error: 'deploy_failed', reason: 'tx' }
  }
}
