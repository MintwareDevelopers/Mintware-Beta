/** Apply a basis-point tolerance using integer arithmetic, rounding down. */
export function applyToleranceBps(value: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10_000) throw new Error(`invalid tolerance bps ${bps}`)
  return (value * BigInt(10_000 - bps)) / 10_000n
}
