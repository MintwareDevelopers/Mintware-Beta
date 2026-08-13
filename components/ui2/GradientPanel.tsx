// GradientPanel — the signature "elevated moment" primitive of the Privy-esque
// v2 design system: a rounded pastel mesh-gradient surface with grain, reused in
// tone variations across the platform (hero panels, section banners, closing CTAs).
// Server component. Pastel ramp + grain come from globals.css tokens/utilities.

import type { ReactNode } from 'react'

export type PanelTone = 'balanced' | 'lavender' | 'coral' | 'periwinkle'

// Cool-led pastel meshes with a single warm coral note (matches the locked reference).
const MESH: Record<PanelTone, string> = {
  balanced:
    'radial-gradient(ellipse 70% 90% at 20% 20%, var(--color-pas-lav) 0%, transparent 60%),' +
    'radial-gradient(ellipse 80% 80% at 80% 28%, var(--color-pas-peri) 0%, transparent 55%),' +
    'radial-gradient(ellipse 66% 78% at 72% 90%, var(--color-coral2) 0%, transparent 46%),' +
    'radial-gradient(ellipse 70% 80% at 40% 92%, var(--color-pas-blush) 0%, transparent 55%),' +
    'linear-gradient(175deg, var(--color-pas-orchid), var(--color-pas-blush))',
  lavender:
    'radial-gradient(ellipse 72% 90% at 14% 30%, var(--color-pas-peri) 0%, transparent 60%),' +
    'radial-gradient(ellipse 82% 78% at 86% 20%, var(--color-pas-lav) 0%, transparent 55%),' +
    'radial-gradient(ellipse 60% 74% at 76% 94%, var(--color-coral2) 0%, transparent 46%),' +
    'radial-gradient(ellipse 66% 72% at 34% 92%, var(--color-pas-violet) 0%, transparent 55%),' +
    'linear-gradient(155deg, var(--color-pas-lav) 0%, var(--color-pas-orchid) 62%, var(--color-pas-blush) 100%)',
  coral:
    'radial-gradient(ellipse 70% 90% at 12% 34%, var(--color-pas-peach) 0%, transparent 60%),' +
    'radial-gradient(ellipse 82% 78% at 88% 18%, var(--color-coral2) 0%, transparent 55%),' +
    'radial-gradient(ellipse 70% 80% at 72% 96%, var(--color-pas-lav) 0%, transparent 55%),' +
    'linear-gradient(150deg, var(--color-pas-peach) 0%, var(--color-pas-blush) 58%, var(--color-pas-orchid) 100%)',
  periwinkle:
    'radial-gradient(ellipse 80% 62% at 78% 20%, var(--color-pas-lav) 0%, transparent 55%),' +
    'radial-gradient(ellipse 74% 60% at 58% 44%, var(--color-pas-peri) 0%, transparent 52%),' +
    'radial-gradient(ellipse 62% 66% at 76% 72%, var(--color-coral2) 0%, transparent 46%),' +
    'radial-gradient(ellipse 60% 52% at 32% 30%, var(--color-pas-orchid) 0%, transparent 52%),' +
    'radial-gradient(ellipse 58% 62% at 28% 82%, var(--color-pas-sky) 0%, transparent 52%),' +
    'radial-gradient(ellipse 80% 56% at 50% 52%, var(--color-pas-blush) 0%, transparent 58%)',
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
  return (
    <div
      className={`grain relative overflow-hidden ${className}`}
      style={{
        background: MESH[tone],
        borderRadius: 'var(--radius-panel)',
        border: '1px solid rgba(255,255,255,0.6)',
      }}
    >
      <div className="relative z-[2]">{children}</div>
    </div>
  )
}
