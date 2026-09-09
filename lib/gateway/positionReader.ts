// Reads a depositor's LP-gateway position value from chain, using the SAME offset-consistent share
// math the contract enforces (toAssets with the 1e6 virtual offset) so the dashboard never disagrees
// with an actual withdraw. Cost basis + buffer balance come from the caller (DB). All amounts are
// atomic units of the pool's quote asset (USDG). No par claim — value is the current IL-exposed mark.
//
// Also home to the DRY QUOTES the UI needs to set slippage floors (audit C-6): `depositSharesQuote`
// mirrors SeniorSharesMath.toShares (floor) and `withdrawLegsQuote` mirrors `_withdraw`'s pro-rata
// idle + LP-leg entitlement at spot. `readGatewayPoolState` gathers the on-chain inputs for both.
// Every quote is an ESTIMATE off the current block — the on-chain `*WithMin` floor is the protection.

import { LP_GATEWAY_ABI, LP_GATEWAY_VIRTUAL as V, LP_STAGING_ABI } from '@/lib/web3/artifacts/lpGateway'
import { readCurrentTick, type GatewayPoolKey } from '@/lib/gateway/poolState'
import { getSqrtPriceAtTick, getAmountsForLiquidity, mulDiv, pairedToQuoteAtSpot } from '@/lib/gateway/v4Math'

// Structural: satisfied by a viem PublicClient and by test mocks alike (viem's readContract is a
// complex generic overload, so we accept it loosely and pin the ABI at the call site).
type Reader = { readContract: (args: any) => Promise<unknown> } // eslint-disable-line @typescript-eslint/no-explicit-any

