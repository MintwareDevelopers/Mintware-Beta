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
import { LivePreview } from '@/components/rewards/creator/LivePreview'

interface Step3ActionsProps {
  form:     CreatorFormState
  onChange: (partial: Partial<CreatorFormState>) => void
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-sans text-[12px] font-bold text-mw-ink-4 tracking-[0.5px] uppercase mb-[10px]">
      {children}
    </div>
  )
}

// Slider with custom fill track — keeps <style> only for pseudo-element CSS
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
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="font-sans text-[13px] text-[#3A3C52]">
            {label}
          </span>
          <span className="font-mono text-[14px] font-bold" style={{ color }}>
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
        <div className="flex justify-between">
          <span className="font-mono text-[10px] text-[#C4C3F0]">
            {formatValue(min)}
          </span>
          <span className="font-mono text-[10px] text-[#C4C3F0]">
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
      className="flex items-center justify-between cursor-pointer"
      onClick={() => onChange(!value)}
    >
      <span className="font-sans text-[13px] text-[#3A3C52]">
        {label}
      </span>
      <div
        className="w-10 h-[22px] rounded-[11px] relative transition-[background] duration-200 shrink-0"
        style={{ background: value ? '#3A5CE8' : '#E0DFFF' }}
      >
        <div
          className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-[left] duration-200"
          style={{ left: value ? 21 : 3 }}
        />
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
      <div className="flex items-center border-[1.5px] border-[#E0DFFF] rounded-[10px] bg-white overflow-hidden">
        {prefix && (
          <span className="font-sans text-[13px] text-mw-ink-4 pl-3 pr-[10px]">
            {prefix}
          </span>
        )}
        <input
          type="number" min={min} max={max} step={step ?? 1} value={value}
          className={`flex-1 border-none outline-none font-mono text-[14px] text-[#1A1A2E] bg-transparent min-w-0 ${prefix ? 'py-[10px] pr-0' : 'p-[10px_14px]'}`}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v) }}
        />
        {suffix && (
          <span className="font-sans text-[13px] text-mw-ink-4 px-3">
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
      <div className="flex flex-col gap-7">

        {/* Sliders */}
        <div className="flex flex-col gap-5">
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
        <div className="flex justify-between items-center bg-mw-surface-purple border border-[#E0DFFF] rounded-[10px] p-[10px_14px]">
          <span className="font-sans text-[13px] text-mw-ink-4">
            Platform fee
          </span>
          <span className="font-mono text-[13px] font-bold text-mw-ink-4">
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
          <div className="border-t border-[#E0DFFF] pt-6 flex flex-col gap-5">
            <div className="font-sans text-[11px] font-bold text-mw-ink-4 tracking-[1px] uppercase">
              Advanced settings
            </div>

            <Toggle
              label="Apply score multiplier to rewards"
              value={form.useScoreMultiplier}
              onChange={(v) => onChange({ useScoreMultiplier: v })}
            />

            <div>
              <SectionLabel>Referral hold period</SectionLabel>
              <div className="bg-mw-surface-purple border border-[#E0DFFF] rounded-[10px] p-[14px_16px]">
                <div className="flex justify-between mb-[10px]">
                  <span className="font-sans text-[13px] text-[#3A3C52]">
                    Referral reward unlocks linearly over
                  </span>
                  <span className="font-mono text-[14px] font-bold text-[#3A5CE8]">
                    {form.referralHoldHours}h
                  </span>
                </div>
                {/* Arc visual */}
                <div className="relative h-[6px] bg-[#E0DFFF] rounded-[3px] overflow-hidden mb-2">
                  <div
                    className="absolute left-0 top-0 h-full rounded-[3px]"
                    style={{
                      width: `${(form.referralHoldHours / 24) * 100}%`,
                      background: 'linear-gradient(to right, #3A5CE8, #7B6FCC)',
                    }}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-[#C4C3F0]">0% at t=0</span>
                  <span className="font-mono text-[10px] text-[#C4C3F0]">100% at {form.referralHoldHours}h</span>
                </div>
                <input
                  type="range" min={1} max={24} step={1}
                  value={form.referralHoldHours}
                  className="w-full mt-[10px] cursor-pointer h-1 rounded-[2px] outline-none appearance-none"
                  style={{
                    background: `linear-gradient(to right, #3A5CE8 ${(form.referralHoldHours / 24) * 100}%, #E0DFFF ${(form.referralHoldHours / 24) * 100}%)`,
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
    <div className="flex flex-col gap-7">

      {/* Focus selector */}
      <div>
        <SectionLabel>Campaign focus</SectionLabel>
        <div className="flex gap-2">
          {FOCUS_OPTIONS.map(o => (
            <button
              key={o.value}
              className={`flex-1 font-sans text-[13px] py-[10px] px-4 rounded-[10px] cursor-pointer border-[1.5px] transition-all duration-150 text-center${form.pointsFocus === o.value ? ' bg-[#EEF1FF] border-[#3A5CE8] text-[#3A5CE8] font-bold' : ' bg-white border-[#E0DFFF] text-mw-ink-4 font-semibold hover:bg-mw-surface-purple hover:text-[#3A3C52]'}`}
              onClick={() => onChange({ pointsFocus: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Points config */}
      <div className="grid grid-cols-2 gap-4">
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
      <div className="bg-mw-surface-purple border border-[#E0DFFF] rounded-[10px] p-[12px_16px] flex gap-4 flex-wrap">
        {(form.pointsFocus === 'trade' || form.pointsFocus === 'both') && (
          <div>
            <div className="font-mono text-[14px] font-bold text-[#3A5CE8]">
              +{form.pointsPerUsdTrade} pts
            </div>
            <div className="font-sans text-[10px] text-mw-ink-4 mt-[1px]">
              per $1 traded
            </div>
          </div>
        )}
        {(form.pointsFocus === 'bridge' || form.pointsFocus === 'both') && (
          <div>
            <div className="font-mono text-[14px] font-bold text-mw-teal">
              +{form.fixedBridgePoints} pts
            </div>
            <div className="font-sans text-[10px] text-mw-ink-4 mt-[1px]">
              per bridge
            </div>
          </div>
        )}
      </div>

      {/* Advanced mode */}
      {form.advancedMode && (
        <div className="border-t border-[#E0DFFF] pt-6 flex flex-col gap-5">
          <div className="font-sans text-[11px] font-bold text-mw-ink-4 tracking-[1px] uppercase">
            Advanced settings
          </div>

          <div className="grid grid-cols-2 gap-4">
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
  )
}
