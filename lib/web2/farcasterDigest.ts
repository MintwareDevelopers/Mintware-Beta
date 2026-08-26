// =============================================================================
// lib/web2/farcasterDigest.ts — the ONE place @mintware-agent uses an LLM.
//
// Everything else on the account (score-lookup replies) is templated — this is the
// exception, because a short weekly "here's what's interesting" digest genuinely
// benefits from judgment. Claude Haiku 4.5 (deliberate choice, not a cost downgrade —
// see conversation 2026-08-25): the task is short-form summarization, not deep reasoning.
//
// Draft-only by design — this module never posts. The caller (the cron route) returns
// the draft for review; posting is a separate, explicit action. See
// docs/product/farcaster-attribution-growth-playbook.md — credibility-primary, no
// unreviewed autonomous posting yet.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_API_KEY } from '@/lib/constants'
import type { LegacyScore } from '@/lib/attribution/legacyShape'

const MINTWARE_AGENT_PERSONA = `You are @mintware-agent, the disclosed, agent-run Farcaster account for
Mintware (on-chain Attribution reputation scoring for AI agents on Base). Your voice: factual, useful,
understated — never hype, never "🚀" energy, no manufactured urgency. You are infrastructure that
happens to post, not an influencer account.

Write a single short cast (Farcaster casts are capped around 320 characters — stay well under that)
summarizing the wallets/scores given to you. Point out something genuinely interesting or notable if
there is one (a high score, a big spread, a surprising percentile) — don't just list numbers flatly.
End with an invitation to reply with an address to get scored. No hashtags, no emoji spam (one is fine
if it earns its place), no exclamation-point stacking.`

export interface ScoredEntry {
  address: string
  score: LegacyScore & { source: string }
}

/** Generates the weekly digest cast text. Never posts — caller decides what to do with the draft. */
export async function generateWeeklyDigest(entries: ScoredEntry[]): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('anthropic_unconfigured: ANTHROPIC_API_KEY not set')
  }
  if (entries.length === 0) {
    throw new Error('no_entries: need at least one scored address to write a digest')
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const dataBlock = entries
    .map((e) => {
      const short = `${e.address.slice(0, 6)}…${e.address.slice(-4)}`
      return `${short}: score ${e.score.score}/925, tier ${e.score.tier}, ${e.score.percentile}th percentile, ${e.score.chains} chains, ${e.score.totalTxCount} txs`
    })
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: [
      {
        type: 'text',
        text: MINTWARE_AGENT_PERSONA,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: `This week's scored wallets:\n\n${dataBlock}` }],
  })

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!textBlock) throw new Error('no_text_in_response')
  return textBlock.text.trim()
}
