// =============================================================================
// GET /api/eas/attest-score?address=
//
// Signs an AttributionScore offchain EAS attestation for the given wallet.
// Used by the Profile page → Score tab to display an attestation card.
//
// Flow:
//   1. Validate address param
//   2. Rate-limit: 1 request / address / 60 min (via Upstash)
//   3. Check eas_attestations for a fresh (<30 days) AttributionScore UID
//      — if found, return the cached UID immediately (no re-attestation)
//   4. Fetch Attribution score from external API
//   5. Call attestScore() from lib/eas.ts
//   6. Upsert eas_attestations row
//   7. Return { uid, eas_explorer_url }
// =============================================================================

import { attestScore }  from '@/lib/rewards/eas'
import { API }          from '@/lib/web2/api'
import { createHandler } from '@/lib/web2/routeHandler'

// ── Stale threshold ───────────────────────────────────────────────────────────
const STALE_DAYS  = 30
const STALE_MS    = STALE_DAYS * 24 * 60 * 60 * 1000

function easExplorerUrl(uid: string): string {
  const chainId = process.env.NEXT_PUBLIC_EAS_CHAIN_ID ?? '8453'
  const base    = chainId === '84532'
    ? 'https://base-sepolia.easscan.org'
    : 'https://base.easscan.org'
  return `${base}/offchain/attestation/view/${uid}`
}

function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

export const GET = createHandler(async (req, ctx) => {
  const { searchParams } = req.nextUrl
  const rawAddr          = searchParams.get('address') ?? ''

  if (!isValidAddress(rawAddr)) {
    return ctx.json({ error: 'invalid address' }, 400)
  }

  const address = rawAddr.toLowerCase()

  // ── Cache check: fresh AttributionScore UID (<30 days old) ─────────────────
  const { data: cached } = await ctx.supabase
    .from('eas_attestations')
    .select('eas_uid, attested_at')
    .eq('wallet', address)
    .eq('schema_name', 'AttributionScore')
    .order('attested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.attested_at).getTime()
    if (age < STALE_MS) {
      return ctx.json({
        uid:              cached.eas_uid,
        eas_explorer_url: easExplorerUrl(cached.eas_uid),
        cached:           true,
      })
    }
  }

  // ── Fetch score from Attribution API ───────────────────────────────────────
  let scoreData: Parameters<typeof attestScore>[1]
  try {
    const res = await fetch(`${API}/score?address=${address}`, { cache: 'no-store' })
    if (!res.ok) {
      return ctx.json({ error: 'score API unavailable' }, 502)
    }
    const json = await res.json() as Record<string, unknown>

    // Map API response to attestation shape
    const signals = (json.signals as { key: string; score: number }[]) ?? []
    scoreData = {
      score:        (json.score        as number)  ?? 0,
      maxScore:     (json.signals as { max: number }[] ?? []).reduce((s: number, sig: { max: number }) => s + sig.max, 925),
      percentile:   (json.percentile   as number)  ?? 0,
      tier:         (json.tier         as string)  ?? 'bronze',
      signals,
      treeSize:     (json.treeSize     as number)  ?? 0,
      treeQuality:  (json.treeQuality  as string)  ?? '0.00',
      chains:       (json.chains       as number)  ?? 0,
      totalTxCount: (json.totalTxCount as number)  ?? 0,
      character:    (json.character    as { label: string }) ?? { label: 'Unknown' },
    }
  } catch (err) {
    ctx.log.error('attest-score', 'Score fetch error', { err: String(err) })
    return ctx.json({ error: 'score fetch failed' }, 502)
  }

  // ── Attest ─────────────────────────────────────────────────────────────────
  let uid: string
  try {
    uid = await attestScore(address, scoreData)
  } catch (err) {
    ctx.log.error('attest-score', 'attestScore error', { err: String(err) })
    return ctx.json({ error: 'attestation failed' }, 500)
  }

  // ── Upsert eas_attestations ────────────────────────────────────────────────
  const { error: upsertErr } = await ctx.supabase
    .from('eas_attestations')
    .upsert(
      {
        wallet:      address,
        schema_name: 'AttributionScore',
        eas_uid:     uid,
        attested_at: new Date().toISOString(),
        metadata:    { score: scoreData.score, tier: scoreData.tier },
      },
      { onConflict: 'eas_uid' }
    )

  if (upsertErr) {
    ctx.log.warn('attest-score', 'Upsert error (non-critical)', { error: upsertErr.message })
    // Non-critical — still return the UID to the client
  }

  return ctx.json({
    uid,
    eas_explorer_url: easExplorerUrl(uid),
    cached:           false,
  })
}, { rateLimit: { max: 1, windowMs: 3600000 } })

export const POST = createHandler(async (_req, ctx) => {
  return ctx.json({ error: 'method not allowed' }, 405)
})
