'use client'

// CardsCTA — COMING SOON conversion (email waitlist → /api/waitlist) for /cards.
// v2 Privy-esque: rendered inside the signature pastel GradientPanel. No launch.
// Sibling to components/marketing/ypn/AppConversionCTA.tsx (same pattern, cards copy).

import { useState } from 'react'
import Link from 'next/link'
import { CARDS_CTA } from '@/constants/cards-landing'
import { GradientPanel } from '@/components/ui2/GradientPanel'

export function CardsCTA() {
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
    <section className="bg-ground-cool">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px]">
        <GradientPanel tone="periwinkle" className="p-12 max-[800px]:p-7">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-9 items-center max-[820px]:grid-cols-1">
            <div>
              <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{CARDS_CTA.eyebrow}</div>
              <h2 className="font-atx-display font-medium text-ink tracking-[-0.04em] leading-[1.05] text-[clamp(1.9rem,3.8vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
                {CARDS_CTA.title}
              </h2>
              <p className="text-ink-mid text-[15px] leading-[1.5] mt-3 max-w-[52ch]">{CARDS_CTA.body}</p>
              <Link href={CARDS_CTA.secondaryHref} className="inline-flex items-center mt-4 text-[13px] font-semibold text-peri-deep no-underline hover:underline">
                {CARDS_CTA.secondaryCta} →
              </Link>
            </div>

            <div>
              {status === 'done' ? (
                <div className="glass-pill w-full justify-center py-4 text-[14px] font-semibold">{CARDS_CTA.successLabel}</div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 min-w-0 py-3.5 px-4 rounded-full bg-white/80 backdrop-blur-[8px] border border-hair text-[14px] text-ink outline-none focus:border-[rgba(108,108,240,0.5)] placeholder:text-ink-soft"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-label="Email for early access"
                      required
                    />
                    <button type="submit" disabled={status === 'loading'} className="glass-pill whitespace-nowrap disabled:opacity-60">
                      {status === 'loading' ? '…' : 'Get early access'}
                    </button>
                  </div>
                  {status === 'error' && <div className="text-[11px] text-coral2-deep px-1">{errMsg || 'Something went wrong — try again.'}</div>}
                </form>
              )}
            </div>
          </div>
        </GradientPanel>
      </div>
    </section>
  )
}
