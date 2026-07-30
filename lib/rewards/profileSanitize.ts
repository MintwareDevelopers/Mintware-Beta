// Profile 2.0 — shared identity-field sanitizers.
//
// CRITICAL: the owner-only edit flow signs `buildProfileUpdateMessage(sanitized)`
// on the client, and the server (app/api/(web2)/profile/route.ts) rebuilds the
// same message from its own sanitized values and compares. If the two sides
// sanitize differently the signature check fails. Both sides MUST import these.

// Strip ASCII control chars + angle brackets; keep spaces, punctuation, emoji. Trim + cap.
export function cleanProfileField(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = Array.from(v)
    .filter((c) => c.charCodeAt(0) >= 32 && c !== '<' && c !== '>')
    .join('')
    .trim()
  return s ? s.slice(0, max) : null
}

// Social handle — bare (leading @ stripped), max 40.
export function cleanProfileHandle(v: unknown): string | null {
  const s = cleanProfileField(v, 40)
  return s ? s.replace(/^@+/, '') : null
}

// URL — max 200, coerced to https:// when a scheme is missing.
export function cleanProfileUrl(v: unknown): string | null {
  const s = cleanProfileField(v, 200)
  if (!s) return null
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

export const AVATAR_TYPES = ['basename', 'nft', 'upload', 'default'] as const
export type AvatarType = (typeof AVATAR_TYPES)[number]
