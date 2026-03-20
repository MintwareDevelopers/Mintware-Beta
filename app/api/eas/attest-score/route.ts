// =============================================================================
// GET /api/eas/attest-score?address=
//
// Signs an AttributionScore offchain EAS attestation for the given wallet.
// Used by the Profile page → Score tab to display an attestation card.
//
// Flow:
//   1. Validate address param
//   2. Rate-limit: 1 request / address / 60 min (in-memory, per instance)
//   3. Check eas_attestations for a fresh (<30 days) AttributionScore UID
//      — if found, return the cached UID immediately (no re-attestation)
//   4. Fetch Attribution score from external API
//   5. Call attestScore() from lib/eas.ts
//   6. Upsert eas_attestations row
//   7. Return { uid, eas_explorer_url }
//
// Rate limit note: uses the same in-memory Map pattern as other routes.
// One entry per wallet address; expires after RATE_LIMIT_MS.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase'
import { attestScore }                 from '@/lib/eas'
import { API }                         from '@/lib/api'

// ── Rate limiter ──────────────────────────────────────────────────────────────
const RATE_LIMIT_MS = 60 * 60 * 1000  // 1 hour
const rateMap       = new Map<string, number>()

function isRateLimited(addr: string): boolean {
  const last = rateMap.get(addr)
  if (!last) return false
  return Date.now() - last < RATE_LIMIT_MS
}

function recordRequest(addr: string): void {
  rateMap.set(addr, Date.now())
  // Prune stale entries every ~500 requests to prevent unbounded growth
  if (rateMap.size > 500) {
    const cutoff = Date.now() - RATE_LIMIT_MS
    for (const [k, v] of rateMap) {
      if (v < cutoff) rateMap.delete(k)
    }
  }
}

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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const rawAddr          = searchParams.get('address') ?? ''

  if (!isValidAddress(rawAddr)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 })
  }

  const address  = rawAddr.toLowerCase()
  const supabase = createSupabaseServiceClient()

  // ── Rate limit ─────────────────────────────────────────────────────────────
  if (isRateLimited(address)) {
    return NextResponse.json({ error: 'rate limited — try again in 1 hour' }, { status: 429 })
  }

  // ── Cache check: fresh AttributionScore UID (<30 days old) ─────────────────
  const { data: cached } = await supabase
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
      return NextResponse.json({
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
      return NextResponse.json({ error: 'score API unavailable' }, { status: 502 })
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
    console.error('[attest-score] score fetch error:', err)
    return NextResponse.json({ error: 'score fetch failed' }, { status: 502 })
  }

  // ── Attest ─────────────────────────────────────────────────────────────────
  recordRequest(address)

  let uid: string
  try {
    uid = await attestScore(address, scoreData)
  } catch (err) {
    console.error('[attest-score] attestScore error:', err)
    return NextResponse.json({ error: 'attestation failed' }, { status: 500 })
  }

  // ── Upsert eas_attestations ────────────────────────────────────────────────
  const { error: upsertErr } = await supabase
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
    console.error('[attest-score] upsert error:', upsertErr.message)
    // Non-critical — still return the UID to the client
  }

  return NextResponse.json({
    uid,
    eas_explorer_url: easExplorerUrl(uid),
    cached:           false,
  })
}

export async function POST() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 })
}
