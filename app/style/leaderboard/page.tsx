'use client'

// =============================================================================
// /style/leaderboard — elevated leaderboard concept (design lab). Mock data.
// Reputation-first: hero + stat band, a top-3 podium, metric tabs, and a clean
// hairline table with top ranks accented and YOUR row pinned. Promote to
// /leaderboard once the feel's locked (wire real /leaderboard + /score data).
// =============================================================================

import { useMemo, useState } from 'react'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'

type Metric = 'score' | 'points' | 'tree'
const TABS: Array<{ k: Metric; label: string }> = [
  { k: 'score', label: 'Attribution' },
  { k: 'points', label: 'Campaign points' },
  { k: 'tree', label: 'Referral tree' },
]

type Row = { handle: string; addr: string; tier: string; score: number; points: number; tree: number; me?: boolean }
const ROWS: Row[] = [
  { handle: 'vaultwizard.eth',  addr: '0x8f…21a4', tier: 'Oracle',  score: 912, points: 184_200, tree: 340 },
  { handle: '0xsettler',        addr: '0x3c…9de1', tier: 'Oracle',  score: 878, points: 141_050, tree: 512 },
  { handle: 'basedbuilder.eth', addr: '0x71…04ab', tier: 'Builder', score: 844, points: 203_900, tree: 128 },
  { handle: 'liquidhands',      addr: '0xa2…77c0', tier: 'Builder', score: 806, points: 96_400,  tree: 274 },
  { handle: 'onchain.pat',      addr: '0x19…5b2f', tier: 'Builder', score: 771, points: 158_300, tree: 89 },
  { handle: 'degenmonk.eth',    addr: '0x55…e310', tier: 'Signal',  score: 742, points: 74_800,  tree: 401 },
  { handle: 'rwa.stacker',      addr: '0xc8…1a90', tier: 'Signal',  score: 718, points: 112_600, tree: 61 },
  { handle: '0xnightowl',       addr: '0x40…6b39', tier: 'Signal',  score: 690, points: 63_100,  tree: 155 },
  { handle: 'yieldpilgrim.eth', addr: '0x9c…33ad', tier: 'Builder', score: 247, points: 136_500, tree: 47, me: true },
  { handle: 'ghostwallet',      addr: '0x2e…88f1', tier: 'Ghost',   score: 214, points: 41_900,  tree: 12 },
]

const TIER_ACCENT: Record<string, string> = {
  Oracle: 'text-atx-coral', Builder: 'text-atx-blue', Signal: 'text-atx-mesquite', Ghost: 'text-atx-ink/45',
}
const PODIUM = ['text-atx-coral', 'text-atx-mesquite', 'text-atx-clay'] // 1 · 2 · 3
const fmt = (n: number) => n.toLocaleString()

