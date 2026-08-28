'use client'

// Team · Treasury Overview — the terminal's home. NAV hero + KPI row, then the
// ACTIVITY the treasury cares about front-and-centre: pool activity (LP / swaps /
// referrals routed through the pool), the edge-auth authorization feed, and
// allocation. Treasury/cards figures are ILLUSTRATIVE (ULV in testing).
//
// The "Top contributors" leaderboard widget that lived here was removed
// 2026-08-28 with the rest of the human-facing Attribution surface — it hit an
// external Cloudflare Worker of unverifiable live status and fell back to a
// hardcoded demo array. See attribution_review_2026_08_28 memory.

const KPIS = [
  { k: 'Available to spend', v: '$2.41M', s: 'credit against NAV' },
  { k: '30-day net APY', v: '6.2%', s: 'Aave + v4 capture' },
  { k: 'Allocated to vaults', v: '$5.80M', s: '73% of treasury' },
  { k: 'Unencumbered', v: '$1.14M', s: 'free of card holds' },
]

const AUTH_FEED = [
  { who: 'AWS · us-east-1', amt: '$4,182.00', t: '2s ago', ms: '118 ms', ok: true },
  { who: 'Meta Ads', amt: '$12,500.00', t: '1m ago', ms: '104 ms', ok: true },
  { who: 'Delta Air Lines', amt: '$2,340.55', t: '4m ago', ms: '131 ms', ok: true },
  { who: 'Figma', amt: '$960.00', t: '12m ago', ms: '—', ok: false },
]

const ALLOC = [
  { name: 'USDC · Growth ULV', pct: 52, color: 'var(--color-peri)' },
  { name: 'ETH / USDC pair', pct: 21, color: 'var(--color-coral2)' },
  { name: 'Aave idle buffer', pct: 20, color: 'var(--color-peri-deep)' },
  { name: 'Reserve (unallocated)', pct: 7, color: 'var(--color-ink-soft)' },
]

// ── Pool activity (illustrative) ──
type Kind = 'lp' | 'swap' | 'referral'
const KIND_META: Record<Kind, { label: string; cls: string; dot: string }> = {
  lp:       { label: 'LP committed', cls: 'text-peri-deep bg-[rgba(108,108,240,0.08)]', dot: 'var(--color-peri)' },
  swap:     { label: 'Swap routed',  cls: 'text-mw-green bg-mw-green-muted',            dot: 'var(--color-mw-green)' },
  referral: { label: 'Referral',     cls: 'text-coral2-deep bg-[rgba(240,120,110,0.1)]', dot: 'var(--color-coral2)' },
}
const POOL: { kind: Kind; wallet: string; detail: string; amt: string; when: string }[] = [
  { kind: 'lp',       wallet: '0x8a1f…d9e0', detail: 'into Growth ULV',     amt: '+$42,000', when: '2m ago' },
  { kind: 'swap',     wallet: '0x2b7d…0819', detail: 'ETH → USDC via pool', amt: '$12,400',  when: '9m ago' },
  { kind: 'referral', wallet: '0x5c6d…3c4d', detail: 'brought 0x9f0e…b7c6', amt: '+1 wallet', when: '21m ago' },
  { kind: 'lp',       wallet: '0x1a2b…3c4d', detail: 'into ETH / USDC pair', amt: '+$8,900',  when: '34m ago' },
  { kind: 'swap',     wallet: '0x6e7f…8091', detail: 'USDC → ETH via pool', amt: '$3,120',   when: '1h ago' },
]

