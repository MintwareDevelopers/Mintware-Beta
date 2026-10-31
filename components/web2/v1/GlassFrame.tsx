import type { ReactNode } from 'react'

// The V1 data-view treatment (Mineral): a raised white surface for tables, charts and stat groups.
// The name is kept from the earlier glass-on-gradient frame so call sites don't change.
export function GlassFrame({ className = '', innerClassName = '', children }: { className?: string; innerClassName?: string; children: ReactNode }) {
  return (
    <div className={`mw-raise rounded-[24px] overflow-hidden ${className}`}>
      <div className={innerClassName}>{children}</div>
    </div>
  )
}
