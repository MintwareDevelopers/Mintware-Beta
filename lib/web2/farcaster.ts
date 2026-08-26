// =============================================================================
// lib/web2/farcaster.ts — @mintware-agent helpers (Neynar)
//
// Disclosed, agent-run Farcaster account. Reply-to-mention flow is TEMPLATED, not
// LLM-generated — the score is a data lookup + format, not something that needs judgment.
// See docs/product/farcaster-attribution-growth-playbook.md for the account's operating rules.
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NEYNAR_API_KEY, NEYNAR_SIGNER_UUID, NEYNAR_WEBHOOK_SECRET } from '@/lib/constants'
import type { LegacyScore } from '@/lib/attribution/legacyShape'

const NEYNAR_BASE = 'https://api.neynar.com/v2/farcaster'
const EVM_ADDRESS_RE = /0x[0-9a-fA-F]{40}/

// ---------------------------------------------------------------------------
// Webhook signature verification — HMAC-SHA512 hex, header `X-Neynar-Signature`.
// Verify against the RAW body string (before JSON.parse), same constant-time-compare
// discipline as routeHandler.ts's bearer-secret check.
// ---------------------------------------------------------------------------

export function verifyNeynarSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!NEYNAR_WEBHOOK_SECRET || !signatureHeader) return false
  const expected = createHmac('sha512', NEYNAR_WEBHOOK_SECRET).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// Address resolution — an explicit address in the cast text wins; otherwise fall back
// to the mentioner's own primary verified ETH address ("score me" case).
// ---------------------------------------------------------------------------

export function resolveTargetAddress(castText: string, authorVerifiedEthAddresses: string[] | undefined): string | null {
  const match = castText.match(EVM_ADDRESS_RE)
  if (match) return match[0]
  const fallback = authorVerifiedEthAddresses?.[0]
  return fallback ?? null
}

// ---------------------------------------------------------------------------
// Reply formatting — templated, no LLM call. Keep it short (casts are length-limited)
// and disclosed in tone, matching the account bio.
// ---------------------------------------------------------------------------

export function formatScoreReply(address: string, score: LegacyScore & { source: string }): string {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`
  const tier = score.tier.charAt(0).toUpperCase() + score.tier.slice(1)
  return `${short} → ${score.score}/925 (${tier}, ${score.percentile}th pct). Full profile: mintware.finance/${address}`
}

// ---------------------------------------------------------------------------
// Neynar API calls
// ---------------------------------------------------------------------------

async function neynarPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${NEYNAR_BASE}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': NEYNAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`neynar ${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Reply in-thread to a cast. `parentHash` is the hash of the cast being replied to. */
export function replyToCast(parentHash: string, text: string): Promise<any> {
  if (!NEYNAR_API_KEY || !NEYNAR_SIGNER_UUID) {
    throw new Error('neynar_unconfigured: NEYNAR_API_KEY / NEYNAR_SIGNER_UUID not set')
  }
  return neynarPost('/cast', { signer_uuid: NEYNAR_SIGNER_UUID, text, parent: parentHash })
}

/** Post a new top-level cast (not a reply) — used for the weekly leaderboard cast + the launch cast. */
export function publishCast(text: string): Promise<any> {
  if (!NEYNAR_API_KEY || !NEYNAR_SIGNER_UUID) {
    throw new Error('neynar_unconfigured: NEYNAR_API_KEY / NEYNAR_SIGNER_UUID not set')
  }
  return neynarPost('/cast', { signer_uuid: NEYNAR_SIGNER_UUID, text })
}
