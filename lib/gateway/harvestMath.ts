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

export type OnchainSplit = {
  credits: BufferCredit[]
  /** Σ credits (≤ netAtomic) */
  allocatedAtomic: bigint
  /** netAtomic − allocated: floor rounding + the slice owned by holders NOT in `holders` (unknown wallets).
   *  Stays in the seat wallet, tracked on the harvest log as `unallocated_atomic` — never re-assigned. */
  unallocatedAtomic: bigint
}

/** Ledger split (audit closeout O-4 / A-4): weight each known holder by their ON-CHAIN `sharesOf` over the
 *  ON-CHAIN `totalShares`, both read at the harvest block. Unlike `proRataBufferCredits`, the denominator is
 *  the contract's total — NOT the sum of the holders we happen to know — so a wallet we failed to discover
 *  can never inflate the others' credits; its slice (and rounding dust) is reported as `unallocatedAtomic`.
 *  Floor-divides; Σ credits ≤ net always. Zero-share holders get nothing. */
export function proRataByOnchainShares(
  netAtomic: bigint,
  holders: readonly SharePosition[],
  totalShares: bigint,
): OnchainSplit {
  if (netAtomic <= 0n || totalShares <= 0n || holders.length === 0) {
    return { credits: [], allocatedAtomic: 0n, unallocatedAtomic: netAtomic > 0n ? netAtomic : 0n }
  }
  const credits: BufferCredit[] = []
  let allocated = 0n
  for (const h of holders) {
    if (h.shares <= 0n) continue
    // a holder can never claim more than the whole (defensive: a lying mock / reorg mid-read)
    const shares = h.shares > totalShares ? totalShares : h.shares
    const credit = (netAtomic * shares) / totalShares
    if (credit <= 0n) continue
    credits.push({ user: h.user, creditAtomic: credit })
    allocated += credit
  }
  if (allocated > netAtomic) {
    // only reachable if Σ sharesOf > totalShares (inconsistent reads): refuse to over-credit
    throw new Error('proRataByOnchainShares: Σ sharesOf exceeds totalShares')
  }
  return { credits, allocatedAtomic: allocated, unallocatedAtomic: netAtomic - allocated }
}
