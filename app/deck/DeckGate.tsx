'use client'

import { useState, type FormEvent } from 'react'

// On-brand password gate. Posts to /api/deck/unlock which sets the cookie; on success we
// reload so the server component re-runs and renders the deck.
export function DeckGate({ configured }: { configured: boolean }) {
  const [pw, setPw] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (status === 'loading') return
    setStatus('loading'); setMsg('')
    try {
      const res = await fetch('/api/deck/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean }
      if (res.ok && d.ok) { window.location.reload(); return }
      setStatus('error')
      setMsg(res.status === 503 ? 'The deck isn’t available just yet.' : 'That password didn’t work.')
    } catch {
      setStatus('error'); setMsg('Something went wrong — try again.')
    }
  }

  return (
    <main style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#191923',
      background: 'radial-gradient(46% 60% at 18% 8%, rgba(108,108,240,.20), transparent 62%), radial-gradient(40% 55% at 90% 30%, rgba(240,133,94,.16), transparent 60%), #F5F5FB',
    }}>
      <div style={{
        width: '100%', maxWidth: 420, background: '#fff', border: '1px solid rgba(22,22,44,.10)',
        borderRadius: 20, boxShadow: '0 1px 2px rgba(20,20,50,.05), 0 16px 44px -18px rgba(30,30,80,.24)',
        padding: '34px 32px', textAlign: 'center',
      }}>
        <svg width="46" height="46" viewBox="0 0 100 100" style={{ borderRadius: 13, boxShadow: '0 6px 16px -4px rgba(108,108,240,.6)' }} aria-hidden>
          <defs><linearGradient id="mwg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8A82F4" /><stop offset="1" stopColor="#6C6CF0" /></linearGradient></defs>
          <rect width="100" height="100" rx="22" fill="url(#mwg)" />
          <ellipse cx="50" cy="55.5" rx="35" ry="7" fill="#fff" />
          <path d="M32,55.5 A18,18 0 0 1 68,55.5 Z" fill="#fff" />
        </svg>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 24, letterSpacing: '-0.03em', margin: '18px 0 4px' }}>Mintware</h1>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#4C4CD6' }}>Investor deck</div>
        <p style={{ fontSize: 13.5, color: '#494957', lineHeight: 1.5, margin: '14px 0 22px' }}>
          This deck is private. Enter the password you were sent to view it.
        </p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoFocus
            aria-label="Deck password"
            style={{ width: '100%', padding: '13px 16px', borderRadius: 12, border: '1px solid rgba(22,22,44,.14)', fontSize: 15, fontFamily: 'inherit', outline: 'none', color: '#191923' }}
          />
          <button type="submit" disabled={status === 'loading' || !pw}
            style={{ width: '100%', padding: '13px 16px', borderRadius: 999, border: 0, background: '#4C4CD6', color: '#fff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', opacity: status === 'loading' || !pw ? 0.6 : 1 }}>
            {status === 'loading' ? 'Unlocking…' : 'Unlock the deck'}
          </button>
        </form>
        {status === 'error' && <div style={{ fontSize: 12.5, color: '#C85A38', marginTop: 12 }}>{msg}</div>}
        {!configured && <div style={{ fontSize: 11.5, color: '#8A8A9E', marginTop: 14 }}>Not yet configured — set <code>DECK_PASSWORD</code> to open the gate.</div>}
        <div style={{ fontSize: 11.5, color: '#8A8A9E', marginTop: 20 }}>
          Not an investor?{' '}
          <a href="/" style={{ color: '#4C4CD6', textDecoration: 'none', fontWeight: 600 }}>mintware.finance →</a>
        </div>
      </div>
    </main>
  )
}
