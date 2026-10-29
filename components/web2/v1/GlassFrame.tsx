import type { ReactNode } from 'react'
import { GradientPanel } from '@/components/ui2/GradientPanel'

// The V1 data-view treatment: a frosted-glass card on a pastel gradient frame. Reserved for tables,
// charts and stat groups — ordinary panels stay plain white cards.
export function GlassFrame({ className = '', innerClassName = '', children }: { className?: string; innerClassName?: string; children: ReactNode }) {
  return (
    <GradientPanel tone="lavender" className={`p-2.5 max-[640px]:p-1.5 ${className}`}>
      <div className={`glass-card !rounded-[16px] ${innerClassName}`}>{children}</div>
    </GradientPanel>
  )
}
