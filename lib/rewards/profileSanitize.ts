// Profile 2.0 — shared identity-field sanitizers.
//
// CRITICAL: the owner-only edit flow signs `buildProfileUpdateMessage(sanitized)`
// on the client, and the server (app/api/(web2)/profile/route.ts) rebuilds the
// same message from its own sanitized values and compares. If the two sides
// sanitize differently the signature check fails. Both sides MUST import these.

// Strip ASCII control chars + angle brackets; keep spaces, punctuation, emoji.
// MUST be idempotent — the client signs the sanitized value and the server
// re-sanitizes and compares, so sanitize(sanitize(x)) === sanitize(x) is
// required. Hence trim → cap → trim (the final trim removes any whitespace the
// slice exposed at the cap boundary).
export function cleanProfileField(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = Array.from(v)
    .filter((c) => c.charCodeAt(0) >= 32 && c !== '<' && c !== '>')
    .join('')
    .trim()
    .slice(0, max)
    .trim()
  return s || null
}

// Social handle — bare (leading @ stripped), max 40. Idempotent (trim after strip).
export function cleanProfileHandle(v: unknown): string | null {
  const s = cleanProfileField(v, 40)
  if (!s) return null
  return s.replace(/^@+/, '').trim() || null
}

// URL — coerced to https:// when a scheme is missing, then capped. Idempotent:
// the cap is applied AFTER the scheme is added so re-running is a no-op.
function coerceUrl(v: unknown, max: number): string | null {
  const base = cleanProfileField(v, max)
  if (!base) return null
  const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`
  return withScheme.slice(0, max).trim() || null
}
export function cleanProfileUrl(v: unknown): string | null {
  return coerceUrl(v, 200)
}
// Avatar image URL — https-validated (no data:/javascript:/relative junk), max 300.
export function cleanProfileImageUrl(v: unknown): string | null {
  return coerceUrl(v, 300)
}

export const AVATAR_TYPES = ['basename', 'nft', 'upload', 'default'] as const
export type AvatarType = (typeof AVATAR_TYPES)[number]
