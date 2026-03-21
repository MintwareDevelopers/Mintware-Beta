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
import type { ActionDef } from '@/components/rewards/campaigns/ActionsPanel'
import { useEffect, useState, useCallback } from 'react'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { API } from '@/lib/web2/api'
import { useReferral } from '@/lib/rewards/referral/useReferral'

import { CampaignHeader }   from '@/components/rewards/campaigns/CampaignHeader'
import { JoinButton }        from '@/components/rewards/campaigns/JoinButton'
import { ActionsPanel }      from '@/components/rewards/campaigns/ActionsPanel'
import { Leaderboard }       from '@/components/rewards/campaigns/Leaderboard'
import { ParticipantStats }  from '@/components/rewards/campaigns/ParticipantStats'
import type { Campaign }     from '@/components/rewards/campaigns/CampaignCard'
import type { Participant }  from '@/components/rewards/campaigns/ParticipantStats'

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
        <div style={{ height: 60, background: '#F0EFFF', borderRadius: 'var(--radius-md)' }} />
      </div>
      {/* Join skeleton */}
      <div style={{ height: 52, background: '#F0EFFF', borderRadius: 10 }} />
      {/* Tabs skeleton */}
      <div style={{ height: 40, background: '#F0EFFF', borderRadius: 'var(--radius-sm)' }} />
    </div>
  )
}

