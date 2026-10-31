'use client'

import { useState } from 'react'
import { useChainId, useSwitchChain } from 'wagmi'
import { SUPPORTED_CHAINS } from '@/config/chains'

export function ChainSelector() {
  const chainId = useChainId()
  const { switchChain, isPending } = useSwitchChain()
  const [open, setOpen] = useState(false)

  const current = SUPPORTED_CHAINS.find(c => c.chain.id === chainId) ?? SUPPORTED_CHAINS[0]

  return (
    <div className="relative inline-block">
      <button
        className="mw-btn-quiet !min-h-[38px] !px-3 !rounded-full text-[13px] whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={isPending}
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      >
        <img
          src={current.logoUrl}
          alt={current.name}
          className="w-[18px] h-[18px] rounded-full object-cover bg-[#ECECF2] shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        {isPending ? 'Switching…' : current.name}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-60"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="mw-raise-lg absolute top-[calc(100%+6px)] right-0 z-[500] rounded-[16px] p-1.5 min-w-[180px] font-geist">
          {SUPPORTED_CHAINS.map(cfg => (
            <div
              key={cfg.chain.id}
              className="flex items-center gap-[9px] px-[12px] py-[9px] rounded-[11px] text-[14px] font-medium text-ink cursor-pointer transition-colors duration-100 hover:bg-[#F6F6FA]"
              style={cfg.chain.id === chainId ? { background: 'var(--mw-band)' } : undefined}
              tabIndex={0}
              onMouseDown={() => {
                if (cfg.chain.id !== chainId) switchChain({ chainId: cfg.chain.id })
                setOpen(false)
              }}
            >
              <img
                src={cfg.logoUrl}
                alt={cfg.name}
                className="w-[20px] h-[20px] rounded-full object-cover bg-[#ECECF2] shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              {cfg.name}
              {cfg.chain.id === chainId && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mw-peri-deep)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Current network" className="ml-auto"><path d="m5 12 4 4 10-10" /></svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
