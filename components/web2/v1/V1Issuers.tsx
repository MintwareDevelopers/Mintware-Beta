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
        actions={<Link href="/issuers#talk" className="mw-btn">Talk to us</Link>}
      />

      <div className="mt-9 flex items-center gap-3">
        <Label>Your listed assets</Label>
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: '#0F7A43' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#0F7A43' }} />Live on testnet
        </span>
      </div>
      <div className="mt-3">
        <RwaIssuerConsole />
      </div>

      <div className="mt-12 flex items-center gap-3">
        <Label>Bring an asset to market</Label>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full" style={{ color: '#62626F', background: 'rgba(22,22,44,0.05)' }}>Simulated</span>
      </div>
      <div className="grid gap-5 mt-3 grid-cols-1 min-[900px]:grid-cols-[1fr_1fr]">
        <form
          className="rounded-[20px] p-6"
          style={PLAIN}
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) setSent(true) }}
        >
          <label className="block text-[12.5px] font-semibold" htmlFor="asset-name">Asset name</label>
          <input
            id="asset-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setSent(false) }}
            placeholder="e.g. Willow Creek Parcel 7"
            className="w-full mt-2 min-h-[46px] rounded-[12px] px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)]"
            style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}
          />
          <div className="text-[12.5px] font-semibold mt-5">Asset type</div>
          <div className="flex flex-wrap gap-1.5 mt-2 p-1.5 rounded-[14px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
            {TYPES.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                aria-pressed={t === type}
                className="text-[13px] font-medium px-3 min-h-[34px] rounded-[10px] cursor-pointer border-0"
                style={t === type ? { background: '#fff', color: '#15151D', boxShadow: 'var(--mw-raise-sm)' } : { background: 'transparent', color: '#454552' }}
              >
                {t}
              </button>
            ))}
          </div>
          <button type="submit" disabled={!name.trim()} className="mw-btn w-full mt-6 !min-h-[48px] disabled:opacity-50 disabled:cursor-default">Request a market</button>
        </form>

        <div className="rounded-[20px] p-6" style={PLAIN}>
          <div className="text-[13px] font-semibold">{sent ? `${name} · ${type}` : 'How a market goes live'}</div>
          {/* Stage status is carried by the material, as on the landing: solid = done, dotted = in progress, hatched = ahead. */}
          <ol className="mt-5 p-0 list-none flex flex-col">
            {STAGES.map((s, i) => {
              const state = !sent ? 'idle' : i === 0 ? 'done' : i === 1 ? 'active' : 'idle'
              return (
                <li key={s.t} className="flex gap-3.5">
                  <div className="flex flex-col items-center">
                    <span
                      className={`w-8 h-8 rounded-full grid place-items-center text-[12px] font-bold shrink-0 ${state === 'active' ? 'mw-tex-dots' : state === 'idle' ? 'mw-tex-hatch' : ''}`}
                      style={state === 'done' ? { backgroundColor: '#0F7A43', color: '#fff' } : state === 'active' ? { backgroundColor: '#E1DBFA', color: '#2E1F7A', boxShadow: '0 0 0 2px rgba(91,91,230,.4)' } : { backgroundColor: '#F2F2F5', color: '#454552', boxShadow: 'var(--mw-inset)' }}
                    >
                      {state === 'done' ? '✓' : i + 1}
                    </span>
                    {i < STAGES.length - 1 && <span className="w-px flex-1 min-h-[14px] my-1" style={{ background: 'var(--mw-line)' }} />}
                  </div>
                  <div className="pb-4 pt-1">
                    <div className="text-[14px] font-semibold">{s.t}{state === 'active' && <span className="ml-2 text-[11.5px] font-semibold" style={{ color: '#4643D1' }}>In progress</span>}</div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: '#62626F' }}>{s.d}</div>
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
