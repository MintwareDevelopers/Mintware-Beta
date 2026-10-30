// Mineral icon set: thin-line icons drawn from the same disc and layer shapes as the logo, so small UI
// marks read as Mintware rather than a stock icon pack. 24×24 grid, 1.7 stroke, currentColor.

import type { ReactNode, SVGProps } from 'react'

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({ size = 22, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

/** Two separate disc stacks with a wall between them — each asset kept apart. */
export function IconIsolated(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="6.5" cy="8.5" rx="4" ry="1.8" /><path d="M2.5 8.5v3c0 1 1.8 1.8 4 1.8s4-.8 4-1.8v-3" /><path d="M2.5 14.5c0 1 1.8 1.8 4 1.8s4-.8 4-1.8" />
    <ellipse cx="17.5" cy="8.5" rx="4" ry="1.8" /><path d="M13.5 8.5v3c0 1 1.8 1.8 4 1.8s4-.8 4-1.8v-3" /><path d="M13.5 14.5c0 1 1.8 1.8 4 1.8s4-.8 4-1.8" />
    <path d="M12 4v16" strokeDasharray="1.6 2.2" />
  </Icon>
}

/** A disc with a check on its face — the position is yours, on-chain. */
export function IconOwned(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="12" cy="8" rx="8.5" ry="3.4" /><path d="M3.5 8v6c0 1.9 3.8 3.4 8.5 3.4s8.5-1.5 8.5-3.4V8" />
    <path d="m9.2 8.1 1.9 1.3 3.8-2.6" />
  </Icon>
}

/** A disc seen as a clock face — marks that follow market hours. */
export function IconHours(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="12" cy="10" rx="9" ry="5.5" /><path d="M3 10v3.5c0 3 4 5.5 9 5.5s9-2.5 9-5.5V10" />
    <path d="M12 10V6.6M12 10l3.6 1.4" />
  </Icon>
}

/** A disc with a pause bar — fails closed rather than guessing. */
export function IconFailClosed(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="12" cy="8" rx="8.5" ry="3.4" /><path d="M3.5 8v6c0 1.9 3.8 3.4 8.5 3.4s8.5-1.5 8.5-3.4V8" />
    <path d="M10.3 6.6v2.8M13.7 6.6v2.8" />
  </Icon>
}

/** A layer lifting off the stack — exits stay open. */
export function IconExit(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="12" cy="16" rx="8.5" ry="3" /><path d="M3.5 16v2c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-2" />
    <ellipse cx="12" cy="7" rx="6" ry="2.2" /><path d="M12 13.2V10.8M10.2 12l1.8 1.6 1.8-1.6" />
  </Icon>
}

/** A disc under a magnifier — audited before real value. */
export function IconAudited(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="10" cy="9" rx="7" ry="2.8" /><path d="M3 9v4.5c0 1.5 3.1 2.8 7 2.8" />
    <circle cx="16.5" cy="16" r="3.4" /><path d="m19 18.5 2.5 2.5" />
  </Icon>
}