export default function StyleLeaderboardConcept() {
  const [metric, setMetric] = useState<Metric>('score')

  const ranked = useMemo(() => {
    const list = [...ROWS].sort((a, b) => b[metric] - a[metric])
    return list.map((r, i) => ({ ...r, rank: i + 1 }))
  }, [metric])

  const top3 = ranked.slice(0, 3)
  const me = ranked.find((r) => r.me)
  const topVal = ranked[0]?.[metric] ?? 0
  const unit = metric === 'score' ? '' : metric === 'points' ? ' pts' : ' refs'

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Top bar */}
      <div className="flex items-center gap-3.5 px-7 h-[58px] border-b border-atx-ink/20 sticky top-0 bg-atx-bone z-10">
        <Star className="w-[18px] h-[18px] text-atx-blue" />
        <span className="font-bold">Leaderboard</span>
        <button className="ml-auto font-atx-mono text-[12px] text-atx-ink/55 border border-atx-ink/20 px-2.5 py-1.5">Search ⌘K</button>
        <span className="hidden sm:flex items-center gap-2 font-atx-mono text-[12px] border border-atx-blue px-2.5 py-1.5">
          <Star className="w-3.5 h-3.5 text-atx-blue" />
          <span className="font-bold text-atx-blue">#{me?.rank ?? '—'}</span>
          <span className="text-atx-ink/45">your rank</span>
        </span>
        <button className="font-semibold text-[13px] font-atx-mono px-3 py-1.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">Connect Wallet</button>
      </div>

      {/* Hero */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="px-7 pt-8 pb-7">
          <p className={`${LABEL} mb-4`}>Attribution · global rankings · live</p>
          <h1 className="font-bold tracking-[-0.03em] leading-[0.85] text-[clamp(44px,8vw,92px)]">
            REPUTATION, <span className="text-atx-blue">RANKED.</span>
          </h1>
          <p className="text-atx-ink/60 text-[15px] max-w-[62ch] mt-4">
            Every wallet has a history. This is the board — ranked by Attribution score, campaign points,
            and the referral trees they've grown. One swap enters you.
          </p>
        </div>
        <div className="border-t border-atx-ink grid [grid-template-columns:1.4fr_1fr_1fr_1fr] max-[720px]:[grid-template-columns:1fr_1fr]">
          {[
            ['Ranked wallets', String(ranked.length).padStart(3, '0'), 'and counting'],
            ['Top score', String(ranked[0]?.score ?? 0), ranked[0]?.handle ?? ''],
            ['Your rank', me ? `#${me.rank}` : '—', me ? `${me.tier} · ${me.score}` : 'connect'],
            ['Epoch', 'T−4d', 'live rankings'],
          ].map(([l, v, sub], i) => (
            <div key={i} className={`px-7 py-3 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
              <div className={`${LABEL} text-[9px] mb-1.5`}>{l}</div>
              <div className={`font-bold text-[15px] tabular-nums ${i === 2 ? 'text-atx-blue' : ''}`}>{v}</div>
              <div className="font-atx-mono text-[10px] text-atx-ink/45 mt-0.5 truncate">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How you climb — the three ways a rank is earned (maps to the metric tabs below) */}
      <section className="border-b border-atx-ink bg-atx-blue/[0.05] px-7 py-7">
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

      {/* Podium — top 3 by the active metric */}
      <div className="px-7 pt-7 grid grid-cols-3 gap-[22px] max-[720px]:grid-cols-1">
        {top3.map((r, i) => (
          <div
            key={r.addr}
            className={`p-[16px_18px] flex flex-col ${i === 0 ? 'border-2 border-atx-coral bg-atx-coral/[0.06]' : 'border border-atx-ink bg-atx-bone'}`}
          >
            <div className="flex items-center justify-between">
              <span className={`font-bold text-[34px] leading-none tabular-nums ${PODIUM[i]}`}>{String(r.rank).padStart(2, '0')}</span>
              <Star className={`w-6 h-6 ${PODIUM[i]}`} />
            </div>
            <div className="mt-3">
              <div className="font-bold text-[16px] tracking-tight truncate">{r.handle}</div>
              <div className="font-atx-mono text-[11px] mt-0.5 text-atx-ink/50">{r.addr} · {r.tier}</div>
            </div>
            <div className={`mt-3 pt-3 border-t ${i === 0 ? 'border-atx-coral/30' : LINE} flex items-baseline gap-2`}>
              <span className="font-atx-mono text-[26px] font-bold tabular-nums">{fmt(r[metric])}</span>
              <span className="font-atx-mono text-[11px] text-atx-ink/45">{unit.trim() || TABS.find((t) => t.k === metric)?.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Board — the ranked list, on a panel band for tonal contrast */}
      <section className="bg-atx-panel border-t border-atx-ink">
      {/* Metric tabs */}
      <div className="px-7 pt-7 flex items-center gap-3.5">
        <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2 bg-atx-bone">{String(ranked.length).padStart(2, '0')}</span>
        <div className="flex border border-atx-ink bg-atx-bone">
          {TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setMetric(t.k)}
              className={`font-atx-mono text-[12px] uppercase tracking-[0.1em] px-4 py-2 border-r border-atx-ink last:border-r-0 ${metric === t.k ? 'bg-atx-blue text-white' : 'bg-transparent text-atx-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto font-atx-mono text-[11px] text-atx-ink/45">ranked by {TABS.find((t) => t.k === metric)?.label.toLowerCase()}</span>
      </div>

      {/* Table */}
      <div className="px-7 py-7">
        <div className="border border-atx-ink bg-atx-bone">
          {/* header */}
          <div className={`grid [grid-template-columns:64px_1fr_120px_repeat(3,110px)] max-[820px]:[grid-template-columns:52px_1fr_100px] border-b border-atx-ink bg-atx-panel`}>
            {['Rank', 'Wallet', 'Tier', 'Attribution', 'Points', 'Tree'].map((h, i) => (
              <div key={h} className={`${LABEL} text-[9px] px-[16px] py-3 ${i >= 3 ? 'text-right max-[820px]:hidden' : ''} ${i === 2 ? 'max-[820px]:hidden' : ''}`}>{h}</div>
            ))}
          </div>
          {/* rows */}
          {ranked.map((r) => {
            const isTop = r.rank <= 3
            const rankCls = r.rank === 1 ? 'text-atx-coral' : r.rank === 2 ? 'text-atx-mesquite' : r.rank === 3 ? 'text-atx-clay' : 'text-atx-ink/45'
            const active = (k: Metric) => (metric === k ? 'font-bold' : 'text-atx-ink/70')
            return (
              <div
                key={r.addr}
                className={`grid [grid-template-columns:64px_1fr_120px_repeat(3,110px)] max-[820px]:[grid-template-columns:52px_1fr_100px] items-center border-b ${LINE} last:border-b-0 ${r.me ? 'bg-atx-blue/[0.07] border-l-2 border-l-atx-blue' : ''}`}
              >
                <div className={`px-[16px] py-3.5 font-atx-mono tabular-nums ${isTop ? `text-[18px] font-bold ${rankCls}` : `text-[15px] ${rankCls}`}`}>
                  {String(r.rank).padStart(2, '0')}
                </div>
                <div className="px-[16px] py-3.5 min-w-0 flex items-center gap-2.5">
                  <Star className={`w-4 h-4 shrink-0 ${TIER_ACCENT[r.tier]}`} />
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] tracking-tight truncate flex items-center gap-2">
                      {r.handle}
                      {r.me && <span className="font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-blue border border-atx-blue px-1.5 py-0.5">you</span>}
                    </div>
                    <div className="font-atx-mono text-[11px] text-atx-ink/45 truncate">{r.addr}</div>
                  </div>
                </div>
                <div className={`px-[16px] py-3.5 font-atx-mono text-[12px] uppercase tracking-[0.06em] max-[820px]:hidden ${TIER_ACCENT[r.tier]}`}>{r.tier}</div>
                <div className={`px-[16px] py-3.5 text-right font-atx-mono text-[15px] tabular-nums max-[820px]:hidden ${active('score')}`}>{r.score}</div>
                <div className={`px-[16px] py-3.5 text-right font-atx-mono text-[15px] tabular-nums max-[820px]:hidden ${active('points')}`}>{fmt(r.points)}</div>
                <div className={`px-[16px] py-3.5 text-right font-atx-mono text-[15px] tabular-nums max-[820px]:hidden ${active('tree')}`}>{r.tree}</div>
              </div>
            )
          })}
        </div>

        {/* your rank — pinned reminder */}
        {me && me.rank > 3 && (
          <div className="mt-[22px] border border-atx-blue bg-atx-blue/[0.06] p-[14px_18px] flex items-center gap-4">
            <span className="font-bold text-[26px] tabular-nums text-atx-blue">#{me.rank}</span>
            <div className="min-w-0">
              <div className="font-bold text-[15px] truncate">{me.handle} <span className="font-atx-mono text-[11px] text-atx-ink/50">· {me.tier}</span></div>
              <div className="font-atx-mono text-[11px] text-atx-ink/55">
                {fmt(me[metric])}{unit} · {ranked[me.rank - 2] ? `${fmt(ranked[me.rank - 2][metric] - me[metric])}${unit} to rank #${me.rank - 1}` : 'climbing'}
              </div>
            </div>
            <button className="ml-auto font-semibold text-[13px] font-atx-mono px-4 py-2.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">Climb →</button>
          </div>
        )}

        <div className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/40 flex items-center gap-1.5 px-1 mt-6">
          <Star className="w-3 h-3" /> Powered by Attribution
        </div>
      </div>
      </section>
    </div>
  )
}
