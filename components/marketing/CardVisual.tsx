'use client'

import { useEffect, useState } from 'react'
import { MineralMark } from '@/components/ui2/MineralMark'

// Two fanned Mintware cards with a floating "balance earning" chip (Mineral). Illustrative only.
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Card({ tone, className = '' }: { tone: 'peri' | 'coral'; className?: string }) {
  // Solid, matte cards: a deep periwinkle and a warm porcelain, each lit by one soft patch of the sheen.
  const peri = tone === 'peri'
  return (
    <div
      className={`absolute w-[300px] h-[188px] rounded-[22px] p-6 overflow-hidden ${className}`}
      style={{
        background: peri ? '#4E4CD8' : '#FBEEE7',
        color: peri ? '#fff' : '#15151D',
        boxShadow: peri
          ? '0 0 0 1px rgba(40,36,140,.6), 0 2px 2px rgba(21,21,29,.08), 0 30px 60px -24px rgba(40,36,120,.55), inset 0 1px 0 rgba(255,255,255,.25)'
          : 'var(--mw-raise-lg)',
      }}
    >
      <div aria-hidden="true" className="absolute -right-16 -top-20 w-56 h-56 rounded-full blur-[40px]" style={{ background: 'var(--mw-sheen)', opacity: peri ? 0.55 : 0.6 }} />
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold text-[16px] tracking-[-0.02em]"><MineralMark size={20} />Mintware</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M8.5 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M15.5 2.5a13 13 0 0 1 0 19" /></svg>
      </div>
      <div className="relative mt-6 w-11 h-8 rounded-[7px]" style={{ background: 'linear-gradient(160deg,#F3E6C0,#CFAE68)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }} />
      <div className="relative mt-5 flex items-end justify-between">
        <span className="font-geist-mono text-[14px] tracking-[0.18em] opacity-90">•••• 2026</span>
        <span className="font-semibold text-[12px] opacity-90">Earning</span>
      </div>
    </div>
  )
}

export function CardVisual({ label = 'Earning balance', amount = '$2,480.00' }: { label?: string; amount?: string }) {
  const [earned, setEarned] = useState(18.4)
  useEffect(() => {
    const id = window.setInterval(() => setEarned(e => e + 0.01), 150)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="relative w-[380px] max-w-full h-[340px] max-[480px]:scale-[.84] max-[480px]:-my-6 origin-center">
      <div aria-hidden="true" className="absolute inset-[14%_0_0_10%] rounded-[40px] opacity-35 blur-[48px]" style={{ background: 'var(--mw-sheen)' }} />
      <Card tone="coral" className="left-4 top-4 rotate-[-9deg]" />
      <Card tone="peri" className="left-10 top-20 rotate-[4deg]" />
      <div className="mw-raise-lg absolute right-0 bottom-2 px-5 py-4 rounded-[18px]">
        <div className="text-[12px] text-ink-soft">{label}</div>
        <div className="font-geist-mono text-[22px] tracking-[-0.02em] text-ink mt-0.5">{amount}</div>
        <div className="font-geist-mono text-[12px] font-medium" style={{ color: 'var(--mw-gain)' }}>+${fmt(earned)} this month</div>
      </div>
    </div>
  )
}
