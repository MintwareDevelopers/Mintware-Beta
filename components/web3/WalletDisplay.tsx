'use client'

// =============================================================================
// components/WalletDisplay.tsx
//
// Resolves and displays a wallet address as a Basename if one exists,
// falling back to the truncated hex address.
//
// Resolution happens silently on mount — the address shows immediately and
// swaps to the Basename when resolved. No loading spinner.
//
// Usage:
//   <WalletDisplay address="0x3F9A..." />
//   <WalletDisplay address="0x3F9A..." mono />          ← DM Mono fallback
//   <WalletDisplay address="0x3F9A..." className="..." />
//
// Display:
//   - Basename found  → "jake.base"      (Plus Jakarta Sans, normal weight)
//   - No Basename     → "0x3F9A…37Bf"   (DM Mono if mono prop, else Jakarta)
// =============================================================================

import { useEffect, useState } from 'react'
import { resolveBasename } from '@/lib/web2/identity'
import { shortAddr } from '@/lib/web2/api'

interface WalletDisplayProps {
  address:    string
  className?: string
  /** Use DM Mono font for the address fallback (matches existing address styling) */
  mono?:      boolean
  style?:     React.CSSProperties
}

export function WalletDisplay({ address, className, mono, style }: WalletDisplayProps) {
  const [basename, setBasename] = useState<string | null>(null)

  useEffect(() => {
    if (!address) return
    resolveBasename(address).then(name => {
      if (name) setBasename(name)
    })
  }, [address])

  const display   = basename ?? shortAddr(address)
  const isFallback = !basename

  return (
    <span
      className={className}
      style={{
        fontFamily: (isFallback && mono)
          ? 'DM Mono, monospace'
          : 'Plus Jakarta Sans, sans-serif',
        ...style,
      }}
    >
      {display}
    </span>
  )
}
