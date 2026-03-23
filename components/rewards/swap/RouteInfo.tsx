'use client'

// =============================================================================
// components/swap/RouteInfo.tsx
//
// Displays: price impact (color-coded) + integrator fee strip
// Props: route (from @lifi/sdk), fee (decimal)
// =============================================================================

import type { Route } from '@lifi/sdk'

interface RouteInfoProps {
  route: Route
  fee: number  // e.g. 0.01 = 1%
}

function priceImpactColor(impact: number): string {
  if (impact < 1)  return '#2A9E8A' // green
  if (impact < 3)  return '#C27A00' // amber
  return '#C2537A'                  // red
}

export function RouteInfo({ route, fee }: RouteInfoProps) {
  // Price impact — LI.FI doesn't always expose it directly; derive from amounts
  const fromUSD  = parseFloat(route.fromAmountUSD ?? '0')
  const toUSD    = parseFloat(route.toAmountUSD   ?? '0')
  const impact   = fromUSD > 0 ? Math.max(0, (fromUSD - toUSD) / fromUSD * 100) : 0
  const impactColor = priceImpactColor(impact)

  // Fee amount in USD
  const feeUSD = fromUSD * fee

  // Gas cost
  const gasCost = route.gasCostUSD ? parseFloat(route.gasCostUSD) : null

  // Route summary — protocol names from first step
  const bridgeName = route.steps[0]?.toolDetails?.name ?? route.steps[0]?.tool ?? null

  return (
    <div className="bg-mw-surface-purple border border-[#E0DFFF] rounded-[10px] px-[12px] py-[10px] flex flex-col gap-[6px]">
      {/* Route via */}
      {bridgeName && (
        <div className="flex items-center justify-between">
          <span className="font-sans text-[12px] text-mw-ink-4 font-medium">Route</span>
          <span className="font-sans text-[10px] font-bold bg-[#EEF1FF] text-mw-brand-deep rounded-[4px] px-[6px] py-[1px] tracking-[0.3px]">
            via {bridgeName}
          </span>
        </div>
      )}

      {/* Price impact */}
      <div className="flex items-center justify-between">
        <span className="font-sans text-[12px] text-mw-ink-4 font-medium">Price impact</span>
        <span className="font-mono text-[12px] font-semibold" style={{ color: impactColor }}>
          {impact < 0.01 ? '< 0.01%' : `${impact.toFixed(2)}%`}
        </span>
      </div>

      <div className="h-[1px] bg-[#E0DFFF] my-[2px]" />

      {/* Integrator fee */}
      <div className="flex items-center justify-between">
        <span className="font-sans text-[12px] text-mw-ink-4 font-medium">Fee ({(fee * 100).toFixed(1)}%)</span>
        <span className="font-mono text-[12px] text-mw-ink font-medium">
          {feeUSD > 0 ? `~$${feeUSD.toFixed(2)}` : '—'}
        </span>
      </div>

      {/* Gas */}
      {gasCost !== null && (
        <div className="flex items-center justify-between">
          <span className="font-sans text-[12px] text-mw-ink-4 font-medium">Gas</span>
          <span className="font-mono text-[12px] text-mw-ink font-medium">
            {gasCost > 0 ? `~$${gasCost.toFixed(4)}` : '< $0.0001'}
          </span>
        </div>
      )}

      {/* Minimum received */}
      <div className="flex items-center justify-between">
        <span className="font-sans text-[12px] text-mw-ink-4 font-medium">Min received</span>
        <span className="font-mono text-[12px] text-mw-ink font-medium">
          {route.toAmountMin
            ? `${(Number(route.toAmountMin) / 10 ** route.toToken.decimals).toPrecision(6)} ${route.toToken.symbol}`
            : '—'}
        </span>
      </div>
    </div>
  )
}
