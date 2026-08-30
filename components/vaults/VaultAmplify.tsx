'use client'

// =============================================================================
// VaultAmplify — the value-communication layer beneath vault discovery.
// Design v2 (Privy-esque). Sells the real wedge: never idle + fees shared
// pro-rata by liquidity.
//
//  · Live stats band (evergreen economics, GradientPanel)
//  01 Pro-rata fees (interactive: deposit vs pool → your share of the fees)
//  02 Trust, enforced on-chain
//  03 Vault leaderboard (ranked by TVL, real vs example)
//
// Note: the old reputation=yield / lock-tier reward-multiplier / referral-
// compounding sections were removed — LPs are paid pro-rata by liquidity share,
// not by an Attribution score. Reputation-weighted reward rails are undeployed.
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
    { v: '3', k: 'Income streams · Aave + fees + MEV' },
    { v: 'Pro-rata', k: 'Fees shared by liquidity' },
    { v: 'In testing', k: 'Base Sepolia · audit pending' },
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

// ─── 01 · Pro-rata fees (interactive) ────────────────────────────────────────
function ProRataShare() {
  const [deposit, setDeposit] = useState(10_000)
  const [poolTvl, setPoolTvl] = useState(500_000) // total liquidity in the pool
  const [feeApy, setFeeApy] = useState(8) // % — user-driven model input on the pool's fee take

  const total = Math.max(poolTvl, deposit)
  const share = deposit / total
  const poolFeesPerYr = (total * feeApy) / 100
  const yourFees = poolFeesPerYr * share

  return (
    <div className="soft-card overflow-hidden">
      <div className="p-8 max-[640px]:p-6 border-b border-hair-soft">
        <SectionHead
          n="01"
          label="How you're paid · pro-rata"
          title="Your share of the fees is your share of the liquidity."
          sub="No score, no multiplier, no tiers. The fees a pool earns are split across everyone who provided liquidity, in proportion to how much they put in — standard LP economics. Model it below."
        />
      </div>

      <div className="grid grid-cols-[1fr_1.15fr] max-[820px]:grid-cols-1">
        {/* controls */}
        <div className="p-8 max-[640px]:p-6 border-r border-hair-soft max-[820px]:border-r-0 max-[820px]:border-b flex flex-col gap-7">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Your liquidity</span>
              <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{fmtUsd(deposit)}</span>
            </div>
            <input type="range" min={1000} max={500_000} step={1000} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} className="ypn-range w-full" aria-label="Your liquidity" />
            <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
              <span>$1K</span><span>$500K</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Total pool liquidity</span>
              <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{fmtUsd(poolTvl)}</span>
            </div>
            <input type="range" min={50_000} max={5_000_000} step={50_000} value={poolTvl} onChange={(e) => setPoolTvl(Number(e.target.value))} className="ypn-range w-full" aria-label="Total pool liquidity" />
            <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
              <span>$50K</span><span>$5M</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className={LABEL}>Pool fee + MEV APY</span>
              <span className="font-atx-display text-[22px] font-medium text-ink tabular-nums">{feeApy}%</span>
            </div>
            <input type="range" min={1} max={20} step={1} value={feeApy} onChange={(e) => setFeeApy(Number(e.target.value))} className="ypn-range w-full" aria-label="Pool fee and MEV APY" />
            <div className="flex justify-between mt-1.5 text-[10px] text-ink-soft">
              <span>1%</span><span>model your own · 20%</span>
            </div>
          </div>

          <GradientPanel tone="lavender" className="p-5">
            <div className={`${LABEL} mb-1`}>Your fee share / yr</div>
            <div className="font-atx-display text-[34px] font-medium text-peri-deep leading-none tabular-nums">
              {fmtUsd(yourFees)}
            </div>
            <div className="text-[12px] text-coral2-deep mt-1.5 font-medium">
              {(share * 100).toFixed(1)}% of the pool → {(share * 100).toFixed(1)}% of the fees
            </div>
          </GradientPanel>
        </div>

        {/* share visual */}
        <div className="p-8 max-[640px]:p-6 flex flex-col justify-center gap-5">
          <span className={LABEL}>Your slice of a {fmtUsd(total)} pool</span>
          <div className="h-[26px] rounded-full bg-ground-cool relative overflow-hidden">
            <div className="h-full absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${Math.max(1.5, share * 100)}%`, background: 'var(--color-peri)' }} />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] uppercase tracking-[0.06em] font-semibold text-ink">You · {(share * 100).toFixed(1)}%</span>
            <span className="text-[13px] uppercase tracking-[0.06em] font-semibold text-ink-soft">Everyone else · {(100 - share * 100).toFixed(1)}%</span>
          </div>
          <p className="text-[10px] text-ink-soft mt-1 leading-[1.5]">
            Illustrative model · fee APY is your input, not a Mintware projection. Actual yield varies by pool activity.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── 02 · Trust, enforced on-chain ───────────────────────────────────────────
const TRUST = [
  { k: 'Non-custodial', d: 'You hold ERC-4626 shares. No one — not the team — can move your principal.' },
  { k: 'Fees split on-chain', d: 'Fees flow to LPs pro-rata to the liquidity they provided; the protocol cut is fixed on-chain and any change emits a public event, never a silent tweak.' },
  { k: 'Withdrawal queue', d: 'A 7-day on-chain notice — visible, enforced by the contract, no discretion.' },
  { k: 'Senior / junior tranche', d: 'A senior / junior split keeps the spendable side protected while first-loss capital absorbs volatility — a waterfall, enforced by code.' },
  { k: 'MEV guard in the hook', d: 'Sandwich protection runs before every swap — value stays with LPs, not bots.' },
]

function TrustOnChain() {
  return (
    <div>
      <SectionHead
        n="02"
        label="Trust · enforced by code, not promises"
        title="You don't have to trust us. Trust the contract."
        sub="The rules that protect your deposit live in the contract — verifiable, and impossible to quietly change. Independent audit pending before mainnet."
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

// ─── 03 · Vault leaderboard ──────────────────────────────────────────────────
function Leaderboard({ data }: { data: AmplifyData | null }) {
  const rows = (data?.leaderboard ?? []).slice(0, 6)
  const anyExample = rows.some((v) => !isRealId(v.id))

  return (
    <div>
      <SectionHead
        n="03"
        label="The ecosystem · ranked by TVL"
        title="The vaults, ranked. Depth rises to the top."
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
        <ProRataShare />
        <TrustOnChain />
        <Leaderboard data={data} />
      </div>
    </section>
  )
}
