'use client'

// =============================================================================
// DemoBar — floating persona switcher, visible only in demo mode (?demo=…).
// Lets a presenter flip the connected wallet's Attribution persona live, so
// every personalized surface (profile, rewards, vault detail) updates
// deterministically. Purely a demo aid — see lib/web2/demoMode.ts.
// =============================================================================

import { useEffect, useState } from 'react'
import {
  DEMO_PERSONAS,
  getDemoPersona,
  setDemoPersona,
  personaLabel,
  type DemoPersona,
} from '@/lib/web2/demoMode'

export function DemoBar() {
  const [persona, setPersona] = useState<DemoPersona | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setPersona(getDemoPersona())
  }, [])

  if (!mounted || !persona) return null

  const pick = (p: DemoPersona) => {
    setDemoPersona(p)
    // reload so every score fetch re-runs with the new persona
    window.location.reload()
  }
  const exit = () => {
    setDemoPersona(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('demo')
    window.location.href = url.toString()
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] font-atx-mono
                 border border-atx-ink bg-atx-ink text-white shadow-[0_8px_30px_rgba(0,0,0,0.35)]
                 flex items-stretch [&_*]:rounded-none max-[560px]:bottom-2 max-[560px]:scale-90"
    >
      <div className="px-3.5 flex items-center gap-2 border-r border-white/20">
        <span className="w-[8px] h-[8px] bg-atx-acid border border-white/40 inline-block" />
        <span className="uppercase tracking-[0.14em] text-[10px] text-white/60">Demo</span>
      </div>
      <div className="flex">
        {DEMO_PERSONAS.map((p) => {
          const active = p === persona
          return (
            <button
              key={p}
              onClick={() => pick(p)}
              title={personaLabel(p)}
              className={`px-3.5 py-2.5 text-[11px] uppercase tracking-[0.08em] border-r border-white/15 transition-colors
                ${active ? 'bg-atx-acid text-atx-ink font-bold' : 'text-white/65 hover:text-white hover:bg-white/10'}`}
            >
              {p}
            </button>
          )
        })}
      </div>
      <button
        onClick={exit}
        title="Exit demo mode"
        className="px-3 text-white/50 hover:text-white text-[13px]"
      >
        ✕
      </button>
    </div>
  )
}
