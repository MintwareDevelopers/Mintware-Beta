'use client'

// Team · Activity — the reputation layer, surfaced for treasuries. Two halves:
//   1. Pool activity feed — LP deposits / swaps / referrals routed through the
//      org's pool. ILLUSTRATIVE: per-pool routing needs a deployed vault.
//   2. Top contributors — a LIVE leaderboard wired to the real Attribution
//      `${API}/leaderboard` endpoint (the same source the retail board uses).
//      Global reputation today; scopes to the org's pool once its vault is live.
//      Demo rows show only in dev/preview — real users never see fabricated wallets.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { API, shortAddr } from '@/lib/web2/api'
import { WalletDisplay } from '@/components/web3/WalletDisplay'

// ── Pool activity feed (illustrative) ──
type Kind = 'lp' | 'swap' | 'referral'
const KIND_META: Record<Kind, { label: string; cls: string; dot: string }> = {
  lp:       { label: 'LP committed', cls: 'text-peri-deep bg-[rgba(108,108,240,0.08)]', dot: 'var(--color-peri)' },
  swap:     { label: 'Swap routed',  cls: 'text-mw-green bg-mw-green-muted',            dot: 'var(--color-mw-green)' },
  referral: { label: 'Referral',     cls: 'text-coral2-deep bg-[rgba(240,120,110,0.1)]', dot: 'var(--color-coral2)' },
}
const FEED: { kind: Kind; wallet: string; detail: string; amt: string; when: string }[] = [
  { kind: 'lp',       wallet: '0x8a1f…d9e0', detail: 'into Growth ULV',        amt: '+$42,000', when: '2m ago' },
  { kind: 'swap',     wallet: '0x2b7d…0819', detail: 'ETH → USDC via pool',    amt: '$12,400',  when: '9m ago' },
  { kind: 'referral', wallet: '0x5c6d…3c4d', detail: 'brought 0x9f0e…b7c6',    amt: '+1 wallet', when: '21m ago' },
  { kind: 'lp',       wallet: '0x1a2b…3c4d', detail: 'into ETH / USDC pair',   amt: '+$8,900',  when: '34m ago' },
  { kind: 'swap',     wallet: '0x6e7f…8091', detail: 'USDC → ETH via pool',    amt: '$3,120',   when: '1h ago' },
  { kind: 'lp',       wallet: '0x3c4d…5e6f', detail: 'into Growth ULV',        amt: '+$27,500', when: '2h ago' },
]

// ── Contributors leaderboard (LIVE) ──
interface Entry { wallet: string; attribution_score?: number; referral_trade_points?: number }
type Metric = 'score' | 'referrals'
const metricVal = (e: Entry, m: Metric) => (m === 'score' ? e.attribution_score || 0 : e.referral_trade_points || 0)
const tierFor = (s = 0) => (s >= 800 ? 'Oracle' : s >= 500 ? 'Builder' : s >= 250 ? 'Signal' : 'Ghost')

