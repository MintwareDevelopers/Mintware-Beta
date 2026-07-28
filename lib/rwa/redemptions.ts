// =============================================================================
// RWA Redemption Queue — data model + source (Track D)
//
// Surfaces the async 30-day settlement flow: requestRedeem → notice window →
// issuer confirmSettlement (KYC-gated). Mock now; getRedemptions() is the seam
// to swap for the vault subgraph (RedemptionRequest entity) later.
// =============================================================================

export type RedemptionStatus = 'pending' | 'ready' | 'settled'

export interface RedemptionRequest {
  id: string
  vault: string
  holder: string
  sharesUsd: number
  requestedAt: string // YYYY-MM-DD
  settlesAt: string
  status: RedemptionStatus
  kycVerified: boolean
  daysRemaining: number // of the 30-day window
}

export const REDEMPTION_WINDOW_DAYS = 30

const MOCK: RedemptionRequest[] = [
  {
    id: 'r-001', vault: 'ATX Credit Facility', holder: '0x9c64…33AD', sharesUsd: 12_000,
    requestedAt: '2026-06-27', settlesAt: '2026-07-27', status: 'ready', kycVerified: true, daysRemaining: 0,
  },
  {
    id: 'r-002', vault: 'LiquidHectar Note', holder: '0x46bb…42d7', sharesUsd: 4_500,
    requestedAt: '2026-07-05', settlesAt: '2026-08-04', status: 'pending', kycVerified: true, daysRemaining: 8,
  },
  {
    id: 'r-003', vault: 'Mesquite Solar', holder: '0x1234…abcd', sharesUsd: 800,
    requestedAt: '2026-07-15', settlesAt: '2026-08-14', status: 'pending', kycVerified: false, daysRemaining: 18,
  },
  {
    id: 'r-004', vault: 'LiquidHectar Note', holder: '0x748f…57bc', sharesUsd: 2_200,
    requestedAt: '2026-06-20', settlesAt: '2026-07-20', status: 'settled', kycVerified: true, daysRemaining: 0,
  },
]

export async function getRedemptions(holder?: string): Promise<RedemptionRequest[]> {
  // Real redemptions from Supabase when present; mock fallback pre-migration.
  try {
    const { dbGetRedemptions } = await import('./db')
    const real = await dbGetRedemptions(holder)
    // A holder-scoped query legitimately returns [] (no requests yet) — trust it,
    // don't fall through to mock. Only the unscoped call falls back to mock.
    if (real && (holder !== undefined || real.length > 0)) return real
  } catch { /* fall back to mock */ }
  return holder ? [] : MOCK
}

export function summarizeRedemptions(rs: RedemptionRequest[]) {
  const pending = rs.filter((r) => r.status !== 'settled')
  const value = pending.reduce((s, r) => s + r.sharesUsd, 0)
  const ready = rs.filter((r) => r.status === 'ready').length
  return { pending: pending.length, value, ready }
}
