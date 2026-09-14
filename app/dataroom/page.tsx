import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { DATAROOM_PASSWORD, DATAROOM_COOKIE, dataroomToken } from '@/lib/deck/gate'
import { DeckGate } from '../deck/DeckGate'
import { DataRoomContent } from './DataRoomContent'

// The investor data room, password-gated behind its OWN password (DATAROOM_PASSWORD) — separate
// from the /deck + /angels gate, so it can be shared independently. The data-room markup is only
// rendered, and therefore only sent to the browser, when a valid unlock cookie is present.
// noindex so it's never crawled.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Mintware — Data Room',
  robots: { index: false, follow: false },
}

export default async function DataRoomPage() {
  const store = await cookies()
  const unlocked = !!DATAROOM_PASSWORD && store.get(DATAROOM_COOKIE)?.value === dataroomToken()
  return unlocked ? (
    <DataRoomContent />
  ) : (
    <DeckGate
      configured={!!DATAROOM_PASSWORD}
      endpoint="/api/dataroom/unlock"
      eyebrow="Investor data room"
      blurb="This data room is private. Enter the password you were sent to view it."
      buttonLabel="Enter the data room"
      envName="DATAROOM_PASSWORD"
    />
  )
}
