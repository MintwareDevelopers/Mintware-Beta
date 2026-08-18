'use client'

import { MwNav } from '@/components/web2/MwNav'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { API, shortAddr } from '@/lib/web2/api'
import { generateRefCode } from '@/lib/rewards/referral/utils'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

// Global reputation leaderboard — design v2 (Privy-esque).
const LABEL = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Entry {
  wallet: string
  attribution_score?: number
  referral_trade_points?: number
}

type Metric = 'score' | 'tree'
const TABS: Array<{ k: Metric; label: string }> = [
  { k: 'score', label: 'Attribution' },
  { k: 'tree', label: 'Referral tree' },
]
const metricVal = (e: Entry, m: Metric) =>
  m === 'score' ? (e.attribution_score || 0) : (e.referral_trade_points || 0)

const tierFor = (score = 0) => score >= 800 ? 'Oracle' : score >= 500 ? 'Builder' : score >= 250 ? 'Signal' : 'Ghost'
const TIER_CHIP: Record<string, string> = {
  Oracle: 'bg-coral2 text-white border-transparent',
  Builder: 'bg-peri text-white border-transparent',
  Signal: 'bg-[rgba(108,108,240,0.12)] text-peri-deep border-[rgba(108,108,240,0.3)]',
  Ghost: 'bg-transparent text-ink-soft border-hair',
}
const PODIUM = ['text-coral2-deep', 'text-peri-deep', 'text-ink-soft']
const STRIPE = ['bg-coral2', 'bg-peri', 'bg-ink-soft']
const fmt = (n: number) => n.toLocaleString()

// The sample board is shown ONLY in preview/dev — real users must never see fabricated rows.
const SHOW_SAMPLE =
  process.env.NEXT_PUBLIC_ATX_PREVIEW === 'true' ||
  process.env.NODE_ENV === 'development'

