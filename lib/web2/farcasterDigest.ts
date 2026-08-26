// =============================================================================
// lib/web2/farcasterDigest.ts — the weekly @mintware-agent digest.
//
// Templated, not LLM-generated — same reasoning as the reply-to-mention flow
// (formatScoreReply in lib/web2/farcaster.ts): picking out what's notable across a
// handful of scored wallets and filling a sentence is logic, not judgment. No paid
// dependency, no new billing account. Decided 2026-08-26 after weighing a Claude
// Haiku 4.5 version — see conversation history; the flat, factual read actually
// fits the account's "understated, not hype" voice better than generated variety.
//
// Draft-only by design — this module never posts. The caller (the cron route) returns
// the draft for review; posting is a separate, explicit action. See
// docs/product/farcaster-attribution-growth-playbook.md.
// =============================================================================

import type { LegacyScore } from '@/lib/attribution/legacyShape'

export interface ScoredEntry {
  address: string
  score: LegacyScore & { source: string }
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// A little week-to-week phrasing variety without an LLM — fully deterministic, keyed off
// the ISO week number so it rotates on its own with no state to track.
const OPENERS = [
  'This week:',
  'Scored this week:',
  "This week's lookups:",
  'From the past week:',
]

function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** Generates the weekly digest cast text — templated, no LLM call, no external cost. */
export function generateWeeklyDigest(entries: ScoredEntry[], now: Date = new Date()): string {
  if (entries.length === 0) {
    throw new Error('no_entries: need at least one scored address to write a digest')
  }

  const opener = OPENERS[isoWeekNumber(now) % OPENERS.length]

  if (entries.length === 1) {
    const e = entries[0]
    return `${opener} ${short(e.address)} → ${e.score.score}/925 (${e.score.tier}, ${e.score.percentile}th pct, ${e.score.chains} chains). Reply with any address and I'll score it too.`
  }

  const sorted = [...entries].sort((a, b) => b.score.score - a.score.score)
  const top = sorted[0]
  const lines = sorted
    .map((e) => `${short(e.address)}: ${e.score.score}/925 (${e.score.tier})`)
    .join(' · ')

  const spread = sorted[0].score.score - sorted[sorted.length - 1].score.score
  const spreadNote = spread > 300 ? ` Wide spread this week — ${spread} points top to bottom.` : ''

  return `${opener} ${lines}. Highest: ${short(top.address)} at ${top.score.percentile}th percentile.${spreadNote} Reply with any address and I'll score it too.`
}
