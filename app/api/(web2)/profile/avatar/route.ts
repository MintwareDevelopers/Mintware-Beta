// Profile picture upload — POST /api/profile/avatar
//
// Multipart body: `file` (the image) + `address`, `authMessage`, `authSignature`, `issuedAt` (the same
// signed-message envelope every owner-only route uses; action `mintware-profile-avatar`). The signed
// payload binds the wallet to the EXACT bytes (sha256 + size), so a captured signature can't upload a
// different picture. Server-side: magic-byte MIME sniff (declared content-type is ignored), ≤ 2 MB,
// upload via the service client into the public-read `avatars` bucket at `<wallet>/<uuid>.<ext>`, write
// the public URL to `wallet_profiles.avatar_ref` (`avatar_type='upload'`), return it. The previous
// avatar object (if it was ours) is removed best-effort so the bucket doesn't accumulate orphans.
//
// Why NOT `createHandler`: the factory's request-size guard rejects any body > 256 KB before parsing
// (correct for every JSON route; wrong for the one binary upload) and its signed-message auth reads the
// body as JSON. This route therefore re-implements the factory's exact auth checks inline — freshness
// window, signed `issuedAt` bound to the body `issuedAt`, `action` bound to this route, signer must equal
// the claimed address — plus its response conventions (BigInt-safe JSON, X-Request-Id, `{success:false,
// error, code}` on failure). Keep those checks in lockstep with lib/web2/routeHandler.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { recoverMessageAddress } from 'viem'
import { getServiceClient } from '@/lib/web2/supabase'
import { bindLogger } from '@/lib/logger'
import { toJsonSafe } from '@/lib/constants'
import {
  AVATAR_ACTION, AVATAR_BUCKET, AVATAR_MAX_BYTES,
  avatarObjectPath, avatarPathFromPublicUrl, buildProfileAvatarMessage, validateAvatarBytes,
} from '@/lib/profile/avatarUpload'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_AUTH_AGE_MS = 15 * 60 * 1000
// Multipart overhead on top of the 2 MB file (boundary + the small text fields).
const MAX_REQUEST_BYTES = AVATAR_MAX_BYTES + 16 * 1024

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID()
  const log = bindLogger(requestId)
  const headers = { 'X-Request-Id': requestId }
  const ok = <T,>(data: T, status = 200) => NextResponse.json(toJsonSafe(data), { status, headers })
  const fail = (error: string, status: number, code: string) => NextResponse.json({ success: false, error, code }, { status, headers })

  // ── size guard (up front, before touching the body) ──
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return fail('Image too large (max 2 MB)', 413, 'PAYLOAD_TOO_LARGE')

  // ── parse multipart ──
  let form: FormData
  try { form = await req.formData() } catch { return fail('Expected multipart/form-data', 400, 'INVALID_BODY') }
  const address = String(form.get('address') ?? '').trim()
  // multipart/form-data normalises newlines in text fields to CRLF (HTML spec) — the canonical signed
  // message is LF-only (JSON.stringify(…, 2)) and never legitimately contains CRLF, so undo that here.
  const rawMessage = form.get('authMessage')
  const authMessage = typeof rawMessage === 'string' ? rawMessage.replace(/\r\n/g, '\n') : rawMessage
  const authSignature = form.get('authSignature')
  const issuedAt = Number(form.get('issuedAt'))
  const file = form.get('file')

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return fail('Valid address required', 400, 'ADDRESS_REQUIRED')
  if (typeof authMessage !== 'string' || typeof authSignature !== 'string' || !Number.isFinite(issuedAt)) return fail('Signed authorization required', 401, 'AUTH_REQUIRED')
  if (Math.abs(Date.now() - issuedAt) > MAX_AUTH_AGE_MS) return fail('Authorization expired', 401, 'AUTH_EXPIRED')
  if (!(file instanceof Blob)) return fail('Image file required', 400, 'FILE_REQUIRED')
  if (file.size > AVATAR_MAX_BYTES) return fail('Image too large (max 2 MB)', 413, 'PAYLOAD_TOO_LARGE')

  // ── bytes: measure + sniff (never trust the declared type) ──
  const bytes = new Uint8Array(await file.arrayBuffer())
  const v = validateAvatarBytes(bytes)
  if (!v.ok) {
    if (v.error === 'too_large') return fail('Image too large (max 2 MB)', 413, 'PAYLOAD_TOO_LARGE')
    if (v.error === 'empty') return fail('Image file required', 400, 'FILE_REQUIRED')
    return fail('Unsupported image type (PNG, JPEG or WebP only)', 415, 'UNSUPPORTED_TYPE')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  // ── auth: replay-bound (issuedAt), route-bound (action), content-bound (sha256 + size), signer == address ──
  let signed: Record<string, unknown>
  try { signed = JSON.parse(authMessage) } catch { return fail('Malformed signed authorization', 401, 'AUTH_MALFORMED') }
  if (signed.issuedAt !== issuedAt || signed.action !== AVATAR_ACTION) return fail('Authorization payload mismatch', 401, 'AUTH_MISMATCH')
  const expected = buildProfileAvatarMessage({ wallet: address, issuedAt, sha256, size: bytes.length })
  if (authMessage !== expected) return fail('Authorization payload mismatch', 401, 'AUTH_MISMATCH')
  const signer = await recoverMessageAddress({ message: authMessage, signature: authSignature as `0x${string}` }).catch(() => null)
  if (!signer || signer.toLowerCase() !== address.toLowerCase()) return fail('Invalid signature', 401, 'INVALID_SIG')

  const wallet = address.toLowerCase()
  const supabase = getServiceClient()

  // ── upload (service role; bucket policies deny every non-service write) ──
  const path = avatarObjectPath(wallet, crypto.randomUUID(), v.ext)
  const up = await supabase.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType: v.mime, upsert: false, cacheControl: '31536000' })
  if (up.error) { log.error('profile.avatar', 'storage upload failed', { wallet, error: up.error.message }); return fail('Upload failed', 502, 'UPLOAD_FAILED') }
  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  const url = pub.publicUrl

  // ── write the profile row (create if absent — same posture as POST /api/profile) ──
  const { data: existing } = await supabase.from('wallet_profiles').select('address, avatar_ref').eq('address', wallet).maybeSingle()
  const fields = { avatar_type: 'upload', avatar_ref: url, updated_at: new Date().toISOString() }
  if (existing) {
    const { error } = await supabase.from('wallet_profiles').update(fields).eq('address', wallet)
    if (error) { log.error('profile.avatar', 'profile update failed', { wallet, error: error.message }); return fail('Update failed', 500, 'UPDATE_FAILED') }
  } else {
    const { generateRefCodeForWallet } = await import('@/lib/rewards/referral-code')
    const ref_code = await generateRefCodeForWallet(wallet, supabase)
    const { error } = await supabase.from('wallet_profiles').insert({ address: wallet, ref_code, last_seen_at: new Date().toISOString(), ...fields })
    if (error) { log.error('profile.avatar', 'profile insert failed', { wallet, error: error.message }); return fail('Create failed', 500, 'CREATE_FAILED') }
  }

  // ── best-effort cleanup of the replaced object (only if it was ours + belongs to this wallet) ──
  const old = avatarPathFromPublicUrl((existing as { avatar_ref?: string | null } | null)?.avatar_ref, process.env.NEXT_PUBLIC_SUPABASE_URL)
  if (old && old !== path && old.startsWith(`${wallet}/`)) {
    await supabase.storage.from(AVATAR_BUCKET).remove([old]).catch(() => null)
  }

  log.info('profile.avatar', 'uploaded', { wallet, mime: v.mime, size: v.size })
  return ok({ success: true, url, mime: v.mime, size: v.size, path })
}
