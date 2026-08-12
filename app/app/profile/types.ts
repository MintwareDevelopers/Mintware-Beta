// Shared types for the profile page and its tab components.
// Kept here so tab components can import them without circular deps.

export interface Signal {
  key: string
  name: string
  icon: string
  max: number
  color: string
  score: number
  insights: string[]
}

export interface ScoreResponse {
  address: string
  score: number
  tier: string
  percentile: number
  signals: Signal[]
  walletAge: string
  firstSeen: string
  chains: number
  totalTxCount: number
  treeSize: number
  treeQuality: string
  character: { label: string; color: string; desc: string; icon: string }
  projects?: {
    name: string
    symbol: string
    cat: string
    deployed: number
    pnl: number
    pnlPct: number
    stillActive: boolean
    holdDays: number
  }[]
  uvOpportunities: {
    name: string; cat: string; icon: string
    type: string; typeColor: string; accentColor: string
    mechanic: string; lo: number; hi: number; reason: string
  }[]
  totalLo: number
  totalHi: number
  timeline?: { date: string; score: number; events: unknown[] }[]
}

export type Tab = 'portfolio' | 'score' | 'badge' | 'invite' | 'liquidity'
