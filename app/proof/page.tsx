'use client'

// /proof — a public, shareable "proof of life": the most recent end-to-end testnet run of the YPN loop,
// rendered from lib/proof/latestRun.ts (single source of truth — update that file after each run). Every
// tx hash links to a block explorer; a live read of the Arc vault's current NAV shows on-chain state now.
// Testnet + unaudited throughout — real hashes, valueless test USDC.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { LATEST_RUN, STAGED_LIQUIDITY_RUN, CARD_RAIL, FORMAL_VERIFICATION, SECURITY_AUDIT, SECURITY_AUDIT_R2, AUDIT_MATRIX, txUrl, addrUrl, shortHash, type Decision, type ProofLeg } from '@/lib/proof/latestRun'

const KIND: Record<Decision['kind'], string> = {
  ok: 'text-mw-green bg-[rgba(22,163,74,0.10)]',
  warn: 'text-mw-amber bg-[rgba(196,122,0,0.10)]',
  stop: 'text-[#C0392B] bg-[rgba(209,67,67,0.10)]',
}
const chip = (cls: string) =>
  `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold font-atx-display ${cls}`

export default function ProofPage() {
  const run = LATEST_RUN
  const [live, setLive] = useState<{ ok: boolean; totalAssetsUsdc?: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/proof/vault')
      .then((r) => r.json())
      .then((d) => setLive(d))
      .catch(() => setLive({ ok: false }))
  }, [])

  const share = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(typeof window !== 'undefined' ? window.location.href : '').then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      })
    }
  }

  return (
    <div className="min-h-screen bg-white text-ink">
      <MwNav />
      <main className="mx-auto max-w-[900px] px-6 max-[700px]:px-4 py-[44px]">
        {/* hero */}
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display">
          Yield Payment Network · executed on-chain
        </div>
        <h1 className="font-atx-display font-bold text-[clamp(2rem,5.4vw,3.1rem)] leading-[1.04] tracking-[-0.03em] mt-3.5">
          The whole loop,<br /><span className="text-gradient-accent">run live on testnet.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.18rem)] leading-[1.5] max-w-[62ch] mt-5">
          Deposit → earn → authorize → spend, plus a native USDC bridge — every leg executed on-chain, with
          real transaction hashes you can open in a block explorer. The plumbing working end to end, not a mock-up.
        </p>

        {/* honesty banner */}
        <div className="rounded-[16px] border border-hair p-4 mt-6 text-[13.5px] text-ink-mid leading-[1.55]"
          style={{ background: 'linear-gradient(120deg, rgba(196,122,0,0.09), var(--color-ground-deep, #EEEEF7))' }}>
          <b className="text-ink">Testnet · unaudited · valueless test USDC.</b> Everything below ran on Circle’s
          Arc testnet ({'5042002'}) and Base Sepolia ({'84532'}). Vaults are empty, nothing is an offer, and
          external audit remains the gate before real value. The hashes are real; the dollars are not.
        </div>

        {/* run facts + live NAV + share */}
        <div className="grid grid-cols-4 max-[760px]:grid-cols-2 gap-3 mt-6">
          <Fact label="Run date" value={run.date} />
          <Fact label="Networks" value="Arc + Base Sepolia" />
          <Fact label="Signer" value={shortHashAddr(run.signer)} mono />
          <div className="rounded-[16px] border border-hair bg-white shadow-card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">Vault right now</div>
            <div className="font-atx-display font-semibold text-[17px] mt-1 tabular-nums flex items-center gap-2">
              {live == null ? (
                <span className="text-ink-soft">reading…</span>
              ) : live.ok ? (
                <>
                  <span>${live.totalAssetsUsdc}</span>
                  <span className="live-chip"><span className="dot" aria-hidden />live</span>
                </>
              ) : (
                <span className="text-ink-soft text-[13px]">unavailable</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button onClick={share} className="glass-pill glass-pill-primary glass-pill-sm">
            {copied ? 'Link copied ✓' : 'Copy shareable link'}
          </button>
          <span className="text-[12px] text-ink-soft">Anyone with the link can view — no wallet, no sign-in.</span>
        </div>

        {/* legs */}
        <div className="mt-10 flex flex-col gap-4">
          {run.legs.map((leg) => <LegCard key={leg.n} leg={leg} />)}
        </div>

        {/* Second proven flow — staged-buffer liquidity loop */}
        <div className="mt-14 pt-2 border-t border-hair">
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display mt-8">
            {STAGED_LIQUIDITY_RUN.eyebrow}
          </div>
          <h2 className="font-atx-display font-bold text-[clamp(1.7rem,4.4vw,2.5rem)] leading-[1.06] tracking-[-0.03em] mt-3">
            {STAGED_LIQUIDITY_RUN.title}<br /><span className="text-gradient-accent">{STAGED_LIQUIDITY_RUN.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(0.98rem,2vw,1.12rem)] leading-[1.5] max-w-[62ch] mt-4">
            {STAGED_LIQUIDITY_RUN.subtitle}
          </p>
          <div className="mt-8 flex flex-col gap-4">
            {STAGED_LIQUIDITY_RUN.legs.map((leg) => <LegCard key={leg.n} leg={leg} />)}
          </div>
          <div className="mt-6 overflow-x-auto rounded-[16px] border border-hair shadow-card">
            <table className="w-full border-collapse text-[13px] min-w-[520px]">
              <thead>
                <tr className="bg-ground-cool">
                  {['Contract', 'Network', 'Address'].map((h) => (
                    <th key={h} className="text-left font-atx-display text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft px-4 py-3 border-b border-hair">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STAGED_LIQUIDITY_RUN.contracts.map((c) => (
                  <tr key={c.address} className="border-b border-hair-soft last:border-0">
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3 text-ink-mid">Base Sepolia</td>
                    <td className="px-4 py-3">
                      <a href={addrUrl(c.chain, c.address)} target="_blank" rel="noopener" className="font-mono text-[12px] text-peri-deep no-underline hover:underline">{c.short}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-ink-soft mt-4 max-w-[64ch]">
            The router is the real product bytecode; the yield source + pair vault here are an open-mint mock rig
            so the loop is self-contained. The real <span className="font-mono">AaveV3YieldAdapter</span> +{' '}
            <span className="font-mono">MintwareDeFiPairVault</span> implement the same interfaces (Forge-tested).{' '}
            <Link href="/app/liquidity/staged" className="text-peri-deep no-underline hover:underline">Try it live →</Link>
          </p>
        </div>

        {/* Card rail — honest status board (NOT a proven on-chain run) */}
        <div className="mt-14 pt-2 border-t border-hair">
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display mt-8">
            {CARD_RAIL.eyebrow}
          </div>
          <h2 className="font-atx-display font-bold text-[clamp(1.7rem,4.4vw,2.5rem)] leading-[1.06] tracking-[-0.03em] mt-3">
            {CARD_RAIL.title}<br /><span className="text-gradient-accent">{CARD_RAIL.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(0.98rem,2vw,1.12rem)] leading-[1.5] max-w-[62ch] mt-4">{CARD_RAIL.blurb}</p>

          <div className="mt-6 flex flex-col gap-3">
            {CARD_RAIL.points.map((p) => (
              <div key={p.label} className="soft-card p-5 flex items-start gap-4 max-[560px]:flex-col max-[560px]:gap-2">
                <div className="flex items-center gap-2.5 min-w-[150px]">
                  <span className="font-atx-display font-semibold text-[15px] tracking-[-0.01em]">{p.label}</span>
                  <span className={chip(
                    p.status === 'proven' ? 'text-mw-green bg-[rgba(22,163,74,0.10)]'
                    : p.status === 'service' ? 'text-peri-deep bg-[rgba(108,108,240,0.10)]'
                    : 'text-mw-amber bg-[rgba(196,122,0,0.10)]')}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {p.status === 'proven' ? 'Proven call' : p.status === 'service' ? 'Live service' : 'Wired · off by default'}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-[13.5px] text-ink-mid leading-[1.55]">{p.note}</p>
                  {p.txHash && (
                    <a href={txUrl(p.chain ?? 'base-sepolia', p.txHash)} target="_blank" rel="noopener"
                      className="inline-block mt-1.5 font-mono text-[12px] rounded-lg px-2.5 py-1 no-underline text-peri-deep bg-[rgba(108,108,240,0.10)] hover:bg-[rgba(108,108,240,0.18)]">
                      {shortHash(p.txHash)} · {(p.chain ?? 'base-sepolia') === 'arc' ? 'arcscan' : 'basescan'} ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4 max-w-[64ch]">
            Proven end-to-end on 2026-08-20: a real sandbox swipe authorized off live NAV, then a
            card-originated settleSpend burned $2 of senior shares on-chain (linked above). The one
            still-dormant piece is the AUTOMATIC capture path (off by default). This same run also
            surfaced a real bug — the settle core was marking a reverted tx as settled — now fixed.{' '}
            <Link href="/app/org" className="text-peri-deep no-underline hover:underline">The card surface →</Link>
          </p>
        </div>

        {/* Formal verification — proofs, not just tests */}
        <div className="mt-14 pt-2 border-t border-hair">
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display mt-8">
            {FORMAL_VERIFICATION.eyebrow}
          </div>
          <h2 className="font-atx-display font-bold text-[clamp(1.7rem,4.4vw,2.5rem)] leading-[1.06] tracking-[-0.03em] mt-3">
            {FORMAL_VERIFICATION.title}<br /><span className="text-gradient-accent">{FORMAL_VERIFICATION.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(0.98rem,2vw,1.12rem)] leading-[1.5] max-w-[62ch] mt-4">{FORMAL_VERIFICATION.blurb}</p>

          <div className="mt-6 flex flex-col gap-2.5">
            {FORMAL_VERIFICATION.props.map((p) => (
              <div key={p.claim} className="soft-card p-4 flex items-start gap-3.5 max-[560px]:flex-col max-[560px]:gap-2">
                <span className={`${chip(p.method === 'coq' ? 'text-mw-green bg-[rgba(22,163,74,0.10)]' : 'text-peri-deep bg-[rgba(108,108,240,0.10)]')} shrink-0 min-w-[168px] justify-center`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {p.method === 'coq' ? 'Coq · machine-checked' : 'Halmos · symbolic'}
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] text-ink leading-[1.5] font-medium">{p.claim}</p>
                  <p className="text-[11.5px] text-ink-soft font-mono mt-0.5">{p.target}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4 max-w-[64ch]">
            {FORMAL_VERIFICATION.note}{' '}
            <Link href="/the-math" className="text-peri-deep no-underline hover:underline">The math →</Link>
          </p>
        </div>

        {/* Security self-assessment — audit-readiness exercise + remediation */}
        <div className="mt-14 pt-2 border-t border-hair">
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display mt-8">
            {SECURITY_AUDIT.eyebrow}
          </div>
          <h2 className="font-atx-display font-bold text-[clamp(1.7rem,4.4vw,2.5rem)] leading-[1.06] tracking-[-0.03em] mt-3">
            {SECURITY_AUDIT.title}<br /><span className="text-gradient-accent">{SECURITY_AUDIT.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(0.98rem,2vw,1.12rem)] leading-[1.5] max-w-[62ch] mt-4">{SECURITY_AUDIT.blurb}</p>

          <div className="grid grid-cols-4 max-[720px]:grid-cols-2 gap-3 mt-6">
            {SECURITY_AUDIT.stats.map((m) => (
              <div key={m.label} className="rounded-[16px] border border-hair bg-white shadow-card p-4">
                <div className="font-atx-display font-bold text-[1.7rem] tracking-[-0.02em] tabular-nums">
                  {m.value}<span className="text-peri-deep text-[1.1rem]"> {m.sub}</span>
                </div>
                <div className="text-[12px] text-ink-mid mt-1 leading-[1.4]">{m.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-2">
            {SECURITY_AUDIT.fixes.map((f) => (
              <div key={f.title} className="soft-card p-4 flex items-start gap-3">
                <span className={chip(f.sev === 'H' ? 'text-[#C0392B] bg-[rgba(209,67,67,0.10)]' : f.sev === 'M' ? 'text-mw-amber bg-[rgba(196,122,0,0.10)]' : 'text-mw-green bg-[rgba(22,163,74,0.10)]') + ' shrink-0'}>
                  {f.sev === 'H' ? 'High' : f.sev === 'M' ? 'Med' : 'Low'}
                </span>
                <p className="text-[13.5px] text-ink leading-[1.5] min-w-0 flex-1">{f.title}</p>
                <span className={chip('text-mw-green bg-[rgba(22,163,74,0.10)]') + ' shrink-0'}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />{f.status}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4 max-w-[64ch]">{SECURITY_AUDIT.note}</p>
        </div>

        {/* Security self-assessment · ROUND 2 — re-audited our own fixes */}
        <div className="mt-14 pt-2 border-t border-hair">
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display mt-8">
            {SECURITY_AUDIT_R2.eyebrow}
          </div>
          <h2 className="font-atx-display font-bold text-[clamp(1.7rem,4.4vw,2.5rem)] leading-[1.06] tracking-[-0.03em] mt-3">
            {SECURITY_AUDIT_R2.title}<br /><span className="text-gradient-accent">{SECURITY_AUDIT_R2.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(0.98rem,2vw,1.12rem)] leading-[1.5] max-w-[62ch] mt-4">{SECURITY_AUDIT_R2.blurb}</p>

          <div className="grid grid-cols-4 max-[720px]:grid-cols-2 gap-3 mt-6">
            {SECURITY_AUDIT_R2.stats.map((m) => (
              <div key={m.label} className="rounded-[16px] border border-hair bg-white shadow-card p-4">
                <div className="font-atx-display font-bold text-[1.7rem] tracking-[-0.02em] tabular-nums">
                  {m.value}<span className="text-peri-deep text-[1.1rem]"> {m.sub}</span>
                </div>
                <div className="text-[12px] text-ink-mid mt-1 leading-[1.4]">{m.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-2">
            {SECURITY_AUDIT_R2.fixes.map((f) => (
              <div key={f.title} className="soft-card p-4 flex items-start gap-3">
                <span className={chip(f.sev === 'H' ? 'text-[#C0392B] bg-[rgba(209,67,67,0.10)]' : f.sev === 'M' ? 'text-mw-amber bg-[rgba(196,122,0,0.10)]' : 'text-mw-green bg-[rgba(22,163,74,0.10)]') + ' shrink-0'}>
                  {f.sev === 'H' ? 'High' : f.sev === 'M' ? 'Med' : 'Low'}
                </span>
                <p className="text-[13.5px] text-ink leading-[1.5] min-w-0 flex-1">{f.title}</p>
                <span className={chip('text-mw-green bg-[rgba(22,163,74,0.10)]') + ' shrink-0'}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />{f.status}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4 max-w-[64ch]">{SECURITY_AUDIT_R2.note}</p>
        </div>

        {/* Defense-in-depth matrix — round 3, layer-shaped */}
        <div className="mt-14 pt-2 border-t border-hair">
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep font-atx-display mt-8">
            {AUDIT_MATRIX.eyebrow}
          </div>
          <h2 className="font-atx-display font-bold text-[clamp(1.7rem,4.4vw,2.5rem)] leading-[1.06] tracking-[-0.03em] mt-3">
            {AUDIT_MATRIX.title}<br /><span className="text-gradient-accent">{AUDIT_MATRIX.titleAccent}</span>
          </h2>
          <p className="text-ink-mid text-[clamp(0.98rem,2vw,1.12rem)] leading-[1.5] max-w-[62ch] mt-4">{AUDIT_MATRIX.blurb}</p>

          <div className="grid grid-cols-4 max-[720px]:grid-cols-2 gap-3 mt-6">
            {AUDIT_MATRIX.stats.map((m) => (
              <div key={m.label} className="rounded-[16px] border border-hair bg-white shadow-card p-4">
                <div className="font-atx-display font-bold text-[1.7rem] tracking-[-0.02em] tabular-nums">
                  {m.value}<span className="text-peri-deep text-[1.1rem]"> {m.sub}</span>
                </div>
                <div className="text-[12px] text-ink-mid mt-1 leading-[1.4]">{m.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-2">
            {AUDIT_MATRIX.layers.map((l) => (
              <div key={l.n} className="soft-card p-4 flex items-start gap-3.5 max-[560px]:flex-col max-[560px]:gap-2">
                <span className="font-mono text-[12px] text-peri-deep tabular-nums shrink-0 pt-0.5">{l.n}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-atx-display font-semibold text-[14.5px] tracking-[-0.01em] text-ink">{l.name}</span>
                    <span className="font-mono text-[11px] text-ink-soft">{l.tool}</span>
                  </div>
                  <p className="text-[12.5px] leading-[1.5] text-ink-mid mt-1">{l.note}</p>
                </div>
                <span className={chip(l.status === 'green' ? 'text-mw-green bg-[rgba(22,163,74,0.10)]' : 'text-mw-amber bg-[rgba(196,122,0,0.10)]') + ' shrink-0'}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />{l.status === 'green' ? 'Green' : 'Env-blocked'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-ink-soft mt-4 max-w-[64ch]">{AUDIT_MATRIX.note}</p>
        </div>

        {/* tests */}
        <h2 className="font-atx-display font-semibold text-[clamp(1.4rem,3vw,1.8rem)] tracking-[-0.02em] mt-12">The suites behind it</h2>
        <p className="text-ink-mid text-[15px] mt-2 max-w-[64ch]">The on-chain run rides code that is green across every layer — Solidity, Rust, and the property-based invariants where money can be lost.</p>
        <div className="grid grid-cols-4 max-[720px]:grid-cols-2 gap-3 mt-5">
          {run.tests.map((m) => (
            <div key={m.label} className="rounded-[16px] border border-hair bg-white shadow-card p-4">
              <div className="font-atx-display font-bold text-[1.7rem] tracking-[-0.02em] tabular-nums">
                {m.value}<span className="text-peri-deep text-[1.1rem]"> {m.sub}</span>
              </div>
              <div className="text-[12px] text-ink-mid mt-1 leading-[1.4]">{m.label}</div>
            </div>
          ))}
        </div>

        {/* contracts */}
        <div className="mt-8 overflow-x-auto rounded-[16px] border border-hair shadow-card">
          <table className="w-full border-collapse text-[13px] min-w-[520px]">
            <thead>
              <tr className="bg-ground-cool">
                {['Contract', 'Network', 'Address'].map((h) => (
                  <th key={h} className="text-left font-atx-display text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft px-4 py-3 border-b border-hair">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.contracts.map((c) => (
                <tr key={c.address} className="border-b border-hair-soft last:border-0">
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-ink-mid">{c.chain === 'arc' ? 'Arc' : 'Base Sepolia'}</td>
                  <td className="px-4 py-3">
                    <a href={addrUrl(c.chain, c.address)} target="_blank" rel="noopener" className="font-mono text-[12px] text-peri-deep no-underline hover:underline">{c.short}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[12px] text-ink-soft mt-8">
          Recorded {run.date} · {run.networkLabel} · unaudited. To reproduce or extend the run, see the deploy
          scripts in <span className="font-mono">contracts-v4/script</span> and the runbook{' '}
          <span className="font-mono">docs/developers/session-handoff-arc.md</span>.{' '}
          <Link href="/yield-payment-network" className="text-peri-deep no-underline hover:underline">What is YPN? →</Link>
        </p>
      </main>
    </div>
  )
}

function LegCard({ leg }: { leg: ProofLeg }) {
  return (
    <div className="soft-card p-6 max-[560px]:p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-atx-display font-bold text-[15px] text-white w-[32px] h-[32px] rounded-[10px] grid place-items-center shrink-0"
          style={{ background: 'linear-gradient(135deg,var(--color-peri-mid),var(--color-peri))', boxShadow: '0 3px 10px rgba(108,108,240,.35)' }}>
          {leg.n}
        </span>
        <h2 className="font-atx-display font-semibold text-[17px] tracking-[-0.02em]">{leg.title}</h2>
        <span className={chip(leg.status === 'proven' ? 'text-mw-green bg-[rgba(22,163,74,0.10)]' : 'text-peri-deep bg-[rgba(108,108,240,0.10)]')}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />{leg.statusLabel}
        </span>
        <span className="font-mono text-[11px] text-ink-soft w-full">{leg.where}</span>
      </div>
      <p className="text-[13.5px] text-ink-mid leading-[1.55] mt-3">{leg.desc}</p>

      {leg.deltas && (
        <div className="mt-3.5 border-t border-hair-soft">
          {leg.deltas.map((d) => (
            <div key={d.k} className="grid grid-cols-[1fr_auto] gap-3 py-2.5 border-b border-hair-soft text-[13px] items-center">
              <span className="text-ink-mid">{d.k}</span>
              <span className="font-mono text-[12.5px] tabular-nums">
                {d.before && <span className="text-ink-soft">{d.before}</span>}
                {d.before && <span className="text-peri px-1.5">→</span>}
                <span className="text-ink font-semibold">{d.after}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {leg.decisions && (
        <div className="mt-3.5 overflow-x-auto rounded-[12px] border border-hair">
          <table className="w-full border-collapse text-[13px] min-w-[480px]">
            <thead>
              <tr className="bg-ground-cool">
                {['Request', 'Decision', 'Reason', 'Latency'].map((h) => (
                  <th key={h} className="text-left font-atx-display text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft px-3.5 py-2.5 border-b border-hair">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leg.decisions.map((dec) => (
                <tr key={dec.req} className="border-b border-hair-soft last:border-0">
                  <td className="px-3.5 py-2.5 font-mono text-[12px]">{dec.req}</td>
                  <td className="px-3.5 py-2.5"><span className={chip(KIND[dec.kind])}><span className="w-1.5 h-1.5 rounded-full bg-current" />{dec.label}</span></td>
                  <td className="px-3.5 py-2.5 text-ink-mid">{dec.reason}</td>
                  <td className="px-3.5 py-2.5 font-mono text-peri-deep font-semibold">{dec.latency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {leg.txs && (
        <div className="mt-3.5 flex flex-col gap-2">
          {leg.txs.map((t) => (
            <div key={t.hash} className="flex items-center gap-2.5 flex-wrap text-[12.5px]">
              <span className="font-atx-display font-semibold text-[11px] uppercase tracking-[0.06em] text-ink-soft min-w-[108px]">{t.label}</span>
              <a href={txUrl(t.chain, t.hash)} target="_blank" rel="noopener"
                className="font-mono text-[12px] rounded-lg px-2.5 py-1 no-underline text-peri-deep bg-[rgba(108,108,240,0.10)] hover:bg-[rgba(108,108,240,0.18)]">
                {shortHash(t.hash)}
              </a>
              <span className="text-[11px] text-ink-soft">{t.chain === 'arc' ? 'arcscan' : 'basescan'} ↗{t.note ? ` · ${t.note}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[16px] border border-hair bg-white shadow-card p-4">
      <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{label}</div>
      <div className={`font-semibold text-[15px] mt-1 ${mono ? 'font-mono text-[12.5px]' : 'font-atx-display'}`}>{value}</div>
    </div>
  )
}

function shortHashAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}
