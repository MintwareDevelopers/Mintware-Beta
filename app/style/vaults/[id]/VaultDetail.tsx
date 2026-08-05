'use client'

import { useState } from 'react'
import Link from 'next/link'
import { type VaultDetail, fmtUsd } from '@/lib/vaults/discovery'
import { DealSection } from '@/components/vaults/DealSection'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

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

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'

function ActionPanel({ v }: { v: VaultDetail }) {
  const isDeFi = v.surface === 'DeFi'
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState('')
  const [tierIdx, setTierIdx] = useState(0)
  const tier = v.lockTiers[tierIdx]
  const amt = parseFloat(amount) || 0

  return (
    <div className="border border-atx-ink bg-atx-bone sticky top-[74px]">
      <div className="flex border-b border-atx-ink">
        {(['deposit', 'withdraw'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 font-atx-mono text-[12px] uppercase tracking-[0.1em] py-3 border-r border-atx-ink last:border-r-0 ${
              tab === t ? 'bg-atx-ink text-atx-bone' : 'text-atx-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'deposit' ? (
        <div className="p-[18px]">
          <div className={`${LABEL} mb-2`}>Amount · USDC</div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full border border-atx-ink bg-transparent px-3 py-2.5 font-atx-mono text-[18px] outline-none focus:border-atx-blue"
          />

          {isDeFi && (
            <>
              <div className={`${LABEL} mb-2 mt-5`}>Lock tier</div>
              <div className="grid grid-cols-4 border border-atx-ink">
                {v.lockTiers.map((lt, i) => (
                  <button
                    key={lt.tier}
                    onClick={() => setTierIdx(i)}
                    className={`py-2.5 border-r border-atx-ink last:border-r-0 text-center ${
                      i === tierIdx ? 'bg-atx-blue text-white' : 'text-atx-ink'
                    }`}
                  >
                    <div className="font-atx-mono text-[10px] uppercase tracking-[0.08em]">{lt.tier}</div>
                    <div className="font-atx-mono text-[13px] mt-0.5">{lt.multiplier.toFixed(2)}×</div>
                  </button>
                ))}
              </div>
              <p className="font-atx-mono text-[11px] text-atx-ink/55 mt-2">
                {tier.days === 0 ? 'No lock · withdraw anytime after 7-day notice.' : `${tier.days}-day lock · ${tier.multiplier.toFixed(2)}× FeeVault multiplier.`}
              </p>
            </>
          )}

          {!isDeFi && (
            <p className="font-atx-mono text-[11px] text-atx-ink/55 mt-4">
              Deposit mints vRWA 1:1 with your shares. Holding and trading require the deal’s KYC tier
              unless it trades openly (Reg A+); redemption always re-checks KYC.
            </p>
          )}

          <div className={`mt-5 border-t ${LINE} pt-4 space-y-2`}>
            <div className="flex justify-between font-atx-mono text-[13px]">
              <span className="text-atx-ink/55">You receive</span>
              <span>{amt ? fmtUsd(amt) : '—'} shares</span>
            </div>
            {isDeFi && (
              <div className="flex justify-between font-atx-mono text-[13px]">
                <span className="text-atx-ink/55">Fee multiplier</span>
                <span className="text-atx-blue">{tier.multiplier.toFixed(2)}×</span>
              </div>
            )}
          </div>

          <button
            className={`w-full mt-4 font-semibold text-[14px] py-3 border uppercase tracking-[0.04em] ${
              isDeFi ? 'border-atx-blue bg-atx-blue text-white' : 'border-atx-ink bg-atx-coral text-atx-ink'
            }`}
          >
            Deposit {amt ? fmtUsd(amt) : ''}
          </button>
        </div>
      ) : (
        <div className="p-[18px]">
          {v.position ? (
            <>
              <div className={`${LABEL} mb-2`}>Your position</div>
              <div className="font-atx-mono text-[24px]">{fmtUsd(v.position.depositedUsd)}</div>
              <div className="font-atx-mono text-[12px] text-atx-ink/55 mt-1">
                {v.position.tier} · {v.position.multiplier.toFixed(2)}× · earned {fmtUsd(v.position.earnedUsd)}
              </div>
            </>
          ) : (
            <p className="font-atx-mono text-[13px] text-atx-ink/55">No position in this vault yet.</p>
          )}
          <p className="font-atx-mono text-[11px] text-atx-ink/55 mt-4">
            {isDeFi
              ? 'Request redemption starts a 7-day notice period; early exit before your lock expires incurs a penalty routed to the FeeVault.'
              : 'Request burns your vRWA claim ticket and starts a 30-day settlement window. The issuer settles after a KYC check.'}
          </p>
          <button
            disabled={!v.position}
            className="w-full mt-4 font-semibold text-[14px] py-3 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em] disabled:opacity-40"
          >
            Request Redeem
          </button>
        </div>
      )}
    </div>
  )
}

export function VaultDetailView({ v }: { v: VaultDetail }) {
  const isDeFi = v.surface === 'DeFi'
  const accent = isDeFi ? 'text-atx-blue' : 'text-atx-coral'

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Top bar */}
      <div className="flex items-center gap-3.5 px-7 h-[58px] border-b border-atx-ink/20 sticky top-0 bg-atx-bone z-10">
        <Star className="w-[18px] h-[18px] text-atx-blue" />
        <Link href="/style/vaults" className="font-atx-mono text-[12px] text-atx-ink/55 hover:text-atx-ink">
          Vaults
        </Link>
        <span className="text-atx-ink/40">/</span>
        <span className="font-bold">{v.name}</span>
        <button className="ml-auto font-semibold text-[13px] font-atx-mono px-3 py-1.5 border border-atx-blue bg-atx-blue text-white uppercase tracking-[0.04em]">
          Connect Wallet
        </button>
      </div>

      {/* Header */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="px-7 pt-8 pb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`font-atx-mono text-[11px] uppercase tracking-[0.08em] px-2 py-1 border ${
                  isDeFi ? 'border-atx-blue bg-atx-blue text-white' : 'border-atx-ink bg-atx-coral text-atx-ink'
                }`}
              >
                {v.surface}
              </span>
              <span className="font-atx-mono text-[12px] text-atx-ink/55">{v.pair}</span>
            </div>
            <h1 className="font-bold tracking-[-0.02em] leading-[0.92] text-[clamp(34px,6vw,64px)]">{v.name}</h1>
            <p className="text-atx-ink/55 text-[14px] mt-2 font-atx-mono">{v.descriptor}</p>
          </div>
          <Star className={`w-9 h-9 shrink-0 ${accent}`} />
        </div>
        {/* Stats title-block */}
        <div className="border-t border-atx-ink grid [grid-template-columns:repeat(4,1fr)] max-[720px]:[grid-template-columns:1fr_1fr]">
          {[
            ['Total TVL', fmtUsd(v.tvlUsd), ''],
            ['Net APY', `${v.netApyPct.toFixed(1)}%`, accent],
            ['Epoch', v.epochLabel, ''],
            [isDeFi ? 'Profile' : 'Settle', isDeFi ? `${v.profile} ${v.profileRange}` : `${v.settleDays}d`, ''],
          ].map(([k, val, c], i) => (
            <div key={k} className={`px-7 py-3.5 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
              <div className={`${LABEL} text-[9px] mb-1.5`}>{k}</div>
              <div className={`font-bold text-[16px] ${c}`}>{val}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Body: main + action rail */}
      <div className="px-7 py-8 grid [grid-template-columns:1.55fr_0.85fr] gap-8 max-[900px]:grid-cols-1">
        <div className="min-w-0">
          {/* RWA deal content (team-authored) — only when a real deal is attached */}
          {!isDeFi && v.deal && <DealSection deal={v.deal} />}

          {/* Yield sources */}
          <div className="flex items-center gap-3.5 mb-4">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">01</span>
            <span className={LABEL}>Yield sources</span>
          </div>
          <div className="border border-atx-ink">
            {v.yieldSources.map((y, i) => (
              <div key={y.label} className={`flex items-center gap-4 px-[18px] py-3.5 ${i ? 'border-t ' + LINE : ''}`}>
                <span className="font-atx-mono text-[10px] text-atx-ink/40 w-5">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-[15px] flex-1">{y.label}</span>
                <span className={`font-atx-mono text-[15px] ${i === 0 ? accent : ''}`}>
                  {y.apyPct > 0 ? '+' : ''}{y.apyPct.toFixed(1)}%
                </span>
              </div>
            ))}
            <div className={`flex items-center justify-between px-[18px] py-3.5 border-t border-atx-ink bg-atx-panel`}>
              <span className="font-atx-mono text-[11px] uppercase tracking-[0.1em]">Net APY</span>
              <span className={`font-atx-mono text-[18px] ${accent}`}>{v.netApyPct.toFixed(1)}%</span>
            </div>
          </div>

          {/* Hook stack */}
          <div className="flex items-center gap-3.5 mb-4 mt-9">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">02</span>
            <span className={LABEL}>Hook stack · {v.surface}</span>
          </div>
          <div className="border border-atx-ink">
            {v.hookStack.map((h, i) => (
              <div key={h.name} className={`flex items-center gap-4 px-[18px] py-3.5 ${i ? 'border-t ' + LINE : ''}`}>
                <span className="font-atx-mono text-[12px] border border-atx-ink w-8 h-8 flex items-center justify-center shrink-0">
                  {h.order}
                </span>
                <Star className={`w-4 h-4 shrink-0 ${accent}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[15px] leading-tight">{h.name}</div>
                  <div className="font-atx-mono text-[12px] text-atx-ink/55">{h.note}</div>
                </div>
                <span className="font-atx-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 border border-atx-ink/30 shrink-0">
                  {h.phase}
                </span>
              </div>
            ))}
          </div>

          {v.reserveSplit && (
            <div className="mt-6 border border-atx-ink p-[18px]">
              <div className={`${LABEL} mb-2`}>Capital · reserve / yield</div>
              <div className="flex h-8 border border-atx-ink font-atx-mono text-[11px]">
                <span className="flex items-center justify-center bg-atx-mesquite text-atx-bone border-r border-atx-ink" style={{ flex: v.reserveSplit[0] }}>
                  RESERVE {v.reserveSplit[0]}%
                </span>
                <span className="flex items-center justify-center bg-atx-blue text-white" style={{ flex: v.reserveSplit[1] }}>
                  YIELD {v.reserveSplit[1]}%
                </span>
              </div>
            </div>
          )}
        </div>

        <ActionPanel v={v} />
      </div>
    </div>
  )
}
