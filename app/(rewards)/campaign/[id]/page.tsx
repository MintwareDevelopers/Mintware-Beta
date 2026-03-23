'use client'

// =============================================================================
// app/campaign/[id]/page.tsx — Campaign detail page
//
// Sections: CampaignHeader → JoinButton → Tabs (Overview | Leaderboard | Stats)
// Data:
//   GET /campaign?id=&address=   → campaign + participant
//   GET /score?address=           → user's attribution score (if not joined)
// Auth: MwAuthGuard
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
    <div className="flex flex-col gap-3">
      {/* Header skeleton */}
      <div className="bg-white border border-[#E0DFFF] rounded-[18px] p-6">
        <div className="flex gap-4 mb-4">
          <div className="w-14 h-14 rounded-[14px] bg-[#F0EFFF] shrink-0" />
          <div className="flex-1">
            <div className="h-6 bg-[#F0EFFF] rounded-[6px] mb-2 w-[45%]" />
            <div className="h-[14px] bg-[#F0EFFF] rounded-[4px] w-[30%]" />
          </div>
        </div>
        <div className="h-[60px] bg-[#F0EFFF] rounded-md" />
      </div>
      {/* Join skeleton */}
      <div className="h-[52px] bg-[#F0EFFF] rounded-[10px]" />
      {/* Tabs skeleton */}
      <div className="h-10 bg-[#F0EFFF] rounded-sm" />
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
    <div className="bg-[rgba(42,158,138,0.04)] border border-[rgba(42,158,138,0.2)] rounded-md px-4 py-[14px] mb-6">
      <div className="flex items-center justify-between mb-[10px]">
        <span className="font-sans text-[12px] font-bold tracking-[0.5px] uppercase text-mw-teal">
          ◉ Your referral link
        </span>
        <span className="font-sans text-[11px] text-mw-teal">
          {earnDesc}
        </span>
      </div>
      <div className="flex gap-2 items-center">
        <div className="flex-1 font-mono text-[11px] text-mw-ink-2 bg-white border border-[rgba(42,158,138,0.2)] rounded-sm px-3 py-[9px] overflow-hidden text-ellipsis whitespace-nowrap">
          {refLink}
        </div>
        <button
          onClick={handleCopy}
          className={`shrink-0 px-4 py-[9px] border border-[rgba(42,158,138,0.4)] rounded-sm cursor-pointer font-sans text-[12px] font-semibold transition-[background,color] duration-150 whitespace-nowrap ${copied ? 'bg-mw-teal text-white' : 'bg-white text-mw-teal'}`}
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
      <div className="min-h-screen bg-mw-surface-purple font-sans">
        <MwNav />

        <main className="max-w-[720px] mx-auto px-4 py-8">

          {/* ── Back link ── */}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-[6px] font-sans text-[13px] font-semibold text-mw-ink-4 no-underline mb-5 transition-colors duration-150 hover:text-mw-brand-deep"
          >
            ← Campaigns
          </Link>

          {/* ── Error ── */}
          {error && !loading && (
            <div className="px-5 py-4 bg-[rgba(194,83,122,0.06)] border border-[rgba(194,83,122,0.15)] rounded-md font-sans text-[13px] text-mw-pink mb-5">
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
                <div className="flex justify-end -mt-2 mb-4">
                  <Link
                    href={`/manage/${campaignId}`}
                    className="inline-block border border-mw-brand-deep text-mw-brand-deep rounded-sm px-4 py-2 text-[13px] font-sans font-semibold no-underline transition-colors duration-150 hover:bg-[#EEF1FF]"
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
                  <div className="bg-mw-dark rounded-[12px] px-5 py-4 mb-4 flex items-center gap-5">
                    <div className="shrink-0">
                      <div className="text-[10px] font-bold tracking-[0.1em] uppercase text-[rgba(255,255,255,0.28)] mb-[5px] font-sans">Your multiplier</div>
                      <div
                        className="text-[36px] font-bold tracking-[-1.5px] leading-none font-mono"
                        style={{ color: attributionMultiplier >= 1.5 ? '#4ade80' : attributionMultiplier >= 1.25 ? 'var(--color-mw-brand)' : 'rgba(255,255,255,0.6)' }}
                      >
                        {attributionMultiplier}×
                      </div>
                      <div className="text-[11px] text-[rgba(255,255,255,0.28)] mt-[3px] font-sans">{pct}th percentile</div>
                    </div>
                    <div className="w-px bg-[rgba(255,255,255,0.07)] self-stretch shrink-0" />
                    <div className="flex-1 text-[13px] text-mw-dark-sub leading-[1.6] font-sans">
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
              <div className={isJoined ? 'mb-4' : 'mb-6'}>
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
              <div className="flex border-b border-[#E0DFFF] mb-6">
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    disabled={tab.disabled}
                    onClick={() => !tab.disabled && setActiveTab(tab.key)}
                    className={[
                      'bg-transparent border-0 cursor-pointer font-sans text-[14px] font-semibold px-[18px] py-[10px] border-b-2 transition-[color,border-color] duration-150',
                      tab.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:text-mw-brand-deep',
                      activeTab === tab.key
                        ? 'text-mw-brand-deep border-mw-brand-deep'
                        : 'text-mw-ink-4 border-transparent',
                    ].join(' ')}
                  >
                    {tab.label}
                    {tab.key === 'stats' && !isJoined && (
                      <span className="ml-1 text-[10px] bg-[#F0EFFF] text-[#C4C3F0] rounded-[4px] px-1 py-px">
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
                <div className="text-center px-6 py-12 bg-white border border-[#E0DFFF] rounded-lg">
                  <div className="text-[32px] mb-3">📊</div>
                  <div className="font-sans text-[15px] font-bold text-mw-ink mb-[6px]">
                    Join to see your stats
                  </div>
                  <div className="font-sans text-[13px] text-mw-ink-4">
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
