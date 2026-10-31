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

/** Two discs trading places — income from every trade. */
export function IconTrade(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="7" cy="7.5" rx="4.5" ry="2" /><path d="M2.5 7.5v2.5c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V7.5" />
    <ellipse cx="17" cy="15.5" rx="4.5" ry="2" /><path d="M12.5 15.5V18c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-2.5" />
    <path d="M14 5.5h4.5V10M10 18.5H5.5V14" />
  </Icon>
}

/** A stack that keeps growing — a stake in what you believe in. */
export function IconGrow(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="9" cy="17" rx="6" ry="2.2" /><path d="M3 17v1.8c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V17" />
    <ellipse cx="9" cy="12.6" rx="6" ry="2.2" opacity=".55" />
    <path d="M14.5 9.5 18 6l3 3M18 6v8" />
  </Icon>
}

/** A disc with a seal on its face — reviewed before it opens. */
export function IconCurated(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="12" cy="9" rx="8.5" ry="3.4" /><path d="M3.5 9v5c0 1.9 3.8 3.4 8.5 3.4s8.5-1.5 8.5-3.4V9" />
    <path d="m12 5.9.9 1.6 1.9.3-1.4 1.2.3 1.8-1.7-.9-1.7.9.3-1.8-1.4-1.2 1.9-.3z" />
  </Icon>
}

/** Many thin layers stacked tall — depth. */
export function IconDepth(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="12" cy="5" rx="8" ry="2.4" /><path d="M4 5v2.6c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4V5" />
    <path d="M4 11.2c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4M4 14.8c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4M4 18.4c0 1.3 3.6 2.4 8 2.4s8-1.1 8-2.4M4 7.6v10.8M20 7.6v10.8" />
  </Icon>
}

/** Two arrows closing in on a disc — tighter spreads. */
export function IconSpread(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="12" cy="12" rx="4" ry="1.6" /><path d="M8 12v2c0 .9 1.8 1.6 4 1.6s4-.7 4-1.6v-2" />
    <path d="M2 13h3.5M3.8 11.2 5.5 13l-1.7 1.8M22 13h-3.5M20.2 11.2 18.5 13l1.7 1.8" />
  </Icon>
}

/** Two people, drawn as discs — holders who become the market. */
export function IconHolders(p: IconProps) {
  return <Icon {...p}>
    <circle cx="8.5" cy="8" r="3" /><path d="M3 19c.6-3 2.8-4.8 5.5-4.8S13.4 16 14 19" />
    <circle cx="16.5" cy="9" r="2.5" /><path d="M15.4 14.4c.4-.1.7-.2 1.1-.2 2.3 0 4.2 1.6 4.5 4.3" />
  </Icon>
}

/** A disc reading out a line — price discovery, in public. */
export function IconPrice(p: IconProps) {
  return <Icon {...p}>
    <rect x="3" y="4" width="18" height="14" rx="3.5" /><path d="m6.5 14 3.2-3.4 2.6 2.2 4.8-5" /><path d="M8 21h8" />
  </Icon>
}

/** A card with a disc for a chip. */
export function IconCard(p: IconProps) {
  return <Icon {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3" /><ellipse cx="7.5" cy="10" rx="2.2" ry="1.2" /><path d="M5.3 10v1.2c0 .6 1 1.2 2.2 1.2s2.2-.6 2.2-1.2V10M14 15h4" />
  </Icon>
}

/** A dial with a set limit. */
export function IconLimit(p: IconProps) {
  return <Icon {...p}>
    <path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l3.5-5" /><circle cx="12" cy="17" r="1.2" /><path d="M7 9.8l-1-1M17 9.8l1-1M12 7.5V6" />
  </Icon>
}

/** A shield with a check — nothing moves without your approval. */
export function IconApprove(p: IconProps) {
  return <Icon {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8 7.5 9.5 4.4-1.5 7.5-5.1 7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.4-4.4" />
  </Icon>
}

/** Rising bars on a base — equities. */
export function IconStocks(p: IconProps) {
  return <Icon {...p}>
    <path d="M4 20h16" /><rect x="5.5" y="12" width="3" height="5.5" rx="1" /><rect x="10.5" y="8.5" width="3" height="9" rx="1" /><rect x="15.5" y="5" width="3" height="12.5" rx="1" />
  </Icon>
}

/** Furrowed rows under a low sun — land. */
export function IconLand(p: IconProps) {
  return <Icon {...p}>
    <circle cx="16.5" cy="7" r="2.6" /><path d="M2.5 13.5c3-1.4 6-1.4 9.5 0s6.5 1.4 9.5 0M3 17.5c3-1 6-1 9 .2s6.3 1 9-.2M4.5 21c2.5-.7 5-.6 7.5.3s4.8.8 7.5-.2" />
  </Icon>
}

/** A drop — water rights. */
export function IconWater(p: IconProps) {
  return <Icon {...p}>
    <path d="M12 3.5c3.5 4.2 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.5-6.4 6-10.6z" /><path d="M9.2 14.6a2.9 2.9 0 0 0 2.8 2.6" />
  </Icon>
}

/** Columns under a pediment — treasuries. */
export function IconTreasury(p: IconProps) {
  return <Icon {...p}>
    <path d="M3 9 12 4l9 5" /><path d="M4.5 9.5h15M6 10v7M10 10v7M14 10v7M18 10v7M3.5 20h17M4.5 17.5h15" />
  </Icon>
}

/** A key shaped from a disc — rules that travel with the token. */
export function IconRules(p: IconProps) {
  return <Icon {...p}>
    <ellipse cx="8" cy="9" rx="4.5" ry="4.5" /><circle cx="8" cy="9" r="1.4" /><path d="m11.2 12.2 8.3 8.3M16.4 17.4l2-2M18.6 19.6l1.6-1.6" />
  </Icon>
}
