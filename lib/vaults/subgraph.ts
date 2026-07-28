// =============================================================================
// Vault subgraph client — the real-data source behind the discovery seam.
//
// Gated on NEXT_PUBLIC_VAULT_SUBGRAPH_URL (the Subgraph Studio query URL). When
// unset, callers fall back to mock data, so nothing breaks pre-deploy.
// Maps the on-chain-indexed Vault entity → the UI's VaultSummary.
// =============================================================================

import type { VaultSummary, VaultSurface, VaultStatus } from './discovery'

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_VAULT_SUBGRAPH_URL ?? ''

export function isSubgraphEnabled(): boolean {
  return SUBGRAPH_URL.length > 0
}

interface SgVault {
  id: string
  name: string | null
  symbol: string | null
  surface: number
  asset: string | null
  totalAssets: string
  totalShares: string
  depositorCount: number
  active: boolean
}

const VAULTS_QUERY = `{
  vaults(first: 100, orderBy: totalAssets, orderDirection: desc, where: { active: true }) {
    id name symbol surface asset totalAssets totalShares depositorCount active
  }
}`

/** Query the vault subgraph. Returns [] if disabled or on any error. */
export async function fetchSubgraphVaults(): Promise<VaultSummary[]> {
  if (!isSubgraphEnabled()) return []
  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: VAULTS_QUERY }),
      // Server-side revalidation — vault TVL doesn't need per-request freshness.
      next: { revalidate: 30 },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: { vaults?: SgVault[] } }
    return (json.data?.vaults ?? []).map(mapVault)
  } catch {
    return []
  }
}

function mapVault(v: SgVault): VaultSummary {
  const surface: VaultSurface = v.surface === 1 ? 'RWA' : 'DeFi'
  const tvlUsd = Number(v.totalAssets ?? '0') / 1e6 // USDC is 6-dp
  const status: VaultStatus = v.active ? 'active' : 'paused'

  const base: VaultSummary = {
    id: v.id,
    name: v.name ?? 'Mintware Vault',
    surface,
    pair: v.symbol ?? 'USDC',
    descriptor:
      surface === 'RWA'
        ? 'RWA · SPV-wrapped · oracle-banded'
        : 'ERC-4626 · V4 hook-gated · MEV-protected',
    tvlUsd,
    netApyPct: 0, // APY needs fee/yield history — not yet derived on-chain
    status,
    epochLabel: '—',
    feeSplit: [70, 15, 10, 5],
  }

  if (surface === 'DeFi') {
    base.profile = 'BLUE_CHIP'
    base.profileRange = '±6%'
  } else {
    base.settleDays = 30
    base.priceBand = '±15/±45'
    base.kycAtRedeem = true
  }
  return base
}
