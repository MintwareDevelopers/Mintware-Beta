'use client'

// =============================================================================
// CampaignTypeSelect.tsx — First screen: choose campaign type
//
// Card A: Token Reward Pool — self-serve, open to anyone
// Card B: Points Campaign   — curated, whitelisted teams only
//
// When Points is selected:
//   1. Check GET /api/teams/whitelist?wallet=
//   2. Whitelisted   → proceed to creator flow (onSelect('points'))
//   3. Not listed    → show ApplicationForm inline
// =============================================================================

import { useState } from 'react'
import { useAccount } from 'wagmi'
import type { CampaignType } from '@/lib/rewards/creator'
import { ApplicationForm } from '@/components/rewards/creator/ApplicationForm'

interface CampaignTypeSelectProps {
  onSelect: (type: CampaignType) => void
}

interface TypeCardProps {
  title:      string
  subtitle:   string
  badge:      string
  badgeColor: string
  highlights: string[]
  icon:       string
  iconBg:     string
  iconColor:  string
  onSelect:   () => void
  disabled?:  boolean
}

function TypeCard({
  title, subtitle, badge, badgeColor, highlights,
  icon, iconBg, iconColor, onSelect, disabled,
}: TypeCardProps) {
  return (
    <div
      className={`bg-white border-[1.5px] border-[#E0DFFF] rounded-[18px] p-7 cursor-pointer transition-[box-shadow,transform,border-color] duration-200 ease-[ease] flex-1 min-w-[240px] flex flex-col gap-[18px]${disabled ? ' opacity-50 cursor-not-allowed' : ' hover:shadow-[0_6px_32px_rgba(58,92,232,0.12)] hover:-translate-y-[3px] hover:border-[#3A5CE8]'}`}
      onClick={disabled ? undefined : onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => !disabled && e.key === 'Enter' && onSelect()}
    >
      {/* Icon + badge row */}
      <div className="flex items-start justify-between">
        <div
          className="w-[52px] h-[52px] rounded-[14px] flex items-center justify-center text-[24px]"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </div>
        <span
          className="font-sans text-[10px] font-bold px-[10px] py-[4px] rounded-[20px] tracking-[0.3px]"
          style={{
            background:  badgeColor + '18',
            color:       badgeColor,
            border:      `1px solid ${badgeColor}30`,
          }}
        >
          {badge}
        </span>
      </div>

      {/* Title + subtitle */}
      <div>
        <div className="font-sans text-[18px] font-extrabold text-[#1A1A2E] mb-[6px]">
          {title}
        </div>
        <div className="font-sans text-[13px] text-mw-ink-4 leading-[1.55]">
          {subtitle}
        </div>
      </div>

      {/* Highlights */}
      <div className="flex flex-col gap-[7px] mt-auto">
        {highlights.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className="w-[6px] h-[6px] rounded-full shrink-0"
              style={{ background: iconColor }}
            />
            <span className="font-sans text-[12px] text-[#3A3C52]">
              {h}
            </span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div
        className="mt-1 font-sans text-[13px] font-bold flex items-center gap-[6px]"
        style={{ color: iconColor }}
      >
        {disabled ? 'Checking…' : 'Select →'}
      </div>
    </div>
  )
}

export function CampaignTypeSelect({ onSelect }: CampaignTypeSelectProps) {
  const { address } = useAccount()
  const [checking,  setChecking]  = useState(false)
  const [showForm,  setShowForm]  = useState(false)

  async function handlePointsSelect() {
    if (!address || checking) return
    setChecking(true)

    try {
      const res  = await fetch(`/api/teams/whitelist?wallet=${encodeURIComponent(address)}`)
      const data = await res.json() as { whitelisted?: boolean }

      if (data.whitelisted) {
        onSelect('points')
      } else {
        setShowForm(true)
      }
    } catch {
      // On network error, show the form (apply flow)
      setShowForm(true)
    } finally {
      setChecking(false)
    }
  }

  // ── Show ApplicationForm inline ─────────────────────────────────────────────
  if (showForm) {
    return (
      <ApplicationForm
        wallet={address ?? ''}
        onBack={() => setShowForm(false)}
        onTokenReward={() => onSelect('token_reward')}
      />
    )
  }

  // ── Type select cards ───────────────────────────────────────────────────────
  return (
    <div className="max-w-[720px] mx-auto">
      <div className="mb-9 text-center">
        <h2 className="font-sans text-[26px] font-extrabold text-[#1A1A2E] m-0 mb-2">
          Choose a campaign type
        </h2>
        <p className="font-sans text-[14px] text-mw-ink-4 m-0">
          Select how you want to incentivize your community
        </p>
      </div>

      <div className="flex gap-5 flex-wrap">
        <TypeCard
          icon="◎"
          iconBg="rgba(58,92,232,0.08)"
          iconColor="#3A5CE8"
          title="Token Reward Pool"
          subtitle="Reward buyers and referrers directly with your token"
          badge="Self-serve · Open to anyone"
          badgeColor="#3A5CE8"
          highlights={[
            'Buyer cashback on every purchase',
            'Referral rewards for your community',
            'Depleting pool — clear budget control',
          ]}
          onSelect={() => onSelect('token_reward')}
        />

        <TypeCard
          icon="◈"
          iconBg="rgba(194,83,122,0.08)"
          iconColor="#C2537A"
          title="Points Campaign"
          subtitle="Run a competitive daily ranking campaign with score multipliers"
          badge="Curated · Whitelisted teams"
          badgeColor="#C2537A"
          highlights={[
            'Daily competition and ranking prizes',
            'Score multipliers reward loyal wallets',
            'Attribution-weighted payout distribution',
          ]}
          onSelect={handlePointsSelect}
          disabled={checking}
        />
      </div>
    </div>
  )
}
