// LP-gateway deploy orchestration — moves the FULL staged (quote) balance into the target V4 pool once a
// threshold is reached. Owner-gated on-chain (getOracleSigner('gateway') is the position manager's owner —
// a DEDICATED Privy seat, not the shared root).
//
// **Earn-vs-LP decision (docs/developers/lp-gateway-earn-vs-lp-decision.md, 2026-09-08):** the paired leg is
// no longer acquired off-chain and supplied by the owner — `deploy()` itself swaps part of the user's own
// staged quote into the paired leg, atomically, in-contract. This cron's job is now just to SIZE the call
// (`quoteToDeploy`, `swapAmount`, `minPairedOut`, `minLiquidity`) from live pool state and submit it; it
// executes no swap of its own. There is also no held-back buffer any more — the "deploy fraction" ratio
// (`LP_GATEWAY_DEPLOY_RATIO_BPS`) is retired; every run deploys the entire staged balance above the threshold.
//
// DARK-LAUNCHED, fail-closed, OFF by default: no-ops unless LP_GATEWAY_DEPLOY_ENABLED === 'true' and the
// config + staging address + oracle signer resolve.

import { createWalletClient, http, decodeEventLog } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { LP_GATEWAY_ABI, LP_STAGING_ABI } from '@/lib/web3/artifacts/lpGateway'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { listActiveInstances, computePoolId } from '@/lib/gateway/registry'
import { readCurrentTick, type GatewayPoolKey } from '@/lib/gateway/poolState'
import { getSqrtPriceAtTick, getLiquidityForAmounts, isInRange, applyToleranceBps, quoteToPairedAtSpot, Q96 } from '@/lib/gateway/v4Math'
import { fetchHotPools, type PoolCandidate } from '@/lib/gateway/discovery'
import { estimateGasWithFloor } from '@/lib/gateway/gasEstimate'

export type DeployInstance = { positionManager: `0x${string}`; staging: `0x${string}` }

type SupabaseClient = ReturnType<typeof getServiceClient>
type Logger = { info: (t: string, m: string, c?: Record<string, unknown>) => void; warn: (t: string, m: string, c?: Record<string, unknown>) => void; error: (t: string, m: string, c?: Record<string, unknown>) => void }

type Reason =
  | 'disabled' | 'config' | 'signer' | 'below_threshold' | 'tx' | 'duplicate'
  | 'min_liquidity_unset' // kept for callers that match on it: the computed floor came out 0
  | 'out_of_range' // spot is outside the gateway's fixed range — a balanced two-leg deploy is not what the cron intended
  | 'price_unreadable' // slot0 / pool coordinates unreadable — no honest floor can be set
  // Round-3 XR-2 / X-7 (Cork replay): the first deploy used to anchor the follower at whatever spot an attacker had
  // set. The contract now anchors at creation and bands the first deploy; the cron pre-flights both halves:
  | 'ref_catching_up' // spot is outside the on-chain follower band → we poked one step and will retry next run
  | 'ref_price_unavailable' // no external reference price for this pool and LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE is on
  | 'ref_price_deviation' // spot deviates from the external reference by more than LP_GATEWAY_DEPLOY_REF_MAX_DEV_BPS
export type DeployOutcome =
  | { ok: true; deployTx: `0x${string}`; quoteDeployedAtomic: bigint; pairedDeployedAtomic: bigint; minLiquidity: bigint }
  | { ok: false; status: number; error: string; reason: Reason }

// O-9 / HO-8: the sandwich floor is computed PER POOL from spot, not one global absolute-L env value.
export const DEFAULT_DEPLOY_TOL_BPS = 100 // 1% below the liquidity the amounts fund at the current spot
const deployTolBps = () => {
  const n = Number(process.env.LP_GATEWAY_DEPLOY_TOL_BPS ?? String(DEFAULT_DEPLOY_TOL_BPS))
  return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : DEFAULT_DEPLOY_TOL_BPS
}

// Earn-vs-LP decision: bounds the in-contract zap's OWN slippage floor (minPairedOut) — the same knob that
// used to gate the off-chain executor's swap (routerSwap.ts), now gating the on-chain one instead.
export const DEFAULT_SWAP_SLIPPAGE_BPS = 100 // 1%
const swapSlippageBps = () => {
  const n = Number(process.env.LP_GATEWAY_SWAP_SLIPPAGE_BPS ?? String(DEFAULT_SWAP_SLIPPAGE_BPS))
  return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : DEFAULT_SWAP_SLIPPAGE_BPS
}

