'use client'

// =============================================================================
// app/campaign/[id]/page.tsx — Campaign detail page
//
// Sections: CampaignHeader → JoinButton → Tabs (Overview | Leaderboard | Stats)
// Data:
//   GET /campaign?id=&address=   → campaign + participant
//   GET /score?address=           → user's attribution score (if not joined)
// Auth: MwAuthGuard
// Inline styles only — no Tailwind.
// =============================================================================

import { useAccount } from 'wagmi'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { MwNav } from '@/components/MwNav'
import { MwAuthGuard } from '@/components/MwAuthGuard'
import { API } from '@/lib/api'

import { CampaignHeader }   from '@/components/campaigns/CampaignHeader'
import { JoinButton }        from '@/components/campaigns/JoinButton'
import { ActionsPanel }      from '@/components/campaigns/ActionsPanel'
import { Leaderboard }       from '@/components/campaigns/Leaderboard'
import { ParticipantStats }  from '@/components/campaigns/ParticipantStats'
import type { Campaign }     from '@/components/campaigns/CampaignCard'
import type { Participant }  from '@/components/campaigns/ParticipantStats'

type Tab = 'overview' | 'leaderboard' | 'stats'

// ── Loading skeleton ──────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header skeleton */}
      <div style={{ background: '#fff', border: '1px solid #E0DFFF', borderRadius: 18, padding: 24 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#F0EFFF', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 24, background: '#F0EFFF', borderRadius: 6, marginBottom: 8, width: '45%' }} />
            <div style={{ height: 14, background: '#F0EFFF', borderRadius: 4, width: '30%' }} />
          </div>
        </div>
        <div style={{ height: 60, background: '#F0EFFF', borderRadius: 12 }} />
      </div>
      {/* Join skeleton */}
      <div style={{ height: 52, background: '#F0EFFF', borderRadius: 10 }} />
      {/* Tabs skeleton */}
      <div style={{ height: 40, background: '#F0EFFF', borderRadius: 8 }} />
    </div>
  )
}

