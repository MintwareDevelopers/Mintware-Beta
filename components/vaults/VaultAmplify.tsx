'use client'

// =============================================================================
// VaultAmplify — the value-communication layer beneath vault discovery.
// Design v2 (Privy-esque). Sells the current wedge: one balance, three income
// streams, earned pro-rata, and spendable while it earns. NO reputation- or
// lock-multiplier weighting — pair vaults pay pro-rata by your share.
//
//  · Live stats band (evergreen economics, GradientPanel)
//  01 Three income streams (interactive: deposit × per-stream APY sliders)
//  02 Dual-sided / senior-junior tranches (how the market gets made)
//  03 Trust, enforced on-chain
//  04 Earning here, spendable there (dark 'pop' band)
//  05 Vault leaderboard (ranked by TVL, real vs example)
// =============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GradientPanel } from '@/components/ui2/GradientPanel'

const LABEL = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`
  return `$${Math.round(n).toLocaleString()}`
}

// The three income streams that stack on one balance. The colors mirror the
// homepage's stacked-yield device (lending / swap fees / recaptured MEV).
const STREAMS = [
  { key: 'Best-rate lending', short: 'Lending', color: 'var(--color-peri)' },
  { key: 'Swap fees', short: 'Swap fees', color: 'var(--color-peri-mid)' },
  { key: 'Recaptured MEV', short: 'Recaptured MEV', color: 'var(--color-coral2)' },
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
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const isRealId = (id: string) => /^0x[0-9a-fA-F]{40}$/.test(id) || isUuid(id)

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
    { v: '3', k: 'Income streams · one balance' },
    { v: '60%', k: 'Fees to LPs · pro-rata' },
    { v: '0', k: 'Rebalances you manage' },
  ]

  return (
    <GradientPanel tone="periwinkle" className="p-6 max-[800px]:p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />
        <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-mid">
          In testing · Base — the economics, live at launch
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

// ─── 01 · Three income streams (interactive) ─────────────────────────────────
function IncomeStreams() {
  const [deposit, setDeposit] = useState(10_000)
  // Each stream's APY is the user's own input — illustrative, not a Mintware
  // projection. A plain USDC lender earns the first stream only.
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
          title="Same deposit. Three income streams instead of one."
          sub="A plain lender earns one rate. Mintware stacks best-rate lending, swap fees, and recaptured MEV on the same balance — drive the model below."
        />
      </div>

      <div className="grid grid-cols-[1fr_1.15fr] max-[820px]:grid-cols-1">
        {/* controls */}
        <div className="p-8 max-[640px]:p-6 border-r border-hair-soft max-[820px]:border-r-0 max-[820px]:border-b flex flex-col gap-7">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Your deposit</span>
              <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{fmtUsd(deposit)}</span>
            </div>
            <input type="range" min={1000} max={500_000} step={1000} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} className="ypn-range w-full" aria-label="Your deposit" />
            <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
              <span>$1K</span><span>$500K</span>
            </div>
          </div>

          {STREAMS.map((s, i) => (
            <div key={s.key}>
              <div className="flex items-baseline justify-between mb-3">
                <span className={LABEL}>{s.key} APY</span>
                <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{streamApys[i]}%</span>
              </div>
              <input type="range" min={0} max={12} step={1} value={streamApys[i]} onChange={(e) => setters[i](Number(e.target.value))} className="ypn-range w-full" aria-label={`${s.key} APY`} />
              <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
                <span>0%</span><span>model your own · 12%</span>
              </div>
            </div>
          ))}

          <GradientPanel tone="lavender" className="p-5">
            <div className={`${LABEL} mb-1`}>Your projected earnings / yr</div>
            <div className="font-atx-display text-[34px] font-medium text-peri-deep leading-none tabular-nums">
              {fmtUsd(totalEarn)}
            </div>
            <div className="text-[12px] text-coral2-deep mt-1.5 font-medium">
              +{fmtUsd(totalEarn - lenderEarn)} vs lending alone — from swap fees + MEV
            </div>
          </GradientPanel>
        </div>

        {/* comparison bars */}
        <div className="p-8 max-[640px]:p-6 flex flex-col justify-center gap-5">
          <span className={LABEL}>Same {fmtUsd(deposit)} · lender vs the three-stream vault</span>

          {/* plain lender — lending only */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[13px] uppercase tracking-[0.06em] font-semibold text-ink-soft">USDC lender · one stream</span>
              <span className="font-atx-display text-[15px] font-medium tabular-nums text-ink-mid">{fmtUsd(lenderEarn)}</span>
            </div>
            <div className="h-[26px] rounded-full bg-ground-cool relative overflow-hidden">
              <div className="h-full absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${(lenderEarn / maxEarn) * 100}%`, background: 'var(--color-ink-soft)', opacity: 0.55 }} />
            </div>
          </div>

          {/* mintware — three streams stacked */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[13px] uppercase tracking-[0.06em] font-semibold text-ink">Mintware vault · three streams</span>
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
            Illustrative model · each APY is your input, not a Mintware projection. You earn your pro-rata share of what the pool actually makes.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── 02 · Dual-sided / senior-junior tranches ────────────────────────────────
const MATCHED = [
  { name: 'Team locks its token', dur: 'One side of the pair', accent: 'var(--color-peri)', d: 'Cliff-locked on-chain for ≥90 days — a restriction on withdrawal, not a transfer of ownership.' },
  { name: 'Community matches USDC', dur: 'The other side', accent: 'var(--color-peri-deep)', d: 'Real, two-sided depth funded by the people backing the launch — not a promise of it.' },
  { name: 'Senior tranche', dur: 'Community capital', accent: 'var(--color-peri-mid)', d: 'Sits senior, redeemable at par — it holds its value while the pool works.' },
  { name: 'Junior tranche', dur: 'Team capital', accent: 'var(--color-coral2)', d: 'First-loss: it absorbs the swings first, so the senior side stays steady.' },
]

function Tranches() {
  return (
    <div>
      <SectionHead
        n="02"
        label="Dual-sided · how the market gets made"
        title="Liquidity isn’t a solo act. Two sides make the market together."
        sub="A matched vault pairs a team’s token with community USDC — cliff-locked and split into senior and junior tranches, so real depth is there from the first swap."
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
        Every backer earns their pro-rata share of all three income streams — by the size of their stake, and nothing else.
      </p>
    </div>
  )
}

// ─── 03 · Trust, enforced on-chain ───────────────────────────────────────────
const TRUST = [
  { k: 'Non-custodial', d: 'You hold ERC-4626 shares. No one — not the team — can move your principal.' },
  { k: 'Fee split on-chain', d: 'The 60/30/10 LP/treasury/buybacks split is enforced by the vault contract — any change emits a public event, never a silent tweak.' },
  { k: 'Withdrawal queue', d: 'A 7-day on-chain notice — visible, enforced by the contract, no discretion.' },
  { k: 'Lock cliffs enforced', d: 'A matched vault’s ≥90-day cliff and unlock date live on-chain; the early-exit penalty is automatic.' },
  { k: 'MEV guard in the hook', d: 'Sandwich protection runs before every swap — value stays with LPs, not bots.' },
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

// ─── 04 · Earning here, spendable there · dark pop ───────────────────────────
const SPEND = [
  { k: 'Capital earns in the vault', d: 'All three income streams stack on one balance' },
  { k: 'Nothing is locked away', d: 'The balance stays spendable as USDC while it works' },
  { k: 'Spend on the card or the wire', d: 'Pay anywhere your USDC is accepted' },
  { k: 'A spend is a hold', d: 'Not a withdrawal — your position never unwinds' },
  { k: 'Settled to the cent', d: 'Only the yield moves. The position keeps earning.' },
]

function SpendableLoop() {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 8% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
      <div className="grain absolute inset-0 opacity-40" aria-hidden />
      <div className="relative p-8 max-[640px]:p-6 border-b border-white/12">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[12px] font-semibold text-pas-peri tabular-nums">04</span>
          <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-white/55">The Liquid Sovereign Account · spend the yield</span>
        </div>
        <h2 className="font-atx-display font-medium tracking-[-0.035em] leading-[1.02] text-[clamp(1.7rem,4vw,3rem)] text-white [text-wrap:balance]">
          Earning here. <span className="text-pas-peri">Spendable there.</span>
        </h2>
        <p className="text-white/60 text-[15px] leading-[1.6] mt-4 max-w-[70ch]">
          Most yield locks your capital away. Here the balance keeps earning while it stays spendable as USDC — on a card or over the wire. A spend is a hold against the earning position, never an unwind.
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

// ─── 05 · Vault leaderboard ──────────────────────────────────────────────────
function Leaderboard({ data }: { data: AmplifyData | null }) {
  const rows = (data?.leaderboard ?? []).slice(0, 6)
  const anyExample = rows.some((v) => !isRealId(v.id))

  return (
    <div>
      <SectionHead
        n="05"
        label="The ecosystem · ranked by TVL"
        title="The vaults, ranked. Liquidity rises to the top."
        sub="Every vault is public and ranked by liquidity. Live vaults climb automatically as capital flows in — examples are shown until real vaults seed."
      />
      <div className="soft-card overflow-hidden">
        {/* header row */}
        <div className="grid grid-cols-[40px_1fr_120px_100px_90px] max-[720px]:grid-cols-[32px_1fr_90px] items-center px-4 py-2.5 border-b border-hair-soft bg-ground-cool">
          <div className={`${LABEL} text-[10px]`}>#</div>
          <div className={`${LABEL} text-[10px]`}>Vault</div>
          <div className={`${LABEL} text-[10px] max-[720px]:hidden`}>Surface</div>
          <div className={`${LABEL} text-[10px] max-[720px]:hidden text-right`}>Model APY</div>
          <div className={`${LABEL} text-[10px] text-right`}>TVL</div>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-8 text-center text-[12px] text-ink-soft">Loading vaults…</div>
        ) : (
          rows.map((v, i) => {
            const real = isRealId(v.id)
            const clickable = isUuid(v.id) // approved vaults resolve at /vault/[id]
            const rowClass = `grid grid-cols-[40px_1fr_120px_100px_90px] max-[720px]:grid-cols-[32px_1fr_90px] items-center px-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-hair-soft' : ''}${clickable ? ' hover:bg-ground-cool no-underline text-inherit' : ''}`
            const inner = (
              <>
                <div className="text-[15px] font-semibold text-ink-soft tabular-nums">{i + 1}</div>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-[7px] h-[7px] rounded-full inline-block shrink-0" style={{ background: real ? 'var(--color-peri)' : 'var(--color-hair)' }} />
                  <span className="font-atx-display text-[14px] font-medium truncate text-ink">{v.name}</span>
                  <span className={`text-[9px] uppercase tracking-[0.1em] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${real ? 'border-[rgba(108,108,240,0.3)] text-peri-deep' : 'border-hair text-ink-soft'}`}>
                    {real ? 'Live' : 'Example'}
                  </span>
                  {clickable && <span className="text-[11px] text-ink-soft max-[720px]:hidden">↗</span>}
                </div>
                <div className="max-[720px]:hidden text-[12px] text-peri-deep font-medium">
                  {v.surface}
                </div>
                <div className="max-[720px]:hidden text-[13px] text-right text-ink-mid tabular-nums">
                  {v.netApyPct > 0 ? `${v.netApyPct.toFixed(1)}%` : '—'}
                </div>
                {/* Real vaults show real TVL; example rows never render a fabricated $ figure. */}
                <div className="text-[13px] font-medium text-right text-ink tabular-nums">
                  {real ? fmtUsd(v.tvlUsd) : <span className="text-ink-soft font-normal">—</span>}
                </div>
              </>
            )
            return clickable
              ? <Link key={v.id} href={`/app/vault/${v.id}`} className={rowClass}>{inner}</Link>
              : <div key={v.id} className={rowClass}>{inner}</div>
          })
        )}
      </div>
      {anyExample && (
        <p className="text-[10px] text-ink-soft mt-2.5 leading-[1.5]">
          Rows marked <span className="text-ink-mid">Example</span> illustrate vault types on each surface · APY figures on example rows are illustrative, not projections.
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
