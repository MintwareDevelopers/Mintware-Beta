'use client'

// Public treasury page (#6) — the legitimacy artifact. Read-only, no wallet. Reads the org's converged
// treasury on-chain (NAV, coverage, junior buffer) via /api/orgs/:slug/treasury and shows a "backed &
// solvent, verified on-chain" badge. For a network state or an org this is the public proof that every
// member claim is backed. Deliberately one page — not an analytics platform.

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { MintwareMark } from '@/components/ui2/MintwareMark'

interface TreasuryResp {
  org: { id: string; name: string; slug: string; ownerWallet: string }
  treasuryVaultAddress: string | null
  treasuryChainId: number | null
  memberCount: number
  funded: boolean
  snapshot: {
    navUsdc: string
    coverageBps: number | null // null = fully covered (nothing at risk)
    deployedUsdc: string
    juniorBufferUsdc: string
    fullyCovered: boolean
  } | null
}

const usd = (atomic: string | undefined) => {
  const n = Number(atomic ?? '0') / 1e6
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}
const chainName = (id: number | null) => (id === 5042002 ? 'Circle Arc testnet' : id === 84532 ? 'Base Sepolia' : id ? `chain ${id}` : '—')
const explorer = (id: number | null, addr: string) =>
  id === 5042002 ? `https://testnet.arcscan.app/address/${addr}` : `https://sepolia.basescan.org/address/${addr}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function OrgTreasuryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [data, setData] = useState<TreasuryResp | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`/api/orgs/${slug}/treasury`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then(setData)
      .catch(() => setErr('Treasury not found.'))
  }, [slug])

  const embedSnippet = `<iframe src="${typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'}/org/${slug}/badge" width="320" height="120" style="border:0" title="Treasury solvency"></iframe>`
  const copy = () => {
    navigator.clipboard?.writeText(embedSnippet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const covPct = data?.snapshot ? (data.snapshot.coverageBps === null ? '∞' : `${(data.snapshot.coverageBps / 100).toFixed(0)}%`) : '—'
  const solvent = data?.snapshot?.fullyCovered ?? false

  return (
    <div className="min-h-screen font-atx-display bg-white text-ink overflow-x-clip">
      {/* slim public header */}
      <header className="border-b border-hair-soft">
        <div className="mx-auto max-w-[1000px] px-6 max-[700px]:px-4 h-[60px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 no-underline text-ink"><MintwareMark className="w-[22px] h-[22px]" /><span className="font-atx-display font-semibold text-[15px]">Mintware</span></Link>
          <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Public treasury</span>
        </div>
      </header>

      {err && <div className="mx-auto max-w-[1000px] px-6 py-24 text-center text-ink-soft">{err}</div>}

      {data && (
        <main className="mx-auto max-w-[1000px] px-6 max-[700px]:px-4 py-[64px] max-[700px]:py-[44px]">
          {/* Hero — name + the solvency badge */}
          <div className="flex items-start justify-between gap-6 max-[640px]:flex-col">
            <div>
              <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Treasury</div>
              <h1 className="font-atx-display font-semibold text-ink mt-2 tracking-[-0.04em] leading-[1.03] text-[clamp(2rem,5vw,3.4rem)]">
                {data.org.name}
              </h1>
              <p className="text-ink-mid text-[15px] leading-[1.5] mt-3 max-w-[52ch]">
                Member balances stay <span className="text-ink font-medium">spendable and par-safe</span> while the treasury keeps earning.
                Every claim is backed on-chain — <span className="text-ink font-medium">never idle, never locked, always yours.</span>
              </p>
            </div>
            {data.funded && data.snapshot ? (
              <div className={`shrink-0 rounded-[var(--radius-card)] border p-4 min-w-[220px] ${solvent ? 'border-[rgba(42,158,138,0.35)] bg-mw-green-muted' : 'border-hair bg-white'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-[9px] h-[9px] rounded-full ${solvent ? 'bg-mw-green' : 'bg-coral2'}`} />
                  <span className="text-[13px] font-semibold text-ink">{solvent ? 'Backed & solvent' : 'Coverage below floor'}</span>
                </div>
                <div className="font-atx-display font-semibold text-[30px] text-ink mt-2 tabular-nums leading-none">{covPct}</div>
                <div className="text-[11.5px] text-ink-soft mt-1">junior coverage of at-risk senior</div>
                <div className="text-[11px] text-ink-soft mt-3 pt-3 border-t border-hair-soft">Verified on-chain · {chainName(data.treasuryChainId)}</div>
              </div>
            ) : (
              <div className="shrink-0 rounded-[var(--radius-card)] border border-hair bg-white p-4 min-w-[220px]">
                <div className="text-[13px] font-semibold text-ink">Treasury not funded yet</div>
                <div className="text-[11.5px] text-ink-soft mt-1">No on-chain balance recorded.</div>
              </div>
            )}
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-4 max-[720px]:grid-cols-2 gap-3 mt-10">
            {[
              { k: 'Total backing (NAV)', v: data.snapshot ? usd(data.snapshot.navUsdc) : '—', s: 'par-backed senior claims' },
              { k: 'Coverage', v: covPct, s: 'junior first-loss cushion' },
              { k: 'Members', v: String(data.memberCount), s: 'active on the roster' },
              { k: 'Junior buffer', v: data.snapshot ? usd(data.snapshot.juniorBufferUsdc) : '—', s: 'first-loss reserve' },
            ].map((kpi) => (
              <div key={kpi.k} className="soft-card p-4">
                <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{kpi.k}</div>
                <div className="font-atx-display font-semibold text-[24px] text-ink mt-1.5 tabular-nums">{kpi.v}</div>
                <div className="text-[11.5px] text-ink-soft mt-1">{kpi.s}</div>
              </div>
            ))}
          </div>

          {/* On-chain proof strip */}
          {data.treasuryVaultAddress && (
            <div className="soft-card p-5 mt-4 flex items-center justify-between gap-4 max-[640px]:flex-col max-[640px]:items-start">
              <div>
                <div className="text-[13px] font-semibold text-ink">Proof of reserves</div>
                <p className="text-[12.5px] text-ink-mid leading-[1.5] mt-1 max-w-[62ch]">
                  The treasury is a Mintware vault where community capital is <span className="text-ink font-medium">senior (par, spendable)</span> and
                  the org's own capital is <span className="text-ink font-medium">junior (first-loss)</span>. Anyone can read the NAV and coverage on-chain.
                </p>
              </div>
              <a
                href={explorer(data.treasuryChainId, data.treasuryVaultAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-2 rounded-full bg-white border border-[rgba(108,108,240,0.3)] px-4 py-2 no-underline text-peri-deep font-medium text-[13px] hover:border-peri transition-colors"
              >
                <span className="font-mono text-[12px]">{short(data.treasuryVaultAddress)}</span> View on explorer →
              </a>
            </div>
          )}

          {/* Embeddable badge */}
          <div className="mt-10">
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mb-3">Embed the solvency badge</div>
            <div className="soft-card p-5">
              <p className="text-[12.5px] text-ink-mid leading-[1.5] mb-3">
                Put a live "backed &amp; solvent, verified on-chain" badge on your own site. It reads the same on-chain snapshot.
              </p>
              <div className="flex items-center gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
                <code className="flex-1 font-mono text-[11.5px] text-ink-mid bg-ground-cool rounded-[10px] px-3 py-2.5 overflow-x-auto whitespace-nowrap">{embedSnippet}</code>
                <button onClick={copy} className="shrink-0 rounded-full bg-peri text-white px-4 py-2 text-[13px] font-semibold hover:bg-peri-deep transition-colors">
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* honesty footer */}
          <div className="rounded-[var(--radius-card)] border border-hair bg-white p-5 mt-8 flex items-start gap-3">
            <span className="w-[7px] h-[7px] rounded-full bg-peri mt-1.5 shrink-0" />
            <p className="text-[12.5px] text-ink-mid leading-[1.55]">
              Mintware treasuries are <span className="font-semibold text-ink">in testing on testnet and not yet audited</span>. Figures are read live
              from the recorded vault; nothing here is an offer or a solicitation. External audit gates real value.
            </p>
          </div>
        </main>
      )}
    </div>
  )
}
