// app/[address]/opengraph-image.tsx
// Auto-generated OG image for every public wallet profile.
// Appears when shared to Twitter, Telegram, Discord, iMessage, etc.
// Size: 1200×630 (standard OG)

import { ImageResponse } from 'next/og'
import { NextRequest }   from 'next/server'
import { API }           from '@/lib/web2/api'

export const runtime = 'edge'
export const alt     = 'Mintware — Wallet Attribution Score'
export const size    = { width: 1200, height: 630 }
export const contentType = 'image/png'

function tierColor(tier: string): string {
  if (tier === 'gold')   return '#C27A00'
  if (tier === 'silver') return '#9898C0'
  return '#4f7ef7'
}

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function fmtTier(tier: string): string {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : ''
}

export default async function OGImage(
  { params }: { params: { address: string } }
) {
  const address = params.address?.toLowerCase() ?? ''
  const isValid = /^0x[0-9a-f]{40}$/i.test(address)

  let score   = 0
  let tier    = 'bronze'
  let pct     = 0
  let walletAge = ''
  let chains  = 0
  let badges: string[] = []

  if (isValid) {
    try {
      const res  = await fetch(`${API}/score?address=${address}`, { next: { revalidate: 3600 } })
      const data = await res.json()
      score     = data.score     ?? 0
      tier      = data.tier      ?? 'bronze'
      pct       = data.percentile ?? 0
      walletAge = data.walletAge  ?? ''
      chains    = data.chains     ?? 0

      // Compute earned badges
      const months = parseInt(walletAge.match(/(\d+)\s*month/)?.[1] ?? '0')
      if (months >= 12) badges.push('◆ OG')
      if (pct >= 90)    badges.push('⊕ Top 10%')
      const liq = data.signals?.find((s: { key: string }) => s.key === 'liquidity')?.score ?? 0
      if (liq > 0)      badges.push('⬡ Core LP')
      if ((data.treeSize ?? 0) >= 5) badges.push('◉ Connector')
    } catch {
      // Use defaults
    }
  }

  const color = tierColor(tier)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          background: 'linear-gradient(135deg, #0e1117 0%, #131929 100%)',
          display: 'flex', flexDirection: 'column',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div style={{
          position: 'absolute', top: -80, right: -40,
          width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(79,126,247,0.15) 0%, transparent 70%)',
        }} />

        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '36px 56px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: '#4f7ef7',
            }} />
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 18, fontWeight: 600, letterSpacing: '-0.3px' }}>
              mintware
            </span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>
            Attribution Score
          </span>
        </div>

        {/* Main content */}
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center',
          padding: '0 56px', gap: 48,
        }}>
          {/* Left: address + badges */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18,
              background: 'rgba(255,255,255,0.06)',
              border: '1.5px solid rgba(255,255,255,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.85)',
              marginBottom: 20,
            }}>
              {address.charAt(2).toUpperCase()}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'white', marginBottom: 6 }}>
              {shortAddr(address)}
            </div>
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', marginBottom: 24, fontFamily: 'monospace' }}>
              {address.slice(0, 18)}…
            </div>
            {/* Chips */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
              {walletAge && (
                <div style={{
                  background: 'rgba(255,255,255,0.06)', borderRadius: 20,
                  padding: '4px 12px', fontSize: 13, color: 'rgba(255,255,255,0.45)',
                }}>
                  {walletAge} old
                </div>
              )}
              {chains > 0 && (
                <div style={{
                  background: 'rgba(255,255,255,0.06)', borderRadius: 20,
                  padding: '4px 12px', fontSize: 13, color: 'rgba(255,255,255,0.45)',
                }}>
                  {chains} chain{chains !== 1 ? 's' : ''}
                </div>
              )}
            </div>
            {/* Badges */}
            {badges.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {badges.map((b, i) => (
                  <div key={i} style={{
                    background: `${color}18`,
                    border: `1.5px solid ${color}40`,
                    color, borderRadius: 8,
                    padding: '5px 12px', fontSize: 13, fontWeight: 700,
                  }}>
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: big score */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{
              fontSize: 100, fontWeight: 900, color: 'white',
              lineHeight: 1, letterSpacing: -4, fontFamily: 'monospace',
            }}>
              {score}
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', marginTop: 4, fontFamily: 'monospace' }}>
              of 925 pts
            </div>
            <div style={{
              marginTop: 16, padding: '8px 18px', borderRadius: 24,
              background: `${color}18`,
              border: `1.5px solid ${color}40`,
              color, fontSize: 16, fontWeight: 700,
            }}>
              {fmtTier(tier)} · Top {100 - pct}%
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{
          padding: '0 56px 36px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.2)' }}>
            mintware.finance/{shortAddr(address)}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>
            DeFi reputation · 100+ chains
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
