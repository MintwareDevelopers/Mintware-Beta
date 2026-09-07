'use client'

// Overlapping paired token logos (Meteora/Krystal standard). Real logos come from GeckoTerminal
// (already https-guarded server-side in lib/gateway/discovery.ts#safeImg). When a token has no logo —
// or the image 404s at runtime — it falls back to the token's initials in a tinted circle, never the
// old one-size-fits-all gradient blob. Used in the Discover rows and the /earn/[pool] header.

import { useState } from 'react'

function initials(sym: string): string {
  return (sym || '?').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || '?'
}

function TokenIcon({ logo, sym, size, ring, z, left }: { logo: string | null; sym: string; size: number; ring: string; z: number; left: number }) {
  const [failed, setFailed] = useState(false)
  const show = logo && !failed
  return (
    <span
      className="absolute top-0 rounded-full overflow-hidden flex items-center justify-center"
      style={{ left, width: size, height: size, zIndex: z, background: '#1B1B27', boxShadow: `0 0 0 1.5px ${ring}` }}
      title={sym}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo!} alt={sym} width={size} height={size} onError={() => setFailed(true)} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.32), fontWeight: 700, color: '#8A82F4', letterSpacing: '-0.02em' }}>{initials(sym)}</span>
      )}
    </span>
  )
}

export function TokenPair({
  baseLogo,
  quoteLogo,
  baseSymbol,
  quoteSymbol,
  size = 30,
  ring = '#12121C',
}: {
  baseLogo: string | null
  quoteLogo: string | null
  baseSymbol: string
  quoteSymbol: string
  size?: number
  ring?: string // the surface colour behind the pair, so the overlap reads as a clean cutout
}) {
  const overlap = Math.round(size * 0.6)
  return (
    <span className="relative shrink-0 inline-block" style={{ width: size + overlap, height: size }} aria-label={`${baseSymbol} / ${quoteSymbol}`}>
      <TokenIcon logo={baseLogo} sym={baseSymbol} size={size} ring={ring} z={2} left={0} />
      <TokenIcon logo={quoteLogo} sym={quoteSymbol} size={size} ring={ring} z={1} left={overlap} />
    </span>
  )
}