// ── Page content ──────────────────────────────────────────────────────────────
function CampaignDetailContent() {
  const { address }   = useAccount()
  const params        = useParams()
  const campaignId    = params?.id as string

  const [campaign,     setCampaign]    = useState<Campaign | null>(null)
  const [participant,  setParticipant] = useState<Participant | null>(null)
  const [userScore,    setUserScore]   = useState<number | null>(null)
  const [loading,      setLoading]     = useState(true)
  const [error,        setError]       = useState<string | null>(null)
  const [activeTab,    setActiveTab]   = useState<Tab>('overview')

  // ── Fetch campaign + participant ────────────────────────────────────────────
  const fetchCampaign = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    setError(null)
    try {
      const url = address
        ? `${API}/campaign?id=${encodeURIComponent(campaignId)}&address=${encodeURIComponent(address)}`
        : `${API}/campaign?id=${encodeURIComponent(campaignId)}`
      const res  = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Campaign not found')

      // API may return { campaign, participant } or flat object
      const c: Campaign     = data.campaign ?? data
      const p: Participant | null = data.participant ?? null

      setCampaign(c)
      setParticipant(p)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [campaignId, address])

  useEffect(() => { fetchCampaign() }, [fetchCampaign])

  // ── Fetch user score if not joined ─────────────────────────────────────────
  useEffect(() => {
    if (!address || participant !== null) return
    fetch(`${API}/score?address=${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(data => setUserScore(data.score ?? 0))
      .catch(() => setUserScore(0))
  }, [address, participant])

  // When joined, pull score from participant data
  const displayScore = participant
    ? participant.attribution_score
    : userScore

  const isJoined = participant !== null
  const minScore = campaign?.min_score ?? 0

  const tabs: { key: Tab; label: string; disabled?: boolean }[] = [
    { key: 'overview',     label: 'Overview' },
    { key: 'leaderboard',  label: 'Leaderboard' },
    { key: 'stats',        label: 'Your Stats', disabled: !isJoined },
  ]

  return (
    <>
      <style>{`
        .cd-tab-btn {
          background: none; border: none; cursor: pointer;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 14px; font-weight: 600;
          padding: 10px 18px;
          color: #8A8C9E;
          border-bottom: 2px solid transparent;
          transition: color 0.15s, border-color 0.15s;
        }
        .cd-tab-btn:hover:not(:disabled) { color: #3A5CE8; }
        .cd-tab-btn.active {
          color: #3A5CE8;
          border-bottom-color: #3A5CE8;
        }
        .cd-tab-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#F7F6FF', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
        <MwNav />

        <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>

          {/* ── Back link ── */}
          <Link href="/dashboard" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600,
            color: '#8A8C9E', textDecoration: 'none', marginBottom: 20,
            transition: 'color 0.15s',
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#3A5CE8' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#8A8C9E' }}
          >
            ← Campaigns
          </Link>

          {/* ── Error ── */}
          {error && !loading && (
            <div style={{
              padding: '16px 20px', background: 'rgba(194,83,122,0.06)',
              border: '1px solid rgba(194,83,122,0.15)', borderRadius: 12,
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#C2537A',
              marginBottom: 20,
            }}>
              ⚠ {error}
            </div>
          )}

          {/* ── Loading ── */}
          {loading && <DetailSkeleton />}

          {/* ── Content ── */}
          {!loading && campaign && (
            <>
              {/* Campaign header */}
              <CampaignHeader campaign={campaign} />

              {/* Manage Campaign link — only visible to the creator */}
              {address &&
                (campaign as Campaign & { creator?: string }).creator?.toLowerCase() ===
                  address.toLowerCase() && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8, marginBottom: 16 }}>
                  <a
                    href={`/manage/${campaignId}`}
                    style={{
                      display: 'inline-block',
                      border: '1px solid #3A5CE8',
                      color: '#3A5CE8',
                      borderRadius: 8,
                      padding: '8px 16px',
                      fontSize: 13,
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 600,
                      textDecoration: 'none',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#EEF1FF' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent' }}
                  >
                    Manage Campaign →
                  </a>
                </div>
              )}

              {/* Join / locked / joined state */}
              <div style={{ marginBottom: 24 }}>
                <JoinButton
                  campaignId={campaignId}
                  minScore={minScore}
                  userScore={displayScore}
                  isJoined={isJoined}
                  wallet={address}
                  onJoined={fetchCampaign}
                />
              </div>

              {/* ── Tab navigation ── */}
              <div style={{
                display: 'flex', borderBottom: '1px solid #E0DFFF',
                marginBottom: 24,
              }}>
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    className={`cd-tab-btn${activeTab === tab.key ? ' active' : ''}`}
                    disabled={tab.disabled}
                    onClick={() => !tab.disabled && setActiveTab(tab.key)}
                  >
                    {tab.label}
                    {tab.key === 'stats' && !isJoined && (
                      <span style={{
                        marginLeft: 4, fontSize: 10,
                        background: '#F0EFFF', color: '#C4C3F0',
                        borderRadius: 4, padding: '1px 4px',
                      }}>
                        join first
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Tab content ── */}
              {activeTab === 'overview' && (
                <ActionsPanel
                  actions={campaign.actions ?? {}}
                  startDate={(campaign as Campaign & { start_date?: string }).start_date}
                  endDate={campaign.end_date}
                  campaignType={(campaign as Campaign & { campaign_type?: 'token_pool' | 'points' }).campaign_type}
                  referralRewardPct={(campaign as Campaign & { referral_reward_pct?: number }).referral_reward_pct}
                  buyerRewardPct={(campaign as Campaign & { buyer_reward_pct?: number }).buyer_reward_pct}
                  tokenSymbol={campaign.token_symbol}
                />
              )}

              {activeTab === 'leaderboard' && (
                <Leaderboard
                  campaignId={campaignId}
                  walletAddress={address}
                />
              )}

              {activeTab === 'stats' && isJoined && participant && (
                <ParticipantStats
                  participant={participant}
                  campaignId={campaignId}
                />
              )}

              {activeTab === 'stats' && !isJoined && (
                <div style={{
                  textAlign: 'center', padding: '48px 24px',
                  background: '#fff', border: '1px solid #E0DFFF', borderRadius: 16,
                }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 15, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>
                    Join to see your stats
                  </div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: '#8A8C9E' }}>
                    Your points breakdown and earnings will appear here after joining.
                  </div>
                </div>
              )}
            </>
          )}

        </main>
      </div>
    </>
  )
}

export default function CampaignDetailPage() {
  return (
    <MwAuthGuard>
      <CampaignDetailContent />
    </MwAuthGuard>
  )
}
