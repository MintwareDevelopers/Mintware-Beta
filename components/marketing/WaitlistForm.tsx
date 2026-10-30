'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'

export function WaitlistForm({ source, button = 'Join the waitlist' }: { source: string; button?: string }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, source }) })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error()
      setStatus('done')
    } catch { setStatus('error') }
  }
  if (status === 'done') return <p className="text-[14px] font-semibold text-mw-green">You&apos;re on the list.</p>
  return <form onSubmit={submit} className="flex flex-wrap gap-2 max-w-[520px]">
    <input className="min-w-[220px] flex-1 min-h-[48px] rounded-[12px] border-0 px-4 text-[15px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" aria-label="Email address" />
    <button className="mw-btn !min-h-[48px] !px-5" disabled={status === 'loading'}>{status === 'loading' ? '…' : button}</button>
    {status === 'error' && <span className="w-full text-[13px] text-mw-red">Could not submit. Try again.</span>}
  </form>
}
