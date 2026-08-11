'use client'

// Marquee — an ambient horizontal ticker. Seamless loop (items rendered twice,
// track translates -50%). Pauses on hover; static under reduced-motion. Content
// is real platform facts, never fabricated live data.

import { useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

export function Marquee({
  items,
  speed = 34,
  className,
}: {
  items: ReactNode[]
  /** seconds for one full loop */
  speed?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  const set = items.map((it, i) => (
    <span key={i} className="mw-marquee-item">{it}</span>
  ))
  return (
    <div className={`mw-marquee ${className ?? ''}`} aria-hidden>
      <div
        className={`mw-marquee-track ${reduce ? 'mw-marquee-static' : ''}`}
        style={reduce ? undefined : { animationDuration: `${speed}s` }}
      >
        {set}
        {reduce ? null : set}
      </div>
    </div>
  )
}
