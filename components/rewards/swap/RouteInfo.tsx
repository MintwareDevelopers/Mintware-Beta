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
    <>
      <style>{`
        .ri-wrap {
          background: #F7F6FF;
          border: 1px solid #E0DFFF;
          border-radius: 10px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ri-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ri-label {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          color: #8A8C9E;
          font-weight: 500;
        }
        .ri-value {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: #1A1A2E;
          font-weight: 500;
        }
        .ri-impact {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 600;
        }
        .ri-divider {
          height: 1px;
          background: #E0DFFF;
          margin: 2px 0;
        }
        .ri-route-badge {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 10px;
          font-weight: 700;
          background: #EEF1FF;
          color: #3A5CE8;
          border-radius: 4px;
          padding: 1px 6px;
          letter-spacing: 0.3px;
        }
      `}</style>

      <div className="ri-wrap">
        {/* Route via */}
        {bridgeName && (
          <div className="ri-row">
            <span className="ri-label">Route</span>
            <span className="ri-route-badge">via {bridgeName}</span>
          </div>
        )}

        {/* Price impact */}
        <div className="ri-row">
          <span className="ri-label">Price impact</span>
          <span className="ri-impact" style={{ color: impactColor }}>
            {impact < 0.01 ? '< 0.01%' : `${impact.toFixed(2)}%`}
          </span>
        </div>

        <div className="ri-divider" />

        {/* Integrator fee */}
        <div className="ri-row">
          <span className="ri-label">Fee ({(fee * 100).toFixed(1)}%)</span>
          <span className="ri-value">
            {feeUSD > 0 ? `~$${feeUSD.toFixed(2)}` : '—'}
          </span>
        </div>

        {/* Gas */}
        {gasCost !== null && (
          <div className="ri-row">
            <span className="ri-label">Gas</span>
            <span className="ri-value">
              {gasCost > 0 ? `~$${gasCost.toFixed(4)}` : '< $0.0001'}
            </span>
          </div>
        )}

        {/* Minimum received */}
        <div className="ri-row">
          <span className="ri-label">Min received</span>
          <span className="ri-value">
            {route.toAmountMin
              ? `${(Number(route.toAmountMin) / 10 ** route.toToken.decimals).toPrecision(6)} ${route.toToken.symbol}`
              : '—'}
          </span>
        </div>
      </div>
    </>
  )
}
