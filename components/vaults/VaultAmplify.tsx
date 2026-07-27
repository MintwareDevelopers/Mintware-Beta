'use client'

// =============================================================================
// VaultAmplify — the value-communication layer beneath vault discovery.
// Sells the wedge: reputation = yield. Shared by /vaults (production) and the
// /style/vaults preview. ATX Settlemint.
//
// Sections: 01 Reputation = Yield (interactive) · 02 How LPing works ·
//           03 Trust enforced on-chain · 04 Referral compounding loop ·
//           05 DeFi vs RWA.
// =============================================================================

import { useState } from 'react'

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

// Attribution tiers → fee-share multiplier (matches the rewards multiplier model:
// 0–33 → 1.0×, 34–66 → 1.25×, 67–100 → 1.5×). These are the REAL multipliers.
const TIERS = [
  { key: 'Bronze', mult: 1.0, pct: '0–33 percentile', color: 'var(--color-atx-grey)' },
  { key: 'Silver', mult: 1.25, pct: '34–66 percentile', color: 'var(--color-atx-blue)' },
  { key: 'Gold', mult: 1.5, pct: '67–100 percentile', color: 'var(--color-atx-coral)' },
] as const

// Illustrative base swap-fee APY on the DeFi surface (before the reputation multiplier).
// Tune per your target pools — kept explicit + labelled so it never reads as a promise.
const BASE_APY = 0.08

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

