// lib/rewards/badges.ts
// Badge computation engine — derives earned/unearned badges from score + referral data.
// No API calls — all derived from data already fetched on the profile page.

export interface Badge {
  id:     string
  label:  string
  desc:   string
  icon:   string
  color:  string   // earned color
  earned: boolean
}

interface Signal {
  key:   string
  score: number
  max:   number
}

interface ScoreInput {
  walletAge:    string   // e.g. "117 months"
  percentile:   number   // 0-100
  totalTxCount: number
  signals:      Signal[]
  treeSize?:    number   // from score response
}

/** Parse "117 months" or "6 months" → integer months */
function parseMonths(walletAge: string): number {
  const m = walletAge?.match(/(\d+)\s*month/)
  return m ? parseInt(m[1]) : 0
}

/** Get signal score by key */
function sig(signals: Signal[], key: string): number {
  return signals.find(s => s.key === key)?.score ?? 0
}

export function computeBadges(score: ScoreInput, treeSize: number): Badge[] {
  const months      = parseMonths(score.walletAge)
  const liquidity   = sig(score.signals, 'liquidity')
  const trading     = sig(score.signals, 'trading')
  const governance  = sig(score.signals, 'governance')

  return [
    {
      id:     'og',
      label:  'OG',
      desc:   'Wallet older than 12 months',
      icon:   '◆',
      color:  '#C27A00',
      earned: months >= 12,
    },
    {
      id:     'core_lp',
      label:  'Core LP',
      desc:   'Active liquidity provider',
      icon:   '⬡',
      color:  '#2A9E8A',
      earned: liquidity > 0,
    },
    {
      id:     'connector',
      label:  'Connector',
      desc:   'Referred 5+ active wallets',
      icon:   '◉',
      color:  '#C2537A',
      earned: treeSize >= 5,
    },
    {
      id:     'consistent',
      label:  'Consistent',
      desc:   'High trading activity',
      icon:   '⇄',
      color:  '#3A5CE8',
      earned: trading >= 20,
    },
    {
      id:     'top10',
      label:  'Top 10%',
      desc:   'Top 10% of all scored wallets',
      icon:   '⊕',
      color:  '#7B6FCC',
      earned: score.percentile >= 90,
    },
    {
      id:     'governor',
      label:  'Governor',
      desc:   'Participates in on-chain governance',
      icon:   '⊞',
      color:  '#4f7ef7',
      earned: governance > 0,
    },
  ]
}

/** Returns the top earned badge label for use in share text */
export function topBadgeLabel(badges: Badge[]): string {
  const earned = badges.filter(b => b.earned)
  return earned.length > 0 ? earned[0].label : ''
}
