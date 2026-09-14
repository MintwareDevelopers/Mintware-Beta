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

// A SEPARATE gate for the investor data room at /dataroom — its own password (DATAROOM_PASSWORD)
// and its own cookie, so it can be shared independently of the deck. Same fail-closed posture:
// unset ⇒ nobody gets in.
export const DATAROOM_PASSWORD = process.env.DATAROOM_PASSWORD ?? ''

export const DATAROOM_COOKIE = 'mw_dataroom'

export function dataroomToken(): string {
  return DATAROOM_PASSWORD ? createHash('sha256').update(`mw-dataroom:${DATAROOM_PASSWORD}`).digest('hex') : ''
}
