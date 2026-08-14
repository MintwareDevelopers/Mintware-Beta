import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Mintware — On-chain reputation, reputation-weighted yield'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Design v2 (Privy-esque) palette — periwinkle-led pastel, soft, light-first.
const GROUND = '#FFFFFF'
const GROUND_COOL = '#F6F6FC'
const INK = '#17171F'
const INK_MID = '#55555F'
const INK_SOFT = '#9A9AA8'
const HAIR = 'rgba(23,23,31,0.10)'
const PERI = '#6C6CF0'
const PERI_MID = '#8A82F4'
const CORAL = '#F4A183'

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: GROUND, position: 'relative', fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* soft periwinkle wash (airbrush) */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          background: `linear-gradient(135deg, ${GROUND_COOL} 0%, ${GROUND} 42%), linear-gradient(300deg, rgba(244,161,131,0.16) 0%, rgba(108,108,240,0.16) 55%, transparent 78%)`,
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '72px 80px', justifyContent: 'space-between', position: 'relative' }}>
          {/* logo — dome mark tile + wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${PERI_MID}, ${PERI})`,
            }}>
              <svg width="52" height="52" viewBox="0 0 100 100">
                <ellipse cx="50" cy="54" rx="36" ry="8.5" fill="#ffffff" />
                <path d="M33 54C33 45.4 40.6 38 50 38C59.4 38 67 45.4 67 54Z" fill="#ffffff" />
              </svg>
            </div>
            <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: 2, color: INK }}>MINTWARE</span>
          </div>

          {/* headline block */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ width: 11, height: 11, borderRadius: 6, background: CORAL, display: 'flex' }} />
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 3, color: INK_SOFT, textTransform: 'uppercase' }}>
                Your liquidity, made whole
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 78, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02, color: INK }}>
              <span style={{ display: 'flex' }}>Never idle. Never locked.</span>
              <span style={{ display: 'flex', color: PERI }}>Always yours.</span>
            </div>
            <div style={{ display: 'flex', fontSize: 24, lineHeight: 1.45, color: INK_MID, marginTop: 26, maxWidth: 820 }}>
              USDC that earns three ways at once — and stays liquid and spendable. The LPs who bring real, committed liquidity earn the most.
            </div>
          </div>

          {/* rounded pill chips */}
          <div style={{ display: 'flex', gap: 12 }}>
            {['Vaults', 'Liquid Sovereign Account', 'Attribution', 'Agents'].map((l) => (
              <div key={l} style={{
                display: 'flex', padding: '11px 20px', borderRadius: 999,
                border: `1px solid ${HAIR}`, fontSize: 16, fontWeight: 600,
                color: INK, background: GROUND_COOL,
              }}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