export default function TreasuryOverview() {
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-atx-display font-semibold text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Treasury Overview</h1>
        <span className="live-chip"><span className="dot" aria-hidden />Preview · illustrative</span>
      </div>

      {/* NAV hero */}
      <div className="rounded-[var(--radius-panel)] border border-hair bg-white shadow-card p-6 mt-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Total treasury NAV</div>
            <div className="font-atx-display font-medium text-[clamp(2.2rem,5vw,3.4rem)] tracking-[-0.03em] text-ink leading-none mt-2 tabular-nums">$7,943,204</div>
            <div className="text-[12px] text-ink-mid mt-2"><span className="text-mw-green font-semibold">▲ $48,102</span> · +0.61% · past 30 days</div>
          </div>
          <div className="inline-flex rounded-full bg-ground-cool p-0.5 text-[11px] font-semibold">
            {['7D', '30D', '1Y'].map((t, i) => (
              <span key={t} className={`px-3 py-1.5 rounded-full ${i === 1 ? 'bg-white text-ink shadow-card' : 'text-ink-soft'}`}>{t}</span>
            ))}
          </div>
        </div>
        <div className="mt-5 h-[64px] rounded-xl bg-gradient-to-b from-peri/[0.08] to-transparent border border-hair-soft flex items-end overflow-hidden">
          <svg viewBox="0 0 400 64" preserveAspectRatio="none" className="w-full h-full">
            <polyline points="0,48 40,44 80,46 120,38 160,40 200,30 240,33 280,24 320,26 360,16 400,18" fill="none" stroke="var(--color-peri)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 max-[880px]:grid-cols-2 max-[480px]:grid-cols-1 gap-3 mt-4">
        {KPIS.map((k) => (
          <div key={k.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{k.k}</div>
            <div className="font-atx-display font-medium text-[22px] tracking-tight text-ink mt-1.5 tabular-nums">{k.v}</div>
            <div className="text-[11px] text-ink-soft mt-0.5">{k.s}</div>
          </div>
        ))}
      </div>

      {/* ── Activity: pool feed ── */}
      <div className="grid grid-cols-1 gap-4 mt-4">
        {/* Pool activity */}
        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hair-soft">
            <span className="font-atx-display font-semibold text-[14px] text-ink">Pool activity</span>
            <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.08em] font-semibold text-peri-deep"><span className="w-[5px] h-[5px] rounded-full bg-peri" />Preview</span>
          </div>
          {POOL.map((f, i) => {
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
          <div className="px-5 py-2.5 text-[10.5px] text-ink-soft">Illustrative — per-pool routed activity populates once your vault is live.</div>
        </div>
      </div>

      {/* Authorization feed + allocation */}
      <div className="grid grid-cols-[1.3fr_1fr] max-[880px]:grid-cols-1 gap-4 mt-4">
        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hair-soft">
            <span className="font-atx-display font-semibold text-[14px] text-ink">Live authorization feed</span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-ink-soft">sub-150ms edge-auth</span>
          </div>
          {AUTH_FEED.map((f) => (
            <div key={f.who} className="flex items-center gap-3 px-5 py-3 border-b border-hair-soft last:border-0">
              <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${f.ok ? 'bg-mw-green' : 'bg-[#D14343]'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink truncate">{f.who}</div>
                <div className="text-[10.5px] text-ink-soft">{f.ok ? 'Approved' : 'Declined · over policy'} · {f.t}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[13px] tabular-nums text-ink">{f.amt}</div>
                <div className="text-[10px] text-ink-soft font-mono">{f.ms}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
          <div className="font-atx-display font-semibold text-[14px] text-ink mb-3.5">Allocation</div>
          <div className="flex h-2.5 rounded-full overflow-hidden mb-4">
            {ALLOC.map((a) => <span key={a.name} style={{ width: `${a.pct}%`, background: a.color }} />)}
          </div>
          <div className="flex flex-col gap-2.5">
            {ALLOC.map((a) => (
              <div key={a.name} className="flex items-center gap-2.5">
                <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: a.color }} />
                <span className="text-[12.5px] text-ink-mid flex-1 truncate">{a.name}</span>
                <span className="text-[12.5px] font-semibold text-ink tabular-nums">{a.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-ink-soft mt-5">Treasury, cards, and pool figures are illustrative — the ULV engine is in testing on Base Sepolia.</p>
    </>
  )
}
