// =============================================================================
// RWA Issuer (asset provider) profile — data model + source (Track D)
//
// The provider trust surface: attribution, track record, transparency, and the
// SPVAssetProviderRegistry verification status. Mock now; getIssuer() is the
// seam to swap for the registry read + subgraph later.
// =============================================================================

export type ProviderStatus = 'REGISTERED' | 'VERIFIED' | 'SUSPENDED'

export interface IssuerVault {
  name: string
  tvlUsd: number
  apyPct: number
  status: 'active' | 'seeding'
}
export interface TransparencyItem {
  label: string
  value: string
}
export interface IssuerProfile {
  id: string
  name: string
  address: string
  status: ProviderStatus
  since: string
  attributionScore: number
  dealsCompleted: number
  totalRaisedUsd: number
  defaultRatePct: number
  onTimeSettlementPct: number
  vaults: IssuerVault[]
  transparency: TransparencyItem[]
}

const MOCK: IssuerProfile = {
  id: 'liquidhectar',
  name: 'LiquidHectar',
  address: '0x59a2…76a9',
  status: 'VERIFIED',
  since: '2026-02',
  attributionScore: 312,
  dealsCompleted: 7,
  totalRaisedUsd: 8_400_000,
  defaultRatePct: 0.0,
  onTimeSettlementPct: 100,
  vaults: [
    { name: 'LiquidHectar Note', tvlUsd: 4_180_000, apyPct: 9.0, status: 'active' },
    { name: 'ATX Credit Facility', tvlUsd: 1_960_000, apyPct: 10.4, status: 'active' },
    { name: 'Mesquite Solar', tvlUsd: 512_000, apyPct: 8.1, status: 'seeding' },
  ],
  transparency: [
    { label: 'Audited financials', value: 'Quarterly' },
    { label: 'Reserve attestation', value: 'Monthly · Chainlink' },
    { label: 'Legal opinion', value: 'On file' },
    { label: 'Collateral ratio', value: '128%' },
  ],
}

export async function getIssuer(_id?: string): Promise<IssuerProfile> {
  return MOCK
}
