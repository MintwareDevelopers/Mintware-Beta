import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Mintware — On-chain reputation, reputation-weighted yield'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// ATX Settlemint palette (matches the live site — light-first, square, hairline).
const BONE = '#F1F0E9'
const PANEL = '#F7F6F0'
const INK = '#111111'
const BLUE = '#006FCC'
const CORAL = '#FF8574'

const STAR = 'M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z'

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: BONE, position: 'relative', fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* grid overlay */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          backgroundImage: 'linear-gradient(rgba(17,17,17,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(17,17,17,0.05) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
        }} />
        {/* hairline frame */}
        <div style={{ position: 'absolute', top: 24, left: 24, right: 24, bottom: 24, display: 'flex', border: `1px solid ${INK}` }} />

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '68px 76px', justifyContent: 'space-between' }}>
          {/* logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <svg width="44" height="44" viewBox="0 0 100 100"><path fill={BLUE} d={STAR} /></svg>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: 4, color: INK }}>MINTWARE</span>
          </div>

          {/* headline block */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 22 }}>
              <div style={{ width: 11, height: 11, background: CORAL, border: `1px solid ${INK}`, display: 'flex' }} />
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 3, color: 'rgba(17,17,17,0.55)', textTransform: 'uppercase' }}>
                On-chain reputation · 100+ chains
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02, color: INK }}>
              <span style={{ display: 'flex' }}>Your contribution should</span>
              <span style={{ display: 'flex', color: BLUE }}>mean something.</span>
            </div>
            <div style={{ display: 'flex', fontSize: 24, lineHeight: 1.45, color: 'rgba(17,17,17,0.6)', marginTop: 26, maxWidth: 780 }}>
              One reputation score across every chain — powering reward campaigns and reputation-weighted DeFi liquidity vaults.
            </div>
          </div>

          {/* square chips */}
          <div style={{ display: 'flex', gap: 12 }}>
            {['Attribution', 'DeFi Vaults', 'Rewards', 'AI Agents'].map((l) => (
              <div key={l} style={{
                display: 'flex', padding: '10px 18px', border: `1px solid ${INK}`,
                fontSize: 16, fontWeight: 600, color: INK, background: PANEL,
              }}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
