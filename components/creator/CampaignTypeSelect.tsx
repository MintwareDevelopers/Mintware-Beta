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
import type { CampaignType } from '@/lib/campaigns/creator'
import { ApplicationForm } from '@/components/creator/ApplicationForm'

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
    <>
      <style>{`
        .tc-card {
          background: #fff;
          border: 1.5px solid #E0DFFF;
          border-radius: 18px;
          padding: 28px;
          cursor: pointer;
          transition: box-shadow 200ms ease, transform 200ms ease, border-color 200ms ease;
          flex: 1;
          min-width: 240px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .tc-card:hover {
          box-shadow: 0 6px 32px rgba(58,92,232,0.12);
          transform: translateY(-3px);
          border-color: #3A5CE8;
        }
        .tc-card.tc-disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .tc-card.tc-disabled:hover {
          box-shadow: none;
          transform: none;
          border-color: #E0DFFF;
        }
      `}</style>
      <div
        className={`tc-card${disabled ? ' tc-disabled' : ''}`}
        onClick={disabled ? undefined : onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => !disabled && e.key === 'Enter' && onSelect()}
      >
        {/* Icon + badge row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: iconBg, color: iconColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
          }}>
            {icon}
          </div>
          <span style={{
            fontFamily:  'Plus Jakarta Sans, sans-serif',
            fontSize:    10, fontWeight: 700,
            padding:     '4px 10px',
            borderRadius: 20,
            background:  badgeColor + '18',
            color:       badgeColor,
            border:      `1px solid ${badgeColor}30`,
            letterSpacing: '0.3px',
          }}>
            {badge}
          </span>
        </div>

        {/* Title + subtitle */}
        <div>
          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 18, fontWeight: 800, color: '#1A1A2E', marginBottom: 6,
          }}>
            {title}
          </div>
          <div style={{
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 13, color: '#8A8C9E', lineHeight: 1.55,
          }}>
            {subtitle}
          </div>
        </div>

        {/* Highlights */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 'auto' }}>
          {highlights.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: iconColor, flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontSize: 12, color: '#3A3C52',
              }}>
                {h}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{
          marginTop: 4,
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 13, fontWeight: 700, color: iconColor,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {disabled ? 'Checking…' : 'Select →'}
        </div>
      </div>
    </>
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
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 36, textAlign: 'center' }}>
        <h2 style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 26, fontWeight: 800, color: '#1A1A2E',
          margin: 0, marginBottom: 8,
        }}>
          Choose a campaign type
        </h2>
        <p style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 14, color: '#8A8C9E', margin: 0,
        }}>
          Select how you want to incentivize your community
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
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
