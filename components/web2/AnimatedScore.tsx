'use client'

// AnimatedScore — counts up from 0 to the target value using framer-motion.
// Used wherever a DM Mono score number is shown (profile hero, dashboard hero).

import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'

interface AnimatedScoreProps {
  value: number
  style?: React.CSSProperties
  className?: string
  duration?: number
}

export function AnimatedScore({ value, style, className, duration = 1.2 }: AnimatedScoreProps) {
  const [display, setDisplay] = useState(0)
  const prevValue = useRef(0)

  useEffect(() => {
    if (value === 0) { setDisplay(0); return }
    const from = prevValue.current
    prevValue.current = value
    const controls = animate(from, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [value, duration])

  return (
    <span style={style} className={className}>
      {display.toLocaleString()}
    </span>
  )
}