// ─── 01 · Reputation = Yield (interactive) ───────────────────────────────────
function ReputationYield() {
  const [deposit, setDeposit] = useState(10_000)
  const [tierIdx, setTierIdx] = useState(2) // default Gold to show the upside

  const active = TIERS[tierIdx]
  const baseAnnual = deposit * BASE_APY
  const earnings = TIERS.map((t) => baseAnnual * t.mult)
  const maxEarn = Math.max(...earnings)

  return (
    <div className="border border-atx-ink" style={{ backgroundImage: GRID_BG }}>
      <div className="p-8 max-[640px]:p-6 border-b border-atx-ink/20">
        <SectionHead
          n="01"
          label="The wedge · reputation = yield"
          title="Same deposit. Different reputation. Different yield."
          sub="Everyone else pays LPs by size. Mintware weights your fee share by your on-chain Attribution score — so the exact same deposit earns more the higher your reputation. Your history isn't just a number. It's a multiplier."
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
              className="w-full appearance-none h-[8px] border border-atx-ink bg-atx-bone cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:h-[18px]
                [&::-webkit-slider-thumb]:bg-atx-blue [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-atx-ink
                [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <div className="flex justify-between mt-1.5 font-atx-mono text-[10px] text-atx-ink/45">
              <span>$1K</span><span>$500K</span>
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
          <span className={LABEL}>Same {fmtUsd(deposit)} · every tier</span>
          {TIERS.map((t, i) => {
            const val = baseAnnual * t.mult
            const w = maxEarn > 0 ? (val / maxEarn) * 100 : 0
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
            Illustrative · assumes an {(BASE_APY * 100).toFixed(0)}% base swap-fee APY before the Attribution multiplier.
            Actual yield varies by pool activity.
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
  { k: 'Attribution Split', d: 'Fees split 50 / 25 / 25, your share weighted by reputation' },
  { k: 'FeeVault', d: 'Accrues per-epoch, claimable — no manual compounding' },
]

function HowItWorks() {
  return (
    <div>
      <SectionHead
        n="02"
        label="Deposit once · the vault does the rest"
        title="One deposit. A five-stage V4 hook engine."
        sub="You provide liquidity once. Every swap that touches the pool runs your capital through a hook stack that protects it, optimizes it, and pays you — automatically."
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

// ─── 03 · Trust, enforced on-chain ───────────────────────────────────────────
const TRUST = [
  { k: 'Non-custodial', d: 'You hold ERC-4626 shares. No one — not the team — can move your principal.' },
  { k: 'Fee split is code', d: 'The 50 / 25 / 25 depositor/protocol/provider split is hardcoded, not a policy.' },
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
        sub="The best vaults in the market moved trust from intermediaries to on-chain enforcement. Mintware is built the same way: the rules that protect your deposit are in the code, verifiable, and can't be quietly changed."
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

// ─── 04 · Referral compounding loop ──────────────────────────────────────────
const LOOP = [
  { k: 'Refer an LP', d: 'Share your link — they deposit into any vault' },
  { k: 'Their TVL sticks', d: 'You earn on their sustained liquidity, not a one-time bounty' },
  { k: 'Sharing score rises', d: 'Active referrals lift your on-chain Sharing signal' },
  { k: 'Attribution rises', d: 'A higher score means a higher tier — permanently' },
  { k: 'Every deposit earns more', d: 'Your own fee share multiplier goes up. Loop repeats.' },
]

function ReferralLoop() {
  return (
    <div className="border border-atx-ink bg-atx-ink text-white">
      <div className="p-8 max-[640px]:p-6 border-b border-white/15">
        <div className="flex items-center gap-3.5 mb-4">
          <span className="font-atx-mono text-[13px] border border-white/40 px-3 py-1.5">04</span>
          <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/55">Referrals · the compounding loop</span>
        </div>
        <h2 className="font-atx-display font-bold tracking-[-0.03em] leading-[0.95] text-[clamp(28px,4.5vw,52px)]">
          Refer liquidity. Build reputation. Earn more forever.
        </h2>
        <p className="text-white/60 text-[15px] leading-[1.6] mt-4 max-w-[70ch]">
          Other protocols pay a flat referral bounty. Here, referring an LP feeds your reputation — and reputation is yield. It's the only referral program that pays you twice: once in fees, and again by raising the multiplier on every deposit you'll ever make.
        </p>
      </div>
      <div className="grid grid-cols-5 max-[900px]:grid-cols-1">
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
    </div>
  )
}

// ─── 05 · DeFi vs RWA ────────────────────────────────────────────────────────
function SurfaceSplit() {
  const cols = [
    {
      tag: 'DeFi surface',
      accent: 'var(--color-atx-blue)',
      head: 'Earn from on-chain activity',
      rows: [
        ['Yield source', 'Swap fees + idle-capital + MEV capture'],
        ['Risk shape', 'Smart-contract + market volatility'],
        ['Protection', 'MEV guard · dynamic fee · range optimization'],
        ['Access', 'Permissionless · deposit anytime'],
        ['Best for', 'Active on-chain LPs chasing real trading yield'],
      ],
    },
    {
      tag: 'RWA surface',
      accent: 'var(--color-atx-coral)',
      head: 'Earn from real-world yield',
      rows: [
        ['Yield source', 'Underlying asset (credit, notes, energy) + fees'],
        ['Risk shape', 'Issuer / counterparty · oracle-banded price'],
        ['Protection', 'SPV-wrapped · oracle price bands · 40/60 reserve'],
        ['Access', 'KYC at redemption · 30-day settlement window'],
        ['Best for', 'Allocators wanting off-chain yield, on-chain rails'],
      ],
    },
  ]
  return (
    <div>
      <SectionHead
        n="05"
        label="Two surfaces · one ERC-4626 base"
        title="Pick your surface. Same reputation engine underneath."
        sub="DeFi and RWA are different animals — different yield, different risk, different audience. Mintware runs both on one shared vault base, so your Attribution score compounds across everything you touch."
      />
      <div className="grid grid-cols-2 max-[820px]:grid-cols-1 gap-4">
        {cols.map((c) => (
          <div key={c.tag} className="border border-atx-ink bg-atx-panel" style={{ borderTop: `3px solid ${c.accent}` }}>
            <div className="p-6 border-b border-atx-ink/20">
              <div className="font-atx-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: c.accent }}>{c.tag}</div>
              <div className="text-[20px] font-bold font-atx-display mt-1.5">{c.head}</div>
            </div>
            <div>
              {c.rows.map(([k, v], i) => (
                <div key={k} className={`flex gap-4 px-6 py-3.5 ${i < c.rows.length - 1 ? 'border-b border-atx-ink/12' : ''}`}>
                  <div className={`${LABEL} text-[10px] w-[92px] shrink-0 pt-0.5`}>{k}</div>
                  <div className="text-[13px] text-atx-ink/80 leading-[1.4]">{v}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Composed ────────────────────────────────────────────────────────────────
export function VaultAmplify() {
  return (
    <section className="bg-atx-bone text-atx-ink font-atx-display [&_*]:rounded-none border-t border-atx-ink">
      <div className="max-w-[1100px] mx-auto px-7 py-16 max-[800px]:px-4 max-[800px]:py-10 flex flex-col gap-16 max-[800px]:gap-12">
        <ReputationYield />
        <HowItWorks />
        <TrustOnChain />
        <ReferralLoop />
        <SurfaceSplit />
      </div>
    </section>
  )
}
