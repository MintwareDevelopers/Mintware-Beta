'use client'

// ScrollProgress — a thin voltage bar pinned to the top that tracks page scroll.
// Spring-smoothed so it feels alive, not mechanical. Hidden under reduced-motion.

import { motion, useScroll, useSpring, useReducedMotion } from 'framer-motion'

export function ScrollProgress() {
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 })
  if (reduce) return null
  return (
    <motion.div
      aria-hidden
      style={{ scaleX, transformOrigin: '0% 50%' }}
      className="fixed top-0 left-0 right-0 z-[70] h-[2px] bg-atx-blue"
    />
  )
}
