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
import type { CampaignType } from '@/lib/rewards/creator'
import { ApplicationForm } from '@/components/rewards/creator/ApplicationForm'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

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
  iconColor, onSelect, disabled,
}: TypeCardProps) {
  return (
    <div
      className={`bg-atx-panel border border-atx-ink border-l-[3px] p-7 cursor-pointer transition-shadow duration-200 flex-1 min-w-[240px] flex flex-col gap-[18px]${disabled ? ' opacity-50 cursor-not-allowed' : ' hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)]'}`}
      style={{ borderLeftColor: iconColor }}
      onClick={disabled ? undefined : onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => !disabled && e.key === 'Enter' && onSelect()}
    >
      {/* Icon + badge row */}
      <div className="flex items-start justify-between">
        <div
          className="w-[52px] h-[52px] border border-atx-ink bg-atx-panel flex items-center justify-center"
          style={{ color: iconColor }}
        >
          <svg viewBox="0 0 100 100" className="w-6 h-6" aria-hidden="true">
            <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
          </svg>
        </div>
        <span
          className="font-atx-mono text-[10px] font-bold px-[10px] py-[4px] uppercase tracking-[0.08em] border border-atx-ink/30 bg-atx-bone"
          style={{ color: badgeColor }}
        >
          {badge}
        </span>
      </div>

      {/* Title + subtitle */}
      <div>
        <div className="font-atx-display text-[18px] font-extrabold text-atx-ink mb-[6px]">
          {title}
        </div>
        <div className="font-atx-display text-[13px] text-atx-ink/55 leading-[1.55]">
          {subtitle}
        </div>
      </div>

      {/* Highlights */}
      <div className="flex flex-col gap-[7px] mt-auto">
        {highlights.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className="w-[7px] h-[7px] border border-atx-ink shrink-0 inline-block"
              style={{ background: iconColor }}
            />
            <span className="font-atx-display text-[12px] text-atx-ink/70">
              {h}
            </span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div
        className="mt-1 font-atx-mono text-[13px] font-bold uppercase tracking-[0.06em] flex items-center gap-[6px]"
        style={{ color: iconColor }}
      >
        {disabled ? 'Checking…' : 'Select →'}
      </div>
    </div>
  )
}

export function CampaignTypeSelect({ onSelect }: CampaignTypeSelectProps) {
  const { evmAddress: address } = useMintwareIdentity()
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
        <h2 className="font-atx-display text-[26px] font-extrabold text-atx-ink m-0 mb-2">
          Choose a campaign type
        </h2>
        <p className="font-atx-display text-[14px] text-atx-ink/55 m-0">
          Select how you want to incentivize your community
        </p>
      </div>

      <div className="flex gap-5 flex-wrap">
        <TypeCard
          icon="◎"
          iconBg="rgba(58,92,232,0.08)"
          iconColor="#006FCC"
          title="Token Reward Pool"
          subtitle="Reward buyers and referrers directly with your token"
          badge="Self-serve · Open to anyone"
          badgeColor="#006FCC"
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
          iconColor="#FF8574"
          title="Points Campaign"
          subtitle="Run a competitive daily ranking campaign with score multipliers"
          badge="Curated · Whitelisted teams"
          badgeColor="#FF8574"
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