// ─── Demo fallback ─────────────────────────────────────────────────────────────
const DEMO_ENTRIES: Entry[] = [
  { wallet: '0x8a1f4c9b2d3e5a6f7089c1b2d3e4f5a6b7c8d9e0', attribution_score: 892, referral_trade_points: 264 },
  { wallet: '0x2b7d9e0f1a3c4b5d6e7f8091a2b3c4d5e6f70819', attribution_score: 861, referral_trade_points: 96 },
  { wallet: '0x5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d', attribution_score: 830, referral_trade_points: 312 },
  { wallet: '0x9f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6', attribution_score: 788, referral_trade_points: 408 },
  { wallet: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d', attribution_score: 754, referral_trade_points: 72 },
  { wallet: '0x6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091', attribution_score: 712, referral_trade_points: 144 },
  { wallet: '0x3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f', attribution_score: 690, referral_trade_points: 216 },
  { wallet: '0xa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70819', attribution_score: 651, referral_trade_points: 120 },
  { wallet: '0x7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', attribution_score: 620, referral_trade_points: 288 },
  { wallet: '0x4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5', attribution_score: 588, referral_trade_points: 48 },
  { wallet: '0x0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192', attribution_score: 559, referral_trade_points: 180 },
  { wallet: '0x8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70819', attribution_score: 521, referral_trade_points: 96 },
  { wallet: '0x5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6', attribution_score: 498, referral_trade_points: 156 },
  { wallet: '0x2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4', attribution_score: 470, referral_trade_points: 24 },
  { wallet: '0x9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b', attribution_score: 442, referral_trade_points: 132 },
  { wallet: '0x6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7', attribution_score: 410, referral_trade_points: 60 },
  { wallet: '0x3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5', attribution_score: 388, referral_trade_points: 108 },
  { wallet: '0x0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c', attribution_score: 355, referral_trade_points: 36 },
  { wallet: '0x7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708', attribution_score: 322, referral_trade_points: 72 },
  { wallet: '0x4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6', attribution_score: 298, referral_trade_points: 12 },
]

// ─── Content ──────────────────────────────────────────────────────────────────
function LeaderboardContent() {
  const { evmAddress } = useMintwareIdentity()
  const wallet = evmAddress?.toLowerCase() ?? ''

  const [entries, setEntries] = useState<Entry[]>([])
  const [metric, setMetric] = useState<Metric>('score')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sample, setSample] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const refCode = wallet ? generateRefCode(wallet) : ''
  const refLink = refCode ? `${typeof window !== 'undefined' ? window.location.origin : 'https://mintware.finance'}/ref/${refCode}` : ''
  function copyLink() {
    if (!refLink) return
    navigator.clipboard.writeText(refLink).catch(() => {})
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const loadBoard = useCallback(async () => {
    setLoading(true); setEntries([]); setError(false); setSample(false)
    try {
      const res = await fetch(`${API}/leaderboard?limit=100`)
      const data = res.ok ? await res.json() : null
      const rows = Array.isArray(data) ? (data as Entry[]) : []
      if (rows.length > 0) { setEntries(rows); setSample(false) }
      else if (SHOW_SAMPLE) { setEntries(DEMO_ENTRIES); setSample(true) }
      else { setEntries([]); setSample(false) }
    } catch {
      if (SHOW_SAMPLE) { setEntries(DEMO_ENTRIES); setSample(true) } else { setEntries([]); setSample(false) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadBoard() }, [loadBoard])

  const ranked = useMemo(() => {
    return [...entries]
      .sort((a, b) => metricVal(b, metric) - metricVal(a, metric))
      .map((e, i) => ({ ...e, rank: i + 1, tier: tierFor(e.attribution_score) }))
  }, [entries, metric])

  const total = ranked.length
  const me = wallet ? ranked.find((r) => r.wallet === wallet) : undefined
  const top3 = ranked.slice(0, 3)
  const top10 = ranked.slice(0, 10)
  const showUser = me && me.rank > 10
  const topScore = ranked.reduce((m, r) => Math.max(m, r.attribution_score || 0), 0)
  const unit = metric === 'score' ? '' : ' refs'

  return (
    <div className="bg-white min-h-screen font-atx-display text-ink overflow-x-clip">
      {/* Hero */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[72px] max-[800px]:py-[48px] text-center">
          {sample ? (
            <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Attribution · global rankings · preview data</div>
          ) : (
            <span className="live-chip"><span className="dot" aria-hidden />Attribution · global rankings · live</span>
          )}
          <h1 className="font-atx-display font-semibold text-ink mt-5 tracking-[-0.04em] leading-[1.02] text-[clamp(2rem,5vw,3.4rem)] max-w-[16ch] mx-auto [text-wrap:balance]">
            Reputation, <span className="text-gradient-accent">ranked.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.5] mt-5 max-w-[58ch] mx-auto">
            Every wallet has a history. Ranked by Attribution score and referral network.
          </p>
        </div>
      </section>

      {/* stat band */}
      <section className="border-b border-hair-soft bg-white">
        <div className="mx-auto max-w-[1180px] grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr] mw-reveal">
          {[
            ['Ranked wallets', loading ? '—' : String(total).padStart(3, '0'), 'by reputation'],
            ['Top score', loading ? '—' : String(topScore), 'attribution'],
            ['Your rank', me ? `#${me.rank}` : '—', me ? `${me.tier} · ${me.attribution_score || 0}` : loading ? 'loading…' : wallet ? 'not ranked yet' : 'connect'],
            ['Ranked by', metric === 'score' ? 'Attribution' : 'Referrals', 'switch below'],
          ].map(([l, v, sub], i) => (
            <div key={i} className={`px-7 py-4 max-[560px]:px-4 ${i < 3 ? 'border-r border-hair-soft' : ''}`}>
              <div className={`${LABEL} text-[9px] mb-1.5`}>{l}</div>
              <div className={`font-atx-display font-medium text-[15px] tabular-nums ${i === 1 ? 'text-coral2-deep' : i === 2 ? 'text-peri-deep' : 'text-ink'}`}>{v}</div>
              <div className="text-[10px] text-ink-soft mt-0.5 truncate">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Podium */}
      {!loading && top3.length > 0 && (
        <div className="max-w-[1180px] mx-auto px-7 pt-7 grid grid-cols-3 gap-[22px] max-[720px]:grid-cols-1 max-[560px]:px-4">
          {top3.map((r, i) => {
            const lead = i === 0
            return (
              <div key={r.wallet} className={`flex flex-col rounded-2xl overflow-hidden border ${lead ? 'border-[rgba(108,108,240,0.3)] bg-[rgba(108,108,240,0.08)]' : 'border-hair bg-white'}`}>
                {!lead && <div className={`h-[6px] ${STRIPE[i]}`} />}
                <div className="p-[16px_18px] flex flex-col flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`font-atx-display font-medium text-[34px] leading-none tabular-nums ${lead ? 'text-peri-deep' : PODIUM[i]}`}>{String(r.rank).padStart(2, '0')}</span>
                    {lead && <span className="text-[10px] font-semibold uppercase tracking-[0.1em] rounded-full border border-[rgba(108,108,240,0.3)] text-peri-deep px-2 py-0.5 flex items-center gap-1.5"><span className="w-[6px] h-[6px] rounded-full bg-peri inline-block animate-pulse" />Leader</span>}
                  </div>
                  <div className="mt-3 min-w-0">
                    <div className="font-atx-display font-medium text-[16px] tracking-tight truncate text-ink">
                      <WalletDisplay address={r.wallet} mono style={{ fontSize: 16, fontWeight: 600 }} />
                    </div>
                    <div className="text-[11px] mt-0.5 text-ink-soft">{shortAddr(r.wallet)} · {r.tier}</div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-hair-soft flex items-baseline gap-2">
                    <span className="font-atx-display text-[26px] font-medium tabular-nums text-ink">{fmt(metricVal(r, metric))}</span>
                    <span className="text-[11px] text-ink-soft">{unit.trim() || 'Attribution'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Board */}
      <section className="bg-ground-cool border-t border-hair-soft mt-7 mw-reveal">
        {/* Metric tabs */}
        <div className="max-w-[1180px] mx-auto px-7 pt-7 flex items-center gap-3.5 flex-wrap max-[560px]:px-4">
          <span className="font-atx-display text-[14px] font-medium rounded-full border border-hair px-3 py-2 bg-white text-ink tabular-nums">{String(total).padStart(2, '0')}</span>
          <div className="flex gap-1 rounded-full bg-white border border-hair p-1">
            {TABS.map((t) => (
              <button
                key={t.k}
                onClick={() => setMetric(t.k)}
                className={`text-[12px] uppercase tracking-[0.08em] font-semibold rounded-full px-3.5 py-1.5 transition-colors ${metric === t.k ? 'bg-peri text-white' : 'bg-transparent text-ink-mid hover:text-ink'} max-[560px]:px-3`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-ink-soft max-[560px]:hidden">updates every 5 min</span>
        </div>

        {/* Table */}
        <div className="max-w-[1180px] mx-auto px-7 py-7 max-[560px]:px-4">
          <div className="soft-card overflow-hidden">
            <div className="grid [grid-template-columns:60px_1fr_104px_repeat(2,110px)] max-[820px]:[grid-template-columns:52px_1fr_auto] border-b border-hair-soft bg-ground-cool">
              {['Rank', 'Wallet', 'Tier', 'Attribution', 'Tree'].map((h, i) => (
                <div key={h} className={`${LABEL} text-[9px] px-[16px] py-3 ${i >= 3 ? 'text-right max-[820px]:hidden' : ''} ${i === 2 ? 'max-[820px]:hidden' : ''}`}>{h}</div>
              ))}
              {/* mobile-only header for the currently selected metric */}
              <div className={`${LABEL} text-[9px] px-[16px] py-3 text-right hidden max-[820px]:block`}>{metric === 'tree' ? 'Tree' : 'Attribution'}</div>
            </div>

            {loading ? (
              <div className="p-4 flex flex-col gap-2">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-11 rounded-xl bg-ground-cool mw-shimmer" />)}
              </div>
            ) : error ? (
              <div className="px-5 py-14 text-center text-[14px] text-ink-mid">
                Couldn’t load the rankings.
                <span className="block mt-1.5 text-[12px] text-ink-soft">The Attribution service didn’t respond.</span>
                <button onClick={loadBoard} className="mt-3 glass-pill glass-pill-sm">Retry</button>
              </div>
            ) : ranked.length === 0 ? (
              <div className="px-5 py-14 text-center text-[14px] text-ink-mid">
                The global reputation board is coming soon.
                <span className="block mt-1.5 text-[12px] text-ink-soft">Build your Attribution score and referral tree — you’ll be ranked the moment it’s live.</span>
              </div>
            ) : (
              <>
                {top10.map((r) => <Row key={r.wallet} r={r} metric={metric} isMe={!!(wallet && r.wallet === wallet)} />)}
                {showUser && me && (
                  <>
                    <div className="text-center text-[11px] tracking-[0.3em] text-ink-soft py-2 border-b border-hair-soft">· · ·</div>
                    <Row r={me} metric={metric} isMe />
                  </>
                )}
              </>
            )}
          </div>

          {/* Your rank + invite */}
          {me && (
            <div className="mt-[22px] rounded-2xl border border-[rgba(108,108,240,0.3)] bg-[rgba(108,108,240,0.07)] p-[14px_18px] flex items-center gap-4 flex-wrap">
              <span className="font-atx-display font-medium text-[26px] tabular-nums text-peri-deep">#{me.rank}</span>
              <div className="min-w-0">
                <div className="font-atx-display font-medium text-[15px] truncate text-ink"><WalletDisplay address={me.wallet} mono style={{ fontSize: 15, fontWeight: 600 }} /> <span className="text-[11px] text-ink-soft">· {me.tier}</span></div>
                <div className="text-[11px] text-ink-mid">
                  {fmt(metricVal(me, metric))}{unit}
                  {ranked[me.rank - 2] && ` · ${fmt(metricVal(ranked[me.rank - 2], metric) - metricVal(me, metric))}${unit} to rank #${me.rank - 1}`}
                </div>
              </div>
              {refLink && (
                <button onClick={copyLink} className="ml-auto glass-pill-primary glass-pill-sm">
                  {linkCopied ? 'Copied ✓' : 'Copy invite link'}
                </button>
              )}
            </div>
          )}

          {/* Not connected / not ranked CTA */}
          {!loading && !me && (
            <div className="mt-[22px] soft-card p-[14px_18px] flex items-center gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="font-atx-display font-medium text-[15px] text-ink">{wallet ? 'You’re not on the board yet.' : 'Connect to see your rank.'}</div>
                <div className="text-[11px] text-ink-mid">Your Attribution score and referral tree earn your place.</div>
              </div>
              {refLink && (
                <button onClick={copyLink} className="ml-auto glass-pill-primary glass-pill-sm">
                  {linkCopied ? 'Copied ✓' : 'Copy invite link'}
                </button>
              )}
            </div>
          )}

          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-soft flex items-center gap-1.5 px-1 mt-6">
            ✴ Powered by Attribution
          </div>
        </div>
      </section>

      {/* How you climb — the "why", below the board */}
      <section className="border-t border-hair-soft bg-white">
        <div className="max-w-[1180px] mx-auto px-7 py-[52px] max-[560px]:px-4">
          <span className={`${LABEL} block mb-4`}>How you climb — ranks are earned by contribution</span>
          <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            {[
              { t: 'Attribution', d: 'Your whole on-chain history, scored across six signals — volume, trading, holding, liquidity, governance, sharing. It carries across 100+ chains.' },
              { t: 'Referral tree', d: 'The wallets you bring on-chain, weighted by how real and active they are. Quality over quantity.' },
            ].map((c) => (
              <div key={c.t} className="soft-card p-[16px_18px]">
                <span className="font-atx-display font-medium text-[15px] tracking-tight text-ink">{c.t}</span>
                <p className="text-ink-mid text-[13px] leading-[1.5] mt-2">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function Row({ r, metric, isMe }: { r: Entry & { rank: number; tier: string }; metric: Metric; isMe: boolean }) {
  const isTop = r.rank <= 3
  const rankCls = r.rank === 1 ? 'text-coral2-deep' : r.rank === 2 ? 'text-peri-deep' : r.rank === 3 ? 'text-ink-soft' : 'text-ink-soft'
  const col = (k: Metric) => (metric === k ? 'font-medium text-ink' : 'text-ink-mid')
  const tree = (r.referral_trade_points || 0)
  return (
    <div className={`grid [grid-template-columns:60px_1fr_104px_repeat(2,110px)] max-[820px]:[grid-template-columns:52px_1fr_auto] items-center border-b border-hair-soft last:border-b-0 ${isMe ? 'bg-[rgba(108,108,240,0.07)]' : ''}`} style={isMe ? { borderLeft: '2px solid var(--color-peri)' } : undefined}>
      <div className={`px-[16px] py-3.5 tabular-nums ${isTop ? `text-[18px] font-atx-display font-medium ${rankCls}` : `text-[15px] ${rankCls}`}`}>{String(r.rank).padStart(2, '0')}</div>
      <div className="px-[16px] py-3.5 min-w-0 flex items-center gap-2.5">
        <span className={`w-[7px] h-[7px] rounded-full shrink-0 inline-block ${r.tier === 'Ghost' ? 'bg-ink-soft' : 'bg-peri'}`} />
        <div className="min-w-0">
          <div className="font-atx-display font-medium text-[14px] tracking-tight truncate flex items-center gap-2 text-ink">
            <WalletDisplay address={r.wallet} mono style={{ fontSize: 14, fontWeight: 600 }} />
            {isMe && <span className="text-[9px] uppercase tracking-[0.1em] font-semibold text-peri-deep rounded-full border border-[rgba(108,108,240,0.3)] px-1.5 py-0.5">you</span>}
          </div>
          <div className="font-mono text-[11px] text-ink-soft truncate">{shortAddr(r.wallet)}</div>
        </div>
      </div>
      <div className="px-[16px] py-3.5 max-[820px]:hidden">
        <span className={`text-[10px] uppercase tracking-[0.06em] font-semibold px-2 py-1 rounded-full border ${TIER_CHIP[r.tier]}`}>{r.tier}</span>
      </div>
      <div className={`px-[16px] py-3.5 text-right text-[15px] tabular-nums max-[820px]:hidden ${col('score')}`}>{r.attribution_score || 0}</div>
      <div className={`px-[16px] py-3.5 text-right text-[15px] tabular-nums max-[820px]:hidden ${col('tree')}`}>{tree}</div>
      {/* mobile-only: the currently selected metric's value */}
      <div className="px-[16px] py-3.5 text-right text-[15px] tabular-nums font-medium text-ink hidden max-[820px]:block">{metric === 'tree' ? tree : (r.attribution_score || 0)}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  return (
    <>
      <MwNav />
      <LeaderboardContent />
    </>
  )
}
