'use client'

import { useEffect, useRef, useState } from 'react'
import { DATAROOM_HTML } from './dataroomMarkup'

// Renders the investor data room inside a self-isolating iframe (srcDoc) so its styles can't leak
// into the rest of the site. Unlike the deck, the data room is a scrolling document (not slides),
// so there's no presentation chrome — just an auto-sized frame. The embedded HTML posts its height
// back via postMessage; we size the iframe to fit so the page scrolls naturally. Only reached when
// /dataroom says unlocked.
export function DataRoomContent() {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(2600)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { mwDataroomHeight?: number } | undefined
      if (d && typeof d.mwDataroomHeight === 'number' && d.mwDataroomHeight > 200) {
        setHeight(Math.ceil(d.mwDataroomHeight))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div style={{ background: '#F5F5FB', minHeight: '100vh' }}>
      <iframe
        ref={frameRef}
        title="Mintware Investor Data Room"
        srcDoc={DATAROOM_HTML}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        style={{ width: '100%', height, border: 0, display: 'block', background: '#F5F5FB' }}
      />
    </div>
  )
}
