'use client'

// Reveal — scroll-triggered entrance. Fades + rises its children into view once,
// with an optional stagger delay. Honors prefers-reduced-motion (renders static).
// The band-level "alive" primitive: wrap a section/card and it choreographs in.

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const

export function Reveal({
  children,
  delay = 0,
  y = 16,
  amount = 0.2,
  className,
}: {
  children: ReactNode
  /** seconds — stagger successive items by passing 0, 0.06, 0.12, … */
  delay?: number
  /** px rise distance */
  y?: number
  /** fraction of the element that must be visible to trigger */
  amount?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}
