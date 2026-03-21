// =============================================================================
// lib/campaigns/creator.ts — Campaign creator types, validation, guardrails
// =============================================================================

export type CampaignType  = 'token_reward' | 'points'
export type ScheduleType  = 'now' | 'scheduled'
export type PointsFocus   = 'trade' | 'bridge' | 'both'
export type PayoutPreset  = '3' | '5' | '10' | '20'

export interface TokenInfo {
  address:  string
  name:     string
  symbol:   string
  decimals: number
  chainId:  number
  logoURI?: string
}

export interface CreatorFormState {
  // Type
  type: CampaignType | null

  // Step 1 — Token
  token:   TokenInfo | null
  chainId: number           // 1 = mainnet, 8453 = base, 42161 = arbitrum

  // Step 2 — Pool & Duration
  poolUsd:          number
  durationDays:     number
  // Advanced only
  dailyWalletCapUsd?: number
  dailyPoolCapUsd?:   number
  payoutPreset:       PayoutPreset  // points only

  // Step 3 — Actions (token reward)
  buyerRewardPct:    number   // 0–1
  referralRewardPct: number   // 0–5
  useScoreMultiplier:  boolean
  referralHoldHours:   number   // default 9

  // Step 3 — Actions (points)
  pointsFocus:               PointsFocus
  pointsPerUsdTrade:         number
  fixedBridgePoints:         number
  // Advanced only
  referralBasePoints:         number
  referralSharePct:           number
  useAttributionMultiplier:   boolean
  useSharingMultiplier:       boolean
  minDailyVolumeUsd:          number
  maxPointsPerWalletPct:      number

  // Step 4 — Schedule
  schedule: ScheduleType
  startAt:  Date | null

  // Meta
  advancedMode: boolean
}

export const DEFAULT_FORM: CreatorFormState = {
  type:    null,
  token:   null,
  chainId: 8453,

  poolUsd:          10000,
  durationDays:     30,
  dailyWalletCapUsd: undefined,
  dailyPoolCapUsd:   undefined,
  payoutPreset:      '5',

  buyerRewardPct:    0.5,
  referralRewardPct: 3,
  useScoreMultiplier: false,
  referralHoldHours:  9,

  pointsFocus:               'both',
  pointsPerUsdTrade:         10,
  fixedBridgePoints:         500,
  referralBasePoints:         200,
  referralSharePct:           10,
  useAttributionMultiplier:   true,
  useSharingMultiplier:       false,
  minDailyVolumeUsd:          0,
  maxPointsPerWalletPct:      5,

  schedule: 'now',
  startAt:  null,

  advancedMode: false,
}

// ── Derived calculations ──────────────────────────────────────────────────────

export function dailyBudget(form: CreatorFormState): number {
  return form.poolUsd / Math.max(1, form.durationDays)
}

/** Token reward only — what the pool pays at maximum payout rate (per $1 volume) */
export function totalRewardRate(form: CreatorFormState): number {
  return (form.buyerRewardPct + form.referralRewardPct) / 100
}

/** Volume needed to deplete the pool at max rate */
export function depletionVolumeUsd(form: CreatorFormState): number {
  const rate = totalRewardRate(form)
  if (rate === 0) return Infinity
  return form.poolUsd / rate
}

/** Days until pool depletes at max sustained rate */
export function depletionDays(form: CreatorFormState): number {
  const rate  = totalRewardRate(form)
  const daily = dailyBudget(form)
  // If max daily payout exceeded daily budget → depletion in <1 campaign day
  // Estimate: assume volume triggers max payout every day
  // This is a proxy — actual depletion depends on volume
  if (rate === 0) return Infinity
  return form.poolUsd / (rate * 1000000) * form.durationDays  // normalize to campaign days
}

// ── Guardrail warnings ────────────────────────────────────────────────────────

export interface GuardrailWarning {
  key:     string
  message: string
}

