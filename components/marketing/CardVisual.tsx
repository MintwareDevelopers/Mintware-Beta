'use client'

import { useEffect, useState } from 'react'

// Two fanned Mintware cards with a floating "balance earning" chip. Pure CSS; illustrative only.
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Card({ tone, className = '' }: { tone: 'peri' | 'coral'; className?: string }) {
  const bg = tone === 'peri'
    ? 'radial-gradient(ellipse 80% 90% at 15% 15%, #C7B8FB 0%, transparent 60%), radial-gradient(ellipse 80% 80% at 90% 30%, #A9B6FC 0%, transparent 55%), radial-gradient(ellipse 70% 80% at 70% 100%, #F4A183 0%, transparent 50%), linear-gradient(150deg, #8F8BF4, #5A57DE)'
    : 'radial-gradient(ellipse 80% 90% at 20% 10%, #F8C6AC 0%, transparent 60%), radial-gradient(ellipse 80% 80% at 90% 40%, #F3CFE3 0%, transparent 55%), linear-gradient(150deg, #F4A183, #E1BBEA)'
  return (
    <div className={`absolute w-[300px] h-[188px] rounded-[22px] p-6 text-white shadow-[0_30px_70px_rgba(90,87,222,.35)] border border-white/40 overflow-hidden ${className}`} style={{ background: bg }}>
      <div className="flex items-center justify-between">
        <span className="font-atx-display font-semibold text-[17px] tracking-[-0.02em]">Mintware</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M8.5 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M15.5 2.5a13 13 0 0 1 0 19" /></svg>
      </div>
      <div className="mt-6 w-11 h-8 rounded-md bg-gradient-to-br from-[#F6E7B8] to-[#D9B66A] opacity-90" />
      <div className="mt-5 flex items-end justify-between">
        <span className="font-mono text-[14px] tracking-[0.18em] opacity-90">•••• 2026</span>
        <span className="font-semibold text-[12px] opacity-90">Earning</span>
      </div>
    </div>
  )
}

export function CardVisual({ label = 'Card balance · earning', amount = '$2,480.00' }: { label?: string; amount?: string }) {
  const [earned, setEarned] = useState(18.4)
  useEffect(() => {
    const id = window.setInterval(() => setEarned(e => e + 0.01), 150)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="relative w-[360px] max-w-full h-[340px]">
      <Card tone="coral" className="left-8 top-4 rotate-[-9deg]" />
      <Card tone="peri" className="left-12 top-20 rotate-[4deg]" />
      <div className="glass-card absolute right-0 bottom-2 px-5 py-4 !rounded-2xl">
        <div className="text-[11px] text-ink-mid">{label}</div>
        <div className="font-atx-display font-medium text-[22px] tracking-[-0.02em] text-ink">{amount}</div>
        <div className="font-mono text-[12px] text-mw-green font-semibold">+${fmt(earned)} this month</div>
      </div>
    </div>
  )
}
