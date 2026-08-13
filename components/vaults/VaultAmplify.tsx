'use client'

// =============================================================================
// VaultAmplify — the value-communication layer beneath vault discovery.
// Design v2 (Privy-esque). Sells the wedge: reputation = yield.
//
//  · Live stats band (evergreen economics, GradientPanel)
//  01 Reputation = Yield (interactive: deposit × tier × base-APY sliders)
//  02 Lock tiers (the second lever — commitment; real LockLib numbers)
//  03 Trust, enforced on-chain
//  04 Referral compounding loop (dark 'pop' band + animated flow)
//  05 Vault reputation leaderboard (ranked by TVL, real vs example)
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

// Attribution tiers → fee-share multiplier (0–33 → 1.0×, 34–66 → 1.25×,
// 67–100 → 1.5×). These are the REAL multipliers.
const TIERS = [
  { key: 'Bronze', mult: 1.0, pct: '0–33 percentile', color: 'var(--color-ink-soft)' },
  { key: 'Silver', mult: 1.25, pct: '34–66 percentile', color: 'var(--color-peri)' },
  { key: 'Gold', mult: 1.5, pct: '67–100 percentile', color: 'var(--color-coral2)' },
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
    { v: '70%', k: 'Fees to LPs' },
    { v: '1.95×', k: 'Max fee-share multiplier' },
    { v: '4', k: 'Lock tiers · Flex → Core' },
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

// ─── 01 · Reputation = Yield (interactive) ───────────────────────────────────
function ReputationYield() {
  const [deposit, setDeposit] = useState(10_000)
  const [tierIdx, setTierIdx] = useState(2) // default Gold to show the upside
  const [baseApy, setBaseApy] = useState(8) // % — user-driven model input

  const active = TIERS[tierIdx]
  const baseAnnual = (deposit * baseApy) / 100
  const earnings = TIERS.map((t) => baseAnnual * t.mult)
  const maxEarn = Math.max(...earnings, 1)

  return (
    <div className="soft-card overflow-hidden">
      <div className="p-8 max-[640px]:p-6 border-b border-hair-soft">
        <SectionHead
          n="01"
          label="The wedge · reputation = yield"
          title="Same deposit. Different reputation. Different yield."
          sub="Everyone else pays LPs by size. Mintware weights your fee share by reputation — drive the model below."
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

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Base swap-fee APY</span>
              <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{baseApy}%</span>
            </div>
            <input type="range" min={1} max={20} step={1} value={baseApy} onChange={(e) => setBaseApy(Number(e.target.value))} className="ypn-range w-full" aria-label="Base swap-fee APY" />
            <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
              <span>1%</span><span>model your own · 20%</span>
            </div>
          </div>

          <div>
            <span className={`${LABEL} block mb-2.5`}>Your Attribution tier</span>
            <div className="flex gap-1.5 rounded-full bg-ground-cool border border-hair p-1">
              {TIERS.map((t, i) => (
                <button
                  key={t.key}
                  onClick={() => setTierIdx(i)}
                  className={`flex-1 py-2 rounded-full text-[12px] uppercase tracking-[0.06em] font-semibold transition-colors duration-150 ${tierIdx === i ? 'bg-peri text-white' : 'bg-transparent text-ink-soft hover:text-ink'}`}
                >
                  {t.key}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-ink-soft">{active.pct} · {active.mult.toFixed(2)}× fee-share multiplier</div>
          </div>

          <GradientPanel tone="lavender" className="p-5">
            <div className={`${LABEL} mb-1`}>Your projected fee share / yr</div>
            <div className="font-atx-display text-[34px] font-medium text-peri-deep leading-none tabular-nums">
              {fmtUsd(baseAnnual * active.mult)}
            </div>
            <div className="text-[12px] text-coral2-deep mt-1.5 font-medium">
              +{fmtUsd(baseAnnual * active.mult - baseAnnual)} vs base — from reputation alone
            </div>
          </GradientPanel>
        </div>

        {/* comparison bars */}
        <div className="p-8 max-[640px]:p-6 flex flex-col justify-center gap-5">
          <span className={LABEL}>Same {fmtUsd(deposit)} @ {baseApy}% · every tier</span>
          {TIERS.map((t, i) => {
            const val = baseAnnual * t.mult
            const w = (val / maxEarn) * 100
            return (
              <div key={t.key}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className={`text-[13px] uppercase tracking-[0.06em] font-semibold ${tierIdx === i ? 'text-ink' : 'text-ink-soft'}`}>
                    {t.key} · {t.mult.toFixed(2)}×
                  </span>
                  <span className={`font-atx-display text-[15px] font-medium tabular-nums ${tierIdx === i ? 'text-ink' : 'text-ink-mid'}`}>
                    {fmtUsd(val)}
                  </span>
                </div>
                <div className="h-[26px] rounded-full bg-ground-cool relative overflow-hidden">
                  <div className="h-full absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${w}%`, background: t.color, opacity: tierIdx === i ? 1 : 0.5 }} />
                </div>
              </div>
            )
          })}
          <p className="text-[10px] text-ink-soft mt-1 leading-[1.5]">
            Illustrative model · base APY is your input, not a Mintware projection. Actual yield varies by pool activity.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── 02 · Lock tiers (real LockLib numbers) ──────────────────────────────────
const LOCK_TIERS = [
  { name: 'Flex', dur: 'No lock', days: 0, mult: 1.0, accent: 'var(--color-ink-soft)' },
  { name: 'Committed', dur: '30 days', days: 30, mult: 1.15, accent: 'var(--color-peri)' },
  { name: 'Aligned', dur: '90 days', days: 90, mult: 1.3, accent: 'var(--color-peri-deep)' },
  { name: 'Core', dur: '180 days', days: 180, mult: 1.5, accent: 'var(--color-coral2)' },
]

function LockTiers() {
  const maxMult = 1.5
  return (
    <div>
      <SectionHead
        n="02"
        label="The second lever · commitment"
        title="Reputation is who you are. Lock tier is how long you commit."
        sub="The second lever on your fee share: longer locks earn a higher multiplier, and the early-exit penalty tapers to zero as you near unlock."
      />
      <div className="grid grid-cols-4 gap-3 max-[720px]:grid-cols-2">
        {LOCK_TIERS.map((t) => (
          <div key={t.name} className="rounded-2xl bg-ground-cool border border-hair p-5 flex flex-col gap-4" style={{ borderTop: `3px solid ${t.accent}` }}>
            <div>
              <div className="font-atx-display text-[17px] font-medium text-ink">{t.name}</div>
              <div className="text-[11px] text-ink-soft mt-0.5">{t.dur}</div>
            </div>
            <div>
              <div className="font-atx-display text-[30px] font-medium leading-none tabular-nums" style={{ color: t.accent }}>
                {t.mult.toFixed(2)}×
              </div>
              <div className="h-[8px] rounded-full bg-white border border-hair mt-2.5 relative overflow-hidden">
                <div className="h-full absolute inset-y-0 left-0 rounded-full" style={{ width: `${(t.mult / maxMult) * 100}%`, background: t.accent }} />
              </div>
            </div>
            <div className="text-[10px] text-ink-soft leading-[1.5] mt-auto">
              {t.days === 0 ? 'Withdraw anytime · 7-day queue · no penalty' : 'Early exit ≤2.0%, tapering to 0% near unlock'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 03 · Trust, enforced on-chain ───────────────────────────────────────────
const TRUST = [
  { k: 'Non-custodial', d: 'You hold ERC-4626 shares. No one — not the team — can move your principal.' },
  { k: 'Fee split on-chain', d: 'The 70/15/10/5 LP/referrer/protocol/bonus split lives in the FeeVault — any change emits a public event, never a silent tweak.' },
  { k: 'Withdrawal queue', d: 'A 7-day on-chain notice — visible, enforced by the contract, no discretion.' },
  { k: 'Lock tiers enforced', d: 'Your multiplier and unlock date live on-chain; early exit penalty is automatic.' },
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

// ─── 04 · Referral compounding loop · dark pop ───────────────────────────────
const LOOP = [
  { k: 'Refer an LP', d: 'Share your link — they deposit into any vault' },
  { k: 'Their TVL sticks', d: 'You earn on their sustained liquidity, not a one-time bounty' },
  { k: 'Sharing score rises', d: 'Active referrals lift your on-chain Sharing signal' },
  { k: 'Attribution rises', d: 'A higher score means a higher tier — permanently' },
  { k: 'Every deposit earns more', d: 'Your own fee share multiplier goes up. Loop repeats.' },
]

function ReferralLoop() {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 120% at 8% 0%, rgba(108,108,240,0.34), transparent 60%), radial-gradient(50% 130% at 100% 100%, rgba(244,161,131,0.14), transparent 62%)' }} />
      <div className="grain absolute inset-0 opacity-40" aria-hidden />
      <div className="relative p-8 max-[640px]:p-6 border-b border-white/12">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[12px] font-semibold text-pas-peri tabular-nums">04</span>
          <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-white/55">Referrals · the compounding loop</span>
        </div>
        <h2 className="font-atx-display font-medium tracking-[-0.035em] leading-[1.02] text-[clamp(1.7rem,4vw,3rem)] text-white [text-wrap:balance]">
          Refer liquidity. Build reputation. <span className="text-pas-peri">Earn more forever.</span>
        </h2>
        <p className="text-white/60 text-[15px] leading-[1.6] mt-4 max-w-[70ch]">
          Other protocols pay a flat bounty. Here, referring an LP feeds your reputation — so you're paid twice: in fees now, and in a higher multiplier on every future deposit.
        </p>
      </div>
      <div className="relative grid grid-cols-5 gap-3 p-6 max-[900px]:grid-cols-1">
        {LOOP.map((s, i) => (
          <div key={s.k} className="rounded-2xl bg-white/[0.06] border border-white/15 p-5 flex flex-col gap-2.5">
            <span className="w-[8px] h-[8px] rounded-full bg-pas-peri inline-block" />
            <div className="font-atx-display text-[14px] font-medium leading-tight text-white">{s.k}</div>
            <div className="text-[12px] text-white/55 leading-[1.45]">{s.d}</div>
            {i < LOOP.length - 1 && <span aria-hidden className="flow-dash-h h-[2px] w-8 mt-auto rounded-full opacity-70 max-[900px]:hidden" />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 05 · Vault reputation leaderboard ───────────────────────────────────────
function Leaderboard({ data }: { data: AmplifyData | null }) {
  const rows = (data?.leaderboard ?? []).slice(0, 6)
  const anyExample = rows.some((v) => !isRealId(v.id))

  return (
    <div>
      <SectionHead
        n="05"
        label="The ecosystem · ranked by TVL"
        title="The vaults, ranked. Reputation rises to the top."
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
        <ReputationYield />
        <LockTiers />
        <TrustOnChain />
        <ReferralLoop />
        <Leaderboard data={data} />
      </div>
    </section>
  )
}
