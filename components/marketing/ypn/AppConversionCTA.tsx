'use client'

// AppConversionCTA — COMING SOON conversion band. No "Launch app" (the account
// isn't live). Captures early-access emails to /api/waitlist.

import { useState } from 'react'
import Link from 'next/link'
import { YPN_CTA } from '@/constants/ypn-landing'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

export function AppConversionCTA() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'loading' || status === 'done') return
    setStatus('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Something went wrong')
      setStatus('done')
    } catch (err) {
      setErrMsg((err as Error).message)
      setStatus('error')
    }
  }

  return (
    <section className="border-b border-atx-ink [&_*]:rounded-none" style={{ backgroundImage: GRID_BG }}>
      <div className="mx-auto max-w-[1180px] px-6 py-[56px] max-[800px]:px-4 max-[800px]:py-[40px] grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-8 items-center max-[820px]:grid-cols-1">
        <div>
          <div className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55">{YPN_CTA.eyebrow}</div>
          <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.05] text-[clamp(24px,3.6vw,42px)] mt-3 max-w-[18ch]">
            {YPN_CTA.title}
          </h2>
          <p className="text-atx-ink/65 text-[15px] leading-[1.5] mt-3 max-w-[52ch]">{YPN_CTA.body}</p>
          <Link href={YPN_CTA.secondaryHref} className="inline-flex items-center mt-4 font-atx-mono text-[12px] uppercase tracking-[0.08em] text-atx-blue no-underline hover:underline min-h-[36px]">
            {YPN_CTA.secondaryCta} →
          </Link>
        </div>

        <div>
          {status === 'done' ? (
            <div className="font-atx-mono text-[13px] uppercase tracking-[0.08em] py-4 px-5 border border-atx-ink bg-atx-acid text-atx-ink">
              {YPN_CTA.successLabel}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              <div className="flex">
                <input
                  className="flex-1 min-w-0 py-3.5 px-4 bg-atx-bone border border-atx-ink border-r-0 font-atx-mono text-[13px] text-atx-ink outline-none focus:bg-white placeholder:text-atx-ink/40"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label="Email for early access"
                  required
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="py-3.5 px-5 bg-atx-blue text-white font-atx-mono text-[12px] uppercase tracking-[0.08em] border border-atx-blue cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  {status === 'loading' ? '…' : 'Get early access'}
                </button>
              </div>
              {status === 'error' && (
                <div className="font-atx-mono text-[11px] text-atx-clay">{errMsg || 'Something went wrong — try again.'}</div>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
