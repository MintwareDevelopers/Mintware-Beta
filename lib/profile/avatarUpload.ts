// Profile picture upload — the pure, server+client-shared half.
//
// The upload route (app/api/(web2)/profile/avatar/route.ts) trusts NOTHING the browser claims about a file:
// the MIME type is re-derived from the first bytes (magic numbers), the size is measured from the bytes,
// and the signed authorization binds the wallet to the exact file (sha256 + size) so a captured signature
// can't be replayed to upload a different picture. Both sides import from here so they can't drift.

export const AVATAR_BUCKET = 'avatars'
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024 // 2 MB — mirrored by the bucket's file_size_limit
export const AVATAR_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AvatarMime = (typeof AVATAR_ALLOWED_MIMES)[number]
export const AVATAR_ACTION = 'mintware-profile-avatar'

const EXT_BY_MIME: Record<AvatarMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
export function extForMime(mime: AvatarMime): string {
  return EXT_BY_MIME[mime]
}

/** Magic-byte sniff. Returns the detected image MIME or null — never trusts a declared content-type. */
export function sniffImageMime(bytes: Uint8Array): AvatarMime | null {
  if (bytes.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  // WEBP: "RIFF" .... "WEBP"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

export type AvatarValidation =
  | { ok: true; mime: AvatarMime; ext: string; size: number }
  | { ok: false; error: 'empty' | 'too_large' | 'unsupported_type' }

/** Size + magic-byte validation of the raw upload bytes. */
export function validateAvatarBytes(bytes: Uint8Array): AvatarValidation {
  if (bytes.length === 0) return { ok: false, error: 'empty' }
  if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, error: 'too_large' }
  const mime = sniffImageMime(bytes)
  if (!mime) return { ok: false, error: 'unsupported_type' }
  return { ok: true, mime, ext: extForMime(mime), size: bytes.length }
}

/** Storage object path: `<wallet>/<uuid>.<ext>` — wallet-scoped so a listing/cleanup is trivial. */
export function avatarObjectPath(wallet: string, uuid: string, ext: string): string {
  return `${wallet.toLowerCase()}/${uuid}.${ext}`
}

/** The canonical signed authorization for an avatar upload. Same shape/style as
 *  lib/web3/signedActionMessages.ts (canonical JSON, `action` + `issuedAt` bound) so the route can apply
 *  the same freshness / action / signer checks the `createHandler` factory does. `sha256` is the lowercase
 *  hex digest of the exact bytes being uploaded; `size` is their byte length. */
export function buildProfileAvatarMessage(input: { wallet: string; issuedAt: number; sha256: string; size: number }): string {
  return JSON.stringify(
    {
      action: AVATAR_ACTION,
      wallet: input.wallet.toLowerCase(),
      issuedAt: input.issuedAt,
      sha256: input.sha256.toLowerCase(),
      size: input.size,
    },
    null,
    2,
  )
}

/** Is this URL one of OUR bucket objects (so a replaced avatar can be cleaned up)? Returns the object path or null. */
export function avatarPathFromPublicUrl(url: string | null | undefined, supabaseUrl: string | undefined): string | null {
  if (!url || !supabaseUrl) return null
  const prefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${AVATAR_BUCKET}/`
  if (!url.startsWith(prefix)) return null
  const path = url.slice(prefix.length).split('?')[0]
  return path && /^0x[0-9a-f]{40}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path) ? path : null
}
