'use client'

// Investor entry to unlock the V2 vision (treasury OS, YPN, cards, agents). Types the password →
// POST /api/v2/unlock sets the cookie → the whole site flips from V1 (live LP Gateway) to V2.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useV2Mode } from '@/components/web2/V2ModeProvider'

export default function V2Unlock() {
  const router = useRouter()
  const isV2 = useV2Mode()
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'loading') return
    setStatus('loading')
    setErr('')
    try {
      const res = await fetch('/api/v2/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const d = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !d.ok) throw new Error(d.error === 'wrong_password' ? 'Wrong password.' : d.error ?? 'Unlock failed')
      router.push('/')
      router.refresh()
    } catch (e2) {
      setErr((e2 as Error).message)
      setStatus('error')
    }
  }

  async function lock() {
    await fetch('/api/v2/unlock', { method: 'DELETE' }).catch(() => {})
    router.refresh()
  }

  return (
    <div className="min-h-screen grid place-items-center bg-ground-cool font-atx-display px-6">
      <div className="w-full max-w-[400px]">
        <div className="text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep">Investors</div>
        <h1 className="font-atx-display font-semibold text-ink tracking-[-0.03em] text-[26px] mt-2">
          Unlock the full vision
        </h1>
        <p className="text-[14px] text-ink-mid mt-2 leading-[1.55]">
          The live product is the Robinhood Chain LP Gateway. Enter the password to view the full V2
          vision — treasury OS, the Yield Payment Network, cards, and agents.
        </p>

        {isV2 ? (
          <div className="mt-5 soft-card p-4 text-[13.5px] text-ink-mid">
            V2 vision is unlocked.{' '}
            <button onClick={lock} className="text-peri-deep font-semibold underline">Lock back to V1</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 flex flex-col gap-2.5">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="py-3 px-4 rounded-full bg-white border border-hair text-[14px] text-ink outline-none focus:border-[rgba(108,108,240,0.5)]"
              required
            />
            <button type="submit" disabled={status === 'loading'} className="glass-pill-primary disabled:opacity-60">
              {status === 'loading' ? '…' : 'Unlock the vision →'}
            </button>
            {status === 'error' && <div className="text-[12.5px] text-[#D14343]">{err}</div>}
          </form>
        )}
      </div>
    </div>
  )
}
