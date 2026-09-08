// Uniswap-V4 price/liquidity math in TypeScript (bigint) — a faithful mirror of v4-core `TickMath`,
// `SqrtPriceMath` and v4-periphery `LiquidityAmounts`, restricted to the cases the gateway needs:
//   · getSqrtPriceAtTick            (TickMath — same constants, same rounding)
//   · getLiquidityForAmounts        (LiquidityAmounts — the exact value `deploy()` mints, so an off-chain
//                                    caller can set a REAL `minLiquidity` floor per pool: audit O-9 / HO-8)
//   · getAmountsForLiquidity        (SqrtPriceMath deltas, round-down — what `_withdraw` delivers per leg,
//                                    so the UI can set `withdrawWithMin` floors: audit C-6)
// Pure, no I/O. Every function takes/returns bigint; nothing here is a price feed or a guarantee.

export const Q96 = 1n << 96n
export const MIN_TICK = -887272
export const MAX_TICK = 887272
export const MIN_SQRT_PRICE = 4295128739n
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n
const U256_MAX = (1n << 256n) - 1n
const U128_MAX = (1n << 128n) - 1n

/** floor(a·b/d) — FullMath.mulDiv without the 512-bit dance (JS bigint is arbitrary precision). */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('mulDiv: division by zero')
  return (a * b) / d
}

// TickMath constants (v4-core/src/libraries/TickMath.sol) — copied verbatim; do not "fix" by hand.
const TICK_FACTORS: Array<[number, bigint]> = [
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
]

/** sqrt(1.0001^tick) · 2^96 as a Q64.96 — identical to TickMath.getSqrtPriceAtTick (throws off-range). */
export function getSqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new Error(`invalid tick ${tick}`)
  const absTick = tick < 0 ? -tick : tick
  let price = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
  for (const [bit, f] of TICK_FACTORS) if ((absTick & bit) !== 0) price = (price * f) >> 128n
  if (tick > 0) price = U256_MAX / price
  // Q128.128 → Q64.96, rounding up (so getTickAtSqrtPrice of the output is the input tick).
  return (price >> 32n) + ((price & ((1n << 32n) - 1n)) === 0n ? 0n : 1n)
}

function sort(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b]
}

/** LiquidityAmounts.getLiquidityForAmount0 (floor; reverts on uint128 overflow like SafeCast). */
export function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  const [a, b] = sort(sqrtA, sqrtB)
  const intermediate = mulDiv(a, b, Q96)
  const l = mulDiv(amount0, intermediate, b - a)
  if (l > U128_MAX) throw new Error('liquidity overflows uint128')
  return l
}

/** LiquidityAmounts.getLiquidityForAmount1 (floor). */
export function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  const [a, b] = sort(sqrtA, sqrtB)
  const l = mulDiv(amount1, Q96, b - a)
  if (l > U128_MAX) throw new Error('liquidity overflows uint128')
  return l
}

/** LiquidityAmounts.getLiquidityForAmounts — the max liquidity both amounts can fund at `sqrtP` within
 *  [sqrtA, sqrtB]. Below the range only amount0 counts; above it only amount1; in range it's the min. */
export function getLiquidityForAmounts(sqrtP: bigint, sqrtA: bigint, sqrtB: bigint, amount0: bigint, amount1: bigint): bigint {
  const [a, b] = sort(sqrtA, sqrtB)
  if (sqrtP <= a) return getLiquidityForAmount0(a, b, amount0)
  if (sqrtP < b) {
    const l0 = getLiquidityForAmount0(sqrtP, b, amount0)
    const l1 = getLiquidityForAmount1(a, sqrtP, amount1)
    return l0 < l1 ? l0 : l1
  }
  return getLiquidityForAmount1(a, b, amount1)
}

/** True when `sqrtP` sits strictly inside (sqrtA, sqrtB) — the only state in which a balanced two-leg
 *  deploy mints (out of range, one leg is simply refunded and the deploy is not what the cron intended). */
export function isInRange(sqrtP: bigint, sqrtA: bigint, sqrtB: bigint): boolean {
  const [a, b] = sort(sqrtA, sqrtB)
  return sqrtP > a && sqrtP < b
}

/** SqrtPriceMath.getAmount0Delta(…, roundUp=false). */
export function getAmount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [a, b] = sort(sqrtA, sqrtB)
  if (a === 0n) throw new Error('invalid price')
  return mulDiv(liquidity << 96n, b - a, b) / a
}

/** SqrtPriceMath.getAmount1Delta(…, roundUp=false). */
export function getAmount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [a, b] = sort(sqrtA, sqrtB)
  return mulDiv(liquidity, b - a, Q96)
}

/** Mirror of `MintwareLpGatewayPositionManager._amountsForLiquidity` — round-down token amounts a
 *  liquidity slice is worth at `sqrtP` (what a withdraw's LP leg delivers, before fees/rounding). */
export function getAmountsForLiquidity(sqrtP: bigint, sqrtA: bigint, sqrtB: bigint, liquidity: bigint): { amount0: bigint; amount1: bigint } {
  const [a, b] = sort(sqrtA, sqrtB)
  if (liquidity <= 0n) return { amount0: 0n, amount1: 0n }
  if (sqrtP <= a) return { amount0: getAmount0Delta(a, b, liquidity), amount1: 0n }
  if (sqrtP < b) return { amount0: getAmount0Delta(sqrtP, b, liquidity), amount1: getAmount1Delta(a, sqrtP, liquidity) }
  return { amount0: 0n, amount1: getAmount1Delta(a, b, liquidity) }
}

/** Apply a basis-point haircut: floor(x · (10_000 − bps) / 10_000). bps outside [0, 10_000) ⇒ throws. */
export function applyToleranceBps(x: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10_000) throw new Error(`invalid tolerance bps ${bps}`)
  return (x * BigInt(10_000 - bps)) / 10_000n
}
