'use client'

// Public treasury page — read-only, no wallet. Shows the org's name, whether a Treasury yield vault is recorded,
// and that vault's address on the explorer so anyone can read it on-chain. The treasury API keeps financial
// figures to the org's own members, so this page makes no balance or solvency claims. (The retired senior/junior
// "backed & solvent" coverage view was removed 2026-10-31.)

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { MintwareMark } from '@/components/ui2/MintwareMark'

interface TreasuryResp {
  org: { id: string; name: string; slug: string; ownerWallet: string }
  treasuryVaultAddress: string | null
  treasuryChainId: number | null
  memberCount: number
  funded: boolean
}

const chainName = (id: number | null) => (id === 84532 ? 'Base Sepolia' : id ? `chain ${id}` : '—')
const explorer = (_id: number | null, addr: string) => `https://sepolia.basescan.org/address/${addr}`
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

  const embedSnippet = `<iframe src="${typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'}/org/${slug}/badge" width="320" height="120" style="border:0" title="Treasury on-chain"></iframe>`
  const copy = () => {
    navigator.clipboard?.writeText(embedSnippet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }


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
          {/* Hero — name + whether a vault is recorded */}
          <div className="flex items-start justify-between gap-6 max-[640px]:flex-col">
            <div>
              <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Treasury</div>
              <h1 className="font-atx-display font-semibold text-ink mt-2 tracking-[-0.04em] leading-[1.03] text-[clamp(2rem,5vw,3.4rem)]">
                {data.org.name}
              </h1>
              <p className="text-ink-mid text-[15px] leading-[1.5] mt-3 max-w-[52ch]">
                This organisation keeps its treasury in an on-chain Treasury yield vault. Anyone can read the vault directly on the explorer.
              </p>
            </div>
            <div className="shrink-0 rounded-[var(--radius-card)] border border-hair bg-white p-4 min-w-[220px]">
              <div className="flex items-center gap-2">
                <span className={`w-[9px] h-[9px] rounded-full ${data.treasuryVaultAddress ? 'bg-mw-green' : 'bg-coral2'}`} />
                <span className="text-[13px] font-semibold text-ink">{data.treasuryVaultAddress ? 'Vault recorded' : 'No vault recorded yet'}</span>
              </div>
              <div className="text-[11.5px] text-ink-soft mt-2">{data.treasuryVaultAddress ? `On ${chainName(data.treasuryChainId)}` : 'The owner has not set up Treasury yield.'}</div>
            </div>
          </div>

          {/* On-chain proof strip */}
          {data.treasuryVaultAddress && (
            <div className="soft-card p-5 mt-4 flex items-center justify-between gap-4 max-[640px]:flex-col max-[640px]:items-start">
              <div>
                <div className="text-[13px] font-semibold text-ink">Read it on-chain</div>
                <p className="text-[12.5px] text-ink-mid leading-[1.5] mt-1 max-w-[62ch]">
                  The Treasury yield vault is a standard ERC-4626 vault. Its total assets and every holder&apos;s shares are public on the explorer.
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
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mb-3">Embed the treasury badge</div>
            <div className="soft-card p-5">
              <p className="text-[12.5px] text-ink-mid leading-[1.5] mb-3">
                Put a small badge on your own site that links to this page and the vault on the explorer.
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
              Mintware treasuries are <span className="font-semibold text-ink">in testing on testnet and not yet audited</span>. Nothing here
              is an offer or a solicitation. External audit gates real value.
            </p>
          </div>
        </main>
      )}
    </div>
  )
}
