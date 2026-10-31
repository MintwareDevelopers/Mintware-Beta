'use client'

// First-visit disclaimer gate for the V1 app (Meteora-style "Welcome" modal). Honest testnet framing —
// unaudited, not a deposit / not a guaranteed return, subject to IL. Shows once per session; "Do not
// show again" persists in localStorage. All storage access is wrapped (private windows / blocked storage
// must still render the app), and it never blocks reading behind it beyond the overlay.

import { useEffect, useState } from 'react'
import Link from 'next/link'

const LS_KEY = 'mw_v1_disclaimer_ack'
const SS_KEY = 'mw_v1_disclaimer_session'

export function V1DisclaimerGate() {
  const [open, setOpen] = useState(false)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    let acked = false
    try {
      acked = localStorage.getItem(LS_KEY) === '1' || sessionStorage.getItem(SS_KEY) === '1'
    } catch {
      acked = false
    }
    if (!acked) setOpen(true)
  }, [])

  function enter() {
    try {
      sessionStorage.setItem(SS_KEY, '1')
      if (dontShow) localStorage.setItem(LS_KEY, '1')
    } catch {
      /* storage blocked — dismiss for this render regardless */
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[400] grid place-items-center p-4 font-atx-display" role="dialog" aria-modal="true" aria-label="Welcome to Mintware">
      <div className="absolute inset-0" style={{ background: 'rgba(40,36,90,0.28)', backdropFilter: 'blur(4px)' }} />
      <div className="relative w-full max-w-[440px] rounded-[18px] overflow-hidden" style={{ background: '#FFFFFF', border: '1px solid rgba(22,22,44,0.08)', boxShadow: '0 1px 2px rgba(20,20,50,0.04), 0 8px 24px -12px rgba(30,30,80,0.10)' }}>
        <div className="h-[92px] flex items-center justify-center" style={{ background: 'radial-gradient(120% 120% at 50% 0%, rgba(138,130,244,0.28), transparent 70%)' }}>
          <div className="flex items-center gap-2.5">
            <span className="w-[26px] h-[26px] rounded-[7px_7px_9px_9px]" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }} />
            <span className="font-bold text-[19px] tracking-[-0.01em]" style={{ color: '#191923' }}>Mintware</span>
          </div>
        </div>
        <div className="px-7 pb-7 pt-1">
          <h2 className="font-semibold text-[19px] tracking-[-0.01em]" style={{ color: '#191923' }}>Welcome — this is a testnet preview</h2>
          <p className="text-[13.5px] leading-[1.6] mt-2.5" style={{ color: '#494957' }}>
            Mintware runs on Base and Robinhood Chain testnets — <span style={{ color: '#191923' }}>unaudited, with no real value.</span> A
            liquidity position is not a deposit, a savings product, or a guaranteed or fixed return; its value
            moves with the pool price and is subject to impermanent loss. By clicking Enter you confirm you
            understand and accept the{' '}
            <Link href="/legal" className="no-underline hover:underline" style={{ color: '#5A57DE', fontWeight: 600 }}>terms</Link>.
          </p>

          <label className="flex items-center gap-2.5 mt-5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="w-[15px] h-[15px] cursor-pointer accent-[#6C6CF0]"
            />
            <span className="text-[12.5px]" style={{ color: '#494957' }}>Do not show again</span>
          </label>

          <button
            onClick={enter}
            className="w-full mt-4 text-[14px] font-semibold py-3 rounded-full text-white cursor-pointer"
            style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }}
          >
            Enter
          </button>
        </div>
      </div>
    </div>
  )
}
