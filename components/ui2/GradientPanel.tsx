// GradientPanel — in Mineral this is a recessed stage: a softly inset well lit by one blurred patch of the
// pastel sheen. Raised cards placed on it read as objects sitting in a tray. `tone` only moves and tints the
// light; the surface itself stays the same porcelain everywhere. Server component.

import type { ReactNode } from 'react'

export type PanelTone = 'balanced' | 'lavender' | 'coral' | 'periwinkle'

const LIGHT: Record<PanelTone, { pos: string; color: string }> = {
  balanced:   { pos: '-right-[12%] -top-[30%]', color: 'linear-gradient(120deg,#A9A7FA,#C9C0F4 45%,#F2CBC2)' },
  lavender:   { pos: '-left-[10%] -bottom-[40%]', color: 'linear-gradient(120deg,#C9C0F4,#A9A7FA)' },
  coral:      { pos: '-right-[10%] -bottom-[40%]', color: 'linear-gradient(120deg,#F2CBC2,#F6A988)' },
  periwinkle: { pos: '-right-[8%] -top-[35%]', color: 'linear-gradient(120deg,#A9A7FA,#C9C0F4)' },
}

export function GradientPanel({
  tone = 'balanced',
  className = '',
  children,
}: {
  tone?: PanelTone
  className?: string
  children: ReactNode
}) {
  const light = LIGHT[tone]
  return (
    <div
      className={`relative overflow-hidden rounded-[28px] ${className}`}
      style={{ background: 'var(--mw-band)', boxShadow: 'var(--mw-inset)' }}
    >
      <div aria-hidden="true" className={`pointer-events-none absolute ${light.pos} w-[70%] aspect-square rounded-full opacity-45 blur-[70px]`} style={{ background: light.color }} />
      <div className="relative z-[1] w-full">{children}</div>
    </div>
  )
}
