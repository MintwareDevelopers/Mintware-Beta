// =============================================================================
// demoMode.ts — deterministic Attribution personas for live demos.
//
// Activate by visiting any page with `?demo=gold` (or silver/bronze/whale); the
// choice persists in localStorage and a floating switcher (DemoBar) lets the
// presenter flip personas live. `?demo=off` exits. When active, fetchScore()
// (lib/web2/api.ts) returns the persona's score instead of hitting the live
// Attribution worker — so the connected experience (profile, rewards, vault
// detail) is controllable regardless of which wallet is connected.
//
// Purely client-side and clearly a demo aid — never affects server routes,
// the oracle, or on-chain state.
// =============================================================================

export type DemoPersona = 'gold' | 'silver' | 'bronze' | 'whale'
export const DEMO_PERSONAS: DemoPersona[] = ['gold', 'silver', 'bronze', 'whale']

const STORAGE_KEY = 'mw_demo_persona'

/** Current persona from URL (?demo=) — which also persists — or localStorage. Client-only. */
export function getDemoPersona(): DemoPersona | null {
  if (typeof window === 'undefined') return null
  try {
    const q = new URLSearchParams(window.location.search).get('demo')
    if (q) {
      if (q === 'off') { window.localStorage.removeItem(STORAGE_KEY); return null }
      if ((DEMO_PERSONAS as string[]).includes(q)) {
        window.localStorage.setItem(STORAGE_KEY, q)
        return q as DemoPersona
      }
    }
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return (DEMO_PERSONAS as string[]).includes(stored ?? '') ? (stored as DemoPersona) : null
  } catch {
    return null
  }
}

export function isDemoMode(): boolean {
  return getDemoPersona() !== null
}

export function setDemoPersona(p: DemoPersona | null): void {
  if (typeof window === 'undefined') return
  try {
    if (p) window.localStorage.setItem(STORAGE_KEY, p)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}

// ── persona score payloads (match the /score response shape) ─────────────────

const SIGNAL_META = [
  { key: 'volume',     name: 'Volume',     icon: '⇄', max: 100, color: '#3A52CC' },
  { key: 'trading',    name: 'Trading',    icon: '◈', max: 75,  color: '#6B8FFF' },
  { key: 'holding',    name: 'Holding',    icon: '◆', max: 100, color: '#2A9E8A' },
  { key: 'liquidity',  name: 'Liquidity',  icon: '⬡', max: 150, color: '#C27A00' },
  { key: 'governance', name: 'Governance', icon: '⊕', max: 100, color: '#7B6FCC' },
  { key: 'sharing',    name: 'Sharing',    icon: '◉', max: 400, color: '#C2537A' },
] as const

interface PersonaSpec {
  label: string
  score: number
  tier: 'bronze' | 'silver' | 'gold'
  percentile: number
  walletAge: string
  firstSeen: string
  chains: number
  totalTxCount: number
  treeSize: number
  treeQuality: string
  totalLo: number
  totalHi: number
  signals: [number, number, number, number, number, number] // per SIGNAL_META order
  character: { label: string; color: string; desc: string; icon: string }
}

const SPECS: Record<DemoPersona, PersonaSpec> = {
  gold: {
    label: 'Gold — high-reputation LP',
    score: 842, tier: 'gold', percentile: 88, walletAge: '96 months', firstSeen: 'Mar 2017',
    chains: 6, totalTxCount: 2140, treeSize: 34, treeQuality: '0.82', totalLo: 9800, totalHi: 24000,
    signals: [88, 66, 84, 132, 71, 296],
    character: { label: 'Liquidity Provider', color: '#C27A00', desc: 'Deep, durable liquidity and a real referral network.', icon: '⬡' },
  },
  silver: {
    label: 'Silver — active contributor',
    score: 511, tier: 'silver', percentile: 55, walletAge: '54 months', firstSeen: 'Sep 2021',
    chains: 4, totalTxCount: 870, treeSize: 11, treeQuality: '0.61', totalLo: 3200, totalHi: 9100,
    signals: [61, 48, 57, 74, 33, 138],
    character: { label: 'Builder', color: '#6B8FFF', desc: 'Consistent engagement across protocols.', icon: '◈' },
  },
  bronze: {
    label: 'Bronze — newer wallet',
    score: 190, tier: 'bronze', percentile: 20, walletAge: '14 months', firstSeen: 'Jan 2025',
    chains: 2, totalTxCount: 168, treeSize: 1, treeQuality: '0.20', totalLo: 710, totalHi: 3250,
    signals: [34, 24, 39, 21, 8, 64],
    character: { label: 'Explorer', color: '#7B6FCC', desc: 'Early days — reputation still building.', icon: '○' },
  },
  whale: {
    label: 'Whale — big wallet, low reputation',
    score: 150, tier: 'bronze', percentile: 8, walletAge: '20 months', firstSeen: 'Nov 2024',
    chains: 2, totalTxCount: 96, treeSize: 0, treeQuality: '0.00', totalLo: 1200, totalHi: 4200,
    // high volume (mercenary size) but almost no holding / liquidity duration / sharing
    signals: [92, 22, 10, 14, 0, 0],
    character: { label: 'Ghost', color: '#9898C0', desc: 'Large flows, little durable contribution — the wallet Mintware does not overpay.', icon: '○' },
  },
}

/** Build a /score-shaped object for a persona. */
export function demoScore(persona: DemoPersona) {
  const s = SPECS[persona]
  return {
    score: s.score,
    tier: s.tier,
    percentile: s.percentile,
    walletAge: s.walletAge,
    firstSeen: s.firstSeen,
    chains: s.chains,
    totalTxCount: s.totalTxCount,
    treeSize: s.treeSize,
    treeQuality: s.treeQuality,
    totalLo: s.totalLo,
    totalHi: s.totalHi,
    signals: SIGNAL_META.map((m, i) => ({
      key: m.key, name: m.name, icon: m.icon, max: m.max, color: m.color,
      score: s.signals[i], insights: [] as string[],
    })),
    character: s.character,
    uvOpportunities: [] as unknown[],
    timeline: [] as unknown[],
    projects: [] as unknown[],
    _demo: persona,
  }
}

export function personaLabel(persona: DemoPersona): string {
  return SPECS[persona].label
}

/** The fee-share multiplier a persona's percentile earns (matches the rewards model). */
export function personaMultiplier(persona: DemoPersona): number {
  const p = SPECS[persona].percentile
  return p >= 67 ? 1.5 : p >= 34 ? 1.25 : 1.0
}
