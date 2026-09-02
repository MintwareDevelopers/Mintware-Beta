import { createHash } from 'crypto'

// Password investors type to unlock /deck. UNSET ⇒ the gate is closed to everyone
// (fail-closed) — nothing behind it renders until DECK_PASSWORD is set in the env.
export const DECK_PASSWORD = process.env.DECK_PASSWORD ?? ''

export const DECK_COOKIE = 'mw_deck'

// Opaque cookie token derived from the password — the literal password never sits in
// the cookie, and the cookie can't be forged without knowing the password.
export function deckToken(): string {
  return DECK_PASSWORD ? createHash('sha256').update(`mw-deck:${DECK_PASSWORD}`).digest('hex') : ''
}
