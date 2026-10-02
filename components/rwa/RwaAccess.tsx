'use client'

// V2-RWAs access screen — what every /app/rwa page shows until the visitor enters the V2 password
// (POST /api/v2/unlock → the same http-only cookie the Launch modal sets; lib/v2/rwaGate.ts). Mintware-branded,
// light-only. Nothing about the demo markets (addresses, hashes, numbers) is rendered or fetched before unlock.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MintwareMark } from '@/components/ui2/MintwareMark'

export function RwaAccess() {
  const router = useRouter()
  const [pw, setPw] = useState('')
  const [state, setState] = useState<{ busy: boolean; err?: string }>({ busy: false })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw) return
    setState({ busy: true })
    const res = await fetch('/api/v2/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      .catch(() => null)
    if (res?.ok) {
      router.refresh() // the layout re-renders server-side with the unlock cookie — same URL, now open
      return
    }
    const j = res ? await res.json().catch(() => ({})) : {}
    setState({ busy: false, err: j.error === 'wrong_password' ? 'That access code isn’t right.' : j.error === 'gate_not_configured' ? 'Partner access isn’t configured on this deploy.' : 'Something went wrong — try again.' })
  }

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[linear-gradient(180deg,#F3F2FE_0%,#FFFFFF_70%)] text-ink">
      <div className="mx-auto grid max-w-[1120px] grid-cols-[1.1fr_1fr] items-center gap-12 px-6 py-20 max-[860px]:grid-cols-1 max-sm:px-4 max-sm:py-12">
        <div>
          <div className="inline-flex items-center gap-2.5 rounded-full border border-hair bg-white px-3 py-1.5">
            <MintwareMark size={18} />
            <span className="text-[12px] font-semibold text-ink">Mintware RWA</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-peri-deep">Partner preview</span>
          </div>
          <h1 className="mt-6 max-w-[16ch] font-atx-display text-[clamp(2.2rem,4.6vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
            The liquidity engine for regulated RWAs on Base.
          </h1>
          <p className="mt-5 max-w-[56ch] text-[16px] leading-[1.6] text-ink-mid">
            Licensed issuers keep the licence and the compliance. Mintware gives each asset a market anchored to its
            appraisal, where idle liquidity keeps earning until a trade needs it.
          </p>
          <ul className="mt-7 grid gap-2.5 text-[14px] text-ink-mid">
            {[
              'Permissionless liquidity, compliant ownership',
              'Trades anchored to the appraised value',
              'Every step proven on-chain, with transactions you can open',
            ].map((t) => (
              <li key={t} className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 rounded-full bg-peri" />{t}</li>
            ))}
          </ul>
        </div>

        <form onSubmit={submit} className="rounded-[24px] border border-hair bg-white p-8 shadow-[0_16px_48px_rgba(23,23,31,0.08)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Partner access</div>
          <h2 className="mt-2 font-atx-display text-[24px] font-semibold tracking-[-0.02em]">Enter your access code</h2>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-mid">Use your Mintware V2 preview code. It opens the live RWA markets and their on-chain proofs.</p>
          <label htmlFor="rwa-code" className="sr-only">Access code</label>
          <input
            id="rwa-code"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Access code"
            className="mt-5 w-full rounded-[14px] border border-hair bg-[#FBFBFE] px-4 py-3 text-[15px] outline-none focus:border-peri"
          />
          {state.err && <p className="mt-2 text-[13px] text-[#B4532A]">{state.err}</p>}
          <button type="submit" disabled={state.busy || !pw} className="glass-pill-primary mt-5 w-full disabled:opacity-60">
            {state.busy ? 'Opening…' : 'Open RWA markets'}
          </button>
          <p className="mt-5 text-[11.5px] leading-[1.55] text-ink-soft">
            Testnet demonstration: fictional property, valueless test tokens, simulated lending yield, unaudited contracts.
            Nothing here is an offer of securities.
          </p>
        </form>
      </div>
    </main>
  )
}
