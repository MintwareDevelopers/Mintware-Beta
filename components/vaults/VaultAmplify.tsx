'use client'

// =============================================================================
// VaultAmplify — the value-communication layer beneath vault discovery.
// Sells the wedge: reputation = yield. Shared by /vaults (production) and the
// /style/vaults preview. ATX Settlemint.
//
//  · Live stats band (real subgraph aggregates, honest empty state)
//  01 Reputation = Yield (interactive: deposit × tier × base-APY sliders)
//  02 How LPing works (five-stage hook engine)
//  03 Lock tiers (the second lever — commitment; real LockLib numbers)
//  04 Trust, enforced on-chain
//  05 Referral compounding loop
//  06 Vault reputation leaderboard (ranked by TVL, real vs example)
// =============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`
  return `$${Math.round(n).toLocaleString()}`
}

const RANGE_CLASS =
  'w-full appearance-none h-[8px] border border-atx-ink bg-atx-bone cursor-pointer ' +
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:h-[18px] ' +
  '[&::-webkit-slider-thumb]:bg-atx-blue [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-atx-ink ' +
  '[&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:cursor-pointer'

// Attribution tiers → fee-share multiplier (matches the rewards multiplier model:
// 0–33 → 1.0×, 34–66 → 1.25×, 67–100 → 1.5×). These are the REAL multipliers.
const TIERS = [
  { key: 'Bronze', mult: 1.0, pct: '0–33 percentile', color: 'var(--color-atx-grey)' },
  { key: 'Silver', mult: 1.25, pct: '34–66 percentile', color: 'var(--color-atx-blue)' },
  { key: 'Gold', mult: 1.5, pct: '67–100 percentile', color: 'var(--color-atx-coral)' },
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
// Real = an on-chain vault (address) or an approved vault (UUID). UUID entries
// resolve at /vault/[id]; slug ids are illustrative examples.
const isRealId = (id: string) => /^0x[0-9a-fA-F]{40}$/.test(id) || isUuid(id)

function SectionHead({ n, label, title, sub }: { n: string; label: string; title: string; sub?: string }) {
  return (
    <div className="mb-8 max-w-[70ch]">
      <div className="flex items-center gap-3.5 mb-4">
        <span className="font-atx-mono text-[13px] border border-atx-ink px-3 py-1.5">{n}</span>
        <span className={LABEL}>{label}</span>
      </div>
      <h2 className="font-atx-display font-bold tracking-[-0.03em] leading-[0.95] text-[clamp(28px,4.5vw,52px)]">
        {title}
      </h2>
      {sub && <p className="text-atx-ink/55 text-[15px] leading-[1.6] mt-4">{sub}</p>}
    </div>
  )
}

// ─── Stats band — evergreen vault economics ──────────────────────────────────
// Deliberately NOT live TVL / vault-count: vaults are pre-launch (testnet-first),
// and per the framing doc we never publish specific TVL/count stats. These three
// facts are true before and after launch.
function LiveStatsBand() {
  const cells = [
    { v: '70%', k: 'Fees to LPs' },
    { v: '1.95×', k: 'Max fee-share multiplier' },
    { v: '4', k: 'Lock tiers · Flex → Core' },
  ]

  return (
    <div className="border border-atx-ink bg-atx-ink text-white">
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-white/15">
        <span className="w-[9px] h-[9px] border border-white/40 inline-block bg-white/25" />
        <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/70">
          In testing · Base — the economics, live at launch
        </span>
      </div>
      <div className="grid grid-cols-3 max-[640px]:grid-cols-1">
        {cells.map((c, i) => (
          <div
            key={c.k}
            className={`px-5 py-5 ${i < cells.length - 1 ? 'border-r border-white/15 max-[640px]:border-r-0 max-[640px]:border-b max-[640px]:border-white/15' : ''}`}
          >
            <div className="font-atx-mono text-[26px] font-bold leading-none">{c.v}</div>
            <div className="font-atx-mono uppercase tracking-[0.1em] text-[10px] text-white/50 mt-2">{c.k}</div>
          </div>
        ))}
      </div>
    </div>
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
    <div className="border border-atx-ink" style={{ backgroundImage: GRID_BG }}>
      <div className="p-8 max-[640px]:p-6 border-b border-atx-ink/20">
        <SectionHead
          n="01"
          label="The wedge · reputation = yield"
          title="Same deposit. Different reputation. Different yield."
          sub="Everyone else pays LPs by size. Mintware weights your fee share by reputation — drive the model below."
        />
      </div>

      <div className="grid grid-cols-[1fr_1.15fr] max-[820px]:grid-cols-1">
        {/* controls */}
        <div className="p-8 max-[640px]:p-6 border-r border-atx-ink/20 max-[820px]:border-r-0 max-[820px]:border-b flex flex-col gap-7">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Your deposit</span>
              <span className="font-atx-mono text-[22px] font-bold text-atx-ink">{fmtUsd(deposit)}</span>
            </div>
            <input
              type="range"
              min={1000}
              max={500_000}
              step={1000}
              value={deposit}
              onChange={(e) => setDeposit(Number(e.target.value))}
              className={RANGE_CLASS}
            />
            <div className="flex justify-between mt-1.5 font-atx-mono text-[10px] text-atx-ink/45">
              <span>$1K</span><span>$500K</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Base swap-fee APY</span>
              <span className="font-atx-mono text-[22px] font-bold text-atx-ink">{baseApy}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={baseApy}
              onChange={(e) => setBaseApy(Number(e.target.value))}
              className={RANGE_CLASS}
            />
            <div className="flex justify-between mt-1.5 font-atx-mono text-[10px] text-atx-ink/45">
              <span>1%</span><span>model your own · 20%</span>
            </div>
          </div>

          <div>
            <span className={`${LABEL} block mb-2.5`}>Your Attribution tier</span>
            <div className="flex border border-atx-ink">
              {TIERS.map((t, i) => (
                <button
                  key={t.key}
                  onClick={() => setTierIdx(i)}
                  className={`flex-1 py-2.5 text-[12px] font-atx-mono uppercase tracking-[0.06em] transition-colors duration-150 ${
                    i > 0 ? 'border-l border-atx-ink' : ''
                  } ${tierIdx === i ? 'bg-atx-ink text-white font-semibold' : 'bg-transparent text-atx-ink/60 hover:text-atx-ink'}`}
                >
                  {t.key}
                </button>
              ))}
            </div>
            <div className="mt-2 font-atx-mono text-[11px] text-atx-ink/45">{active.pct} · {active.mult.toFixed(2)}× fee-share multiplier</div>
          </div>

          <div className="border border-atx-ink bg-atx-panel p-5">
            <div className={`${LABEL} mb-1`}>Your projected fee share / yr</div>
            <div className="font-atx-mono text-[34px] font-bold text-atx-blue leading-none">
              {fmtUsd(baseAnnual * active.mult)}
            </div>
            <div className="font-atx-mono text-[12px] text-atx-mesquite mt-1.5">
              +{fmtUsd(baseAnnual * active.mult - baseAnnual)} vs base — from reputation alone
            </div>
          </div>
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
                  <span className={`font-atx-mono text-[13px] uppercase tracking-[0.06em] ${tierIdx === i ? 'text-atx-ink font-bold' : 'text-atx-ink/55'}`}>
                    {t.key} · {t.mult.toFixed(2)}×
                  </span>
                  <span className={`font-atx-mono text-[15px] font-bold ${tierIdx === i ? 'text-atx-ink' : 'text-atx-ink/60'}`}>
                    {fmtUsd(val)}
                  </span>
                </div>
                <div className="h-[26px] border border-atx-ink relative overflow-hidden">
                  <div
                    className="h-full absolute inset-y-0 left-0 transition-[width] duration-300"
                    style={{ width: `${w}%`, background: t.color, opacity: tierIdx === i ? 1 : 0.5 }}
                  />
                </div>
              </div>
            )
          })}
          <p className="font-atx-mono text-[10px] text-atx-ink/40 mt-1 leading-[1.5]">
            Illustrative model · base APY is your input, not a Mintware projection. Actual yield varies by pool activity.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── 02 · How your deposit works ─────────────────────────────────────────────