// Public immutables on the PM that the trimmed artifact ABI doesn't carry, plus the periphery liquidity read.
const PM_EXTRA_ABI = [
  { type: 'function', stateMutability: 'view', name: 'staging', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'positionManager', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', stateMutability: 'view', name: 'quoteIsCurrency0', inputs: [], outputs: [{ type: 'bool' }] },
] as const
const PERIPHERY_ABI = [
  { type: 'function', stateMutability: 'view', name: 'getPositionLiquidity', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint128' }] },
] as const

export type GatewayPositionView = {
  shares: bigint
  positionValueAtomic: bigint
  costBasisAtomic: bigint | null
  unrealizedPnlAtomic: bigint | null
  bufferBalanceAtomic: bigint
  // V1-08 fix (independent Codex audit, 2026-09-09): the contract's own `sourceReadable()` — false
  // means `totalNav` fell back to a cached `lastKnownIdle` because the yield source is temporarily
  // unreadable (an outage, not a solvency claim). `positionValueAtomic` above is still computed from
  // that same (possibly stale) `totalNav`, so callers that want to warn the user of staleness need
  // this flag; a portfolio silently showing a cached NAV as current was part of V1-08's finding.
  sourceReadable: boolean
}

/** toAssets(shares, nav, totalShares) with the contract's virtual offset — floor, matching on-chain. */
export function positionValueAtomic(shares: bigint, totalShares: bigint, totalNav: bigint): bigint {
  if (shares <= 0n || totalShares <= 0n) return 0n
  return (shares * (totalNav + V)) / (totalShares + V)
}

/** SeniorSharesMath.toShares(assets, totalShares, totalNav, VIRTUAL, Floor) — the shares a deposit of
 *  `quoteAmount` mints at the CURRENT `totalNav`. The contract mints off `_navDeposit()` (LP leg marked
 *  at max(spot, ref)) which is ≥ totalNav, so the real mint is ≤ this quote; the caller's tolerance
 *  absorbs the small ref/spot gap and `depositWithMin` reverts on a large one (C-6). */
export function depositSharesQuote(quoteAmount: bigint, totalShares: bigint, totalNav: bigint): bigint {
  if (quoteAmount <= 0n) return 0n
  return mulDiv(quoteAmount, totalShares + V, totalNav + V)
}

/** The on-chain inputs `_withdraw` prices a pro-rata exit from — read once, serialised to the client. */
export type GatewayPoolState = {
  totalShares: bigint
  totalNav: bigint
  idleAtomic: bigint // staging.stagedAssets()
  deployed: boolean // tokenId != 0
  liquidity: bigint // positionManager.getPositionLiquidity(tokenId) (0 when not deployed)
  sqrtPriceX96: bigint | null // live slot0 (null = unreadable ⇒ LP leg unquotable)
  tickLower: number
  tickUpper: number
  quoteIsCurrency0: boolean
}

/** Mirror of `_withdraw`'s entitlements for burning `shares`. Round-4 audit fix: this used to apply the
 *  SeniorSharesMath virtual offset `V` SEPARATELY to each leg (`shares·(idle+V)/(ts+V)` and
 *  `shares·(liq+V)/(ts+V)`) — exactly the formula the round-3 fuzz-F1 fix replaced on-chain because it
 *  over-counts by ≈ shares·V/(ts+V) per leg (≈$1 per exit at 6dp), causing a spurious `SlippageExceeded`
 *  on `withdrawWithMin` for any typical partial exit whose 1% tolerance band is smaller than that
 *  overshoot. Now mirrors `_withdraw` exactly: price the WHOLE claim once (`claimTotal =
 *  toAssets(shares, navW, ts, V, Floor)`, `navW = idle + lpSpotVal`), then split proportionally with no
 *  further offset. Last holder takes everything (the offset dust clears). Returns the two legs the tx
 *  delivers when both succeed — the honest floor for `withdrawWithMin` once a tolerance is applied.
 *  `pairedOut` is in the PAIRED token's own units (not quote). */
export function withdrawLegsQuote(shares: bigint, s: GatewayPoolState): { quoteOut: bigint; pairedOut: bigint; lpQuotable: boolean } {
  if (shares <= 0n || s.totalShares <= 0n) return { quoteOut: 0n, pairedOut: 0n, lpQuotable: true }
  const last = shares >= s.totalShares

  if (!s.deployed || s.liquidity <= 0n) {
    const fromIdle = last ? s.idleAtomic : mulDiv(shares, s.idleAtomic + V, s.totalShares + V)
    return { quoteOut: fromIdle, pairedOut: 0n, lpQuotable: true }
  }
  if (s.sqrtPriceX96 == null) {
    // No live price ⇒ the LP leg can't be valued for the single-offset split either — fall back to the
    // idle-only per-leg estimate (still an ESTIMATE; the on-chain *WithMin floor is the real protection).
    const fromIdle = last ? s.idleAtomic : mulDiv(shares, s.idleAtomic + V, s.totalShares + V)
    return { quoteOut: fromIdle, pairedOut: 0n, lpQuotable: false }
  }

  const sqrtA = getSqrtPriceAtTick(s.tickLower)
  const sqrtB = getSqrtPriceAtTick(s.tickUpper)
  const { amount0: fullAmount0, amount1: fullAmount1 } = getAmountsForLiquidity(s.sqrtPriceX96, sqrtA, sqrtB, s.liquidity)
  const [fullLpQuote, fullLpPaired] = s.quoteIsCurrency0 ? [fullAmount0, fullAmount1] : [fullAmount1, fullAmount0]
  const lpSpotVal = fullLpQuote + pairedToQuoteAtSpot(fullLpPaired, s.sqrtPriceX96, s.quoteIsCurrency0)

  const navW = s.idleAtomic + lpSpotVal
  if (navW <= 0n) return { quoteOut: 0n, pairedOut: 0n, lpQuotable: true }
  let claimTotal = last ? navW : mulDiv(shares, navW + V, s.totalShares + V)
  if (claimTotal > navW) claimTotal = navW // a near-total loss can push the offset formula above what exists
  const fromIdle = last ? s.idleAtomic : mulDiv(claimTotal, s.idleAtomic, navW)
  const lpEntitled = claimTotal - fromIdle

  const liqToRemoveRaw = last ? s.liquidity : (lpSpotVal <= 0n ? 0n : mulDiv(s.liquidity, lpEntitled, lpSpotVal))
  const liqToRemove = liqToRemoveRaw > s.liquidity ? s.liquidity : liqToRemoveRaw
  const { amount0, amount1 } = getAmountsForLiquidity(s.sqrtPriceX96, sqrtA, sqrtB, liqToRemove)
  const [lpQuote, lpPaired] = s.quoteIsCurrency0 ? [amount0, amount1] : [amount1, amount0]
  return { quoteOut: fromIdle + lpQuote, pairedOut: lpPaired, lpQuotable: true }
}

/** JSON-safe shape of the pool state (bigint → string) for the position route → UI hop. */
export function serializePoolState(s: GatewayPoolState) {
  return {
    totalShares: s.totalShares.toString(),
    totalNav: s.totalNav.toString(),
    idleAtomic: s.idleAtomic.toString(),
    deployed: s.deployed,
    liquidity: s.liquidity.toString(),
    sqrtPriceX96: s.sqrtPriceX96 == null ? null : s.sqrtPriceX96.toString(),
    tickLower: s.tickLower,
    tickUpper: s.tickUpper,
    quoteIsCurrency0: s.quoteIsCurrency0,
  }
}
export type SerializedPoolState = ReturnType<typeof serializePoolState>
export function parsePoolState(j: SerializedPoolState): GatewayPoolState {
  return {
    totalShares: BigInt(j.totalShares),
    totalNav: BigInt(j.totalNav),
    idleAtomic: BigInt(j.idleAtomic),
    deployed: !!j.deployed,
    liquidity: BigInt(j.liquidity),
    sqrtPriceX96: j.sqrtPriceX96 == null ? null : BigInt(j.sqrtPriceX96),
    tickLower: Number(j.tickLower),
    tickUpper: Number(j.tickUpper),
    quoteIsCurrency0: !!j.quoteIsCurrency0,
  }
}

/** Read everything `withdrawLegsQuote` / `depositSharesQuote` need in one pass. Throws on a failed
 *  core read (the route maps it to 502); a failed slot0 read only nulls `sqrtPriceX96`. */
export async function readGatewayPoolState(opts: { client: Reader; positionManager: `0x${string}`; staging?: `0x${string}` | null }): Promise<GatewayPoolState> {
  const { client, positionManager } = opts
  const pm = (functionName: string, abi: unknown = LP_GATEWAY_ABI, args?: readonly unknown[]) =>
    client.readContract({ address: positionManager, abi, functionName, args })

  const [totalShares, totalNav, tokenId, tickLower, tickUpper, quoteIsCurrency0, stagingAddr] = (await Promise.all([
    pm('totalShares'), pm('totalNav'), pm('tokenId'), pm('tickLower'), pm('tickUpper'),
    pm('quoteIsCurrency0', PM_EXTRA_ABI), opts.staging ? Promise.resolve(opts.staging) : pm('staging', PM_EXTRA_ABI),
  ])) as [bigint, bigint, bigint, number | bigint, number | bigint, boolean, `0x${string}`]

  const idleAtomic = (await client.readContract({ address: stagingAddr, abi: LP_STAGING_ABI, functionName: 'stagedAssets' })) as bigint

  const deployed = tokenId !== 0n
  let liquidity = 0n
  let sqrtPriceX96: bigint | null = null
  if (deployed) {
    const [periphery, poolManager, poolKey] = (await Promise.all([
      pm('positionManager', PM_EXTRA_ABI), pm('poolManager'), pm('poolKey'),
    ])) as [`0x${string}`, `0x${string}`, GatewayPoolKey]
    liquidity = (await client.readContract({ address: periphery, abi: PERIPHERY_ABI, functionName: 'getPositionLiquidity', args: [tokenId] })) as bigint
    const slot0 = await readCurrentTick({ client, poolManager, poolKey })
    sqrtPriceX96 = slot0?.sqrtPriceX96 ?? null
  }

  return {
    totalShares, totalNav, idleAtomic, deployed, liquidity, sqrtPriceX96,
    tickLower: Number(tickLower), tickUpper: Number(tickUpper), quoteIsCurrency0,
  }
}

export async function readGatewayPosition(opts: {
  client: Reader
  positionManager: `0x${string}`
  user: `0x${string}`
  costBasisAtomic?: bigint | null
  bufferBalanceAtomic?: bigint
}): Promise<GatewayPositionView> {
  const { client, positionManager, user } = opts
  const read = (functionName: string, args?: readonly unknown[]) =>
    client.readContract({ address: positionManager, abi: LP_GATEWAY_ABI, functionName, args })

  const [shares, totalShares, totalNav, sourceReadable] = (await Promise.all([
    read('sharesOf', [user]),
    read('totalShares'),
    read('totalNav'),
    read('sourceReadable'),
  ])) as [bigint, bigint, bigint, boolean]

  const value = positionValueAtomic(shares, totalShares, totalNav)
  const costBasisAtomic = opts.costBasisAtomic ?? null
  const unrealizedPnlAtomic = costBasisAtomic == null ? null : value - costBasisAtomic

  return {
    shares,
    positionValueAtomic: value,
    costBasisAtomic,
    unrealizedPnlAtomic,
    bufferBalanceAtomic: opts.bufferBalanceAtomic ?? 0n,
    sourceReadable,
  }
}
