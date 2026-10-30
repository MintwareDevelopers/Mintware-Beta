'use client'

// The landing hero object: three stacked discs — liquidity, collateral, credit — that make up one asset's
// engine. Each layer label is a button; picking one lifts its disc and explains it underneath.

import { useState } from 'react'

type LayerId = 'liq' | 'col' | 'cred'

const LAYERS: { id: LayerId; name: string; status: string; top: string; swatch: string; title: string; body: string }[] = [
  {
    id: 'liq', name: 'Liquidity', status: 'Live on testnet', top: '34.2%', swatch: 'linear-gradient(160deg,#E4E4FE,#7C7AF0)',
    title: 'Liquidity · live on testnet',
    body: 'Provide to a market. The engine pairs it into that asset’s own pool and fees compound into your share.',
  },
  {
    id: 'col', name: 'Collateral', status: 'In development', top: '55.8%', swatch: 'linear-gradient(160deg,#F0ECFD,#9C8EE6)',
    title: 'Collateral · in development',
    body: 'Borrow against your position without taking it out of the market. It keeps providing depth while it backs the loan.',
  },
  {
    id: 'cred', name: 'Credit', status: 'On the roadmap', top: '78.3%', swatch: 'linear-gradient(160deg,#FDE3D7,#E08A62)',
    title: 'Credit · on the roadmap',
    body: 'Loans that unwind gradually inside the pool, and only on a fresh mark. Nobody races a closed market to liquidate you.',
  },
]

export function EngineHero() {
  const [layer, setLayer] = useState<LayerId>('liq')
  const disc = (id: LayerId) => ({
    transform: `translateY(${layer === id ? -16 : 0}px)`,
    filter: layer === id ? 'none' : 'saturate(0.45) brightness(1.04)',
    opacity: layer === id ? 1 : 0.85,
    transition: 'transform .45s cubic-bezier(.2,.8,.2,1), opacity .35s ease, filter .35s ease',
  })
  const cur = LAYERS.find((l) => l.id === layer)!

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div className="relative w-full max-w-[600px]">
        <svg role="img" aria-label="Three stacked discs forming one engine: liquidity on top, collateral in the middle, credit at the base" viewBox="0 0 640 520" className="block w-full h-auto overflow-visible">
          <defs>
            <filter id="eh-blur12" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="12" /></filter>
            <filter id="eh-blur6" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="6" /></filter>
            <linearGradient id="eh-cTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FDE3D7" /><stop offset="1" stopColor="#F6A988" /></linearGradient>
            <linearGradient id="eh-cSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#D86E46" /><stop offset=".38" stopColor="#F3A280" /><stop offset="1" stopColor="#C9602F" /></linearGradient>
            <linearGradient id="eh-mTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F0ECFD" /><stop offset="1" stopColor="#C9C0F4" /></linearGradient>
            <linearGradient id="eh-mSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8A7BDD" /><stop offset=".38" stopColor="#BDB1F2" /><stop offset="1" stopColor="#7C6CD3" /></linearGradient>
            <linearGradient id="eh-pTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E4E4FE" /><stop offset="1" stopColor="#A9A7FA" /></linearGradient>
            <linearGradient id="eh-pSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4E4CD8" /><stop offset=".38" stopColor="#8B89F6" /><stop offset="1" stopColor="#4240C8" /></linearGradient>
          </defs>
          <ellipse cx="250" cy="470" rx="220" ry="26" fill="#15151D" opacity=".16" filter="url(#eh-blur12)" />
          <g style={disc('cred')}>
            <path d="M50,385 A200 60 0 0 0 450,385 L450,429 A200 60 0 0 1 50,429 Z" fill="url(#eh-cSide)" />
            <ellipse cx="250" cy="385" rx="200" ry="60" fill="url(#eh-cTop)" />
            <ellipse cx="250" cy="385" rx="199" ry="59" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.5" />
            <ellipse cx="250" cy="372" rx="155" ry="38" fill="#7A3A1E" opacity=".2" filter="url(#eh-blur6)" />
          </g>
          <g style={disc('col')}>
            <path d="M85,270 A165 50 0 0 0 415,270 L415,310 A165 50 0 0 1 85,310 Z" fill="url(#eh-mSide)" />
            <ellipse cx="250" cy="270" rx="165" ry="50" fill="url(#eh-mTop)" />
            <ellipse cx="250" cy="270" rx="164" ry="49" fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="1.5" />
            <ellipse cx="250" cy="262" rx="120" ry="30" fill="#3A2C8C" opacity=".18" filter="url(#eh-blur6)" />
          </g>
          <g style={disc('liq')}>
            <path d="M120,160 A130 40 0 0 0 380,160 L380,196 A130 40 0 0 1 120,196 Z" fill="url(#eh-pSide)" />
            <ellipse cx="250" cy="160" rx="130" ry="40" fill="url(#eh-pTop)" />
            <ellipse cx="250" cy="160" rx="129" ry="39" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="1.5" />
            <ellipse cx="205" cy="148" rx="46" ry="9" fill="#fff" opacity=".55" filter="url(#eh-blur6)" />
          </g>
          <g stroke="#15151D" strokeOpacity=".22">
            <line x1="386" y1="178" x2="462" y2="178" />
            <line x1="421" y1="290" x2="462" y2="290" />
            <line x1="456" y1="407" x2="462" y2="407" />
          </g>
          <g fill="#15151D"><circle cx="386" cy="178" r="3.5" /><circle cx="421" cy="290" r="3.5" /><circle cx="456" cy="407" r="3.5" /></g>
        </svg>
        <div role="group" aria-label="Engine layers">
          {LAYERS.map((l) => {
            const on = l.id === layer
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => setLayer(l.id)}
                className="absolute right-0 flex items-center gap-2.5 min-h-[48px] py-1.5 pl-3 pr-3.5 rounded-[14px] border-0 cursor-pointer text-left transition-[box-shadow,background] duration-200"
                style={{
                  top: l.top, transform: 'translateY(-50%)',
                  background: on ? '#fff' : 'rgba(255,255,255,0.72)',
                  boxShadow: on ? '0 0 0 2px rgba(91,91,230,.45), 0 1px 2px rgba(21,21,29,.06), 0 8px 20px -8px rgba(70,67,209,.45), inset 0 1px 0 #fff' : 'var(--mw-raise-sm)',
                }}
              >
                <span className="shrink-0 w-3.5 h-3.5 rounded-[5px]" style={{ background: l.swatch, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7)' }} />
                <span>
                  <span className="block text-[14px] font-semibold" style={{ color: 'var(--mw-ink)' }}>{l.name}</span>
                  <span className="block text-[12px]" style={{ color: 'var(--mw-ink-3)' }}>{l.status}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div role="status" aria-live="polite" className="mw-raise-sm w-full max-w-[520px] rounded-[18px] px-[18px] py-4 flex gap-3.5 items-start">
        <span className="shrink-0 mt-[3px] w-[18px] h-[18px] rounded-[6px]" style={{ background: cur.swatch, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7)' }} />
        <div>
          <div className="font-semibold">{cur.title}</div>
          <div className="mt-1 text-[14px] leading-[1.5]" style={{ color: 'var(--mw-ink-2)' }}>{cur.body}</div>
        </div>
      </div>
    </div>
  )
}
