// =============================================================================
// Vault Discovery — data model + source (Track D)
//
// Typed model the two-surface Vault Discovery UI consumes. Backed by mock data
// for now; `getVaultsDiscovery()` is the single seam to swap for the vault
// subgraph / on-chain reads once contracts are deployed (see Track D plan).
// =============================================================================

export type VaultSurface = 'DeFi' | 'RWA'
export type PoolProfile = 'BLUE_CHIP' | 'EMERGING' | 'MEME'
export type VaultStatus = 'active' | 'seeding' | 'paused'

export interface VaultSummary {
  id: string
  name: string
  surface: VaultSurface
  pair: string          // e.g. "ETH / USDC" or "vRWA / USDC"
  descriptor: string    // one-line mechanism
  tvlUsd: number
  netApyPct: number
  status: VaultStatus
  epochLabel: string    // e.g. "T−3d"
  // Swap-fee split, 50 / 25 / 25 depositors / mintware / provider
  feeSplit: [number, number, number]
  // DeFi-only
  profile?: PoolProfile
  profileRange?: string // e.g. "±6%"
  // RWA-only
  underlyingApyPct?: number
  settleDays?: number
  priceBand?: string    // e.g. "±15/±45"
  kycAtRedeem?: boolean
}

const MOCK_VAULTS: VaultSummary[] = [
  {
    id: 'social-blue-chip', name: 'Social Blue-Chip', surface: 'DeFi',
    pair: 'ETH / USDC', descriptor: 'V4 hook-gated LP · MEV-protected',
    tvlUsd: 2_412_900, netApyPct: 11.0, status: 'active', epochLabel: 'T−3d',
    feeSplit: [50, 25, 25], profile: 'BLUE_CHIP', profileRange: '±6%',
  },
  {
    id: 'degen-emerging', name: 'Degen Emerging', surface: 'DeFi',
    pair: 'ARB / USDC', descriptor: 'Volatility-adjusted dynamic fee',
    tvlUsd: 684_300, netApyPct: 18.4, status: 'active', epochLabel: 'T−3d',
    feeSplit: [50, 25, 25], profile: 'EMERGING', profileRange: '±13%',
  },
  {
    id: 'meme-wide', name: 'Meme Wide-Range', surface: 'DeFi',
    pair: 'PEPE / USDC', descriptor: 'Wide range · idle-capital routed',
    tvlUsd: 129_500, netApyPct: 41.2, status: 'seeding', epochLabel: 'T−6d',
    feeSplit: [50, 25, 25], profile: 'MEME', profileRange: '±27%',
  },
  {
    id: 'liquidhectar-note', name: 'LiquidHectar Note', surface: 'RWA',
    pair: 'vRWA / USDC', descriptor: 'Real-estate note · oracle-banded',
    tvlUsd: 4_180_000, netApyPct: 9.0, status: 'active', epochLabel: 'T−3d',
    feeSplit: [50, 25, 25], underlyingApyPct: 12.0, settleDays: 30,
    priceBand: '±15/±45', kycAtRedeem: true,
  },
  {
    id: 'atx-credit', name: 'ATX Credit Facility', surface: 'RWA',
    pair: 'vRWA / USDC', descriptor: 'Private-credit facility · SPV-wrapped',
    tvlUsd: 1_960_000, netApyPct: 10.4, status: 'active', epochLabel: 'T−3d',
    feeSplit: [50, 25, 25], underlyingApyPct: 13.5, settleDays: 30,
    priceBand: '±15/±45', kycAtRedeem: true,
  },
  {
    id: 'mesquite-solar', name: 'Mesquite Solar', surface: 'RWA',
    pair: 'vRWA / USDC', descriptor: 'Energy off-take · commodity yield',
    tvlUsd: 512_000, netApyPct: 8.1, status: 'seeding', epochLabel: 'T−9d',
    feeSplit: [50, 25, 25], underlyingApyPct: 10.0, settleDays: 30,
    priceBand: '±15/±45', kycAtRedeem: true,
  },
]

/** Discovery source. Swap the mock for the vault subgraph / on-chain reads later. */
export async function getVaultsDiscovery(): Promise<VaultSummary[]> {
  return MOCK_VAULTS
}

/** Aggregate stats for the discovery header title-block. */
export function summarize(vaults: VaultSummary[]) {
  const tvlUsd = vaults.reduce((s, v) => s + v.tvlUsd, 0)
  const surfaces = new Set(vaults.map((v) => v.surface)).size
  return { count: vaults.length, tvlUsd, surfaces }
}

export function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
