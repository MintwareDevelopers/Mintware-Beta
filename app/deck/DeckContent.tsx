'use client'

import { useEffect, useRef, useState } from 'react'
import { DECK_HTML } from './deckMarkup'

// Renders the deck inside a self-isolating iframe (srcDoc) so its styles can't leak into the
// rest of the site. The deck posts its height back via postMessage; we size the iframe to fit
// so there's no inner scrollbar. Only reached when the /deck server component says unlocked.
export function DeckContent() {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(2400)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { mwDeckHeight?: number } | undefined
      if (d && typeof d.mwDeckHeight === 'number' && d.mwDeckHeight > 200) {
        setHeight(Math.ceil(d.mwDeckHeight))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <iframe
      ref={ref}
      title="Mintware Investor Deck"
      srcDoc={DECK_HTML}
      sandbox="allow-scripts"
      style={{ width: '100%', height, border: 0, display: 'block', background: '#F5F5FB' }}
    />
  )
}
