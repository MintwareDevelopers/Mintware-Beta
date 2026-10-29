'use client'

// =============================================================================
// Current MarketEngine details beneath pool discovery.
//
//  · Live stats band (evergreen economics, GradientPanel)
//  01 Scenario calculator
//  02 Retired matched issuance
//  03 Trust, enforced on-chain
//  04 Earn-share card refill
//  05 Curated pool discovery
// =============================================================================

import { useEffect, useState } from 'react'
import { GradientPanel } from '@/components/ui2/GradientPanel'

const LABEL = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`
  return `$${Math.round(n).toLocaleString()}`
}

const STREAMS = [
  { key: 'Scenario input A', short: 'Input A', color: 'var(--color-peri)' },
  { key: 'Scenario input B', short: 'Input B', color: 'var(--color-peri-mid)' },
  { key: 'Scenario input C', short: 'Input C', color: 'var(--color-coral2)' },
] as const

// ── amplify-data shape (from /api/vaults/amplify-data) ───────────────────────
type LbVault = {
  id: string
  name: string
  surface: 'DeFi'
  pair?: string
  tvlUsd: number
  netApyPct: number
  status: string
}
type AmplifyData = {
  live: boolean
  stats: { count: number; tvlUsd: number; surfaces: number; live: boolean }
  leaderboard: LbVault[]
}
const isRealId = (id: string) => /^0x[0-9a-fA-F]{40}$/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

function SectionHead({ n, label, title, sub, onDark }: { n: string; label: string; title: string; sub?: string; onDark?: boolean }) {
  return (
    <div className="mb-8 max-w-[70ch]">
      <div className="flex items-center gap-3 mb-4">
        <span className={`text-[12px] font-semibold tabular-nums ${onDark ? 'text-pas-peri' : 'text-peri-deep'}`}>{n}</span>
        <span className={`text-[11px] uppercase tracking-[0.14em] font-semibold ${onDark ? 'text-white/55' : 'text-ink-soft'}`}>{label}</span>
      </div>
      <h2 className={`font-atx-display font-medium tracking-[-0.035em] leading-[1.02] text-[clamp(1.7rem,4vw,3rem)] ${onDark ? 'text-white' : 'text-ink'} [text-wrap:balance]`}>
        {title}
      </h2>
      {sub && <p className={`text-[15px] leading-[1.6] mt-4 ${onDark ? 'text-white/60' : 'text-ink-mid'}`}>{sub}</p>}
    </div>
  )
}

// ─── Stats band — evergreen vault economics (GradientPanel) ──────────────────
function LiveStatsBand() {
  const cells = [
    { v: '1', k: 'MarketEngine per curated pool' },
    { v: '2', k: 'Pool tokens returned in kind' },
    { v: '0', k: 'Yield from RH testnet adapters' },
  ]

  return (
    <GradientPanel tone="periwinkle" className="p-6 max-[800px]:p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />
        <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-mid">
          Live on Robinhood Chain testnet · unaudited
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
        {cells.map((c) => (
          <div key={c.k}>
            <div className="font-atx-display text-[26px] font-medium leading-none text-ink tabular-nums">{c.v}</div>
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft mt-2">{c.k}</div>
          </div>
        ))}
      </div>
    </GradientPanel>
  )
}

// ─── 01 · Hypothetical scenario calculator ───────────────────────────────────
function IncomeStreams() {
  const [deposit, setDeposit] = useState(10_000)
  // These three generic scenario rates are user inputs and do not model Mintware.
  const [lending, setLending] = useState(5)
  const [swapFees, setSwapFees] = useState(3)
  const [mev, setMev] = useState(2)

  const streamApys = [lending, swapFees, mev]
  const totalApy = lending + swapFees + mev
  const streamEarn = streamApys.map((a) => (deposit * a) / 100)
  const totalEarn = (deposit * totalApy) / 100
  const lenderEarn = (deposit * lending) / 100
  const maxEarn = Math.max(totalEarn, 1)

  const setters = [setLending, setSwapFees, setMev]

  return (
    <div className="soft-card overflow-hidden">
      <div className="p-8 max-[640px]:p-6 border-b border-hair-soft">
        <SectionHead
          n="01"
          label="The wedge · every dollar working"
          title="Hypothetical scenario inputs."
          sub="This calculator shows arithmetic from user-supplied assumptions; it does not model current Mintware yield or product mechanics."
        />
      </div>

      <div className="grid grid-cols-[1fr_1.15fr] max-[820px]:grid-cols-1">
        {/* controls */}
        <div className="p-8 max-[640px]:p-6 border-r border-hair-soft max-[820px]:border-r-0 max-[820px]:border-b flex flex-col gap-7">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Scenario balance</span>
              <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{fmtUsd(deposit)}</span>
            </div>
            <input type="range" min={1000} max={500_000} step={1000} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} className="ypn-range w-full" aria-label="Scenario balance" />
            <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
              <span>$1K</span><span>$500K</span>
            </div>
          </div>

          {STREAMS.map((s, i) => (
            <div key={s.key}>
              <div className="flex items-baseline justify-between mb-3">
                <span className={LABEL}>{s.key} rate</span>
                <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{streamApys[i]}%</span>
              </div>
              <input type="range" min={0} max={12} step={1} value={streamApys[i]} onChange={(e) => setters[i](Number(e.target.value))} className="ypn-range w-full" aria-label={`${s.key} scenario rate`} />
              <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
                <span>0%</span><span>model your own · 12%</span>
              </div>
            </div>
          ))}

          <GradientPanel tone="lavender" className="p-5">
            <div className={`${LABEL} mb-1`}>Scenario arithmetic / yr</div>
            <div className="font-atx-display text-[34px] font-medium text-peri-deep leading-none tabular-nums">
              {fmtUsd(totalEarn)}
            </div>
            <div className="text-[12px] text-coral2-deep mt-1.5 font-medium">
              Scenario difference between all inputs and input A
            </div>
          </GradientPanel>
        </div>

        {/* comparison bars */}
        <div className="p-8 max-[640px]:p-6 flex flex-col justify-center gap-5">
          <span className={LABEL}>Scenario comparison · assumptions only</span>

          {/* user-entered scenario input A */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[13px] uppercase tracking-[0.06em] font-semibold text-ink-soft">Scenario input A</span>
              <span className="font-atx-display text-[15px] font-medium tabular-nums text-ink-mid">{fmtUsd(lenderEarn)}</span>
            </div>
            <div className="h-[26px] rounded-full bg-ground-cool relative overflow-hidden">
              <div className="h-full absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${(lenderEarn / maxEarn) * 100}%`, background: 'var(--color-ink-soft)', opacity: 0.55 }} />
            </div>
          </div>

          {/* combined hypothetical inputs */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[13px] uppercase tracking-[0.06em] font-semibold text-ink">Combined scenario inputs</span>
              <span className="font-atx-display text-[15px] font-medium tabular-nums text-ink">{fmtUsd(totalEarn)}</span>
            </div>
            <div className="h-[26px] rounded-full bg-ground-cool relative overflow-hidden flex">
              {STREAMS.map((s, i) => (
                <div key={s.key} className="h-full transition-[width] duration-300" style={{ width: `${(streamEarn[i] / maxEarn) * 100}%`, background: s.color }} title={`${s.short} · ${fmtUsd(streamEarn[i])}`} />
              ))}
            </div>
          </div>

          {/* legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-mid">
            {STREAMS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: s.color }} />{s.short}
              </span>
            ))}
          </div>

          <p className="text-[10px] text-ink-soft mt-1 leading-[1.5]">
            User-entered scenario only. It is not a Mintware yield estimate or projection.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── 02 · Former matched liquidity design ───────────────────────────────────
const MATCHED = [
  { name: 'Matched issuance', dur: 'Retired', accent: 'var(--color-peri)', d: 'Community-matched launch issuance is not part of the current product.' },
  { name: 'Lock tiers', dur: 'Retired', accent: 'var(--color-peri-deep)', d: 'The current MarketEngine does not impose lock periods.' },
  { name: 'Senior issuance', dur: 'Retired', accent: 'var(--color-peri-mid)', d: 'Treasury senior/junior new issuance is not current.' },
  { name: 'Current liquidity', dur: 'MarketEngine', accent: 'var(--color-coral2)', d: 'One engine serves each curated Uniswap v4 pool.' },
]

function Tranches() {
  return (
    <div>
      <SectionHead
        n="02"
        label="Retired · matched issuance"
        title="The former matched-launch design is retired."
        sub="Current pool liquidity uses one MarketEngine per curated pool; senior/junior issuance and lock tiers are not current features."
      />
      <div className="grid grid-cols-4 gap-3 max-[720px]:grid-cols-2">
        {MATCHED.map((t) => (
          <div key={t.name} className="rounded-2xl bg-ground-cool border border-hair p-5 flex flex-col gap-3" style={{ borderTop: `3px solid ${t.accent}` }}>
            <div>
              <div className="font-atx-display text-[16px] font-medium text-ink leading-[1.2]">{t.name}</div>
              <div className="text-[11px] text-ink-soft mt-0.5">{t.dur}</div>
            </div>
            <div className="text-[11px] text-ink-mid leading-[1.5] mt-auto">{t.d}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-soft mt-3 leading-[1.5]">
        Current MarketEngine withdrawals return both pool tokens pro-rata in kind.
      </p>
    </div>
  )
}

// ─── 03 · Trust, enforced on-chain ───────────────────────────────────────────
const TRUST = [
  { k: 'Quote-valued share', d: 'Each engine issues one share token valued in the quote asset.' },
  { k: 'Deposit guard', d: 'Deposits require a fresh mark and spot near that mark.' },
  { k: 'Minimum outputs', d: 'Deposits have a min-shares floor; withdrawals have minimum token outputs.' },
  { k: 'Stale mark', d: 'Withdrawals remain available when the mark is stale.' },
  { k: 'Testnet status', d: 'Live on Robinhood Chain testnet · unaudited. External audit gates real value.' },
]

function TrustOnChain() {
  return (
    <div>
      <SectionHead
        n="03"
        label="Trust · enforced by code, not promises"
        title="You don't have to trust us. Trust the contract."
        sub="The rules that protect your deposit live in the contract — verifiable, and impossible to quietly change."
      />
      <div className="soft-card overflow-hidden">
        {TRUST.map((t, i) => (
          <div key={t.k} className={`flex items-start gap-4 px-6 py-4 ${i < TRUST.length - 1 ? 'border-b border-hair-soft' : ''}`}>
            <span className="w-[8px] h-[8px] rounded-full bg-peri inline-block mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0 flex gap-4 max-[640px]:flex-col max-[640px]:gap-1">
              <div className="font-atx-display text-[15px] font-medium w-[180px] shrink-0 max-[640px]:w-auto text-ink">{t.k}</div>
              <div className="text-[13px] text-ink-mid leading-[1.5]">{t.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 04 · Earn-share card refill · dark pop ──────────────────────────────────
const SPEND = [
  { k: 'Earn shares', d: 'The gateway can redeem a member’s Earn shares' },
  { k: 'Registered buffer', d: 'Assets go to that member’s registered buffer wallet' },
  { k: 'Propose → wait → accept', d: 'A destination change has a 48-hour delay' },
  { k: 'Revoke any time', d: 'The member can revoke the destination registration' },
  { k: 'Daily caps', d: 'Per-user and global UTC-day caps apply' },
]

function SpendableLoop() {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 8% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
      <div className="grain absolute inset-0 opacity-40" aria-hidden />
      <div className="relative p-8 max-[640px]:p-6 border-b border-white/12">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[12px] font-semibold text-pas-peri tabular-nums">04</span>
          <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-white/55">Card refill · pre-enable</span>
        </div>
        <h2 className="font-atx-display font-medium tracking-[-0.035em] leading-[1.02] text-[clamp(1.7rem,4vw,3rem)] text-white [text-wrap:balance]">
          Refill from Earn. <span className="text-pas-peri">No spend from NAV.</span>
        </h2>
        <p className="text-white/60 text-[15px] leading-[1.6] mt-4 max-w-[70ch]">
          Bridge + Stripe card rails are pre-enable. The on-chain gateway redeems Earn shares to a member-registered buffer; it does not authorize card purchases or settle merchants from vault assets.
        </p>
      </div>
      <div className="relative grid grid-cols-5 gap-3 p-6 max-[900px]:grid-cols-1">
        {SPEND.map((s, i) => (
          <div key={s.k} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
            <span className="w-[8px] h-[8px] rounded-full bg-pas-peri inline-block" />
            <div className="font-atx-display text-[14px] font-medium leading-tight text-white">{s.k}</div>
            <div className="text-[12px] text-white/55 leading-[1.45]">{s.d}</div>
            {i < SPEND.length - 1 && <span aria-hidden className="flow-dash-h h-[2px] w-8 mt-auto rounded-full opacity-70 max-[900px]:hidden" />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 05 · Curated pool discovery ────────────────────────────────────────────
function Leaderboard({ data }: { data: AmplifyData | null }) {
  const rows = (data?.leaderboard ?? []).slice(0, 6)
  const anyExample = rows.some((v) => !isRealId(v.id))

  return (
    <div>
      <SectionHead
        n="05"
        label="Discover · candidate ranking"
        title="Candidate pools, curated for MarketEngine."
        sub="Discover uses GeckoTerminal data and a risk score to rank candidate pools. Ranking does not certify a pool."
      />
      <div className="soft-card overflow-hidden">
        {/* header row */}
        <div className="grid grid-cols-[40px_1fr_120px_100px_90px] max-[720px]:grid-cols-[32px_1fr_90px] items-center px-4 py-2.5 border-b border-hair-soft bg-ground-cool">
          <div className={`${LABEL} text-[10px]`}>#</div>
          <div className={`${LABEL} text-[10px]`}>Pool / instance</div>
          <div className={`${LABEL} text-[10px] max-[720px]:hidden`}>Surface</div>
          <div className={`${LABEL} text-[10px] max-[720px]:hidden text-right`}>Status</div>
          <div className={`${LABEL} text-[10px] text-right`}>TVL</div>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-8 text-center text-[12px] text-ink-soft">Loading vaults…</div>
        ) : (
          rows.map((v, i) => {
            const real = isRealId(v.id)
            const rowClass = `grid grid-cols-[40px_1fr_120px_100px_90px] max-[720px]:grid-cols-[32px_1fr_90px] items-center px-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-hair-soft' : ''}`
            const inner = (
              <>
                <div className="text-[15px] font-semibold text-ink-soft tabular-nums">{i + 1}</div>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-[7px] h-[7px] rounded-full inline-block shrink-0" style={{ background: real ? 'var(--color-peri)' : 'var(--color-hair)' }} />
                  <span className="font-atx-display text-[14px] font-medium truncate text-ink">{v.name}</span>
                  <span className={`text-[9px] uppercase tracking-[0.1em] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${real ? 'border-[rgba(108,108,240,0.3)] text-peri-deep' : 'border-hair text-ink-soft'}`}>
                    {real ? 'Registered' : 'Candidate'}
                  </span>
                </div>
                <div className="max-[720px]:hidden text-[12px] text-peri-deep font-medium">
                  {v.surface}
                </div>
                <div className="max-[720px]:hidden text-[13px] text-right text-ink-mid tabular-nums">
                  {v.status}
                </div>
                {/* Real vaults show real TVL; example rows never render a fabricated $ figure. */}
                <div className="text-[13px] font-medium text-right text-ink tabular-nums">
                  {real ? fmtUsd(v.tvlUsd) : <span className="text-ink-soft font-normal">—</span>}
                </div>
              </>
            )
            return <div key={v.id} className={rowClass}>{inner}</div>
          })
        )}
      </div>
      {anyExample && (
        <p className="text-[10px] text-ink-soft mt-2.5 leading-[1.5]">
          Registered pools have an associated MarketEngine. A risk score ranks candidates and does not certify them.
        </p>
      )}
    </div>
  )
}

// ─── Composed ────────────────────────────────────────────────────────────────
export function VaultAmplify() {
  const [data, setData] = useState<AmplifyData | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/vaults/amplify-data')
      .then((r) => r.json())
      .then((d: AmplifyData) => { if (alive) setData(d) })
      .catch(() => { /* band + leaderboard fall back to empty/loading states */ })
    return () => { alive = false }
  }, [])

  return (
    <section className="bg-white text-ink font-atx-display border-t border-hair-soft">
      <div className="max-w-[1100px] mx-auto px-6 py-16 max-[800px]:px-4 max-[800px]:py-12 flex flex-col gap-16 max-[800px]:gap-12">
        <LiveStatsBand />
        <IncomeStreams />
        <Tranches />
        <TrustOnChain />
        <SpendableLoop />
        <Leaderboard data={data} />
      </div>
    </section>
  )
}