// ── Referral card ─────────────────────────────────────────────────────────────
function ReferralCard({ refLink, earnDesc }: { refLink: string; earnDesc: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(refLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* silent */ }
  }

  return (
    <div style={{
      background: 'rgba(42,158,138,0.04)',
      border: '1px solid rgba(42,158,138,0.2)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      marginBottom: 24,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <span style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.5px',
          textTransform: 'uppercase', color: 'var(--color-mw-teal)',
        }}>
          ◉ Your referral link
        </span>
        <span style={{
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: 11, color: 'var(--color-mw-teal)',
        }}>
          {earnDesc}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
          flex: 1,
          fontFamily: 'DM Mono, monospace', fontSize: 11,
          color: 'var(--color-mw-ink-2)', background: '#fff',
          border: '1px solid rgba(42,158,138,0.2)',
          borderRadius: 'var(--radius-sm)', padding: '9px 12px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {refLink}
        </div>
        <button
          onClick={handleCopy}
          style={{
            flexShrink: 0, padding: '9px 16px',
            background: copied ? 'var(--color-mw-teal)' : '#fff',
            color: copied ? '#fff' : 'var(--color-mw-teal)',
            border: '1px solid rgba(42,158,138,0.4)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 12, fontWeight: 600,
            transition: 'background var(--transition-fast), color var(--transition-fast)',
            whiteSpace: 'nowrap',
          }}
        >
          {copied ? '✓ Copied!' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}

// ── Page content ──────────────────────────────────────────────────────────────
function CampaignDetailContent() {
  const { address }   = useAccount()
  const params        = useParams()
  const campaignId    = params?.id as string
  const wallet        = address?.toLowerCase() ?? ''
  const { refCode }   = useReferral(wallet || undefined)

  const [campaign,     setCampaign]    = useState<Campaign | null>(null)
  const [participant,  setParticipant] = useState<Participant | null>(null)
  const [userScore,      setUserScore]      = useState<number | null>(null)
  const [userPercentile, setUserPercentile] = useState<number | null>(null)
  const [loading,      setLoading]     = useState(true)
  const [error,        setError]       = useState<string | null>(null)
  const [activeTab,    setActiveTab]   = useState<Tab>('overview')
  // Tracks join success — the Worker's /campaign endpoint doesn't know about
  // our Supabase participants table, so we check it directly on mount.
  // Initialised from /api/campaigns/participant so join state survives refresh.
  const [locallyJoined, setLocallyJoined] = useState(false)

  // ── Hydrate join state from Supabase on mount (survives page refresh) ───────
  useEffect(() => {
    if (!campaignId || !address) return
    fetch(`/api/campaigns/participant?campaign_id=${encodeURIComponent(campaignId)}&address=${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then((data: { joined?: boolean }) => {
        if (data.joined) setLocallyJoined(true)
      })
      .catch(() => { /* non-critical — UI degrades gracefully */ })
  }, [campaignId, address])

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
      .then(data => {
        setUserScore(data.score ?? 0)
        setUserPercentile(data.percentile ?? null)
      })
      .catch(() => setUserScore(0))
  }, [address, participant])

  // When joined, pull score from participant data
  const displayScore = participant
    ? participant.attribution_score
    : userScore

  const isJoined = participant !== null || locallyJoined
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
          color: var(--color-mw-ink-4);
          border-bottom: 2px solid transparent;
          transition: color var(--transition-fast), border-color var(--transition-fast);
        }
        .cd-tab-btn:hover:not(:disabled) { color: var(--color-mw-brand-deep); }
        .cd-tab-btn.active {
          color: var(--color-mw-brand-deep);
          border-bottom-color: var(--color-mw-brand-deep);
        }
        .cd-tab-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--color-mw-surface-purple)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
        <MwNav />

        <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>

          {/* ── Back link ── */}
          <Link href="/dashboard" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 600,
            color: 'var(--color-mw-ink-4)', textDecoration: 'none', marginBottom: 20,
            transition: 'color var(--transition-fast)',
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-mw-brand-deep)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-mw-ink-4)' }}
          >
            ← Campaigns
          </Link>

          {/* ── Error ── */}
          {error && !loading && (
            <div style={{
              padding: '16px 20px', background: 'rgba(194,83,122,0.06)',
              border: '1px solid rgba(194,83,122,0.15)', borderRadius: 'var(--radius-md)',
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: 'var(--color-mw-pink)',
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
                  <Link
                    href={`/manage/${campaignId}`}
                    style={{
                      display: 'inline-block',
                      border: '1px solid var(--color-mw-brand-deep)',
                      color: 'var(--color-mw-brand-deep)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 16px',
                      fontSize: 13,
                      fontFamily: 'Plus Jakarta Sans, sans-serif',
                      fontWeight: 600,
                      textDecoration: 'none',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#EEF1FF' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent' }}
                  >
                    Manage Campaign →
                  </Link>
                </div>
              )}

              {/* Multiplier projection card — shown when not yet joined and score is known */}
              {!isJoined && displayScore != null && displayScore > 0 && (() => {
                const pct = userPercentile
                const attributionMultiplier = pct !== null ? (pct >= 67 ? 1.5 : pct >= 34 ? 1.25 : 1.0) : null
                if (attributionMultiplier === null) return null
                return (
                  <div style={{ background: '#0A0D14', borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 5, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Your multiplier</div>
                      <div style={{ fontSize: 36, fontWeight: 700, color: attributionMultiplier >= 1.5 ? '#4ade80' : attributionMultiplier >= 1.25 ? 'var(--color-mw-brand)' : 'rgba(255,255,255,0.6)', letterSpacing: -1.5, lineHeight: 1, fontFamily: 'DM Mono, monospace' }}>{attributionMultiplier}×</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 3, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{pct}th percentile</div>
                    </div>
                    <div style={{ width: '0.5px', background: 'rgba(255,255,255,0.07)', alignSelf: 'stretch', flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.38)', lineHeight: 1.6, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                      {attributionMultiplier >= 1.5
                        ? 'Top-tier wallet. You earn up to 50% more than the base reward rate from this campaign.'
                        : attributionMultiplier >= 1.25
                        ? 'Above-average wallet. You earn 25% more than the base reward rate.'
                        : 'Keep trading to raise your Attribution score and unlock higher multipliers.'}
                    </div>
                  </div>
                )
              })()}

              {/* Join / locked / joined state */}
              <div style={{ marginBottom: isJoined ? 16 : 24 }}>
                <JoinButton
                  campaignId={campaignId}
                  minScore={minScore}
                  userScore={displayScore}
                  isJoined={isJoined}
                  wallet={address}
                  onJoined={() => { setLocallyJoined(true); fetchCampaign() }}
                />
              </div>

              {/* ── Referral link — shown immediately after joining ── */}
              {isJoined && address && (() => {
                const code    = refCode ?? `mw_${address.slice(2, 8).toLowerCase()}`
                const refLink = `${typeof window !== 'undefined' ? window.location.origin : 'https://mintware-beta.vercel.app'}/campaign/${campaignId}?ref=${code}`
                const isTokenPool = campaign.campaign_type === 'token_pool'
                const earnDesc = isTokenPool
                  ? `Earn ${(campaign as Campaign & { referral_reward_pct?: number }).referral_reward_pct ?? 0}% of every swap your referrals make`
                  : 'Earn referral points for every wallet you bring in'
                return (
                  <ReferralCard refLink={refLink} earnDesc={earnDesc} />
                )
              })()}

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
                  actions={(campaign.actions ?? {}) as Record<string, ActionDef>}
                  startDate={(campaign as Campaign & { start_date?: string }).start_date}
                  endDate={campaign.end_date}
                  campaignType={campaign.campaign_type}
                  referralRewardPct={(campaign as Campaign & { referral_reward_pct?: number }).referral_reward_pct}
                  buyerRewardPct={(campaign as Campaign & { buyer_reward_pct?: number }).buyer_reward_pct}
                  tokenSymbol={campaign.token_symbol}
                  isJoined={isJoined}
                  walletAddress={address}
                  campaignId={campaignId}
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
                  walletAddress={address}
                  refCode={refCode}
                />
              )}

              {activeTab === 'stats' && !isJoined && (
                <div style={{
                  textAlign: 'center', padding: '48px 24px',
                  background: '#fff', border: '1px solid #E0DFFF', borderRadius: 'var(--radius-lg)',
                }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--color-mw-ink)', marginBottom: 6 }}>
                    Join to see your stats
                  </div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, color: 'var(--color-mw-ink-4)' }}>
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