export function computeWarnings(form: CreatorFormState): GuardrailWarning[] {
  const w: GuardrailWarning[] = []

  if (form.poolUsd < 1000) {
    w.push({ key: 'small_pool', message: 'Small pools may not attract participation.' })
  }

  if (form.durationDays < 3) {
    w.push({ key: 'short_duration', message: 'Short campaigns limit organic growth.' })
  }

  if (form.type === 'token_reward') {
    const totalRate  = form.buyerRewardPct + form.referralRewardPct  // in %
    const budget     = dailyBudget(form)
    // Daily payout at max rate (treating % of volume — proxy: 1% of $1M daily = $10k)
    // Simplified: if total rate % × pool > duration × budget/2 → unsustainable
    if (totalRate > 0) {
      const estimatedDailyPayout = (form.poolUsd * totalRate / 100) / form.durationDays
      if (estimatedDailyPayout > budget * 0.5) {
        w.push({
          key:     'pool_sustainability',
          message: 'At these settings your pool may deplete faster than your campaign duration.',
        })
      }

      if ((form.referralRewardPct / totalRate) > 0.6) {
        w.push({
          key:     'referral_dominance',
          message: 'Referral rewards are >60% of your pool. Consider reducing referral % or adding a daily cap.',
        })
      }
    }
  }

  return w
}

// ── Step validation ────────────────────────────────────────────────────────────

export function validateStep(step: number, form: CreatorFormState): string | null {
  switch (step) {
    case 1:
      if (!form.token) return 'Please select or paste a token address.'
      return null
    case 2:
      if (form.poolUsd <= 0)    return 'Pool size must be greater than 0.'
      if (form.durationDays < 1) return 'Duration must be at least 1 day.'
      return null
    case 4:
      if (form.schedule === 'scheduled' && !form.startAt) {
        return 'Please select a start date and time.'
      }
      return null
    default:
      return null
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function fmtPct(n: number): string {
  return n % 1 === 0 ? `${n}%` : `${n.toFixed(1)}%`
}

export function fmtUSDShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

export const CHAIN_OPTIONS: { id: number; label: string; key: string }[] = [
  { id: 8453,  label: 'Base',     key: 'base'     },
  { id: 1,     label: 'Ethereum', key: 'mainnet'  },
  { id: 42161, label: 'Arbitrum', key: 'arbitrum' },
]

export const POOL_PRESETS = [5000, 10000, 25000] as const

export const POINTS_DURATION_PRESETS = [7, 14, 30] as const

export const PAYOUT_PRESETS: { value: PayoutPreset; label: string }[] = [
  { value: '3',  label: 'Top 3'  },
  { value: '5',  label: 'Top 5'  },
  { value: '10', label: 'Top 10' },
  { value: '20', label: 'Top 20' },
]

export const PAYOUT_PCT: Record<PayoutPreset, number[]> = {
  '3':  [50, 30, 20],
  '5':  [35, 25, 20, 12, 8],
  '10': [22, 18, 15, 12, 10, 8, 6, 4, 3, 2],
  '20': [15, 12, 10, 8, 7, 6, 5, 4, 3.5, 3, 3, 2.5, 2.5, 2.5, 2, 2, 2, 1.5, 1.5, 1],
}

/** ERC-20 minimal ABI for token validation */
export const ERC20_READ_ABI = [
  { name: 'name',     type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'symbol',   type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8'  }], stateMutability: 'view' },
] as const

/** ERC-20 approve ABI */
export const ERC20_APPROVE_ABI = [
  {
    name:            'approve',
    type:            'function',
    inputs:          [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs:         [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

/** MintwareDistributor v2 depositCampaign ABI */
export const DISTRIBUTOR_ABI = [
  {
    name:  'depositCampaign',
    type:  'function',
    inputs: [
      { name: 'campaignId', type: 'string'  },
      { name: 'token',      type: 'address' },
      { name: 'amount',     type: 'uint256' },
    ],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const

export const DISTRIBUTOR_ADDRESS =
  (process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS as `0x${string}` | undefined) ??
  '0x0000000000000000000000000000000000000000'