const FLOW = [
  { k: 'MEV Protection', d: 'TWAP verify · sandwich guard blocks value leaking to bots' },
  { k: 'Dynamic Fee', d: 'Fee auto-tunes to volatility + depth so LPs capture more' },
  { k: 'Idle Capital', d: 'Un-ranged liquidity routed to yield instead of sitting idle' },
  { k: 'Attribution Split', d: 'Fees split 70/15/10/5, your LP share weighted by reputation' },
  { k: 'FeeVault', d: 'Accrues per-epoch, claimable — no manual compounding' },
]

function HowItWorks() {
  return (
    <div>
      <SectionHead
        n="02"
        label="Deposit once · the vault does the rest"
        title="One deposit. A five-stage V4 hook engine."
        sub="Provide liquidity once. Every swap runs it through a hook stack that protects, optimizes, and pays you — automatically."
      />
      <div className="grid grid-cols-5 max-[900px]:grid-cols-1 border border-atx-ink">
        {FLOW.map((s, i) => (
          <div
            key={s.k}
            className={`p-5 flex flex-col gap-3 ${i < FLOW.length - 1 ? 'border-r border-atx-ink/20 max-[900px]:border-r-0 max-[900px]:border-b' : ''}`}
          >
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-atx-coral shrink-0" />
              <span className="font-atx-mono text-[11px] text-atx-ink/45">0{i + 1}</span>
            </div>
            <div className="text-[15px] font-bold font-atx-display leading-tight">{s.k}</div>
            <div className="text-[12px] text-atx-ink/55 leading-[1.45]">{s.d}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 03 · Lock tiers (real LockLib numbers) ──────────────────────────────────
const LOCK_TIERS = [
  { name: 'Flex', dur: 'No lock', days: 0, mult: 1.0, accent: 'var(--color-atx-grey)' },
  { name: 'Committed', dur: '30 days', days: 30, mult: 1.15, accent: 'var(--color-atx-blue)' },
  { name: 'Aligned', dur: '90 days', days: 90, mult: 1.3, accent: 'var(--color-atx-mesquite)' },
  { name: 'Core', dur: '180 days', days: 180, mult: 1.5, accent: 'var(--color-atx-coral)' },
]

function LockTiers() {
  const maxMult = 1.5
  return (
    <div>
      <SectionHead
        n="03"
        label="The second lever · commitment"
        title="Reputation is who you are. Lock tier is how long you commit."
        sub="The second lever on your fee share: longer locks earn a higher multiplier, and the early-exit penalty tapers to zero as you near unlock."
      />
      <div className="grid grid-cols-4 max-[720px]:grid-cols-2 border border-atx-ink">
        {LOCK_TIERS.map((t, i) => (
          <div
            key={t.name}
            className={`p-5 flex flex-col gap-4 bg-atx-panel ${i < LOCK_TIERS.length - 1 ? 'border-r border-atx-ink/20 max-[720px]:[&:nth-child(2)]:border-r-0' : ''} ${i < 2 ? 'max-[720px]:border-b max-[720px]:border-atx-ink/20' : ''}`}
            style={{ borderTop: `3px solid ${t.accent}` }}
          >
            <div>
              <div className="font-atx-display text-[17px] font-bold">{t.name}</div>
              <div className="font-atx-mono text-[11px] text-atx-ink/50 mt-0.5">{t.dur}</div>
            </div>
            <div>
              <div className="font-atx-mono text-[30px] font-bold leading-none" style={{ color: t.accent }}>
                {t.mult.toFixed(2)}×
              </div>
              <div className="h-[8px] border border-atx-ink mt-2.5 relative overflow-hidden">
                <div className="h-full absolute inset-y-0 left-0" style={{ width: `${(t.mult / maxMult) * 100}%`, background: t.accent }} />
              </div>
            </div>
            <div className="font-atx-mono text-[10px] text-atx-ink/45 leading-[1.5] mt-auto">
              {t.days === 0 ? 'Withdraw anytime · 7-day queue · no penalty' : 'Early exit ≤2.0%, tapering to 0% near unlock'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 04 · Trust, enforced on-chain ───────────────────────────────────────────
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
        n="04"
        label="Trust · enforced by code, not promises"
        title="You don't have to trust us. Trust the contract."
        sub="The rules that protect your deposit live in the contract — verifiable, and impossible to quietly change."
      />
      <div className="border border-atx-ink">
        {TRUST.map((t, i) => (
          <div key={t.k} className={`flex items-start gap-4 px-6 py-4 ${i < TRUST.length - 1 ? 'border-b border-atx-ink/15' : ''}`}>
            <span className="w-[10px] h-[10px] bg-atx-acid border border-atx-ink inline-block mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0 flex gap-4 max-[640px]:flex-col max-[640px]:gap-1">
              <div className="text-[15px] font-bold font-atx-display w-[180px] shrink-0 max-[640px]:w-auto">{t.k}</div>
              <div className="text-[13px] text-atx-ink/60 leading-[1.5]">{t.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 05 · Referral compounding loop + earnings model ─────────────────────────
const LOOP = [
  { k: 'Refer an LP', d: 'Share your link — they deposit into any vault' },
  { k: 'Their TVL sticks', d: 'You earn on their sustained liquidity, not a one-time bounty' },
  { k: 'Sharing score rises', d: 'Active referrals lift your on-chain Sharing signal' },
  { k: 'Attribution rises', d: 'A higher score means a higher tier — permanently' },
  { k: 'Every deposit earns more', d: 'Your own fee share multiplier goes up. Loop repeats.' },
]

// The REAL referral economics (lib/rewards/vault/weightedDistribution.ts):
//   referee boost +10% · referrer 20% of the referred LP's fee earning, lifetime,
//   scaled linearly by the referred LP's Attribution percentile (anti-sybil).
const REFEREE_BOOST = 0.10
const REFERRER_RATE = 0.20
const REF_BASE_APY = 0.08 // illustrative model assumption, same as the wedge default

function ReferralEarnings() {
  const [count, setCount] = useState(8)        // referred LPs
  const [avgDeposit, setAvgDeposit] = useState(15_000)
  const [avgPct, setAvgPct] = useState(70)     // referred LPs' avg Attribution percentile

  const perLpBase = avgDeposit * REF_BASE_APY
  const quality = avgPct / 100
  const referrerPerLp = REFERRER_RATE * perLpBase * quality
  const totalReferrer = count * referrerPerLp
  const totalRefereeBoost = count * REFEREE_BOOST * perLpBase

  // Anti-sybil punchline: one Gold LP earns real money; a score-0 sybil's quality
  // factor is 0, so any number of sybils earns the referrer exactly nothing.
  const oneGold = REFERRER_RATE * (avgDeposit * REF_BASE_APY) * 0.85

  return (
    <div className="border-t border-white/15 p-8 max-[640px]:p-6">
      <div className="flex items-center gap-3.5 mb-6">
        <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink inline-block" />
        <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/55">
          Model your referral income
        </span>
      </div>

      <div className="grid grid-cols-[1fr_1.1fr] max-[820px]:grid-cols-1 gap-8">
        {/* controls */}
        <div className="flex flex-col gap-6">
          <div>
            <div className="flex items-baseline justify-between mb-2.5">
              <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/55">LPs you refer</span>
              <span className="font-atx-mono text-[22px] font-bold text-white">{count}</span>
            </div>
            <input type="range" min={1} max={50} step={1} value={count}
              onChange={(e) => setCount(Number(e.target.value))} className={RANGE_CLASS} />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2.5">
              <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/55">Avg deposit each</span>
              <span className="font-atx-mono text-[22px] font-bold text-white">{fmtUsd(avgDeposit)}</span>
            </div>
            <input type="range" min={1000} max={100_000} step={1000} value={avgDeposit}
              onChange={(e) => setAvgDeposit(Number(e.target.value))} className={RANGE_CLASS} />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2.5">
              <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/55">Their avg Attribution</span>
              <span className="font-atx-mono text-[22px] font-bold text-white">top {100 - avgPct}%</span>
            </div>
            <input type="range" min={1} max={100} step={1} value={avgPct}
              onChange={(e) => setAvgPct(Number(e.target.value))} className={RANGE_CLASS} />
            <div className="font-atx-mono text-[10px] text-white/40 mt-1.5">
              Quality-weighted {quality.toFixed(2)}× — a score-0 sybil earns you nothing.
            </div>
          </div>
        </div>

        {/* result */}
        <div className="flex flex-col gap-4">
          <div className="border border-atx-acid bg-white/[0.04] p-6">
            <div className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/55 mb-1">
              Your referral income / yr — lifetime
            </div>
            <div className="font-atx-mono text-[42px] font-bold leading-none text-atx-acid">
              {fmtUsd(totalReferrer)}
            </div>
            <div className="font-atx-mono text-[12px] text-white/60 mt-2 leading-[1.5]">
              Paid every epoch your referred LPs stay in — not a one-time bounty. Funded from
              Mintware&apos;s margin, so being referred never taxes the LP.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-white/20 p-4">
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-white/45">Your network also earns</div>
              <div className="font-atx-mono text-[19px] font-bold text-white mt-1">+{fmtUsd(totalRefereeBoost)}</div>
              <div className="font-atx-mono text-[10px] text-white/40 mt-0.5">+10% referee boost, on them</div>
            </div>
            <div className="border border-white/20 p-4">
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-white/45">Anti-sybil</div>
              <div className="font-atx-mono text-[13px] font-bold text-white mt-1 leading-tight">
                1 Gold LP {fmtUsd(oneGold)}/yr
              </div>
              <div className="font-atx-mono text-[11px] text-white/45 leading-tight">
                1,000 score-0 sybils $0
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="font-atx-mono text-[10px] text-white/35 mt-6 leading-[1.5]">
        Illustrative model at {(REF_BASE_APY * 100).toFixed(0)}% base swap-fee APY · referrer earns
        {' '}{(REFERRER_RATE * 100).toFixed(0)}% of each referred LP&apos;s fee earning × their Attribution,
        referee earns +{(REFEREE_BOOST * 100).toFixed(0)}%. Actual yield varies by pool activity.
      </p>
    </div>
  )
}

function ReferralLoop() {
  return (
    <div className="border border-atx-ink bg-atx-ink text-white">
      <div className="p-8 max-[640px]:p-6 border-b border-white/15">
        <div className="flex items-center gap-3.5 mb-4">
          <span className="font-atx-mono text-[13px] border border-white/40 px-3 py-1.5">05</span>
          <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/55">Referrals · the compounding loop</span>
        </div>
        <h2 className="font-atx-display font-bold tracking-[-0.03em] leading-[0.95] text-[clamp(28px,4.5vw,52px)]">
          Refer liquidity. Build reputation. Earn more forever.
        </h2>
        <p className="text-white/60 text-[15px] leading-[1.6] mt-4 max-w-[70ch]">
          Other protocols pay a flat bounty. Here, referring an LP feeds your reputation — so you&apos;re paid twice: in fees now, and in a higher multiplier on every future deposit.
        </p>
      </div>
      <div className="grid grid-cols-5 max-[900px]:grid-cols-1 border-b border-white/15">
        {LOOP.map((s, i) => (
          <div
            key={s.k}
            className={`p-5 flex flex-col gap-2.5 ${i < LOOP.length - 1 ? 'border-r border-white/15 max-[900px]:border-r-0 max-[900px]:border-b' : ''}`}
          >
            <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink inline-block" />
            <div className="text-[14px] font-bold font-atx-display leading-tight">{s.k}</div>
            <div className="text-[12px] text-white/55 leading-[1.45]">{s.d}</div>
            {i < LOOP.length - 1 && <span className="font-atx-mono text-white/35 text-[16px] mt-auto max-[900px]:hidden">→</span>}
          </div>
        ))}
      </div>
      <ReferralEarnings />
    </div>
  )
}

// ─── 07 · Vault reputation leaderboard ───────────────────────────────────────
function Leaderboard({ data }: { data: AmplifyData | null }) {
  const rows = (data?.leaderboard ?? []).slice(0, 6)
  const anyExample = rows.some((v) => !isRealId(v.id))

  return (
    <div>
      <SectionHead
        n="06"
        label="The ecosystem · ranked by TVL"
        title="The vaults, ranked. Reputation rises to the top."
        sub="Every vault is public and ranked by liquidity. Live vaults climb automatically as capital flows in — examples are shown until real vaults seed."
      />
      <div className="border border-atx-ink">
        {/* header row */}
        <div className="grid grid-cols-[40px_1fr_120px_100px_90px] max-[720px]:grid-cols-[32px_1fr_90px] items-center px-4 py-2.5 border-b border-atx-ink bg-atx-panel">
          <div className={`${LABEL} text-[10px]`}>#</div>
          <div className={`${LABEL} text-[10px]`}>Vault</div>
          <div className={`${LABEL} text-[10px] max-[720px]:hidden`}>Surface</div>
          <div className={`${LABEL} text-[10px] max-[720px]:hidden text-right`}>Model APY</div>
          <div className={`${LABEL} text-[10px] text-right`}>TVL</div>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-8 text-center font-atx-mono text-[12px] text-atx-ink/45">Loading vaults…</div>
        ) : (
          rows.map((v, i) => {
            const real = isRealId(v.id)
            const clickable = isUuid(v.id) // approved vaults resolve at /vault/[id]
            const rowClass = `grid grid-cols-[40px_1fr_120px_100px_90px] max-[720px]:grid-cols-[32px_1fr_90px] items-center px-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-atx-ink/12' : ''}${clickable ? ' hover:bg-atx-panel no-underline text-inherit' : ''}`
            const inner = (
              <>
                <div className="font-atx-mono text-[15px] font-bold text-atx-ink/40">{i + 1}</div>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-[8px] h-[8px] border border-atx-ink inline-block shrink-0"
                    style={{ background: real ? 'var(--color-atx-acid)' : 'transparent' }}
                  />
                  <span className="font-atx-display text-[14px] font-semibold truncate">{v.name}</span>
                  <span className={`font-atx-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 border shrink-0 ${real ? 'border-atx-ink text-atx-mesquite' : 'border-atx-ink/25 text-atx-ink/40'}`}>
                    {real ? 'Live' : 'Example'}
                  </span>
                  {clickable && <span className="font-atx-mono text-[11px] text-atx-ink/40 max-[720px]:hidden">↗</span>}
                </div>
                <div className="max-[720px]:hidden font-atx-mono text-[12px]" style={{ color: 'var(--color-atx-blue)' }}>
                  {v.surface}
                </div>
                <div className="max-[720px]:hidden font-atx-mono text-[13px] text-right text-atx-ink/70">
                  {v.netApyPct > 0 ? `${v.netApyPct.toFixed(1)}%` : '—'}
                </div>
                {/* Real vaults show real TVL; example rows never render a fabricated $ figure. */}
                <div className="font-atx-mono text-[13px] font-bold text-right">
                  {real ? fmtUsd(v.tvlUsd) : <span className="text-atx-ink/35 font-normal">—</span>}
                </div>
              </>
            )
            return clickable
              ? <Link key={v.id} href={`/vault/${v.id}`} className={rowClass}>{inner}</Link>
              : <div key={v.id} className={rowClass}>{inner}</div>
          })
        )}
      </div>
      {anyExample && (
        <p className="font-atx-mono text-[10px] text-atx-ink/40 mt-2.5 leading-[1.5]">
          Rows marked <span className="text-atx-ink/60">Example</span> illustrate vault types on each surface · APY figures on example rows are illustrative, not projections.
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
    <section className="bg-atx-bone text-atx-ink font-atx-display [&_*]:rounded-none border-t border-atx-ink">
      <div className="max-w-[1100px] mx-auto px-7 py-16 max-[800px]:px-4 max-[800px]:py-10 flex flex-col gap-16 max-[800px]:gap-12">
        <LiveStatsBand />
        <ReputationYield />
        <HowItWorks />
        <LockTiers />
        <TrustOnChain />
        <ReferralLoop />
        <Leaderboard data={data} />
      </div>
    </section>
  )
}
