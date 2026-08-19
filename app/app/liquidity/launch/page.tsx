'use client'

// /app/liquidity/launch — the community-matched launch flow (MintwareMatchedLiquidityVault).
//
// The mechanic is the hero: a team commits its TOKEN as one side; the community funds the quote
// (USDC) up to a target, and the team's token pairs PROPORTIONALLY as the fill arrives — whatever
// isn't matched by the deadline refunds to the team. The on-chain `activate()` does exactly this:
//     matchedTokens = teamTokens × matched / target   ·   refund = teamTokens − matchedTokens
// and only goes live once community fill ≥ activationThreshold (+ ≥3 backers). The interactive
// preview on the right makes that visceral — drag the fill and watch the pair form and the remainder
// come back. This screen only RECORDS intent (a social_vaults row); an operator deploys the real
// Foundry vault + backfills the address. Testnet, unaudited — nothing here is an offer.

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { erc20Abi, isAddress } from 'viem'
import { useChainId, usePublicClient, useSignMessage } from 'wagmi'
import { MwNav } from '@/components/web2/MwNav'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { signedOrgFetch } from '@/lib/org/signedFetch'

const MIN_LOCK_DAYS = 90

function fmt(n: number, max = 4): string {
  if (!Number.isFinite(n)) return '0'
  if (n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  return n.toLocaleString(undefined, { maximumFractionDigits: max })
}
function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  if (n >= 1_000) return `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export default function MatchedLaunch() {
  const { address } = useMintwareIdentity()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { signMessageAsync } = useSignMessage()

  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [symbol, setSymbol] = useState('')
  const [teamTokens, setTeamTokens] = useState('')     // team-side commitment
  const [targetUsdc, setTargetUsdc] = useState('')     // community quote target
  const [thresholdPct, setThresholdPct] = useState(50) // min fill to activate (%)
  const [lockDays, setLockDays] = useState(90)

  const [fillPct, setFillPct] = useState(65)           // preview only — the interactive fill
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ id: string; name: string } | null>(null)
  const [err, setErr] = useState('')

  // Auto-resolve the token symbol from chain (best-effort, non-blocking).
  useEffect(() => {
    let cancelled = false
    if (!isAddress(token) || !publicClient) { return }
    publicClient
      .readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: 'symbol' })
      .then((s) => { if (!cancelled) setSymbol(String(s).slice(0, 16)) })
      .catch(() => { if (!cancelled) setSymbol('') })
    return () => { cancelled = true }
  }, [token, publicClient])

  const committed = Number(teamTokens) || 0
  const target = Number(targetUsdc) || 0
  const fill = Math.min(100, Math.max(0, fillPct)) / 100

  // The exact contract mechanic, previewed at the chosen fill.
  const preview = useMemo(() => {
    const matchedUsdc = target * fill
    const pairedTokens = committed * fill
    const refundTokens = committed - pairedTokens
    const pricePerToken = committed > 0 ? target / committed : 0 // USDC per token at full fill
    const live = fillPct >= thresholdPct
    return { matchedUsdc, pairedTokens, refundTokens, pricePerToken, live }
  }, [target, committed, fill, fillPct, thresholdPct])

  const tkr = symbol || 'TOKEN'
  const canSubmit =
    !!address && !!name.trim() && isAddress(token) && committed > 0 && target > 0 &&
    thresholdPct > 0 && thresholdPct <= 100 && lockDays >= MIN_LOCK_DAYS && !busy

  async function submit() {
    if (!canSubmit || !address) return
    setBusy(true); setErr(''); setDone(null)
    try {
      const res = await signedOrgFetch({
        path: '/api/vaults/matched',
        action: 'mintware-vault-matched',
        address,
        signMessageAsync,
        payload: {
          teamWallet: address, projectToken: token, name: name.trim(), symbol,
          teamTokens: committed, targetUsdc: target, thresholdBps: Math.round(thresholdPct * 100),
          lockDays, chainId,
        },
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j?.error || 'Could not record the launch.'); return }
      setDone({ id: j.id, name: j.name })
    } catch (e) {
      setErr(e instanceof Error && e.message.includes('rejected') ? 'Signature declined.' : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  const pairedW = Math.round(fill * 100)

  return (
    <div className="min-h-screen bg-white font-atx-display text-ink">
      <MwNav />
      <main className="mx-auto max-w-[1040px] px-6 max-[700px]:px-4 py-[44px]">
        <Link href="/app/liquidity" className="text-[12px] text-ink-soft hover:text-ink no-underline">← All liquidity models</Link>

        <div className="mt-4 text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep">Community-matched launch</div>
        <h1 className="font-atx-display font-bold text-[clamp(1.8rem,4.4vw,2.6rem)] leading-[1.06] tracking-[-0.03em] mt-3 max-w-[16ch]">
          Your token pairs as the crowd <span className="text-gradient-accent">fills in.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.12rem)] leading-[1.5] max-w-[60ch] mt-4">
          Commit your token on one side. The community funds the USDC side up to your target — and your
          token pairs proportionally with every dollar that arrives. Whatever isn&apos;t matched by the
          deadline comes straight back to you.
        </p>

        <div className="grid grid-cols-[1fr_minmax(340px,440px)] max-[880px]:grid-cols-1 gap-6 mt-9 items-start">
          {/* ── Config ─────────────────────────────────────────── */}
          <div className="soft-card p-5 flex flex-col gap-4">
            <Field label="Pool name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme launch pool"
                className="mw-in" maxLength={80} />
            </Field>

            <Field label="Your token" hint={symbol ? `Detected: ${symbol}` : undefined}>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x… token address"
                className="mw-in font-mono text-[13px]" spellCheck={false} />
            </Field>

            <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
              <Field label="Token to commit" hint="one side of the pair">
                <div className="mw-in-wrap">
                  <input value={teamTokens} onChange={(e) => setTeamTokens(e.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal" placeholder="0" className="mw-in mw-in-bare" />
                  <span className="mw-in-suffix">{tkr}</span>
                </div>
              </Field>
              <Field label="Target to raise" hint="community USDC side">
                <div className="mw-in-wrap">
                  <span className="mw-in-prefix">$</span>
                  <input value={targetUsdc} onChange={(e) => setTargetUsdc(e.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal" placeholder="0" className="mw-in mw-in-bare" />
                  <span className="mw-in-suffix">USDC</span>
                </div>
              </Field>
            </div>

            {committed > 0 && target > 0 && (
              <div className="text-[12px] text-ink-mid -mt-1">
                Implied price at full fill: <span className="font-semibold text-ink">{fmtUsd(preview.pricePerToken)}</span> / {tkr}
              </div>
            )}

            <Field label={`Go live at ${thresholdPct}% filled`} hint="+ at least 3 backers, on-chain">
              <input type="range" min={10} max={100} step={5} value={thresholdPct}
                onChange={(e) => setThresholdPct(Number(e.target.value))} className="mw-range" />
            </Field>

            <Field label="Team lock" hint="cliff before the team side can exit">
              <div className="flex gap-2">
                {[90, 180, 365].map((d) => (
                  <button key={d} onClick={() => setLockDays(d)}
                    className={`glass-pill px-3.5 py-2 text-[13px] cursor-pointer ${lockDays === d ? 'ring-2 ring-[var(--color-peri)] text-ink font-semibold' : 'text-ink-mid'}`}>
                    {d === 365 ? '1 year' : `${d} days`}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* ── Live proportional preview (the star) ───────────── */}
          <div className="soft-card p-5 sticky top-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft">Live preview</span>
              <span className="text-[11px] text-ink-soft">drag to simulate ↓</span>
            </div>

            {/* Fill slider */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[13px] text-ink-mid">Community fill</span>
                <span className="text-[22px] font-bold tracking-[-0.02em]">{fillPct}%</span>
              </div>
              <div className="relative">
                <input type="range" min={0} max={100} value={fillPct}
                  onChange={(e) => setFillPct(Number(e.target.value))} className="mw-range mw-range-lg" />
              </div>
            </div>

            {/* The pairing bar — paired grows, refund shrinks, threshold marker */}
            <div>
              <div className="relative h-[64px] rounded-[14px] overflow-hidden border border-hair bg-ground-cool">
                <div className="absolute inset-y-0 left-0 flex items-center justify-center transition-[width] duration-150"
                  style={{ width: `${pairedW}%`, background: 'linear-gradient(135deg, var(--color-peri), var(--color-peri-deep))' }}>
                  {pairedW >= 22 && <span className="text-white text-[12px] font-semibold px-2 truncate">{fmt(preview.pairedTokens)} {tkr} paired</span>}
                </div>
                <div className="absolute inset-y-0 right-0 flex items-center justify-center transition-[width] duration-150"
                  style={{ width: `${100 - pairedW}%` }}>
                  {(100 - pairedW) >= 22 && <span className="text-ink-soft text-[12px] font-medium px-2 truncate">{fmt(preview.refundTokens)} refund</span>}
                </div>
                {/* activation threshold marker */}
                <div className="absolute inset-y-0 w-[2px] bg-ink/40" style={{ left: `${thresholdPct}%` }} />
                <div className="absolute top-1 text-[9px] text-ink-soft -translate-x-1/2" style={{ left: `${thresholdPct}%` }}>live</div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[11px] text-ink-soft">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-peri)' }} />Paired now</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-ink/15" />Refunds to you</span>
              </div>
            </div>

            {/* Live figures */}
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Community raises" value={fmtUsd(preview.matchedUsdc)} />
              <Stat label={`${tkr} paired`} value={fmt(preview.pairedTokens)} />
              <Stat label={`${tkr} refunded`} value={fmt(preview.refundTokens)} sub="if it stops here" />
              <Stat label="Pool status" value={preview.live ? 'Live ✓' : 'Building'} tone={preview.live ? 'peri' : 'amber'} />
            </div>

            <div className={`rounded-[12px] px-3.5 py-2.5 text-[12px] leading-[1.45] ${preview.live ? 'bg-[color-mix(in_srgb,var(--color-peri)_10%,white)] text-peri-deep' : 'bg-[color-mix(in_srgb,var(--color-coral2)_12%,white)] text-ink-mid'}`}>
              {preview.live
                ? <>At {fillPct}% the pool clears your {thresholdPct}% threshold — it activates once ≥3 backers have joined. The unmatched {fmt(preview.refundTokens)} {tkr} returns to you.</>
                : <>Needs {thresholdPct - fillPct}% more to reach your activation threshold. Until then nothing is locked — backers can withdraw and your full commitment is refundable.</>}
            </div>
          </div>
        </div>

        {/* ── Submit ─────────────────────────────────────────── */}
        <div className="soft-card p-5 mt-6 flex items-center justify-between gap-4 max-[560px]:flex-col max-[560px]:items-stretch">
          <div className="text-[12.5px] text-ink-mid leading-[1.5] max-w-[62ch]">
            {done
              ? <span className="text-peri-deep font-semibold">Recorded “{done.name}”. An operator provisions the on-chain vault next — you&apos;ll be notified when the pairing window opens.</span>
              : err
                ? <span className="text-[var(--color-coral2)] font-semibold">{err}</span>
                : <>Recording your launch intent — you sign a message (no gas, no transfer). Testnet &amp; unaudited; the on-chain vault is deployed by an operator after review. Nothing here is an offer.</>}
          </div>
          {!done && (
            <button onClick={submit} disabled={!canSubmit}
              className="glass-pill px-6 py-3 text-[14px] font-semibold whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: canSubmit ? 'linear-gradient(135deg, var(--color-peri), var(--color-peri-deep))' : undefined, color: canSubmit ? '#fff' : undefined }}>
              {busy ? 'Signing…' : !address ? 'Connect to launch' : 'Record launch'}
            </button>
          )}
          {done && (
            <Link href="/app/liquidity" className="glass-pill px-6 py-3 text-[14px] font-semibold whitespace-nowrap no-underline text-ink">Done</Link>
          )}
        </div>
      </main>

      <style jsx global>{`
        .mw-in { width: 100%; background: var(--color-ground-cool, #f4f4fb); border: 1px solid var(--color-hair, rgba(0,0,0,0.08));
          border-radius: 12px; padding: 10px 12px; font-size: 14px; color: var(--color-ink, #1a1a1a); outline: none; }
        .mw-in:focus { border-color: var(--color-peri, #6C6CF0); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-peri) 18%, transparent); }
        .mw-in-wrap { display: flex; align-items: center; background: var(--color-ground-cool, #f4f4fb);
          border: 1px solid var(--color-hair, rgba(0,0,0,0.08)); border-radius: 12px; padding: 0 12px; }
        .mw-in-wrap:focus-within { border-color: var(--color-peri, #6C6CF0); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-peri) 18%, transparent); }
        .mw-in-bare { background: transparent; border: none; box-shadow: none; padding: 10px 0; }
        .mw-in-bare:focus { box-shadow: none; }
        .mw-in-prefix, .mw-in-suffix { font-size: 13px; color: var(--color-ink-soft, #8A8C9E); }
        .mw-in-prefix { margin-right: 4px; } .mw-in-suffix { margin-left: 6px; }
        .mw-range { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 999px;
          background: color-mix(in srgb, var(--color-peri) 22%, #e9e9f4); outline: none; }
        .mw-range-lg { height: 8px; }
        .mw-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%;
          background: #fff; border: 2px solid var(--color-peri, #6C6CF0); box-shadow: 0 1px 4px rgba(0,0,0,0.18); cursor: pointer; }
        .mw-range::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: #fff;
          border: 2px solid var(--color-peri, #6C6CF0); box-shadow: 0 1px 4px rgba(0,0,0,0.18); cursor: pointer; }
      `}</style>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-soft">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'peri' | 'amber' }) {
  return (
    <div className="rounded-[12px] border border-hair bg-ground-cool px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">{label}</div>
      <div className="text-[18px] font-bold tracking-[-0.02em] mt-0.5"
        style={{ color: tone === 'peri' ? 'var(--color-peri-deep)' : tone === 'amber' ? 'var(--color-coral2)' : undefined }}>
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-ink-soft mt-0.5">{sub}</div>}
    </div>
  )
}
