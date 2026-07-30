// Profile 2.0 · Slice 1 — /api/profile
//   GET  ?address=   public read; merges the wallet_profiles row with a live basename lookup.
//   POST             owner-only edit (inline signed-message, EIP-191). Updates identity fields.
// Storage: wallet_profiles identity columns (migration 20260729000001).

import { createHandler } from '@/lib/web2/routeHandler'
import { recoverMessageAddress } from 'viem'
import { resolveBasename } from '@/lib/web2/identity'
import { generateRefCodeForWallet } from '@/lib/rewards/referral-code'
import { buildProfileUpdateMessage } from '@/lib/web3/signedActionMessages'
import { cleanProfileField, cleanProfileHandle, cleanProfileUrl, cleanProfileImageUrl, AVATAR_TYPES } from '@/lib/rewards/profileSanitize'

const IDENTITY_COLS =
  'address, display_name, bio, avatar_type, avatar_ref, twitter, farcaster, telegram, website, attestation_uid, ref_code, created_at, updated_at'

// ─── GET — public read ──────────────────────────────────────────────────────────
export const GET = createHandler(async (req, ctx) => {
  const raw = new URL(req.url).searchParams.get('address')?.trim() ?? ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return ctx.json({ error: 'Valid address required' }, 400)
  const address = raw.toLowerCase()

  const { data } = await ctx.supabase
    .from('wallet_profiles')
    .select(IDENTITY_COLS)
    .eq('address', address)
    .maybeSingle()

  // EAS badge (Slice 5): surface the wallet's latest AttributionScore attestation
  // UID. eas_attestations is the source of truth (maintained by /api/eas/attest-
  // score); fall back to a UID pinned on the profile row. No write needed here.
  const { data: att } = await ctx.supabase
    .from('eas_attestations')
    .select('eas_uid')
    .eq('wallet', address)
    .eq('schema_name', 'AttributionScore')
    .order('attested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const attestationUid = att?.eas_uid ?? data?.attestation_uid ?? null

  const basename = await resolveBasename(address)

  return ctx.json({
    address,
    basename,
    // render order the UI should use: custom name -> basename -> (client shortens address)
    name:         data?.display_name ?? basename ?? null,
    display_name: data?.display_name ?? null,
    bio:          data?.bio ?? null,
    avatar:       { type: data?.avatar_type ?? 'default', ref: data?.avatar_ref ?? null },
    socials: {
      twitter:   data?.twitter ?? null,
      farcaster: data?.farcaster ?? null,
      telegram:  data?.telegram ?? null,
      website:   data?.website ?? null,
    },
    attestationUid,
    refCode:        data?.ref_code ?? null,
    createdAt:      data?.created_at ?? null,
    updatedAt:      data?.updated_at ?? null,
  })
})

// ─── POST — owner-only edit ─────────────────────────────────────────────────────
interface UpdatePayload {
  wallet?: string
  displayName?: string | null
  bio?: string | null
  twitter?: string | null
  farcaster?: string | null
  telegram?: string | null
  website?: string | null
  avatarType?: string | null
  avatarRef?: string | null
  authMessage?: string
  authSignature?: `0x${string}`
  issuedAt?: number
}

const MAX_AUTH_AGE_MS = 15 * 60 * 1000

export const POST = createHandler(async (req, ctx) => {
  let body: UpdatePayload
  try { body = (await req.clone().json()) as UpdatePayload } catch { return ctx.json({ error: 'Invalid JSON' }, 400) }

  if (typeof body.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(body.wallet))
    return ctx.json({ error: 'Valid wallet required' }, 400)
  if (!body.authMessage || !body.authSignature || typeof body.issuedAt !== 'number')
    return ctx.json({ error: 'Signed authorization required' }, 401)
  if (Math.abs(Date.now() - body.issuedAt) > MAX_AUTH_AGE_MS)
    return ctx.json({ error: 'Authorization expired — please sign again' }, 401)

  // sanitize the same way the signed payload was built (shared lib — client + server)
  const displayName = cleanProfileField(body.displayName, 40)
  const bio         = cleanProfileField(body.bio, 200)
  const twitter     = cleanProfileHandle(body.twitter)
  const farcaster   = cleanProfileHandle(body.farcaster)
  const telegram    = cleanProfileHandle(body.telegram)
  const website     = cleanProfileUrl(body.website)
  const avatarType  = (AVATAR_TYPES as readonly string[]).includes(String(body.avatarType)) ? String(body.avatarType) : null
  const avatarRef   = cleanProfileImageUrl(body.avatarRef)

  const expected = buildProfileUpdateMessage({
    wallet: body.wallet, issuedAt: body.issuedAt,
    displayName, bio, twitter, farcaster, telegram, website, avatarType, avatarRef,
  })
  if (body.authMessage !== expected) return ctx.json({ error: 'Authorization payload mismatch' }, 401)

  const signer = await recoverMessageAddress({ message: body.authMessage, signature: body.authSignature }).catch(() => null)
  if (!signer || signer.toLowerCase() !== body.wallet.toLowerCase())
    return ctx.json({ error: 'Invalid authorization signature' }, 401)

  const addr = body.wallet.toLowerCase()
  const fields = {
    display_name: displayName, bio, twitter, farcaster, telegram, website,
    avatar_type: avatarType, avatar_ref: avatarRef,
    updated_at: new Date().toISOString(),
  }

  // Row normally exists (created on wallet connect). Update it; create with a
  // generated ref_code only in the rare case it does not yet.
  const { data: existing } = await ctx.supabase
    .from('wallet_profiles').select('address').eq('address', addr).maybeSingle()

  if (existing) {
    const { error } = await ctx.supabase.from('wallet_profiles').update(fields).eq('address', addr)
    if (error) { ctx.log.error('profile', 'update failed', { addr, error: error.message }); return ctx.json({ error: 'Update failed' }, 500) }
  } else {
    const ref_code = await generateRefCodeForWallet(addr, ctx.supabase)
    const { error } = await ctx.supabase.from('wallet_profiles')
      .insert({ address: addr, ref_code, last_seen_at: new Date().toISOString(), ...fields })
    if (error) { ctx.log.error('profile', 'insert failed', { addr, error: error.message }); return ctx.json({ error: 'Create failed' }, 500) }
  }

  ctx.log.info('profile', 'updated', { addr })
  return ctx.json({ success: true })
}, { rateLimit: { max: 10, windowMs: 60_000 } })
