'use client'

// =============================================================================
// Step3Actions.tsx — Reward configuration
//
// Token reward (simple):
//   buyer_reward_pct slider 0–1%, default 0.5%
//   referral_reward_pct slider 0–5%, default 3%
//   Platform fee 2% (informational)
//   LivePreview card
//
// Token reward (advanced):
//   + use_score_multiplier toggle
//   + referral_hold_hours arc (default 9h)
//
// Points (simple):
//   Focus selector: Trade | Bridge | Trade + Bridge
//   points_per_usd_trade input (default 10)
//   fixed_bridge_points input (default 500)
//
// Points (advanced):
//   + referral base_points, share_pct
//   + attribution multiplier, sharing multiplier toggles
//   + min_daily_volume_usd, max_points_per_wallet_pct
// =============================================================================

import type { CreatorFormState, PointsFocus } from '@/lib/rewards/creator'
import { fmtPct } from '@/lib/rewards/creator'
import { LivePreview } from '@/components/creator/LivePreview'

interface Step3ActionsProps {
  form:     CreatorFormState
  onChange: (partial: Partial<CreatorFormState>) => void
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      fontSize: 12, fontWeight: 700, color: '#8A8C9E',
      letterSpacing: '0.5px', textTransform: 'uppercase',
      marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

// Slider with custom fill track
function RewardSlider({
  label, value, min, max, step, onChange, formatValue, color = '#3A5CE8',
}: {
  label:       string
  value:       number
  min:         number
  max:         number
  step:        number
  onChange:    (v: number) => void
  formatValue: (v: number) => string
  color?:      string
}) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <>
      <style>{`
        .reward-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          outline: none;
          cursor: pointer;
        }
        .reward-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid #3A5CE8;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.15);
        }
        .reward-slider::-moz-range-thumb {
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid #3A5CE8;
          cursor: pointer;
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#3A3C52' }}>
            {label}
          </span>
          <span style={{
            fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color,
          }}>
            {formatValue(value)}
          </span>
        </div>
        <input
          type="range"
          className="reward-slider"
          min={min} max={max} step={step}
          value={value}
          style={{
            background: `linear-gradient(to right, ${color} ${pct}%, #E0DFFF ${pct}%)`,
          }}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#C4C3F0' }}>
            {formatValue(min)}
          </span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#C4C3F0' }}>
            {formatValue(max)}
          </span>
        </div>
      </div>
    </>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      onClick={() => onChange(!value)}
    >
      <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#3A3C52' }}>
        {label}
      </span>
      <div style={{
        width: 40, height: 22, borderRadius: 11,
        background: value ? '#3A5CE8' : '#E0DFFF',
        position: 'relative', transition: 'background 200ms', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 3,
          left: value ? 21 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff',
          transition: 'left 200ms',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
    </div>
  )
}

function NumberField({
  label, value, onChange, prefix, suffix, min, max, step,
}: {
  label:    string
  value:    number
  onChange: (v: number) => void
  prefix?:  string
  suffix?:  string
  min?:     number
  max?:     number
  step?:    number
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div style={{
        display: 'flex', alignItems: 'center',
        border: '1.5px solid #E0DFFF', borderRadius: 10, background: '#fff', overflow: 'hidden',
      }}>
        {prefix && (
          <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', padding: '0 10px 0 12px' }}>
            {prefix}
          </span>
        )}
        <input
          type="number" min={min} max={max} step={step ?? 1} value={value}
          style={{ flex: 1, border: 'none', outline: 'none', fontFamily: 'DM Mono, monospace', fontSize: 14, padding: prefix ? '10px 0' : '10px 14px', color: '#1A1A2E', background: 'transparent', minWidth: 0 }}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v) }}
        />
        {suffix && (
          <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E', padding: '0 12px' }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

const FOCUS_OPTIONS: { value: PointsFocus; label: string }[] = [
  { value: 'trade',  label: 'Trade'          },
  { value: 'bridge', label: 'Bridge'         },
  { value: 'both',   label: 'Trade + Bridge' },
]

export function Step3Actions({ form, onChange }: Step3ActionsProps) {
  const isTokenReward = form.type === 'token_reward'

  if (isTokenReward) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Sliders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <RewardSlider
            label="Buyer reward"
            value={form.buyerRewardPct}
            min={0} max={1} step={0.05}
            onChange={(v) => onChange({ buyerRewardPct: v })}
            formatValue={(v) => fmtPct(v)}
            color="#3A5CE8"
          />
          <RewardSlider
            label="Referral reward"
            value={form.referralRewardPct}
            min={0} max={5} step={0.1}
            onChange={(v) => onChange({ referralRewardPct: v })}
            formatValue={(v) => fmtPct(v)}
            color="#7B6FCC"
          />
        </div>

        {/* Platform fee note */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 10, padding: '10px 14px',
        }}>
          <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E' }}>
            Platform fee
          </span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#8A8C9E' }}>
            2% (fixed)
          </span>
        </div>

        {/* Live preview */}
        <LivePreview
          buyerRewardPct={form.buyerRewardPct}
          referralRewardPct={form.referralRewardPct}
        />

        {/* Advanced mode */}
        {form.advancedMode && (
          <div style={{ borderTop: '1px solid #E0DFFF', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, fontWeight: 700, color: '#8A8C9E', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Advanced settings
            </div>

            <Toggle
              label="Apply score multiplier to rewards"
              value={form.useScoreMultiplier}
              onChange={(v) => onChange({ useScoreMultiplier: v })}
            />

            <div>
              <SectionLabel>Referral hold period</SectionLabel>
              <div style={{
                background: '#F7F6FF', border: '1px solid #E0DFFF',
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#3A3C52' }}>
                    Referral reward unlocks linearly over
                  </span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color: '#3A5CE8' }}>
                    {form.referralHoldHours}h
                  </span>
                </div>
                {/* Arc visual */}
                <div style={{ position: 'relative', height: 6, background: '#E0DFFF', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${(form.referralHoldHours / 24) * 100}%`,
                    background: 'linear-gradient(to right, #3A5CE8, #7B6FCC)',
                    borderRadius: 3,
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#C4C3F0' }}>0% at t=0</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#C4C3F0' }}>100% at {form.referralHoldHours}h</span>
                </div>
                <input
                  type="range" min={1} max={24} step={1}
                  value={form.referralHoldHours}
                  style={{
                    width: '100%', marginTop: 10, cursor: 'pointer',
                    background: `linear-gradient(to right, #3A5CE8 ${(form.referralHoldHours / 24) * 100}%, #E0DFFF ${(form.referralHoldHours / 24) * 100}%)`,
                    height: 4, borderRadius: 2, outline: 'none', appearance: 'none',
                  }}
                  onChange={(e) => onChange({ referralHoldHours: parseInt(e.target.value) })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Points campaign ────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .focus-btn {
          flex: 1;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px; font-weight: 600;
          padding: 10px 16px; border-radius: 10px;
          cursor: pointer; border: 1.5px solid #E0DFFF;
          background: #fff; color: #8A8C9E;
          transition: all 150ms; text-align: center;
        }
        .focus-btn.active { background: #EEF1FF; border-color: #3A5CE8; color: #3A5CE8; font-weight: 700; }
        .focus-btn:hover:not(.active) { background: #F7F6FF; color: #3A3C52; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Focus selector */}
        <div>
          <SectionLabel>Campaign focus</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            {FOCUS_OPTIONS.map(o => (
              <button
                key={o.value}
                className={`focus-btn${form.pointsFocus === o.value ? ' active' : ''}`}
                onClick={() => onChange({ pointsFocus: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Points config */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {(form.pointsFocus === 'trade' || form.pointsFocus === 'both') && (
            <NumberField
              label="Points per $1 traded"
              value={form.pointsPerUsdTrade}
              onChange={(v) => onChange({ pointsPerUsdTrade: v })}
              min={1}
            />
          )}
          {(form.pointsFocus === 'bridge' || form.pointsFocus === 'both') && (
            <NumberField
              label="Bridge points (fixed)"
              value={form.fixedBridgePoints}
              onChange={(v) => onChange({ fixedBridgePoints: v })}
              suffix="pts"
              min={0}
              step={50}
            />
          )}
        </div>

        {/* Points preview chip */}
        <div style={{
          background: '#F7F6FF', border: '1px solid #E0DFFF', borderRadius: 10,
          padding: '12px 16px', display: 'flex', gap: 16, flexWrap: 'wrap',
        }}>
          {(form.pointsFocus === 'trade' || form.pointsFocus === 'both') && (
            <div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color: '#3A5CE8' }}>
                +{form.pointsPerUsdTrade} pts
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>
                per $1 traded
              </div>
            </div>
          )}
          {(form.pointsFocus === 'bridge' || form.pointsFocus === 'both') && (
            <div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 700, color: '#2A9E8A' }}>
                +{form.fixedBridgePoints} pts
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 10, color: '#8A8C9E', marginTop: 1 }}>
                per bridge
              </div>
            </div>
          )}
        </div>

        {/* Advanced mode */}
        {form.advancedMode && (
          <div style={{ borderTop: '1px solid #E0DFFF', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, fontWeight: 700, color: '#8A8C9E', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Advanced settings
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <NumberField
                label="Referral base points"
                value={form.referralBasePoints}
                onChange={(v) => onChange({ referralBasePoints: v })}
                suffix="pts"
                min={0}
                step={10}
              />
              <NumberField
                label="Referral share %"
                value={form.referralSharePct}
                onChange={(v) => onChange({ referralSharePct: Math.min(100, Math.max(0, v)) })}
                suffix="%"
                min={0}
                max={100}
              />
              <NumberField
                label="Min daily volume"
                value={form.minDailyVolumeUsd}
                onChange={(v) => onChange({ minDailyVolumeUsd: v })}
                prefix="$"
                min={0}
                step={100}
              />
              <NumberField
                label="Max pts per wallet"
                value={form.maxPointsPerWalletPct}
                onChange={(v) => onChange({ maxPointsPerWalletPct: Math.min(100, Math.max(0.1, v)) })}
                suffix="% of pool"
                min={0.1}
                step={0.5}
              />
            </div>

            <Toggle
              label="Apply attribution score multiplier"
              value={form.useAttributionMultiplier}
              onChange={(v) => onChange({ useAttributionMultiplier: v })}
            />
            <Toggle
              label="Apply sharing score multiplier"
              value={form.useSharingMultiplier}
              onChange={(v) => onChange({ useSharingMultiplier: v })}
            />
          </div>
        )}
      </div>
    </>
  )
}
