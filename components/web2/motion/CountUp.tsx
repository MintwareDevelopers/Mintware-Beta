'use client'

// CountUp — animates a number from 0 → value when it scrolls into view (once).
// easeOutCubic, locale-formatted, with prefix/suffix for "$615k" / "8.5%" style.
// Honors prefers-reduced-motion (shows the final value immediately).

import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'framer-motion'

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export function CountUp({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1.1,
  className,
}: {
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const [n, setN] = useState(reduce ? value : 0)

  useEffect(() => {
    if (reduce) { setN(value); return }
    if (!inView) return
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / (duration * 1000))
      setN(value * easeOutCubic(p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value, duration, reduce])

  const text = n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return <span ref={ref} className={className}>{prefix}{text}{suffix}</span>
}
