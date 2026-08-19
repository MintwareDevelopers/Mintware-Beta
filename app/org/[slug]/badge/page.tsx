'use client'

// Embeddable solvency badge (#6) — a tiny, self-contained, iframe-able widget. Reads the same on-chain
// snapshot as the public treasury page and renders "backed & solvent · coverage X% · verified on-chain".
// No nav, no wallet, transparent background so it drops into any host. Framing is allowed for THIS path
// only (see next.config.mjs frame-ancestors exception); everything else stays frame-ancestors: none.

import { use, useEffect, useState } from 'react'

export default function TreasuryBadge({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [snap, setSnap] = useState<{ name: string; covPct: string; solvent: boolean; nav: string } | null>(null)

  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.snapshot) return setSnap({ name: d?.org?.name ?? slug, covPct: '—', solvent: false, nav: '—' })
        const n = Number(d.snapshot.navUsdc) / 1e6
        const nav = n >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`
        const covPct = d.snapshot.coverageBps === null ? '∞' : `${(d.snapshot.coverageBps / 100).toFixed(0)}%`
        setSnap({ name: d.org.name, covPct, solvent: d.snapshot.fullyCovered, nav })
      })
      .catch(() => setSnap({ name: slug, covPct: '—', solvent: false, nav: '—' }))
  }, [slug])

  return (
    <a
      href={`/org/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block', width: 300, textDecoration: 'none', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        border: '1px solid rgba(0,0,0,0.1)', borderRadius: 14, padding: 14, background: '#fff', color: '#171717',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: snap?.solvent ? '#2A9E8A' : '#C2537A' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{snap?.solvent ? 'Backed & solvent' : 'Treasury'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8A8C9E' }}>verified on-chain</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{snap?.covPct ?? '…'}</span>
        <span style={{ fontSize: 12, color: '#6b6b6b' }}>coverage · {snap?.nav ?? '…'} backed</span>
      </div>
      <div style={{ fontSize: 11, color: '#8A8C9E', marginTop: 8 }}>{snap?.name ?? slug} · powered by Mintware</div>
    </a>
  )
}
