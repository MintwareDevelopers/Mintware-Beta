// Pure money math for the LP-gateway harvest → yield-first buffer credit. No I/O, no chain, no clock —
// so every branch is unit-tested deterministically. The orchestration (on-chain harvest, router swap,
// Supabase writes) lives in harvest.ts and calls these. All amounts are atomic units of the pool's
// quote asset (USDG here, 6dp) as bigint — never assumed to be USDC.

export type SharePosition = { user: string; shares: bigint }
export type BufferCredit = { user: string; creditAtomic: bigint }

/** Skim a performance fee (bps of gross harvested income). Rounds the fee DOWN so the buffer never
 *  under-credits depositors; the remainder is what funds the yield-first buffer. */
export function skimPerformanceFee(
  grossAtomic: bigint,
  feeBps: number,
): { feeAtomic: bigint; netAtomic: bigint } {
  if (grossAtomic <= 0n) return { feeAtomic: 0n, netAtomic: 0n }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error(`invalid feeBps: ${feeBps}`)
  }
  const feeAtomic = (grossAtomic * BigInt(feeBps)) / 10_000n
  return { feeAtomic, netAtomic: grossAtomic - feeAtomic }
}

/** Split `netAtomic` across depositors pro-rata to their gateway-position shares at harvest time.
 *  Floor-divides each credit (never over-distributes past `netAtomic`); the largest-share holder
 *  absorbs the rounding dust so the sum of credits equals `netAtomic` exactly. Zero-share and
 *  empty inputs credit nothing. This is the yield-first buffer income — never principal. */
export function proRataBufferCredits(
  netAtomic: bigint,
  positions: readonly SharePosition[],
): BufferCredit[] {
  if (netAtomic <= 0n || positions.length === 0) return []
  const totalShares = positions.reduce((a, p) => a + (p.shares > 0n ? p.shares : 0n), 0n)
  if (totalShares === 0n) return []

  const credits: BufferCredit[] = []
  let distributed = 0n
  let maxIdx = -1
  let maxShares = 0n
  for (const p of positions) {
    if (p.shares <= 0n) continue // zero/negative-share holders participate in nothing
    const credit = (netAtomic * p.shares) / totalShares
    credits.push({ user: p.user, creditAtomic: credit })
    distributed += credit
    if (p.shares > maxShares) {
      maxShares = p.shares
      maxIdx = credits.length - 1
    }
  }
  // Assign the floor-division dust to the largest holder so Σ credits == netAtomic exactly.
  const dust = netAtomic - distributed
  if (dust > 0n && maxIdx >= 0) credits[maxIdx].creditAtomic += dust
  return credits
}
