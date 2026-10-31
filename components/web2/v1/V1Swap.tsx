'use client'

// Swap — routes USDG → a curated-pool token through Mintware's own Robinhood-Chain pools (the "real pools per our
// criteria" story). The To list is the live curated set from /api/gateway/discover. On-chain routing turns on with
// the first deployed pool + the V4 quoter/router (v4SwapExec seam) — until then the card is fully designed and
// honest about that, never a fake quote. Mineral: the ticket is a raised card, amounts sit in inset wells, the
// route is drawn as discs, and the not-yet-built execution step carries the hatched "planned" texture.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Pool = { poolAddress: string; pairLabel: string; live: boolean }

const WELL = { background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }

const symbolOf = (p: Pool) => (p.pairLabel || p.poolAddress).replace(/\s*\/\s*USDG.*/i, '')

export function V1Swap() {
  const [pools, setPools] = useState<Pool[]>([])
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    fetch('/api/gateway/discover')
      .then((r) => r.json())
      .then((d) => setPools(d?.success && Array.isArray(d.pools) ? (d.pools as Pool[]) : []))
      .catch(() => {})
  }, [])

  const selected = useMemo(() => pools.find((p) => p.poolAddress === to) ?? null, [pools, to])
  const hasAmount = Number(amount) > 0
  // V1-06 fix (independent Codex audit, 2026-09-09): `selected.live` means "this pool has an ACTIVE
  // gateway deposit target" (the registry's deposit-eligibility flag) — it says nothing about whether
  // an actual swap-execution path exists for it. This component never calls executeV4Swap (the seam
  // this file's own header comment names) or any router/quoter — there is no real swap capability
  // wired here at all yet, so the button must never claim otherwise regardless of a pool's live flag.
  // Keep the picker/preview fully interactive; just never enable submission until routing genuinely
  // exists (per the remediation: explicitly unavailable, not a fake "Swap" label on a no-op button).
  // V1-06 fix, copy corrected on review: deployment alone doesn't implement execution — say so plainly
  // rather than implying it's just waiting on pools to go live (a router/quoter still needs building).
  const btn = !to ? 'Select a token' : !hasAmount ? 'Enter an amount' : 'Swap execution not live yet'
  const btnEnabled = false
  const toSymbol = selected ? symbolOf(selected) : 'Token'

  return (
    <div className="max-w-[1040px] mx-auto grid gap-8 grid-cols-[minmax(0,1fr)] min-[940px]:grid-cols-[minmax(0,460px)_1fr] items-start">
      {/* The ticket */}
      <div>
        <div className="text-[12.5px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#4643D1' }}>Swap · Robinhood Chain</div>
        <h1 className="font-geist font-semibold tracking-[-0.04em] leading-[1.04] text-[clamp(1.9rem,3.6vw,2.6rem)] mt-2.5">Swap into <span style={{ color: '#62626F' }}>a curated pool.</span></h1>
        <p className="text-[15px] leading-[1.6] mt-3" style={{ color: '#454552' }}>
          Routes through Mintware&rsquo;s own Robinhood-Chain pools — the same curated set you can provide USDG to.
        </p>

        <div className="mt-6 rounded-[24px] p-3.5 mw-raise-lg">
          {/* From */}
          <div className="rounded-[18px] p-4" style={WELL}>
            <div className="flex justify-between text-[12px] font-medium" style={{ color: '#62626F' }}>
              <span>You pay</span><span>Balance —</span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              <input
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Amount of USDG to swap"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="bg-transparent outline-none font-mono text-[30px] tracking-[-0.03em] w-full min-w-0"
                style={{ color: '#15151D' }}
              />
              <span className="flex items-center gap-2 shrink-0 pl-1.5 pr-3 py-1.5 rounded-full mw-raise-sm">
                <span className="w-6 h-6 rounded-full grid place-items-center text-[9.5px] font-bold" style={{ background: '#E9F3EE', color: '#0F5F37', boxShadow: 'inset 0 1px 0 #fff' }}>$G</span>
                <span className="font-semibold text-[14px]">USDG</span>
              </span>
            </div>
          </div>

          {/* flip — decorative: the direction is fixed (USDG in) */}
          <div className="flex justify-center -my-3 relative z-10" aria-hidden="true">
            <span className="w-10 h-10 rounded-[12px] grid place-items-center mw-raise-sm" style={{ color: '#454552', boxShadow: 'var(--mw-raise-sm), 0 0 0 4px #fff' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
            </span>
          </div>

          {/* To */}
          <div className="rounded-[18px] p-4" style={WELL}>
            <div className="flex justify-between text-[12px] font-medium" style={{ color: '#62626F' }}>
              <span>You receive</span>
              {selected && (
                <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: selected.live ? '#0F7A43' : '#62626F' }}>
                  <span className={`w-1.5 h-1.5 rounded-full ${selected.live ? '' : 'mw-tex-dots'}`} style={{ background: selected.live ? '#22A45D' : '#C9C0F4' }} />
                  {selected.live ? 'Live pool' : 'Curating'}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              <span className="font-mono text-[30px] tracking-[-0.03em]" style={{ color: '#8A8A96' }}>—</span>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Token to receive"
                className="shrink-0 max-w-[60%] pl-3 pr-2 py-2 rounded-full font-semibold text-[14px] outline-none cursor-pointer mw-raise-sm focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)]"
                style={{ color: to ? '#15151D' : '#454552', border: 'none' }}
              >
                <option value="">Select token</option>
                {pools.map((p) => (
                  <option key={p.poolAddress} value={p.poolAddress} style={{ color: '#111' }}>
                    {symbolOf(p)}{p.live ? '' : ' (curating)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* review */}
          <div className="px-2.5 pt-4 pb-3 flex flex-col gap-2.5 text-[13px]" style={{ color: '#62626F' }}>
            <Row k="Route" v="Mintware curated pool" />
            <Row k="Max slippage" v="1.0%" />
            <Row k="Network" v="Robinhood Testnet" />
          </div>

          <button
            disabled={!btnEnabled}
            className={`w-full text-[15px] font-semibold min-h-[52px] rounded-[14px] border-0 cursor-pointer disabled:cursor-default ${btnEnabled ? 'mw-btn' : ''}`}
            style={btnEnabled ? undefined : { background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)', color: '#62626F' }}
          >
            {btn}
          </button>
        </div>

        <p className="text-[13px] mt-4" style={{ color: '#62626F' }}>
          <Link href="/v1" className="no-underline hover:underline" style={{ color: '#4643D1', fontWeight: 600 }}>Browse pools →</Link>{' '}
          · <Link href="/legal" className="no-underline hover:underline" style={{ color: '#4643D1', fontWeight: 600 }}>Legal →</Link>
        </p>
      </div>

      {/* How it routes + what's live */}
      <div className="flex flex-col gap-5 min-[940px]:pt-[132px]">
        <div className="rounded-[24px] p-6 mw-raise">
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#62626F' }}>How it routes</div>
          <div className="mt-5 flex items-center gap-2" role="img" aria-label={`USDG, through a Mintware curated pool, into ${toSymbol}`}>
            <RouteNode label="USDG" sub="You pay" tone="usdg" />
            <RouteArrow />
            <RouteNode label="Curated pool" sub="Mintware, Robinhood Chain" tone="pool" />
            <RouteArrow />
            <RouteNode label={toSymbol} sub="You receive" tone="token" />
          </div>
          <p className="text-[14px] leading-[1.55] mt-5 mb-0" style={{ color: '#454552' }}>
            One hop, through a pool that has passed curation. No outside aggregator choosing a venue for you.
          </p>
        </div>

        <div className="rounded-[24px] p-6 mw-raise-sm">
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: '#62626F' }}>What works today</div>
          <ul className="mt-4 p-0 list-none flex flex-col gap-3">
            <Status tex="solid" t="Curated pools" d="The pool list above is live from Discover, on testnet." />
            <Status tex="solid" t="Providing liquidity" d="Put USDG into a live pool from its market page." />
            <Status tex="hatch" t="Swap execution" d="The router and quoter aren’t built yet, so this ticket can’t submit." />
          </ul>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span style={{ color: '#15151D' }} className="font-medium">{v}</span>
    </div>
  )
}

function RouteArrow() {
  return (
    <span className="shrink-0" style={{ color: '#8A8A96' }} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    </span>
  )
}

function RouteNode({ label, sub, tone }: { label: string; sub: string; tone: 'usdg' | 'pool' | 'token' }) {
  const disc = tone === 'usdg'
    ? { background: '#E9F3EE', color: '#0F5F37' }
    : tone === 'pool'
      ? { background: 'linear-gradient(160deg,#F0ECFD,#C9C0F4)', color: '#3A2C8C' }
      : { background: 'linear-gradient(160deg,#E4E4FE,#A9A7FA)', color: '#2E2BA8' }
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center text-center">
      <span className="w-11 h-11 rounded-full grid place-items-center" style={{ ...disc, boxShadow: 'inset 0 1px 0 #fff, var(--mw-raise-sm)' }}>
        {tone === 'pool'
          ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="8" rx="8" ry="3" /><path d="M4 8v4c0 1.7 3.6 3 8 3s8-1.3 8-3V8M4 12v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4" /></svg>
          : <span className="text-[11px] font-bold">{tone === 'usdg' ? '$G' : label.slice(0, 2).toUpperCase()}</span>}
      </span>
      <span className="text-[13px] font-semibold mt-2 truncate max-w-full">{label}</span>
      <span className="text-[11.5px] mt-0.5 truncate max-w-full" style={{ color: '#62626F' }}>{sub}</span>
    </div>
  )
}

/** Status line using the Mineral textures: solid = live, hatched = planned. */
function Status({ tex, t, d }: { tex: 'solid' | 'hatch'; t: string; d: string }) {
  return (
    <li className="flex gap-3.5 items-start">
      <span
        className={`shrink-0 mt-1 w-4 h-4 rounded-[5px] ${tex === 'hatch' ? 'mw-tex-hatch' : ''}`}
        style={{ backgroundColor: tex === 'solid' ? '#7C7AF0' : '#ECECF2', boxShadow: tex === 'hatch' ? 'var(--mw-inset)' : 'none' }}
        aria-hidden="true"
      />
      <div>
        <div className="text-[14.5px] font-semibold">{t} <span className="text-[12px] font-semibold ml-1" style={{ color: tex === 'solid' ? '#0F7A43' : '#62626F' }}>{tex === 'solid' ? 'Live on testnet' : 'Not built yet'}</span></div>
        <div className="text-[13.5px] leading-[1.5] mt-0.5" style={{ color: '#454552' }}>{d}</div>
      </div>
    </li>
  )
}
