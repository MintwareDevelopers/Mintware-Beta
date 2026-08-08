'use client'

import { MwNav } from '@/components/web2/MwNav'
import { PageHero } from '@/components/web2/PageHero'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { API, shortAddr, daysUntil, fmtUSD } from '@/lib/web2/api'
import { generateRefCode } from '@/lib/rewards/referral/utils'
import { WalletDisplay } from '@/components/web3/WalletDisplay'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Campaign {
  id: string
  name: string
  status: string
  end_date?: string
  pool_usd?: number
  daily_payout_usd?: number
  actions?: Record<string, { label: string; points: number; per_day?: boolean; per_referral?: boolean; per_referred_trade?: boolean }>
}
interface Entry {
  wallet: string
  total_points?: number
  total_earned_usd?: number
  attribution_score?: number
  referral_trade_points?: number
}

type Metric = 'score' | 'points' | 'tree'
const TABS: Array<{ k: Metric; label: string }> = [
  { k: 'score', label: 'Attribution' },
  { k: 'points', label: 'Campaign points' },
  { k: 'tree', label: 'Referral tree' },
]
const metricVal = (e: Entry, m: Metric) =>
  m === 'score' ? (e.attribution_score || 0)
  : m === 'points' ? (e.total_points || 0)
  : (e.referral_trade_points || 0)

const tierFor = (score = 0) => score >= 800 ? 'Oracle' : score >= 500 ? 'Builder' : score >= 250 ? 'Signal' : 'Ghost'
const TIER_CHIP: Record<string, string> = {
  Oracle: 'bg-atx-coral text-atx-ink border-atx-ink',
  Builder: 'bg-atx-blue text-white border-atx-blue',
  Signal: 'bg-atx-mesquite text-white border-atx-mesquite',
  Ghost: 'bg-transparent text-atx-ink/50 border-atx-ink/25',
}
const TIER_ACCENT: Record<string, string> = {
  Oracle: 'text-atx-coral', Builder: 'text-atx-blue', Signal: 'text-atx-mesquite', Ghost: 'text-atx-ink/45',
}
const PODIUM = ['text-atx-coral', 'text-atx-mesquite', 'text-atx-clay']
const STRIPE = ['bg-atx-coral', 'bg-atx-mesquite', 'bg-atx-clay']
const fmt = (n: number) => n.toLocaleString()

