'use client'

// Issuers lane — an issuer's view: their listed assets read live from chain (the RWA demo unit), and a
// "bring an asset to market" request that walks through curation. The request flow is simulated client-side —
// listing is an operator-run deploy today — so it is tagged and never submits anything.

import { useState } from 'react'
import Link from 'next/link'
import { RwaIssuerConsole } from '@/components/rwa/RwaIssuerConsole'
import { LaneHeader, Label, PLAIN } from './LaneHeader'

const TYPES = ['Stock token', 'Land', 'Water rights', 'Treasuries', 'Private credit', 'Stablecoin', 'Other']
const STAGES = [
  { t: 'Request received', d: 'Your asset, its token and where it trades.' },
  { t: 'Curation review', d: 'Token rules, issuer controls and market depth are checked by a person.' },
  { t: 'Market deployed', d: 'A dedicated engine is deployed for your pool and verified on-chain.' },
  { t: 'Live for holders', d: 'Holders can back the market and earn from its trading.' },
]

export function V1Issuers() {
  const [name, setName] = useState('')
  const [type, setType] = useState(TYPES[0])
  const [sent, setSent] = useState(false)

  return (
    <div>
      <LaneHeader
        eyebrow="Issuers"
        title="Your token."
        accent="Real liquidity."
        lede="Bring a tokenized asset to market with depth from day one, funded by its own holders. Your listed assets, and how a new one goes live."
        actions={<Link href="/issuers#talk" className="glass-pill-primary no-underline">Talk to us</Link>}
      />

      <div className="mt-9 flex items-center gap-3">
        <Label>Your listed assets</Label>
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: '#16A34A' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#16A34A' }} />Live on testnet
        </span>
      </div>
      <div className="mt-3">
        <RwaIssuerConsole />
      </div>

      <div className="mt-12 flex items-center gap-3">
        <Label>Bring an asset to market</Label>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full" style={{ color: '#8A8A9E', background: 'rgba(22,22,44,0.05)' }}>Simulated</span>
      </div>
      <div className="grid gap-5 mt-3 grid-cols-1 min-[900px]:grid-cols-[1fr_1fr]">
        <form
          className="rounded-[16px] p-6"
          style={PLAIN}
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) setSent(true) }}
        >
          <label className="block text-[12.5px] font-semibold" htmlFor="asset-name">Asset name</label>
          <input
            id="asset-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setSent(false) }}
            placeholder="e.g. Willow Creek Parcel 7"
            className="w-full mt-2 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            style={{ background: '#F7F7FB', border: '1px solid rgba(22,22,44,0.08)' }}
          />
          <div className="text-[12.5px] font-semibold mt-5">Asset type</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                className="text-[12.5px] font-medium px-3 py-1.5 rounded-full cursor-pointer"
                style={t === type ? { background: '#5A57DE', color: '#fff' } : { background: '#F7F7FB', color: '#494957', border: '1px solid rgba(22,22,44,0.08)' }}
              >
                {t}
              </button>
            ))}
          </div>
          <button type="submit" disabled={!name.trim()} className="glass-pill-primary w-full mt-6 disabled:opacity-50">Request a market</button>
        </form>

        <div className="rounded-[16px] p-6" style={PLAIN}>
          <div className="text-[13px] font-semibold">{sent ? `${name} · ${type}` : 'How a market goes live'}</div>
          <ol className="mt-4 flex flex-col gap-4">
            {STAGES.map((s, i) => {
              const state = !sent ? 'idle' : i === 0 ? 'done' : i === 1 ? 'active' : 'idle'
              return (
                <li key={s.t} className="flex gap-3">
                  <span
                    className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0"
                    style={state === 'done' ? { background: '#16A34A', color: '#fff' } : state === 'active' ? { background: '#5A57DE', color: '#fff' } : { background: '#F0F0F6', color: '#8A8A9E' }}
                  >
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <div>
                    <div className="text-[14px] font-semibold">{s.t}{state === 'active' && <span className="ml-2 text-[11.5px] font-semibold" style={{ color: '#5A57DE' }}>In progress</span>}</div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: '#8A8A9E' }}>{s.d}</div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
