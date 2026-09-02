import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { DECK_PASSWORD, DECK_COOKIE, deckToken } from '@/lib/deck/gate'
import { DeckGate } from './DeckGate'
import { DeckContent } from './DeckContent'

// The investor deck, password-gated. The deck markup is only rendered — and therefore only
// sent to the browser — when a valid unlock cookie is present. noindex so it never gets crawled.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Mintware — Investor Deck',
  robots: { index: false, follow: false },
}

export default async function DeckPage() {
  const store = await cookies()
  const unlocked = !!DECK_PASSWORD && store.get(DECK_COOKIE)?.value === deckToken()
  return unlocked ? <DeckContent /> : <DeckGate configured={!!DECK_PASSWORD} />
}
