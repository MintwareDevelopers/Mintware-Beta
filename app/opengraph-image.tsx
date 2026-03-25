import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt     = 'Mintware — The reputation economy of DeFi'
export const size    = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width:      '100%',
          height:     '100%',
          display:    'flex',
          flexDirection: 'column',
          alignItems:    'flex-start',
          justifyContent:'flex-end',
          background: '#0A0D14',
          padding:    '64px 72px',
          position:   'relative',
          overflow:   'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Grid lines */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(79,126,247,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(79,126,247,0.04) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          display: 'flex',
        }} />

        {/* Top-right glow */}
        <div style={{
          position: 'absolute', top: -120, right: -80,
          width: 540, height: 540, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(79,126,247,0.15) 0%, transparent 65%)',
          display: 'flex',
        }} />

        {/* Bottom-left glow */}
        <div style={{
          position: 'absolute', bottom: -100, left: -60,
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(58,92,232,0.1) 0%, transparent 65%)',
          display: 'flex',
        }} />

        {/* MW mark — top right */}
        <div style={{
          position: 'absolute', top: 56, right: 72,
          width: 72, height: 72, borderRadius: 18,
          background: '#161B2A',
          border: '1.5px solid rgba(79,126,247,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg viewBox="0 0 158.36 97.28" width="40" height="26" fill="white">
            <path d="m158.36,97.28h-29.82c-.1-1.89-.27-3.65-.28-5.4-.04-15.5.14-31-.11-46.49-.2-12.49-9.81-20.43-21.47-18.2-7.66,1.46-12.28,6.84-12.31,14.66-.06,16.33,0,32.66.02,48.99,0,1.98,0,3.95,0,6.3h-30.85c0-1.92,0-3.84,0-5.76-.01-15.5.07-31-.07-46.49-.08-9.27-4.87-15.65-12.67-17.51-10.88-2.59-19.45,3.96-19.54,15.12-.12,16.33-.07,32.66-.12,48.99,0,1.8-.15,3.59-.24,5.69H.67c-.1-1.7-.29-3.45-.3-5.2C.26,63.64.25,35.31,0,6.98-.03,2.99.81,1.35,5.17,1.54c7.98.34,15.98.1,24.62.1.22,3.03.42,5.88.65,8.97,16.27-16.14,45.06-13.25,58.53,4.88,2.82-2.57,5.54-5.25,8.48-7.67,15.33-12.58,49.61-12.29,58.82,18.14,1.1,3.63,1.45,7.51,1.85,11.31.32,2.97.23,5.99.24,8.99.02,16.81,0,33.63,0,51.02Z"/>
          </svg>
        </div>

        {/* Tag line label */}
        <div style={{
          display:     'flex',
          alignItems:  'center',
          gap:         8,
          marginBottom: 20,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#22c55e',
          }} />
          <span style={{
            fontSize: 13, fontWeight: 700, letterSpacing: 2,
            color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase',
          }}>
            Live on Base
          </span>
        </div>

        {/* Main heading */}
        <div style={{
          fontSize: 72, fontWeight: 800, lineHeight: 1.05,
          color: 'rgba(255,255,255,0.94)',
          letterSpacing: -2.5,
          marginBottom: 20,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <span>The reputation</span>
          <span style={{ color: '#4f7ef7' }}>economy of DeFi.</span>
        </div>

        {/* Sub */}
        <div style={{
          fontSize: 22, fontWeight: 400, lineHeight: 1.5,
          color: 'rgba(255,255,255,0.45)',
          maxWidth: 640,
          marginBottom: 44,
        }}>
          Attribution measures every on-chain contribution.
          Mintware is where those contributions earn rewards.
        </div>

        {/* Bottom pill row */}
        <div style={{ display: 'flex', gap: 12 }}>
          {['Attribution Scoring', '100+ Chains', 'Reward Campaigns', 'AI Agent Support'].map(label => (
            <div key={label} style={{
              padding: '8px 16px',
              border: '1px solid rgba(79,126,247,0.2)',
              borderRadius: 999,
              fontSize: 13, fontWeight: 600,
              color: 'rgba(255,255,255,0.55)',
              background: 'rgba(79,126,247,0.07)',
              display: 'flex',
            }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  )
}
