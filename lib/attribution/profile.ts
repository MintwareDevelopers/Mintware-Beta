// =============================================================================
// Attribution profile — data model + source (Track D)
//
// Blends the off-chain 6-signal score (the canonical Worker output) with the
// on-chain soulbound mwATT rollup (economic / network / technical vectors used
// for surface weighting). Mock now; getAttributionProfile() is the seam to swap
// for the /score API + the MintwareAttributionToken read later.
// =============================================================================

export interface Signal {
  key: string
  label: string
  score: number
  max: number
}
export interface Badge {
  id: string
  name: string
  rarity: 'common' | 'rare' | 'epic'
  earned: boolean
}
export interface AttributionPosition {
  vault: string
  surface: 'DeFi' | 'RWA'
  valueUsd: number
}
export interface AttributionProfile {
  address: string
  total: number
  maxTotal: number
  tier: 'bronze' | 'silver' | 'gold'
  percentile: number
  tokenId: number // soulbound mwATT
  // on-chain rollup vectors (surface weighting: DeFi 70/30/0, RWA 60/25/15)
  vectors: { economic: number; network: number; technical: number }
  signals: Signal[]
  badges: Badge[]
  positions: AttributionPosition[]
  network: { treeSize: number; depth: number; quality: number }
}

const MOCK: AttributionProfile = {
  address: '0x46bb…42d7',
  total: 247,
  maxTotal: 925,
  tier: 'silver',
  percentile: 88,
  tokenId: 1,
  vectors: { economic: 103, network: 78, technical: 66 },
  signals: [
    { key: 'volume', label: 'Volume', score: 41, max: 100 },
    { key: 'trading', label: 'Trading', score: 24, max: 75 },
    { key: 'holding', label: 'Holding', score: 39, max: 100 },
    { key: 'liquidity', label: 'Liquidity', score: 18, max: 150 },
    { key: 'governance', label: 'Governance', score: 12, max: 100 },
    { key: 'sharing', label: 'Sharing', score: 113, max: 400 },
  ],
  badges: [
    { id: 'og', name: 'OG', rarity: 'epic', earned: true },
    { id: 'core-lp', name: 'Core LP', rarity: 'rare', earned: true },
    { id: 'connector', name: 'Connector', rarity: 'rare', earned: true },
    { id: 'consistent', name: 'Consistent', rarity: 'common', earned: true },
    { id: 'top10', name: 'Top 10%', rarity: 'epic', earned: true },
    { id: 'governor', name: 'Governor', rarity: 'rare', earned: false },
  ],
  positions: [
    { vault: 'Social Blue-Chip', surface: 'DeFi', valueUsd: 12_000 },
    { vault: 'LiquidHectar Note', surface: 'RWA', valueUsd: 4_500 },
  ],
  network: { treeSize: 14, depth: 3, quality: 0.72 },
}

export async function getAttributionProfile(_address?: string): Promise<AttributionProfile> {
  return MOCK
}
