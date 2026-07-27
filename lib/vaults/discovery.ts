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

/**
 * Discovery source. Reads the vault subgraph when NEXT_PUBLIC_VAULT_SUBGRAPH_URL
 * is set (real on-chain-indexed DeFi vaults), otherwise falls back to mock. RWA
 * vaults stay mock until the Track-B RWA contracts are deployed + indexed.
 */
export async function getVaultsDiscovery(): Promise<VaultSummary[]> {
  const { isSubgraphEnabled, fetchSubgraphVaults } = await import('./subgraph')
  if (isSubgraphEnabled()) {
    const real = await fetchSubgraphVaults()
    if (real.length > 0) {
      const hasRwa = real.some((v) => v.surface === 'RWA')
      // Real vaults + preview RWA (until RWA contracts ship) so the two-surface
      // UI stays populated on both sides.
      const previewRwa = hasRwa ? [] : MOCK_VAULTS.filter((v) => v.surface === 'RWA')
      return [...real, ...previewRwa]
    }
  }
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

// ── Vault Detail ────────────────────────────────────────────────────────────

export interface HookStep {
  order: number
  name: string
  phase: 'beforeSwap' | 'afterSwap'
  note: string
}
export interface LockTierOption {
  tier: string
  days: number
  multiplier: number
}
export interface YieldSource {
  label: string
  apyPct: number
}
export interface VaultPosition {
  depositedUsd: number
  shares: number
  tier: string
  multiplier: number
  earnedUsd: number
}
export interface VaultDetail extends VaultSummary {
  hookStack: HookStep[]
  lockTiers: LockTierOption[]
  yieldSources: YieldSource[]
  position?: VaultPosition
  reserveSplit?: [number, number] // [reserve%, yield%] — RWA only
}

// Ordered hook stacks per surface (from the two-surface architecture).
const DEFI_HOOK_STACK: HookStep[] = [
  { order: 0, name: 'MEV Protection', phase: 'beforeSwap', note: 'TWAP verify · sandwich guard · cooldown' },
  { order: 1, name: 'Dynamic Fee', phase: 'beforeSwap', note: 'Volatility + depth fee override' },
  { order: 2, name: 'Idle Capital', phase: 'afterSwap', note: 'Rebalance idle → yield pools' },
  { order: 3, name: 'Attribution', phase: 'afterSwap', note: 'Fee split weighted by reputation' },
  { order: 4, name: 'FeeVault', phase: 'afterSwap', note: 'Accumulate for epoch distribution' },
]
const RWA_HOOK_STACK: HookStep[] = [
  { order: 0, name: 'Oracle Bands', phase: 'beforeSwap', note: 'Enforce ±15% / ±45% price bands' },
  { order: 1, name: 'MEV Protection', phase: 'beforeSwap', note: 'TWAP verify · sandwich guard' },
  { order: 2, name: 'Idle Capital', phase: 'afterSwap', note: 'Maintain 40 / 60 reserve ratio' },
  { order: 3, name: 'Attribution', phase: 'afterSwap', note: 'Fee split weighted by reputation' },
  { order: 4, name: 'FeeVault', phase: 'afterSwap', note: 'Accumulate for epoch distribution' },
]

const LOCK_TIERS: LockTierOption[] = [
  { tier: 'Flex', days: 0, multiplier: 1.0 },
  { tier: 'Committed', days: 30, multiplier: 1.15 },
  { tier: 'Aligned', days: 90, multiplier: 1.3 },
  { tier: 'Core', days: 180, multiplier: 1.5 },
]

/**
 * Detail source. Builds on getVaultsDiscovery() (which reads the subgraph when
 * enabled), so the summary fields (name, TVL, status, surface) are already real
 * for a deployed vault. Hook stack + lock tiers are static per-surface config.
 * Yield breakdown is synthesized — for a REAL vault (address id) with no activity
 * yet we show honest zeros rather than a fabricated (and negative) split.
 */
export async function getVault(id: string): Promise<VaultDetail | null> {
  const list = await getVaultsDiscovery()
  const v = list.find((x) => x.id === id)
  if (!v) return null

  const isDeFi = v.surface === 'DeFi'
  // A real on-chain vault is keyed by its contract address.
  const isReal = /^0x[0-9a-fA-F]{40}$/.test(v.id)

  let yieldSources: YieldSource[]
  if (isReal) {
    // Real vault — don't fabricate APY. These accrue once fees/yield flow;
    // wire to real FeeVault/epoch data in a later pass.
    yieldSources = isDeFi
      ? [
          { label: 'Swap fees', apyPct: 0 },
          { label: 'Idle capital yield', apyPct: 0 },
          { label: 'Attribution multiplier', apyPct: 0 },
        ]
      : [
          { label: 'Underlying asset', apyPct: 0 },
          { label: 'Swap fees', apyPct: 0 },
          { label: 'Idle capital yield', apyPct: 0 },
        ]
  } else {
    yieldSources = isDeFi
      ? [
          { label: 'Swap fees', apyPct: 6.0 },
          { label: 'Idle capital yield', apyPct: 1.5 },
          { label: 'Attribution multiplier', apyPct: Math.max(0, v.netApyPct - 7.5) },
        ]
      : [
          { label: 'Underlying asset', apyPct: v.underlyingApyPct ?? 9 },
          { label: 'Swap fees', apyPct: 0.75 },
          { label: 'Idle capital yield', apyPct: 1.4 },
        ]
  }

  return {
    ...v,
    hookStack: isDeFi ? DEFI_HOOK_STACK : RWA_HOOK_STACK,
    lockTiers: LOCK_TIERS,
    yieldSources,
    reserveSplit: isDeFi ? undefined : [40, 60],
    // Position is read on-chain client-side (useVaultOnchain) in the real app;
    // the /style preview only shows a sample position for the mock hero vault.
    position:
      v.id === 'social-blue-chip'
        ? { depositedUsd: 12_000, shares: 12_000, tier: 'Aligned', multiplier: 1.3, earnedUsd: 214 }
        : undefined,
  }
}

