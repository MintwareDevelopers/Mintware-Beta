'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DECK_HTML } from './deckMarkup'

// Renders the deck inside a self-isolating iframe (srcDoc) so its styles can't leak into the
// rest of the site. The deck posts its height + per-slide offsets + slide count back via
// postMessage; the shell sizes the iframe to fit (no inner scrollbar) and drives a thin
// presentation layer on top — progress bar, slide counter, prev/next, keyboard nav, a
// fullscreen "Present" mode, and print-to-PDF. Sandbox is allow-scripts plus allow-popups so
// the in-deck "verify on-chain" links (→ /proof, /the-math, /agents) open in a new tab; the
// deck HTML is our own trusted content. Only reached when /deck says unlocked.
export function DeckContent() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const [height, setHeight] = useState(2400)
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const [progress, setProgress] = useState(0)
  const [fs, setFs] = useState(false)

  // refs so the one-time keyboard handler never reads stale state
  const offsetsRef = useRef<number[]>([])
  const countRef = useRef(0)
  const currentRef = useRef(0)
  currentRef.current = current
  countRef.current = count

  // messages from the deck iframe: height, slide offsets, slide count
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { mwDeckHeight?: number; mwDeckSlides?: number[]; mwDeckCount?: number } | undefined
      if (!d) return
      if (typeof d.mwDeckHeight === 'number' && d.mwDeckHeight > 200) setHeight(Math.ceil(d.mwDeckHeight))
      if (Array.isArray(d.mwDeckSlides) && d.mwDeckSlides.length) offsetsRef.current = d.mwDeckSlides
      if (typeof d.mwDeckCount === 'number') setCount(d.mwDeckCount)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // absolute document Y of slide i = iframe top-in-doc + slide offset within the deck
  const slideDocTop = useCallback((i: number) => {
    const frame = frameRef.current
    const off = offsetsRef.current
    if (!frame || off.length === 0) return null
    const idx = Math.max(0, Math.min(off.length - 1, i))
    const frameTop = frame.getBoundingClientRect().top + window.scrollY
    return Math.max(0, Math.round(frameTop + off[idx] - 10))
  }, [])

  const goTo = useCallback((i: number) => {
    const n = countRef.current || 1
    const clamped = Math.max(0, Math.min(n - 1, i))
    const top = slideDocTop(clamped)
    if (top == null) return
    window.scrollTo({ top, behavior: 'smooth' })
    setCurrent(clamped)
  }, [slideDocTop])

  // track scroll → current slide + progress
  useEffect(() => {
    function onScroll() {
      const frame = frameRef.current
      const off = offsetsRef.current
      if (frame && off.length) {
        const frameTop = frame.getBoundingClientRect().top + window.scrollY
        const y = window.scrollY + window.innerHeight * 0.35
        let idx = 0
        for (let i = 0; i < off.length; i++) if (y >= frameTop + off[i]) idx = i
        setCurrent(idx)
      }
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      setProgress(Math.min(1, Math.max(0, window.scrollY / max)))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [height])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else el.requestFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    function onFs() { setFs(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const printDeck = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ mwDeckPrint: true }, '*')
  }, [])

  // keyboard nav — registered once, reads refs
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key
      if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); goTo(currentRef.current + 1) }
      else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); goTo(currentRef.current - 1) }
      else if (k === 'Home') { e.preventDefault(); goTo(0) }
      else if (k === 'End') { e.preventDefault(); goTo(countRef.current - 1) }
      else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, toggleFullscreen])

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 34, minWidth: 34, padding: '0 10px', borderRadius: 9, border: '1px solid rgba(22,22,44,.10)',
    background: '#fff', color: '#494957', font: "600 12.5px/1 'Plus Jakarta Sans',system-ui,sans-serif",
    cursor: 'pointer', letterSpacing: '.01em',
  }

  return (
    <div ref={wrapRef} style={{ background: '#F5F5FB', minHeight: '100vh', position: 'relative' }}>
      {/* top progress bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: 'rgba(22,22,44,.06)', zIndex: 40 }}>
        <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'linear-gradient(90deg,#6C6CF0,#F0855E)', transition: 'width .12s linear' }} />
      </div>

      <iframe
        ref={frameRef}
        title="Mintware Investor Deck"
        srcDoc={DECK_HTML}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        allow="fullscreen"
        allowFullScreen
        style={{ width: '100%', height, border: 0, display: 'block', background: '#F5F5FB' }}
      />

      {/* control bar */}
      <div
        style={{
          position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 41,
          display: 'flex', alignItems: 'center', gap: 8, padding: 7, borderRadius: 14,
          background: 'rgba(255,255,255,.86)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(22,22,44,.10)', boxShadow: '0 8px 30px -10px rgba(30,30,80,.28)',
          maxWidth: 'calc(100vw - 24px)', flexWrap: 'wrap', justifyContent: 'center',
        }}
      >
        <button style={btn} onClick={() => goTo(current - 1)} disabled={current <= 0} aria-label="Previous slide">‹</button>
        <span style={{ font: "700 12.5px/1 'Space Mono',monospace", color: '#191923', minWidth: 58, textAlign: 'center', letterSpacing: '.02em' }}>
          {String(Math.min(current + 1, Math.max(count, 1))).padStart(2, '0')} / {String(Math.max(count, 1)).padStart(2, '0')}
        </span>
        <button style={btn} onClick={() => goTo(current + 1)} disabled={count > 0 && current >= count - 1} aria-label="Next slide">›</button>
        <span style={{ width: 1, height: 20, background: 'rgba(22,22,44,.10)', margin: '0 2px' }} />
        <button style={btn} onClick={toggleFullscreen}>{fs ? 'Exit' : 'Present'}</button>
        <button style={btn} onClick={printDeck}>Save PDF</button>
      </div>
    </div>
  )
}
