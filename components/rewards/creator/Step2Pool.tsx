'use client'

// =============================================================================
// Step2Pool.tsx — Pool size + duration + auto-calculated stats
//
// Token reward: preset pool buttons + duration days, shows daily cap + depletion
// Points:       preset pool + fixed duration presets, shows daily payout + preset
// Advanced:     dailyWalletCapUsd, dailyPoolCapUsd, payoutPreset
// =============================================================================

import { useState } from 'react'
import type { CreatorFormState } from '@/lib/rewards/creator'
import {
  POOL_PRESETS, POINTS_DURATION_PRESETS, PAYOUT_PRESETS,
  dailyBudget, depletionVolumeUsd, fmtUSDShort,
} from '@/lib/rewards/creator'

interface Step2PoolProps {
  form:     CreatorFormState
  onChange: (partial: Partial<CreatorFormState>) => void
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-atx-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-atx-ink/55 mb-[10px]">
      {children}
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-atx-bone border border-atx-ink/25 px-[14px] py-[8px] flex-1 min-w-[120px]">
      <div className="font-atx-mono text-[14px] font-bold text-atx-ink">
        {value}
      </div>
      <div className="font-atx-mono text-[10px] uppercase tracking-[0.06em] text-atx-ink/55 mt-[2px]">
        {label}
      </div>
    </div>
  )
}

function NumberInput({
  value, onChange, prefix, suffix, min, max, step, placeholder,
}: {
  value?:      number
  onChange:    (v: number) => void
  prefix?:     string
  suffix?:     string
  min?:        number
  max?:        number
  step?:       number
  placeholder?: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div className={`flex items-center border bg-atx-panel overflow-hidden transition-[border-color] duration-150${focused ? ' border-atx-blue' : ' border-atx-ink/30'}`}>
      {prefix && (
        <span className="font-atx-mono text-[13px] text-atx-ink/55 select-none pl-3 pr-[10px]">
          {prefix}
        </span>
      )}
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value ?? ''}
        placeholder={placeholder}
        className={`flex-1 border-none outline-none font-atx-mono text-[14px] text-atx-ink bg-transparent min-w-0 ${prefix ? 'py-[10px] pr-0' : 'px-[14px] py-[10px]'}`}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(v)
        }}
      />
      {suffix && (
        <span className="font-atx-mono text-[13px] text-atx-ink/55 select-none px-3">
          {suffix}
        </span>
      )}
    </div>
  )
}

export function Step2Pool({ form, onChange }: Step2PoolProps) {
  const [customPool, setCustomPool] = useState(!POOL_PRESETS.includes(form.poolUsd as typeof POOL_PRESETS[number]))
  const isTokenReward = form.type === 'token_reward'
  const isPoints      = form.type === 'points'
  const daily         = dailyBudget(form)

  return (
    <div className="flex flex-col gap-7">

      {/* Pool size */}
      <div>
        <SectionLabel>Pool size</SectionLabel>
        <div className="flex gap-2 flex-wrap mb-[10px]">
          {POOL_PRESETS.map(p => (
            <button
              key={p}
              className={`font-atx-mono text-[13px] font-bold py-[9px] px-[18px] cursor-pointer border whitespace-nowrap transition-colors duration-150${form.poolUsd === p && !customPool ? ' bg-atx-blue border-atx-ink text-white' : ' bg-atx-panel border-atx-ink/30 text-atx-ink/70 hover:border-atx-ink hover:text-atx-ink'}`}
              onClick={() => { onChange({ poolUsd: p }); setCustomPool(false) }}
            >
              {fmtUSDShort(p)}
            </button>
          ))}
          <button
            className={`font-atx-mono text-[13px] font-bold py-[9px] px-[18px] cursor-pointer border whitespace-nowrap transition-colors duration-150${customPool ? ' bg-atx-blue border-atx-ink text-white' : ' bg-atx-panel border-atx-ink/30 text-atx-ink/70 hover:border-atx-ink hover:text-atx-ink'}`}
            onClick={() => setCustomPool(true)}
          >
            Custom
          </button>
        </div>
        {customPool && (
          <NumberInput
            value={form.poolUsd}
            onChange={(v) => onChange({ poolUsd: v })}
            prefix="$"
            min={0}
            step={1000}
            placeholder="10000"
          />
        )}
      </div>

      {/* Duration */}
      <div>
        <SectionLabel>Duration</SectionLabel>
        {isPoints ? (
          <div className="flex gap-2 flex-wrap">
            {POINTS_DURATION_PRESETS.map(d => (
              <button
                key={d}
                className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] py-2 px-5 cursor-pointer border transition-colors duration-150${form.durationDays === d ? ' bg-atx-blue border-atx-ink text-white' : ' bg-atx-panel border-atx-ink/30 text-atx-ink/60 hover:border-atx-ink hover:text-atx-ink'}`}
                onClick={() => onChange({ durationDays: d })}
              >
                {d} days
              </button>
            ))}
          </div>
        ) : (
          <NumberInput
            value={form.durationDays}
            onChange={(v) => onChange({ durationDays: Math.max(1, Math.round(v)) })}
            suffix="days"
            min={1}
            max={365}
            placeholder="30"
          />
        )}
      </div>

      {/* Auto-calc stats */}
      {form.poolUsd > 0 && form.durationDays > 0 && (
        <div className="flex gap-[10px] flex-wrap">
          {isPoints && (
            <StatChip label="Daily pool cap" value={fmtUSDShort(daily)} />
          )}
          {isTokenReward && (
            <StatChip
              label="Rewards up to"
              value={`~${fmtUSDShort(depletionVolumeUsd(form))} in swap volume`}
            />
          )}
          {isPoints && (
            <StatChip
              label="Daily payout"
              value={fmtUSDShort(daily)}
            />
          )}
          {isPoints && (
            <StatChip
              label="Payout preset"
              value={`Top ${form.payoutPreset}`}
            />
          )}
        </div>
      )}

      {/* Advanced mode extras */}
      {form.advancedMode && (
        <div className="border-t border-atx-ink/20 pt-6 flex flex-col gap-4">
          <div className="font-atx-mono text-[10px] font-bold text-atx-ink/55 tracking-[0.1em] uppercase">
            Advanced settings
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <SectionLabel>Daily wallet cap</SectionLabel>
              <NumberInput
                value={form.dailyWalletCapUsd}
                onChange={(v) => onChange({ dailyWalletCapUsd: v })}
                prefix="$"
                min={0}
                placeholder="No cap"
              />
            </div>
            <div>
              <SectionLabel>Daily pool cap</SectionLabel>
              <NumberInput
                value={form.dailyPoolCapUsd}
                onChange={(v) => onChange({ dailyPoolCapUsd: v })}
                prefix="$"
                min={0}
                placeholder={fmtUSDShort(daily)}
              />
            </div>
          </div>

          {isPoints && (
            <div>
              <SectionLabel>Payout preset</SectionLabel>
              <div className="flex gap-2 flex-wrap">
                {PAYOUT_PRESETS.map(p => (
                  <button
                    key={p.value}
                    className={`font-atx-mono text-[12px] font-semibold uppercase tracking-[0.06em] py-2 px-5 cursor-pointer border transition-colors duration-150${form.payoutPreset === p.value ? ' bg-atx-blue border-atx-ink text-white' : ' bg-atx-panel border-atx-ink/30 text-atx-ink/60 hover:border-atx-ink hover:text-atx-ink'}`}
                    onClick={() => onChange({ payoutPreset: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