// ─── Demo fallback ─────────────────────────────────────────────────────────────
// The wallet leaderboard is served by the external Attribution worker. When that
// worker returns nothing (or errors), we render this fictional sample board so the
// page is populated for demos instead of showing a "couldn't load" state. Shown
// ONLY as a fallback — any real worker data always takes precedence. A subtle
// "preview data" marker is displayed whenever these rows are in use.
const DEMO_ENTRIES: Entry[] = [
  { wallet: '0x8a1f4c9b2d3e5a6f7089c1b2d3e4f5a6b7c8d9e0', attribution_score: 892, total_points: 41200, total_earned_usd: 3180, referral_trade_points: 264 },
  { wallet: '0x2b7d9e0f1a3c4b5d6e7f8091a2b3c4d5e6f70819', attribution_score: 861, total_points: 28740, total_earned_usd: 2610, referral_trade_points: 96 },
  { wallet: '0x5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d', attribution_score: 830, total_points: 52310, total_earned_usd: 1990, referral_trade_points: 312 },
  { wallet: '0x9f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6', attribution_score: 788, total_points: 19850, total_earned_usd: 4120, referral_trade_points: 408 },
  { wallet: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d', attribution_score: 754, total_points: 33600, total_earned_usd: 1740, referral_trade_points: 72 },
  { wallet: '0x6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091', attribution_score: 712, total_points: 15420, total_earned_usd: 2280, referral_trade_points: 144 },
  { wallet: '0x3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f', attribution_score: 690, total_points: 44180, total_earned_usd: 990, referral_trade_points: 216 },
  { wallet: '0xa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70819', attribution_score: 651, total_points: 21030, total_earned_usd: 1560, referral_trade_points: 120 },
  { wallet: '0x7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', attribution_score: 620, total_points: 12760, total_earned_usd: 3020, referral_trade_points: 288 },
  { wallet: '0x4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5', attribution_score: 588, total_points: 26910, total_earned_usd: 820, referral_trade_points: 48 },
  { wallet: '0x0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192', attribution_score: 559, total_points: 9840, total_earned_usd: 1880, referral_trade_points: 180 },
  { wallet: '0x8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70819', attribution_score: 521, total_points: 31450, total_earned_usd: 640, referral_trade_points: 96 },
  { wallet: '0x5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6', attribution_score: 498, total_points: 8320, total_earned_usd: 1420, referral_trade_points: 156 },
  { wallet: '0x2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4', attribution_score: 470, total_points: 17690, total_earned_usd: 510, referral_trade_points: 24 },
  { wallet: '0x9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b', attribution_score: 442, total_points: 6180, total_earned_usd: 1120, referral_trade_points: 132 },
  { wallet: '0x6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7', attribution_score: 410, total_points: 22540, total_earned_usd: 380, referral_trade_points: 60 },
  { wallet: '0x3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5', attribution_score: 388, total_points: 5470, total_earned_usd: 860, referral_trade_points: 108 },
  { wallet: '0x0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c', attribution_score: 355, total_points: 13920, total_earned_usd: 290, referral_trade_points: 36 },
  { wallet: '0x7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708', attribution_score: 322, total_points: 4210, total_earned_usd: 640, referral_trade_points: 72 },
  { wallet: '0x4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6', attribution_score: 298, total_points: 9130, total_earned_usd: 210, referral_trade_points: 12 },
  { wallet: '0x1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f809192', attribution_score: 271, total_points: 3350, total_earned_usd: 420, referral_trade_points: 48 },
  { wallet: '0x8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80919', attribution_score: 244, total_points: 6740, total_earned_usd: 150, referral_trade_points: 24 },
  { wallet: '0x5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7', attribution_score: 210, total_points: 2180, total_earned_usd: 260, referral_trade_points: 12 },
  { wallet: '0x2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80919293', attribution_score: 176, total_points: 4520, total_earned_usd: 90,  referral_trade_points: 0 },
  { wallet: '0x9d0e1f2a3b4c5d6e7f708192a3b4c5d6e7f80919', attribution_score: 142, total_points: 1240, total_earned_usd: 140, referral_trade_points: 12 },
]

// ─── Content ──────────────────────────────────────────────────────────────────
function LeaderboardContent() {
  const { evmAddress } = useMintwareIdentity()
  const wallet = evmAddress?.toLowerCase() ?? ''

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null)
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

  useEffect(() => {
    fetch(`${API}/campaigns`).then((r) => r.json()).then((data) => {
      if (Array.isArray(data) && data.length) { setCampaigns(data); setActiveCampaignId(data[0].id) }
      else setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const loadBoard = useCallback(async () => {
    if (!activeCampaignId) {
      // No campaign from the worker → show the sample board rather than a blank page.
      setEntries(DEMO_ENTRIES); setSample(true); setError(false); setLoading(false); return
    }
    setLoading(true); setEntries([]); setError(false); setSample(false)
    try {
      const res = await fetch(`${API}/leaderboard?campaign_id=${encodeURIComponent(activeCampaignId)}&limit=100`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const rows = Array.isArray(data) ? data : []
      if (rows.length === 0) { setEntries(DEMO_ENTRIES); setSample(true) }  // empty board → sample fallback
      else { setEntries(rows); setSample(false) }
    } catch {
      // Worker down/erroring → sample fallback so the board isn't broken for demos.
      setEntries(DEMO_ENTRIES); setSample(true)
    } finally { setLoading(false) }
  }, [activeCampaignId])
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
  const activeCampaign = campaigns.find((c) => c.id === activeCampaignId)
  const daysLeft = activeCampaign?.end_date ? daysUntil(activeCampaign.end_date) : null
  const topScore = ranked.reduce((m, r) => Math.max(m, r.attribution_score || 0), 0)
  const unit = metric === 'score' ? '' : metric === 'points' ? ' pts' : ' refs'

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      {/* Hero */}
      <PageHero
        size="compact"
        eyebrow={`Attribution · ${activeCampaign?.name ?? 'global'} rankings · ${sample ? 'preview data' : 'live'}`}
        title={<>REPUTATION, <span className="text-atx-blue">RANKED.</span></>}
        sub="Every wallet has a history. This is the board. One swap enters you."
      />

      {/* stat band */}
      <section className="border-b border-atx-ink">
        <div className="grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr]">
          {[
            ['Ranked wallets', loading ? '—' : String(total).padStart(3, '0'), 'this campaign'],
            ['Top score', loading ? '—' : String(topScore), 'attribution'],
            ['Your rank', me ? `#${me.rank}` : '—', me ? `${me.tier} · ${me.attribution_score || 0}` : loading ? 'loading…' : wallet ? 'not ranked yet' : 'connect'],
            ['Ends', daysLeft !== null ? `${daysLeft}d` : 'live', 'this epoch'],
          ].map(([l, v, sub], i) => (
            <div key={i} className={`px-7 py-3 max-[560px]:px-4 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
              <div className={`${LABEL} text-[9px] mb-1.5`}>{l}</div>
              <div className={`font-bold text-[15px] tabular-nums ${i === 1 ? 'text-atx-coral' : i === 2 ? 'text-atx-blue' : ''}`}>{v}</div>
              <div className="font-atx-mono text-[10px] text-atx-ink/45 mt-0.5 truncate">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Campaign selector */}
      {campaigns.length > 0 && (
        <div className="px-7 pt-7 flex items-center gap-2.5 flex-wrap max-[560px]:px-4">
          <span className={LABEL}>Campaign</span>
          {campaigns.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCampaignId(c.id)}
              className={`py-2 px-3.5 text-[12px] font-atx-mono uppercase tracking-[0.06em] border transition-colors ${
                c.id === activeCampaignId ? 'bg-atx-blue text-white border-atx-blue font-semibold' : 'bg-transparent text-atx-ink/60 border-atx-ink/25 hover:border-atx-ink hover:text-atx-ink'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Campaign context — pool / daily payout / per-action point rewards (preserved) */}
      {activeCampaign && (
        <div className="px-7 pt-3 flex items-center gap-2 flex-wrap max-[560px]:px-4">
          {activeCampaign.pool_usd != null && (
            <span className="font-atx-mono text-[11px] border border-atx-ink/25 px-2 py-1 text-atx-ink/60">
              Pool <span className="text-atx-mesquite font-bold">{fmtUSD(activeCampaign.pool_usd)}</span>
            </span>
          )}
          {activeCampaign.daily_payout_usd != null && (
            <span className="font-atx-mono text-[11px] border border-atx-ink/25 px-2 py-1 text-atx-ink/60">
              <span className="text-atx-coral font-bold">{fmtUSD(activeCampaign.daily_payout_usd)}</span>/day
            </span>
          )}
          {activeCampaign.actions && Object.entries(activeCampaign.actions).map(([k, a]) => {
            const suffix = a.per_day ? '/day' : a.per_referral ? '/ref' : a.per_referred_trade ? '/trade' : ''
            return (
              <span key={k} className="font-atx-mono text-[11px] border border-atx-ink/25 px-2 py-1 text-atx-ink/60">
                <span className="text-atx-blue font-bold">+{a.points}{suffix}</span> {a.label}
              </span>
            )
          })}
        </div>
      )}

      {/* Podium */}
      {!loading && top3.length > 0 && (
        <div className="px-7 pt-7 grid grid-cols-3 gap-[22px] max-[720px]:grid-cols-1 max-[560px]:px-4">
          {top3.map((r, i) => {
            const lead = i === 0
            return (
              <div key={r.wallet} className={`flex flex-col border border-atx-ink ${lead ? 'bg-atx-coral text-atx-ink' : 'bg-atx-bone'}`}>
                {!lead && <div className={`h-[6px] ${STRIPE[i]}`} />}
                <div className="p-[16px_18px] flex flex-col flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-[34px] leading-none tabular-nums ${lead ? 'text-atx-ink' : PODIUM[i]}`}>{String(r.rank).padStart(2, '0')}</span>
                    <Star className={`w-6 h-6 ${lead ? 'text-atx-ink' : PODIUM[i]}`} />
                  </div>
                  <div className="mt-3 min-w-0">
                    <div className="font-bold text-[16px] tracking-tight truncate">
                      <WalletDisplay address={r.wallet} mono style={{ fontSize: 16, fontWeight: 700 }} />
                    </div>
                    <div className={`font-atx-mono text-[11px] mt-0.5 ${lead ? 'text-atx-ink/60' : 'text-atx-ink/50'}`}>{shortAddr(r.wallet)} · {r.tier}</div>
                  </div>
                  <div className={`mt-3 pt-3 border-t ${lead ? 'border-atx-ink/25' : LINE} flex items-baseline gap-2`}>
                    <span className="font-atx-mono text-[26px] font-bold tabular-nums">{fmt(metricVal(r, metric))}</span>
                    <span className={`font-atx-mono text-[11px] ${lead ? 'text-atx-ink/55' : 'text-atx-ink/45'}`}>{unit.trim() || 'Attribution'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Board */}
      <section className="bg-atx-panel border-t border-atx-ink mt-7">
        {/* Metric tabs */}
        <div className="px-7 pt-7 flex items-center gap-3.5 flex-wrap max-[560px]:px-4">
          <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2 bg-atx-bone">{String(total).padStart(2, '0')}</span>
          <div className="flex border border-atx-ink bg-atx-bone">
            {TABS.map((t) => (
              <button
                key={t.k}
                onClick={() => setMetric(t.k)}
                className={`font-atx-mono text-[12px] uppercase tracking-[0.1em] px-4 py-2 border-r border-atx-ink last:border-r-0 ${metric === t.k ? 'bg-atx-blue text-white' : 'bg-transparent text-atx-ink'} max-[560px]:px-3`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="ml-auto font-atx-mono text-[11px] text-atx-ink/45 max-[560px]:hidden">updates every 5 min</span>
        </div>

        {/* Table */}
        <div className="px-7 py-7 max-[560px]:px-4">
          <div className="border border-atx-ink bg-atx-bone">
            <div className="grid [grid-template-columns:60px_1fr_104px_repeat(4,92px)] max-[820px]:[grid-template-columns:52px_1fr] border-b border-atx-ink bg-atx-panel">
              {['Rank', 'Wallet', 'Tier', 'Attribution', 'Points', 'Tree', 'Earned'].map((h, i) => (
                <div key={h} className={`${LABEL} text-[9px] px-[16px] py-3 ${i >= 3 ? 'text-right max-[820px]:hidden' : ''} ${i === 2 ? 'max-[820px]:hidden' : ''}`}>{h}</div>
              ))}
            </div>

            {loading ? (
              <div className="p-4 flex flex-col gap-2">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-11 border border-atx-ink/15 bg-atx-panel" />)}
              </div>
            ) : error ? (
              <div className="px-5 py-14 text-center font-atx-mono text-[14px] text-atx-ink/55">
                Couldn’t load the rankings.
                <span className="block mt-1.5 text-[12px] text-atx-ink/45">The Attribution service didn’t respond.</span>
                <button onClick={loadBoard} className="mt-3 font-atx-mono text-[12px] uppercase tracking-[0.08em] px-3.5 py-2 border border-atx-blue text-atx-blue hover:bg-atx-blue hover:text-white transition-colors">Retry</button>
              </div>
            ) : ranked.length === 0 ? (
              <div className="px-5 py-14 text-center font-atx-mono text-[14px] text-atx-ink/55">
                No participants yet — be the first.
                <span className="block mt-1.5 text-[12px] text-atx-ink/45">Trade on {activeCampaign?.name ?? 'this campaign'} to enter the rankings.</span>
              </div>
            ) : (
              <>
                {top10.map((r) => <Row key={r.wallet} r={r} metric={metric} isMe={!!(wallet && r.wallet === wallet)} />)}
                {showUser && me && (
                  <>
                    <div className="text-center font-atx-mono text-[11px] tracking-[0.3em] text-atx-ink/35 py-2 border-b border-atx-ink/10">· · ·</div>
                    <Row r={me} metric={metric} isMe />
                  </>
                )}
              </>
            )}
          </div>

          {/* Your rank + invite — shown for any ranked wallet so the invite link is always reachable */}
          {me && (
            <div className="mt-[22px] border border-atx-blue bg-atx-blue/[0.06] p-[14px_18px] flex items-center gap-4 flex-wrap">
              <span className="font-bold text-[26px] tabular-nums text-atx-blue">#{me.rank}</span>
              <div className="min-w-0">
                <div className="font-bold text-[15px] truncate"><WalletDisplay address={me.wallet} mono style={{ fontSize: 15, fontWeight: 700 }} /> <span className="font-atx-mono text-[11px] text-atx-ink/50">· {me.tier}</span></div>
                <div className="font-atx-mono text-[11px] text-atx-ink/55">
                  {fmt(metricVal(me, metric))}{unit}
                  {ranked[me.rank - 2] && ` · ${fmt(metricVal(ranked[me.rank - 2], metric) - metricVal(me, metric))}${unit} to rank #${me.rank - 1}`}
                </div>
              </div>
              {refLink && (
                <button onClick={copyLink} className="ml-auto font-semibold text-[13px] font-atx-mono px-4 py-2.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">
                  {linkCopied ? 'Copied ✓' : 'Invite · +60 pts'}
                </button>
              )}
            </div>
          )}

          {/* Not connected / not ranked CTA */}
          {!loading && !me && (
            <div className="mt-[22px] border border-atx-ink bg-atx-bone p-[14px_18px] flex items-center gap-4 flex-wrap">
              <Star className="w-5 h-5 text-atx-coral shrink-0" />
              <div className="min-w-0">
                <div className="font-bold text-[15px]">{wallet ? 'You’re not on the board yet.' : 'Connect to see your rank.'}</div>
                <div className="font-atx-mono text-[11px] text-atx-ink/55">One swap enters you — your Attribution score gives you a head start.</div>
              </div>
              {refLink && (
                <button onClick={copyLink} className="ml-auto font-semibold text-[13px] font-atx-mono px-4 py-2.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">
                  {linkCopied ? 'Copied ✓' : 'Invite · +60 pts'}
                </button>
              )}
            </div>
          )}

          <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/40 flex items-center gap-1.5 px-1 mt-6">
            <Star className="w-3 h-3" /> Powered by Attribution
          </div>
        </div>
      </section>

      {/* How you climb — the "why", below the board */}
      <section className="border-t border-atx-ink bg-atx-blue/[0.05] px-7 py-7 max-[560px]:px-4">
        <span className={`${LABEL} block mb-4`}>How you climb — ranks are earned by contribution</span>
        <div className="grid grid-cols-3 border border-atx-ink max-[720px]:grid-cols-1">
          {[
            { a: 'text-atx-blue', t: 'Attribution', d: 'Your whole on-chain history, scored across six signals — volume, trading, holding, liquidity, governance, sharing. It carries across 100+ chains.' },
            { a: 'text-atx-coral', t: 'Campaign points', d: 'Earned per contribution — every swap, hold, and referral in a live campaign, multiplied by your Attribution tier.' },
            { a: 'text-atx-mesquite', t: 'Referral tree', d: 'The wallets you bring on-chain, weighted by how real and active they are. Quality over quantity.' },
          ].map((c, i) => (
            <div key={i} className={`p-[16px_18px] ${i < 2 ? 'border-r border-atx-ink/20 max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink/20' : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <Star className={`w-4 h-4 ${c.a}`} />
                <span className="font-bold text-[15px] tracking-tight">{c.t}</span>
              </div>
              <p className="text-atx-ink/60 text-[13px] leading-[1.5]">{c.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Row({ r, metric, isMe }: { r: Entry & { rank: number; tier: string }; metric: Metric; isMe: boolean }) {
  const isTop = r.rank <= 3
  const rankCls = r.rank === 1 ? 'text-atx-coral' : r.rank === 2 ? 'text-atx-mesquite' : r.rank === 3 ? 'text-atx-clay' : 'text-atx-ink/45'
  const col = (k: Metric) => (metric === k ? 'font-bold' : 'text-atx-ink/70')
  const tree = (r.referral_trade_points || 0)
  return (
    <div className={`grid [grid-template-columns:60px_1fr_104px_repeat(4,92px)] max-[820px]:[grid-template-columns:52px_1fr] items-center border-b border-atx-ink/20 last:border-b-0 ${isMe ? 'bg-atx-blue/[0.07] border-l-2 border-l-atx-blue' : ''}`}>
      <div className={`px-[16px] py-3.5 font-atx-mono tabular-nums ${isTop ? `text-[18px] font-bold ${rankCls}` : `text-[15px] ${rankCls}`}`}>{String(r.rank).padStart(2, '0')}</div>
      <div className="px-[16px] py-3.5 min-w-0 flex items-center gap-2.5">
        <Star className={`w-4 h-4 shrink-0 ${TIER_ACCENT[r.tier]}`} />
        <div className="min-w-0">
          <div className="font-bold text-[14px] tracking-tight truncate flex items-center gap-2">
            <WalletDisplay address={r.wallet} mono style={{ fontSize: 14, fontWeight: 700 }} />
            {isMe && <span className="font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-blue border border-atx-blue px-1.5 py-0.5">you</span>}
          </div>
          <div className="font-atx-mono text-[11px] text-atx-ink/45 truncate">{shortAddr(r.wallet)}</div>
        </div>
      </div>
      <div className="px-[16px] py-3.5 max-[820px]:hidden">
        <span className={`font-atx-mono text-[10px] uppercase tracking-[0.06em] px-2 py-1 border ${TIER_CHIP[r.tier]}`}>{r.tier}</span>
      </div>
      <div className={`px-[16px] py-3.5 text-right font-atx-mono text-[15px] tabular-nums max-[820px]:hidden ${col('score')}`}>{r.attribution_score || 0}</div>
      <div className={`px-[16px] py-3.5 text-right font-atx-mono text-[15px] tabular-nums max-[820px]:hidden ${col('points')}`}>{fmt(r.total_points || 0)}</div>
      <div className={`px-[16px] py-3.5 text-right font-atx-mono text-[15px] tabular-nums max-[820px]:hidden ${col('tree')}`}>{tree}</div>
      <div className="px-[16px] py-3.5 text-right font-atx-mono text-[15px] tabular-nums max-[820px]:hidden">
        {r.total_earned_usd != null ? <span className="text-atx-mesquite font-semibold">{fmtUSD(r.total_earned_usd)}</span> : <span className="text-atx-ink/30">—</span>}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <LeaderboardContent />
      </MwAuthGuard>
    </>
  )
}
