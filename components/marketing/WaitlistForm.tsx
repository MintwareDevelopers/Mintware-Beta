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
    <input className="min-w-[220px] flex-1 rounded-full border border-hair bg-white px-4 py-3 text-[14px] text-ink outline-none focus:border-peri" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" aria-label="Email address" />
    <button className="glass-pill-primary" disabled={status === 'loading'}>{status === 'loading' ? '…' : button}</button>
    {status === 'error' && <span className="w-full text-[13px] text-mw-red">Could not submit. Try again.</span>}
  </form>
}
