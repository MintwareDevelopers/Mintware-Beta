// =============================================================================
// Attribution Engine v2 — type contract.
//
// WalletActivity is the PROVIDER-AGNOSTIC input the engine consumes. A data
// adapter (GoldRush / Alchemy / a subgraph) maps its raw multi-chain data into
// this shape; the scoring logic never knows which provider produced it.
//
// ScoreResult is the OUTPUT, shaped to be a drop-in for the legacy `/score`
// worker response (score, tier, percentile, signals[]), so the app is unaffected
// by the engine swap.
// =============================================================================

export interface HoldingPosition {
  symbol: string
  usdValue: number
  holdDays: number // how long the position has been held
}

export interface LpPosition {
  pool: string
  usdDepth: number      // capital provided
  durationDays: number  // how long it's been (or was) provided
  active: boolean       // still open?
}

// A referee in the wallet's referral tree, carrying THEIR OWN attribution score
// so the Network signal is quality-weighted (one real high-score LP > 100 sybils).
export interface Referral {
  referredScore: number // 0..925, the referee's own attribution score
  retained: boolean     // did the referee stay active after referral?
}

export type RiskType = 'sanctioned' | 'mixer' | 'scam' | 'wash_trading' | 'sybil_cluster'

export interface RiskFlag {
  type: RiskType
  severity: number // 0..1 confidence/weight of the flag
}

export interface WalletActivity {
  address: string
  firstSeenMs: number       // first on-chain activity (0 = unknown/new)
  lastSeenMs: number        // most recent on-chain activity
  chains: string[]          // distinct chains the wallet is active on
  totalTxCount: number
  activeWeeks: number       // distinct calendar weeks with ≥1 tx (consistency, not bursts)
  lifetimeVolumeUsd: number // cumulative traded value

  positions: HoldingPosition[]
  lpPositions: LpPosition[]

  govVotes: number
  govProposals: number
  delegations: number

  referrals: Referral[]
  riskFlags: RiskFlag[]
}

export interface Insight {
  label: string
  detail: string
}

export interface SignalResult {
  key: string
  name: string
  icon: string
  color: string
  max: number
  score: number      // 0..max
  insights: Insight[]
}

export type Tier = 'bronze' | 'silver' | 'gold'

// FICO/FCRA-style reason code: the key factors moving a score. `weakness`
// entries are the adverse-action drivers ("what's holding you back"), `strength`
// entries are what the wallet has earned. Mirrors the ≤4 key-factor disclosure
// pattern from credit scoring (see spec §10).
export interface ScoreDriver {
  key: string
  name: string
  direction: 'strength' | 'weakness'
  detail: string
}

export interface ScoreResult {
  address: string
  score: number      // 0..925, AFTER the risk deduction
  rawScore: number   // sum of positive signals, BEFORE risk
  riskPenalty: number
  tier: Tier
  percentile: number // 0..100
  // How `percentile` was derived: 'estimate' = the v2.0 calibrated curve (no
  // population yet); 'population' = a real percentile against a frozen backfilled
  // ECDF. Never present an estimate as a population percentile.
  percentileBasis: 'estimate' | 'population'
  signals: SignalResult[]
  topDrivers: ScoreDriver[]
  risk: { penalty: number; flags: { type: RiskType; severity: number }[] }
  version: string
}

// Positive-signal weights (sum = 925, preserving the legacy max). Risk is a
// separate deduction of up to RISK_MAX applied to the total.
export const WEIGHTS = {
  liquidity: 200,
  holding: 150,
  activity: 150,
  longevity: 150,
  volume: 100,
  network: 100,
  governance: 75,
} as const

export const RISK_MAX = 200
export const MAX_SCORE = 925 // Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
export const ENGINE_VERSION = 'attribution-v2.0.0'
