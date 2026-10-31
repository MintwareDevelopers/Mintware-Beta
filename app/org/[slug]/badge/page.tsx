'use client'

// Embeddable treasury badge — a tiny, self-contained, iframe-able widget that names the org, says whether its
// Treasury yield vault is recorded, and links to the public treasury page. No balances or solvency claims (the
// treasury API keeps figures to members). No nav, no wallet, transparent background so it drops into any host.
// Framing is allowed for THIS path only (see next.config.mjs frame-ancestors exception).

import { use, useEffect, useState } from 'react'

export default function TreasuryBadge({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [info, setInfo] = useState<{ name: string; recorded: boolean; chain: string } | null>(null)

  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury`)
      .then((r) => r.json())
      .then((d) => setInfo({
        name: d?.org?.name ?? slug,
        recorded: !!d?.treasuryVaultAddress,
        chain: d?.treasuryChainId === 84532 ? 'Base Sepolia' : d?.treasuryChainId ? `chain ${d.treasuryChainId}` : '',
      }))
      .catch(() => setInfo({ name: slug, recorded: false, chain: '' }))
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
        <span style={{ width: 9, height: 9, borderRadius: 999, background: info?.recorded ? '#2A9E8A' : '#C2537A' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{info?.recorded ? 'Treasury on-chain' : 'Treasury'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8A8C9E' }}>{info?.chain ?? ''}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8 }}>{info?.name ?? '…'}</div>
      <div style={{ fontSize: 11, color: '#8A8C9E', marginTop: 8 }}>{info?.recorded ? 'View the vault · powered by Mintware' : 'Not set up yet · powered by Mintware'}</div>
    </a>
  )
}
