'use client'

// =============================================================================
// Step2Pool.tsx — Pool size + duration + auto-calculated stats
//
// Token reward: preset pool buttons + duration days, shows daily cap + depletion
// Points:       preset pool + fixed duration presets, shows daily payout + preset
// Advanced:     dailyWalletCapUsd, dailyPoolCapUsd, payoutPreset
// =============================================================================

import { useState } from 'react'
import type { CreatorFormState } from '@/lib/campaigns/creator'
import {
  POOL_PRESETS, POINTS_DURATION_PRESETS, PAYOUT_PRESETS,
  dailyBudget, depletionVolumeUsd, fmtUSDShort,
} from '@/lib/campaigns/creator'

interface Step2PoolProps {
  form:     CreatorFormState
  onChange: (partial: Partial<CreatorFormState>) => void
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily:    'Plus Jakarta Sans, sans-serif',
      fontSize:      12, fontWeight: 700, color: '#8A8C9E',
      letterSpacing: '0.5px', textTransform: 'uppercase',
      marginBottom:  10,
    }}>
      {children}
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background:   '#F7F6FF',
      border:       '1px solid #E0DFFF',
      borderRadius: 8,
      padding:      '8px 14px',
      flex:         1,
      minWidth:     120,
    }}>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color: '#1A1A2E' }}>
        {value}
      </div>
      <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 2 }}>
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
    <div style={{
      display:      'flex',
      alignItems:   'center',
      border:       `1.5px solid ${focused ? '#3A5CE8' : '#E0DFFF'}`,
      borderRadius: 10,
      background:   '#fff',
      overflow:     'hidden',
      transition:   'border-color 150ms',
    }}>
      {prefix && (
        <span style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 13, color: '#8A8C9E',
          padding: '0 10px 0 12px', userSelect: 'none',
        }}>
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
        style={{
          flex: 1, border: 'none', outline: 'none',
          fontFamily: 'DM Mono, monospace', fontSize: 14,
          padding: prefix ? '10px 0' : '10px 14px',
          color: '#1A1A2E', background: 'transparent',
          minWidth: 0,
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(v)
        }}
      />
      {suffix && (
        <span style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 13, color: '#8A8C9E',
          padding: '0 12px', userSelect: 'none',
        }}>
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
    <>
      <style>{`
        .pool-preset-btn {
          font-family: 'DM Mono', monospace;
          font-size: 13px; font-weight: 700;
          padding: 9px 18px; border-radius: 10px;
          cursor: pointer; border: 1.5px solid #E0DFFF;
          background: #fff; color: #3A3C52;
          transition: all 150ms; white-space: nowrap;
        }
        .pool-preset-btn.active { background: #EEF1FF; border-color: #3A5CE8; color: #3A5CE8; }
        .pool-preset-btn:hover:not(.active) { background: #F7F6FF; border-color: #C4C3F0; }
        .dur-preset-btn {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px; font-weight: 600;
          padding: 8px 20px; border-radius: 10px;
          cursor: pointer; border: 1.5px solid #E0DFFF;
          background: #fff; color: #8A8C9E;
          transition: all 150ms;
        }
        .dur-preset-btn.active { background: #EEF1FF; border-color: #3A5CE8; color: #3A5CE8; }
        .dur-preset-btn:hover:not(.active) { background: #F7F6FF; color: #3A3C52; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Pool size */}
        <div>
          <SectionLabel>Pool size</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {POOL_PRESETS.map(p => (
              <button
                key={p}
                className={`pool-preset-btn${form.poolUsd === p && !customPool ? ' active' : ''}`}
                onClick={() => { onChange({ poolUsd: p }); setCustomPool(false) }}
              >
                {fmtUSDShort(p)}
              </button>
            ))}
            <button
              className={`pool-preset-btn${customPool ? ' active' : ''}`}
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {POINTS_DURATION_PRESETS.map(d => (
                <button
                  key={d}
                  className={`dur-preset-btn${form.durationDays === d ? ' active' : ''}`}
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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
          <div style={{
            borderTop: '1px solid #E0DFFF',
            paddingTop: 24,
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 11, fontWeight: 700, color: '#8A8C9E',
              letterSpacing: '1px', textTransform: 'uppercase',
            }}>
              Advanced settings
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PAYOUT_PRESETS.map(p => (
                    <button
                      key={p.value}
                      className={`dur-preset-btn${form.payoutPreset === p.value ? ' active' : ''}`}
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
    </>
  )
}
