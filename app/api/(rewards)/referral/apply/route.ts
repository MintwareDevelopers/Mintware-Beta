// =============================================================================
// POST /api/referral/apply
//
// Server-side referral attribution with time-gate protection.
//
// Why this exists (vs. direct Supabase insert from the client):
//   The browser Supabase client (anon key) cannot enforce server-side rules.
//   A bot could pre-generate ref codes for fresh wallets and immediately
//   insert referral_records before the referrer has been a real user for 24h.
//   Moving the insert here lets us check last_seen_at on the referrer.
//
// Time-gate rule:
//   referrer.last_seen_at must be at least 24 hours before now().
//   Referrers created less than 24h ago are rejected with 'referrer_too_new'.
//   This makes it uneconomical to farm self-referrals with fresh wallets.
//
// Body: { referred: string, ref_code: string }
// =============================================================================

import { attestReferral }             from '@/lib/rewards/eas'
import { recoverMessageAddress } from 'viem'
import { buildReferralApplyMessage } from '@/lib/web3/signedActionMessages'
import { createHandler } from '@/lib/web2/routeHandler'
import { getServiceClient } from '@/lib/web2/supabase'

const TIME_GATE_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_AUTH_AGE_MS = 15 * 60 * 1000

function isValidAddress(raw: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(raw)
}

export const POST = createHandler(async (req, ctx) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return ctx.json({ error: 'invalid json' }, 400)
  }

  const b = body as Record<string, unknown>

  const rawReferred = b?.referred
  const refCode     = b?.ref_code
  const authMessage = b?.authMessage
  const authSignature = b?.authSignature
  const issuedAt = b?.issuedAt

  if (!rawReferred || typeof rawReferred !== 'string') {
    return ctx.json({ error: 'referred address required' }, 400)
  }
  if (!isValidAddress(rawReferred)) {
    return ctx.json({ error: 'invalid referred address' }, 400)
  }
  if (!refCode || typeof refCode !== 'string') {
    return ctx.json({ error: 'ref_code required' }, 400)
  }
  if (typeof authMessage !== 'string' || typeof authSignature !== 'string' || typeof issuedAt !== 'number') {
    return ctx.json({ error: 'signed authorization required' }, 401)
  }

  const referred = rawReferred.toLowerCase()
  if (Math.abs(Date.now() - issuedAt) > MAX_AUTH_AGE_MS) {
    return ctx.json({ error: 'authorization expired' }, 401)
  }

  const expectedMessage = buildReferralApplyMessage({ referred, refCode, issuedAt })
  if (authMessage !== expectedMessage) {
    return ctx.json({ error: 'authorization payload mismatch' }, 401)
  }

  const signer = await recoverMessageAddress({
    message: authMessage,
    signature: authSignature as `0x${string}`,
  }).catch(() => null)

  if (!signer || signer.toLowerCase() !== referred) {
    return ctx.json({ error: 'invalid authorization signature' }, 401)
  }

  // Look up referrer by ref_code
  const { data: referrerProfile, error: lookupErr } = await ctx.supabase
    .from('wallet_profiles')
    .select('address, last_seen_at')
    .eq('ref_code', refCode)
    .single()

  if (lookupErr || !referrerProfile) {
    // ref_code doesn't exist — not an error, just a no-op
    return ctx.json({ applied: false, skip_reason: 'ref_code_not_found' }, 200)
  }

  const referrer = referrerProfile.address

  // Self-referral guard
  if (referrer === referred) {
    return ctx.json({ applied: false, skip_reason: 'self_referral' }, 200)
  }

  // ── Time-gate: referrer must have been seen at least 24h ago ──────────────
  // Treat null last_seen_at as failing — profile exists but has never been actively used.
  if (!referrerProfile.last_seen_at) {
    ctx.log.warn('referral/apply', 'Referrer too new: null last_seen_at', { referrer })
    return ctx.json({ applied: false, skip_reason: 'referrer_too_new' }, 200)
  }

  const lastSeen = new Date(referrerProfile.last_seen_at).getTime()
  const ageMs    = Date.now() - lastSeen

  if (ageMs < TIME_GATE_MS) {
    ctx.log.warn('referral/apply', 'Referrer too new', { referrer, last_seen_at: referrerProfile.last_seen_at, ageMs })
    return ctx.json({ applied: false, skip_reason: 'referrer_too_new' }, 200)
  }

  // ── Insert referral record ────────────────────────────────────────────────
  const { error: insertErr } = await ctx.supabase
    .from('referral_records')
    .upsert(
      {
        referrer,
        referred,
        ref_code: refCode,
        status:   'pending',
      },
      { onConflict: 'referred', ignoreDuplicates: true }
    )

  if (insertErr) {
    ctx.log.error('referral/apply', 'Insert error', { error: insertErr.message })
    return ctx.json({ error: 'internal error' }, 500)
  }

  // ── Fire-and-forget: ReferralLink EAS attestation ─────────────────────────
  // Never await — EAS failure must never block or degrade the referral response.
  void attestReferral(referrer, referred, refCode as string)
    .then(async (uid) => {
      if (!uid) return
      try {
        await getServiceClient()
          .from('eas_attestations')
          .upsert(
            {
              wallet:      referred,
              schema_name: 'ReferralLink',
              eas_uid:     uid,
              attested_at: new Date().toISOString(),
              metadata:    { referrer, ref_code: refCode },
            },
            { onConflict: 'eas_uid' }
          )
      } catch (e) { ctx.log.error('referral/apply', 'EAS upsert failed', { error: String(e) }) }
    })
    .catch(err => ctx.log.error('referral/apply', 'EAS attestation failed', { error: String(err) }))

  return ctx.json({ applied: true }, 200)
}, { auth: 'none' })

export const GET = createHandler(async (_req, ctx) => {
  return ctx.json({ error: 'method not allowed' }, 405)
})
