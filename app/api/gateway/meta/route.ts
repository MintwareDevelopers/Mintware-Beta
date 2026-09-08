import { toFunctionSelector } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { gatewayConfig, gatewayPublicClient } from '@/lib/gateway/chain'
import { resolveInstanceStrict } from '@/lib/gateway/routeInstance'
import { LP_GATEWAY_ABI } from '@/lib/web3/artifacts/lpGateway'
import { readCurrentTick, type GatewayPoolKey } from '@/lib/gateway/poolState'

export const dynamic = 'force-dynamic'

const DYNAMIC_FEE_FLAG = 0x800000 // Uniswap V4: top bit set ⇒ dynamic fee (no fixed rate)

// C-6 feature-detect: the deployed PM must expose the slippage-bounded entrypoints before the UI uses
// them. Their 4-byte selectors appear verbatim in the dispatcher of any Solidity build that has them.
const SEL_DEPOSIT_MIN = toFunctionSelector('depositWithMin(uint256,uint256)').slice(2)
const SEL_WITHDRAW_MIN = toFunctionSelector('withdrawWithMin(uint256,uint256,uint256)').slice(2)
const ERC20_DECIMALS_ABI = [{ type: 'function', stateMutability: 'view', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }] }] as const

// Public: the on-chain coordinates a client needs to deposit into a pool's gateway — the position
// manager (deposit target), chain id + RPC, the quote-asset (USDG) address to approve, the fee tier and
// live range status. Resolution is STRICT (audit O-2): `pool` must be the registry key (poolId); a miss
// is 404 while the registry is populated; the env rig is served only while the registry is empty and is
// tagged `source: 'env-fallback'`. `live` is derived — true only for an active registry row.
export const GET = createHandler(async (req, ctx) => {
  const cfg = gatewayConfig()
  if (!cfg) return ctx.json({ success: false, error: 'gateway_not_configured' }, 503)

  const r = await resolveInstanceStrict(ctx.supabase, cfg, req.nextUrl.searchParams.get('pool'))
  if (!r.ok) return ctx.json({ success: false, error: r.error }, r.status)
  const inst = r.inst

  const client = gatewayPublicClient(cfg)
  const read = (fn: 'poolKey' | 'poolManager' | 'tickLower' | 'tickUpper' | 'quoteAsset') =>
    client.readContract({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: fn })

  // Fee tier + range ticks + PoolManager from the position manager; then the pool's live tick via
  // extsload (poolState). Best-effort — a read failure just omits that field (never a false claim).
  let feePips: number | null = null
  let dynamicFee = false
  let inRange: boolean | null = null
  let currentTick: number | null = null
  let onChainQuote: `0x${string}` | null = null
  try {
    onChainQuote = (await read('quoteAsset')) as `0x${string}`
  } catch (e) {
    ctx.log.warn('gateway.meta', 'quoteAsset read failed', { error: String(e) })
  }
  try {
    const [key, poolManager, tickLower, tickUpper] = (await Promise.all([
      read('poolKey'), read('poolManager'), read('tickLower'), read('tickUpper'),
    ])) as [GatewayPoolKey & { fee: number | bigint }, `0x${string}`, number, number]

    const raw = Number(key.fee)
    if (Number.isFinite(raw)) {
      dynamicFee = (raw & DYNAMIC_FEE_FLAG) !== 0
      feePips = dynamicFee ? null : raw
    }
    const slot0 = await readCurrentTick({ client, poolManager, poolKey: key })
    if (slot0) {
      currentTick = slot0.tick
      inRange = slot0.tick >= Number(tickLower) && slot0.tick <= Number(tickUpper)
    }
  } catch (e) {
    ctx.log.warn('gateway.meta', 'pool state read failed', { error: String(e) })
  }

  // Paired token + decimals so the UI can render the withdraw paired-leg floor in real units (C-6).
  let pairedAsset: `0x${string}` | null = null
  let pairedDecimals: number | null = null
  try {
    pairedAsset = (await client.readContract({ address: inst.positionManager, abi: LP_GATEWAY_ABI, functionName: 'pairedAsset' })) as `0x${string}`
    const d = (await client.readContract({ address: pairedAsset, abi: ERC20_DECIMALS_ABI, functionName: 'decimals' })) as number | bigint
    pairedDecimals = Number(d)
  } catch (e) {
    ctx.log.warn('gateway.meta', 'paired asset read failed', { error: String(e) })
  }

  // supportsMin: true/false when the bytecode was readable, null = unknown (UI then uses the plain calls).
  let supportsMin: boolean | null = null
  try {
    const code = (await client.getCode({ address: inst.positionManager }))?.toLowerCase() ?? ''
    supportsMin = code.length > 2 && code.includes(SEL_DEPOSIT_MIN) && code.includes(SEL_WITHDRAW_MIN)
  } catch (e) {
    ctx.log.warn('gateway.meta', 'bytecode read failed', { error: String(e) })
  }

  // The token to approve: the instance's own quote asset (registry row, else the contract's own
  // `quoteAsset()`, else the env for the legacy rig). If the registry and the contract disagree, refuse
  // to advertise any token — that is the H-01 substitution class, not a display detail.
  const usdg = inst.quoteAsset ?? onChainQuote
  if (inst.quoteAsset && onChainQuote && inst.quoteAsset.toLowerCase() !== onChainQuote.toLowerCase()) {
    ctx.log.error('gateway.meta', 'registry quote_asset != contract quoteAsset()', { pool: inst.poolAddress })
    return ctx.json({ success: false, error: 'instance_quote_mismatch' }, 409)
  }

  return ctx.json({
    success: true,
    meta: {
      positionManager: inst.positionManager,
      staging: inst.staging,
      poolAddress: inst.poolAddress,
      pairLabel: inst.pairLabel,
      chainId: inst.chainId,
      rpcUrl: cfg.rpcUrl,
      usdg: usdg ?? null,
      pairedAsset,
      pairedDecimals, // null = unreadable ⇒ UI shows the paired floor in raw units, never a guessed scale
      feePips, // e.g. 3000 = 0.30%; null when dynamic or unreadable
      dynamicFee,
      inRange, // true/false when readable; null = unknown (earning-fees status)
      currentTick,
      tickLower: inst.tickLower,
      tickUpper: inst.tickUpper,
      source: inst.source, // 'registry' | 'env-fallback' — the UI must not send funds to anything else
      live: inst.live, // derived from an ACTIVE registry row; never hard-coded
      supportsMin, // depositWithMin / withdrawWithMin available on this deployment (C-6)
    },
  })
})
