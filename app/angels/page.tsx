import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { DECK_PASSWORD, DECK_COOKIE, deckToken } from '@/lib/deck/gate'
import { DeckGate } from '../deck/DeckGate'
import { DeckContent } from '../deck/DeckContent'
import { ANGELS_HTML } from './angelsMarkup'

// The plain-English "Angels" investor deck, password-gated behind the SAME gate as /deck
// (one password — DECK_PASSWORD — one cookie). The deck markup is only rendered, and therefore
// only sent to the browser, when a valid unlock cookie is present. noindex so it's never crawled.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Mintware — Angels',
  robots: { index: false, follow: false },
}

export default async function AngelsPage() {
  const store = await cookies()
  const unlocked = !!DECK_PASSWORD && store.get(DECK_COOKIE)?.value === deckToken()
  return unlocked
    ? <DeckContent html={ANGELS_HTML} title="Mintware — Angels" showPdf={false} />
    : <DeckGate configured={!!DECK_PASSWORD} />
}