const SHOW_SAMPLE = process.env.NEXT_PUBLIC_ATX_PREVIEW === 'true' || process.env.NODE_ENV === 'development'
const DEMO: Entry[] = [
  { wallet: '0x8a1f4c9b2d3e5a6f7089c1b2d3e4f5a6b7c8d9e0', attribution_score: 892, referral_trade_points: 264 },
  { wallet: '0x9f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6', attribution_score: 830, referral_trade_points: 408 },
  { wallet: '0x2b7d9e0f1a3c4b5d6e7f8091a2b3c4d5e6f70819', attribution_score: 861, referral_trade_points: 96 },
  { wallet: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d', attribution_score: 754, referral_trade_points: 72 },
  { wallet: '0x6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091', attribution_score: 712, referral_trade_points: 144 },
  { wallet: '0x3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f', attribution_score: 690, referral_trade_points: 216 },
  { wallet: '0x7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', attribution_score: 620, referral_trade_points: 288 },
]

export default function TeamActivity() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [metric, setMetric] = useState<Metric>('score')
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/leaderboard?limit=100`)
      const data = res.ok ? await res.json() : null
      const rows = Array.isArray(data) ? (data as Entry[]) : []
      if (rows.length > 0) { setEntries(rows); setLive(true) }
      else { setEntries(SHOW_SAMPLE ? DEMO : []); setLive(false) }
    } catch {
      setEntries(SHOW_SAMPLE ? DEMO : []); setLive(false)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const ranked = useMemo(
    () => [...entries].sort((a, b) => metricVal(b, metric) - metricVal(a, metric)).slice(0, 10).map((e, i) => ({ ...e, rank: i + 1, tier: tierFor(e.attribution_score) })),
    [entries, metric],
  )

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-atx-display font-medium text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Activity</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-peri" />Reputation layer</span>
      </div>
      <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[64ch] mt-2.5">See who’s driving your pool — the wallets committing liquidity, routing swaps, and referring others — and rank them by on-chain reputation. This is the Attribution layer, applied to your treasury.</p>

      <div className="grid grid-cols-[1fr_1.1fr] max-[880px]:grid-cols-1 gap-4 mt-6 items-start">
        {/* Pool activity feed */}
        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hair-soft">
            <span className="font-atx-display font-semibold text-[14px] text-ink">Pool activity</span>
            <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.08em] font-semibold text-peri-deep"><span className="w-[5px] h-[5px] rounded-full bg-peri" />Preview</span>
          </div>
          {FEED.map((f, i) => {
            const m = KIND_META[f.kind]
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-hair-soft last:border-0">
                <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: m.dot }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-ink truncate"><span className="font-mono">{f.wallet}</span> <span className="text-ink-mid">{f.detail}</span></div>
                  <div className="mt-0.5"><span className={`text-[9px] uppercase tracking-[0.06em] font-semibold rounded-full px-1.5 py-0.5 ${m.cls}`}>{m.label}</span> <span className="text-[10.5px] text-ink-soft">· {f.when}</span></div>
                </div>
                <span className="text-[13px] tabular-nums text-ink shrink-0">{f.amt}</span>
              </div>
            )
          })}
          <div className="px-5 py-3 text-[11px] text-ink-soft">Illustrative — per-pool routed activity populates once your vault is live on-chain.</div>
        </div>

        {/* Contributors leaderboard (LIVE) */}
        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-hair-soft flex-wrap">
            <div className="flex items-center gap-2.5">
              <span className="font-atx-display font-semibold text-[14px] text-ink">Top contributors</span>
              <span className={`inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.08em] font-semibold ${live ? 'text-mw-green' : 'text-ink-soft'}`}><span className={`w-[5px] h-[5px] rounded-full ${live ? 'bg-mw-green' : 'bg-ink-soft'}`} />{live ? 'Live' : 'Preview data'}</span>
            </div>
            <div className="flex gap-1 rounded-full bg-ground-cool p-0.5">
              {([['score', 'Attribution'], ['referrals', 'Referrals']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setMetric(k)} className={`text-[11px] uppercase tracking-[0.06em] font-semibold rounded-full px-2.5 py-1 transition-colors ${metric === k ? 'bg-white text-ink shadow-card' : 'text-ink-soft'}`}>{label}</button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-4 flex flex-col gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-lg bg-ground-cool mw-shimmer" />)}</div>
          ) : ranked.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-ink-mid">The contributor board populates from live Attribution data.<span className="block mt-1 text-[12px] text-ink-soft">Wallets are ranked the moment the service returns rows.</span></div>
          ) : (
            ranked.map((r) => (
              <div key={r.wallet} className="grid grid-cols-[36px_1fr_auto] items-center gap-2 px-5 py-2.5 border-b border-hair-soft last:border-0">
                <span className={`font-atx-display font-medium tabular-nums text-[15px] ${r.rank === 1 ? 'text-coral2-deep' : r.rank <= 3 ? 'text-peri-deep' : 'text-ink-soft'}`}>{String(r.rank).padStart(2, '0')}</span>
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${r.tier === 'Ghost' ? 'bg-ink-soft' : 'bg-peri'}`} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate"><WalletDisplay address={r.wallet} mono style={{ fontSize: 13, fontWeight: 600 }} /></div>
                    <div className="font-mono text-[10.5px] text-ink-soft truncate">{shortAddr(r.wallet)} · {r.tier}</div>
                  </div>
                </div>
                <span className="text-[14px] tabular-nums font-medium text-ink shrink-0">{metricVal(r, metric).toLocaleString()}<span className="text-[10px] text-ink-soft font-normal ml-1">{metric === 'score' ? 'pts' : 'refs'}</span></span>
              </div>
            ))
          )}
          <div className="px-5 py-3 text-[11px] text-ink-soft flex items-center gap-1.5 flex-wrap">
            <span>✴ Powered by Attribution — {live ? 'live data' : 'preview'}.</span>
            <Link href="/app/leaderboard" className="text-peri-deep font-medium no-underline">Global board →</Link>
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] border border-hair bg-ground-cool p-5 mt-4 max-w-[880px] flex items-start gap-3">
        <span className="w-[7px] h-[7px] rounded-full bg-peri mt-1.5 shrink-0" />
        <p className="text-[13px] text-ink-mid leading-[1.5]">The contributor board reads <span className="font-semibold text-ink">live Attribution scores</span> today (global reputation). Once your vault is deployed, it scopes to the wallets active in <span className="font-semibold text-ink">your</span> pool — and their reputation weights how rewards route back to them.</p>
      </div>
    </>
  )
}
