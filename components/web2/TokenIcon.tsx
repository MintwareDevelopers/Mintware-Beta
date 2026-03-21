'use client'

// TokenIcon — shows a token's real logo, falls back to coloured initial.
// Pass logoUri directly (if you already have it) or tokenAddress + chainId
// to trigger a live LI.FI / CoinGecko lookup.

import { useState, useEffect } from 'react'
import { iconColor } from '@/lib/web2/api'
import { fetchTokenMeta } from '@/lib/web2/tokenMeta'

const CHAIN_NAME_TO_ID: Record<string, number> = {
  base: 8453, arbitrum: 42161, ethereum: 1, eth: 1,
  bsc: 56, polygon: 137, optimism: 10, coredao: 1116, core: 1116,
}

interface TokenIconProps {
  /** Pre-resolved logo URL — skips the API fetch if provided */
  logoUri?: string | null
  /** Token contract address — triggers a fetch if logoUri is absent */
  tokenAddress?: string | null
  /** Chain as a name ("base", "arbitrum") or numeric ID */
  chain?: string | number | null
  /** Display name used for the coloured-initial fallback */
  name: string
  size?: number
  borderRadius?: number
}

export function TokenIcon({
  logoUri,
  tokenAddress,
  chain,
  name,
  size = 36,
  borderRadius = 9,
}: TokenIconProps) {
  const [resolvedUri, setResolvedUri] = useState<string | null>(logoUri ?? null)
  const [imgFailed,   setImgFailed]   = useState(false)

  // Fetch from LI.FI / CoinGecko if we have an address but no direct URI
  useEffect(() => {
    if (logoUri) { setResolvedUri(logoUri); return }
    if (!tokenAddress || !chain) return

    const chainId =
      typeof chain === 'number'
        ? chain
        : CHAIN_NAME_TO_ID[chain.toLowerCase()] ?? 0

    if (!chainId) return

    fetchTokenMeta(chainId, tokenAddress).then(meta => {
      if (meta?.logoURI) setResolvedUri(meta.logoURI)
    })
  }, [logoUri, tokenAddress, chain])

  const col     = iconColor(name)
  const initial = name.charAt(0).toUpperCase()
  const showImg = resolvedUri && !imgFailed

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius,
        flexShrink: 0,
        border: '0.5px solid rgba(0,0,0,0.07)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: showImg ? '#fff' : col.bg,
        color: col.fg,
        fontSize: Math.round(size * 0.39),
        fontWeight: 700,
        fontFamily: "'DM Mono', monospace",
      }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUri!}
          alt={name}
          width={size}
          height={size}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        initial
      )}
    </div>
  )
}