export type MinLiquidityInput = {
  sqrtPriceX96: bigint // live slot0
  tickLower: number
  tickUpper: number
  quoteIsCurrency0: boolean
  quoteToDeploy: bigint
  pairedOut: bigint // an ESTIMATE now (quoteToPairedAtSpot), not a realized off-chain swap output — the
  // real swap runs on-chain, inside the same deploy() call this floor gates.
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

// ── Round-3 XR-2 / X-7: first-deploy price sanity ──────────────────────────────────────────────────────────
// On-chain, `deploy` reverts `DeployPriceOutOfBand` when spot is more than `maxDeviationBps` (√price) from the
// clamped follower, which is anchored at CREATION since round 3 — so the first deploy is banded too. The follower
// only advances when someone transacts, so after legitimate drift the cron must `poke()` it a step per block
// before a deploy can pass; we do that instead of burning a reverting deploy. Independently of the follower
// (which anyone can walk over a few blocks), we compare spot with an EXTERNAL reference (GeckoTerminal's last
// price for this pool via the Discover feed) and refuse when it deviates by more than a bound. The external price
// lags and, on a single-venue meme pool, is the same venue — it is a sanity check against a held/pre-positioned
// mispricing, not an oracle; the economic backstop for deploy-side manipulation stays the R8 gateway-share cap.

/** |spot − ref| in bps of ref (√price units, the contract's own band metric). ref == 0 ⇒ MAX (fail closed). */
export function bandDeviationBps(spotSqrtPriceX96: bigint, refSqrtPriceX96: bigint): number {
  if (refSqrtPriceX96 <= 0n) return Number.MAX_SAFE_INTEGER
  const diff = spotSqrtPriceX96 > refSqrtPriceX96 ? spotSqrtPriceX96 - refSqrtPriceX96 : refSqrtPriceX96 - spotSqrtPriceX96
  return Number((diff * 10_000n) / refSqrtPriceX96)
}

/** Price of ONE paired token in quote (human units) from slot0. sqrtPriceX96 = √(currency1/currency0) in RAW units. */
export function pairedPriceInQuote(i: { sqrtPriceX96: bigint; quoteIsCurrency0: boolean; quoteDecimals: number; pairedDecimals: number }): number {
  const s = Number(i.sqrtPriceX96) / Number(Q96)
  const rawC1PerC0 = s * s
  const rawQuotePerPaired = i.quoteIsCurrency0 ? 1 / rawC1PerC0 : rawC1PerC0
  return rawQuotePerPaired * 10 ** (i.pairedDecimals - i.quoteDecimals)
}

/** Orient a Discover-feed candidate's `priceQuotePerBase` into "quote (USDG) per paired". null when unusable. */
export function externalPairedPriceInQuote(c: Pick<PoolCandidate, 'priceQuotePerBase' | 'baseToken' | 'quoteToken'>, usdg: string): number | null {
  const p = c.priceQuotePerBase
  if (p === null || !Number.isFinite(p) || p <= 0) return null
  const u = usdg.toLowerCase()
  if (c.quoteToken === u) return p // 1 base(paired) = p quote(USDG)
  if (c.baseToken === u) return 1 / p // 1 base(USDG) = p quote(paired) → 1 paired = 1/p USDG
  return null // USDG is neither leg per GeckoTerminal — not our pool's orientation
}

/** |spot − ext| in bps of ext. Non-finite / non-positive inputs ⇒ MAX (fail closed). */
export function referenceDeviationBps(spotPairedInQuote: number, extPairedInQuote: number): number {
  if (!Number.isFinite(spotPairedInQuote) || !Number.isFinite(extPairedInQuote) || spotPairedInQuote <= 0 || extPairedInQuote <= 0) return Number.MAX_SAFE_INTEGER
  return Math.round((Math.abs(spotPairedInQuote - extPairedInQuote) / extPairedInQuote) * 10_000)
}

export const DEFAULT_DEPLOY_REF_MAX_DEV_BPS = 500
const refMaxDevBps = () => {
  const n = Number(process.env.LP_GATEWAY_DEPLOY_REF_MAX_DEV_BPS ?? String(DEFAULT_DEPLOY_REF_MAX_DEV_BPS))
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : DEFAULT_DEPLOY_REF_MAX_DEV_BPS
}
/** Default ON (fail closed). Only an explicit 'false' lets a deploy proceed with no external reference — the
 *  testnet rig has no GeckoTerminal data, so that is the one place it is expected to be off. */
export const requireRefPrice = (env: Record<string, string | undefined> = process.env) => (env.LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE ?? 'true').trim().toLowerCase() !== 'false'

const ERC20_DECIMALS_ABI = [{ type: 'function', stateMutability: 'view', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }] }] as const
const ERC20_BALANCE_ABI = [{ type: 'function', stateMutability: 'view', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const

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

  // V1-03 fix (independent Codex audit, 2026-09-09): `deploy()` on-chain (PM L800) explicitly pulls
  // quote already sitting in the PM's OWN balance FIRST (`fromParked`), before unstaking any more from
  // staging — a deferred re-stage (staging's cap was momentarily full) or fees swept there ahead of a
  // sweep both leave real, immediately-usable quote sitting idle in the PM. Sizing `quoteToDeploy` from
  // `staged` alone under-requested every time that happened: not a fund-safety bug (deploying less than
  // possible is always safe on-chain), but real value left earning nothing longer than necessary.
  //
  // CAUGHT ON REVIEW (2026-09-09, Codex live fix-watch, same day): this read used to happen AFTER the
  // threshold check below, which compared `staged` alone against the threshold. A parked-only scenario
  // (staged=0, parked>0, any positive threshold under `parked`) returned `below_threshold` without ever
  // reading `parked` — the exact "quote sitting idle in the PM" scenario V1-03 was about could never
  // trigger a deploy on its own. Moved the read before the threshold check and sized the check off the
  // TOTAL deployable idle (`staged + parked`), while keeping `threshold === 0n` as the documented
  // explicit-disable escape hatch (never deploy on a 0/unset threshold, regardless of how much is idle).
  const quoteAssetAddr = (await publicClient.readContract({
    address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'quoteAsset',
  })) as `0x${string}`
  const parked = (await publicClient.readContract({
    address: quoteAssetAddr, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [instance.positionManager],
  })) as bigint

  const threshold = BigInt(process.env.LP_GATEWAY_DEPLOY_THRESHOLD_ATOMIC ?? '0')
  if (threshold === 0n || staged + parked < threshold) {
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

  // Earn-vs-LP decision: no held-back buffer any more — deploy the ENTIRE staged balance (subject only to
  // the dust threshold already checked above). The old ratio-of-principal-at-cost target is retired.
  // V1-03 fix: include quote already parked in the PM's own balance (see the read above) — deploy()
  // on-chain uses it first anyway, so sizing without it just left it earning nothing for longer.
  const quoteToDeploy = staged + parked
  if (quoteToDeploy <= 0n) {
    return { ok: false, status: 200, error: 'nothing staged to deploy', reason: 'below_threshold' }
  }

  // Re-audit A-3 + round-2 O-9 (HO-8): the M-03 sandwich floor is computed PER POOL from the live spot —
  // the exact liquidity the contract will mint for (quoteForMint, pairedOut) at this price, haircut by
  // LP_GATEWAY_DEPLOY_TOL_BPS (default 1%). A single global absolute-L env value cannot be right for
  // every pool (L depends on decimals, price and range); it now survives only as an OPTIONAL extra floor
  // (max(computed, env)). Fail-closed: unreadable price, out-of-range spot, or a computed 0 ⇒ refuse.
  // Checked BEFORE the window claim so a refusal never locks the window.
  let floor: MinLiquidityResult
  let spotSqrtPriceX96: bigint
  let refSqrtPriceX96: bigint
  let bandBps: number
  let quoteIsCurrency0: boolean
  let poolKey: GatewayPoolKey
  let quoteAsset: `0x${string}`
  let swapAmount: bigint
  let minPairedOut: bigint
  try {
    const pm = (functionName: 'poolKey' | 'poolManager' | 'tickLower' | 'tickUpper' | 'quoteAsset' | 'referencePrice' | 'maxDeviationBps') =>
      publicClient.readContract({ address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName })
    const [pk, poolManager, tickLower, tickUpper, qa, refP, band] = (await Promise.all([
      pm('poolKey'), pm('poolManager'), pm('tickLower'), pm('tickUpper'), pm('quoteAsset'), pm('referencePrice'), pm('maxDeviationBps'),
    ])) as [GatewayPoolKey, `0x${string}`, number | bigint, number | bigint, `0x${string}`, readonly [bigint, bigint, bigint], number | bigint]
    poolKey = pk
    quoteAsset = qa
    refSqrtPriceX96 = BigInt(refP[0])
    bandBps = Number(band)
    const slot0 = await readCurrentTick({ client: publicClient, poolManager, poolKey })
    if (!slot0 || slot0.sqrtPriceX96 <= 0n) {
      return { ok: false, status: 200, error: 'pool price unreadable — refusing to deploy without a real slippage floor', reason: 'price_unreadable' }
    }
    spotSqrtPriceX96 = slot0.sqrtPriceX96
    quoteIsCurrency0 = quoteAsset.toLowerCase() === poolKey.currency0.toLowerCase()

    // Earn-vs-LP decision: size the in-contract zap. A straight half-split targets a roughly-balanced
    // two-sided mint for the gateway's fixed, roughly-centered wide range (±22980 ticks by default) — the
    // SAME assumption the old off-chain zap made. `minPairedOut` floors the swap's own slippage at the
    // theoretical spot-price output, haircut by LP_GATEWAY_SWAP_SLIPPAGE_BPS.
    swapAmount = quoteToDeploy / 2n
    const expectedPairedOut = quoteToPairedAtSpot(swapAmount, slot0.sqrtPriceX96, quoteIsCurrency0)
    minPairedOut = applyToleranceBps(expectedPairedOut, swapSlippageBps())

    floor = computeDeployMinLiquidity({
      sqrtPriceX96: slot0.sqrtPriceX96,
      tickLower: Number(tickLower),
      tickUpper: Number(tickUpper),
      quoteIsCurrency0,
      quoteToDeploy: quoteToDeploy - swapAmount,
      pairedOut: expectedPairedOut,
      tolBps: deployTolBps(),
      envFloor: BigInt(process.env.LP_GATEWAY_DEPLOY_MIN_LIQUIDITY ?? '0'),
    })
  } catch (e) {
    log?.error('gateway.deploy', 'pool coordinates unreadable', { error: String(e) })
    return { ok: false, status: 200, error: 'pool coordinates unreadable — refusing to deploy without a real slippage floor', reason: 'price_unreadable' }
  }

  // Round-3 XR-2 / X-7 (a): on-chain band pre-flight. Out of band ⇒ the deploy would revert DeployPriceOutOfBand;
  // advance the follower one bounded step (permissionless `poke`) and let the next run re-check. Never deploy blind.
  const devBps = bandDeviationBps(spotSqrtPriceX96, refSqrtPriceX96)
  if (devBps > bandBps) {
    try {
      const ph = await wallet.writeContract({ address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'poke', args: [], account, chain: publicClient.chain, gas: 150_000n })
      await publicClient.waitForTransactionReceipt({ hash: ph })
      log?.info('gateway.deploy', 'spot outside the follower band — poked one step, retry next run', { devBps, bandBps, pokeTx: ph })
    } catch (e) {
      log?.warn('gateway.deploy', 'poke failed after out-of-band spot', { error: String(e), devBps, bandBps })
    }
    return { ok: false, status: 200, error: `spot is ${devBps} bps from the follower (band ${bandBps}) — poked, will retry`, reason: 'ref_catching_up' }
  }

  // Round-3 XR-2 (b): external reference sanity. The follower can be walked by anyone over a few blocks, so the band
  // alone cannot tell legitimate drift from a held pre-deploy mispricing. Compare with GeckoTerminal's last price for
  // THIS pool (matched by v4 poolId through the Discover feed). Missing reference ⇒ refuse unless explicitly waived.
  try {
    const usdg = quoteAsset.toLowerCase()
    const poolId = computePoolId(poolKey).toLowerCase()
    const pools = await fetchHotPools({ usdgAddress: usdg, limit: 60, log })
    const cand = pools.find((c) => c.poolAddress.toLowerCase() === poolId)
    const ext = cand ? externalPairedPriceInQuote(cand, usdg) : null
    if (ext === null) {
      if (requireRefPrice()) {
        return { ok: false, status: 200, error: 'no external reference price for this pool — refusing to deploy (set LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE=false only on a testnet rig)', reason: 'ref_price_unavailable' }
      }
      log?.warn('gateway.deploy', 'no external reference price — proceeding on the on-chain band alone (LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE=false)')
    } else {
      const paired = quoteIsCurrency0 ? poolKey.currency1 : poolKey.currency0
      const [qd, pd] = (await Promise.all([
        publicClient.readContract({ address: quoteAsset, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' }),
        publicClient.readContract({ address: paired as `0x${string}`, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' }),
      ])) as [number, number]
      const spot = pairedPriceInQuote({ sqrtPriceX96: spotSqrtPriceX96, quoteIsCurrency0, quoteDecimals: Number(qd), pairedDecimals: Number(pd) })
      const refDev = referenceDeviationBps(spot, ext)
      if (refDev > refMaxDevBps()) {
        log?.warn('gateway.deploy', 'spot deviates from the external reference — refusing to deploy', { spot, ext, refDev, max: refMaxDevBps() })
        return { ok: false, status: 200, error: `spot deviates ${refDev} bps from the external reference (max ${refMaxDevBps()})`, reason: 'ref_price_deviation' }
      }
    }
  } catch (e) {
    log?.error('gateway.deploy', 'external reference check failed', { error: String(e) })
    if (requireRefPrice()) return { ok: false, status: 200, error: 'external reference check failed — refusing to deploy', reason: 'ref_price_unavailable' }
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
    // Earn-vs-LP decision: `swapAmount`/`minPairedOut` replace the old owner-supplied `pairedAmount` — the
    // contract executes the zap itself.
    // Round-4 audit fix (Medium): estimate for real instead of a fixed 1_200_000n literal — deploy()'s
    // in-contract zap swap makes it the single heaviest gateway call, so it's also the most exposed to a
    // paired token whose real transfer cost drifts above a fixed budget over time.
    const deployArgs = {
      address: instance.positionManager, abi: LP_GATEWAY_ABI, functionName: 'deploy',
      args: [quoteToDeploy, swapAmount, minPairedOut, minLiquidity, BigInt(Math.floor(Date.now() / 1000) + 600)],
      account,
    } as const
    const { gas: deployGas } = await estimateGasWithFloor(publicClient, deployArgs, 1_200_000n)
    const deployTx = await wallet.writeContract({ ...deployArgs, chain: publicClient.chain, gas: deployGas })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx })
    if (receipt.status !== 'success') return { ok: false, status: 502, error: 'deploy_reverted', reason: 'tx' }

    // The real paired amount is only known once the in-contract swap has run — decode it from the
    // `Deployed` event rather than reporting the pre-tx estimate.
    let pairedDeployedAtomic = minPairedOut // conservative fallback if the event can't be found/decoded
    for (const rawLog of receipt.logs) {
      if (rawLog.address.toLowerCase() !== instance.positionManager.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({ abi: LP_GATEWAY_ABI, data: rawLog.data, topics: rawLog.topics })
        if (decoded.eventName === 'Deployed') {
          pairedDeployedAtomic = (decoded.args as { pairedUsed: bigint }).pairedUsed
          break
        }
      } catch {
        // not the Deployed event (or not decodable with this ABI) — keep scanning
      }
    }

    // Record the settled tx against the claim (best-effort; the claim row already bounds the window).
    if (opts.supabase) {
      await opts.supabase
        .from('gateway_deploy_events')
        .update({ deploy_tx: deployTx.toLowerCase(), quote_deployed_atomic: quoteToDeploy.toString(), paired_deployed_atomic: pairedDeployedAtomic.toString() })
        .eq('position_manager', instance.positionManager.toLowerCase())
        .eq('chain_id', cfg.chainId)
        .eq('window_key', windowKey)
    }
    return { ok: true, deployTx, quoteDeployedAtomic: quoteToDeploy, pairedDeployedAtomic, minLiquidity }
  } catch (e) {
    log?.error('gateway.deploy', 'deploy tx failed', { error: String(e) })
    return { ok: false, status: 502, error: 'deploy_failed', reason: 'tx' }
  }
}
