'use client'

// =============================================================================
// CampaignCard.tsx — Campaign list card for /rewards
// Design: ATX Settlemint — square, hairline rules, JetBrains Mono data, flat
// duotone. Structure: header (real token logo) → stats → reward pills →
// progress → socials. Token logos: LI.FI API. Socials: DexScreener API.
// =============================================================================

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { fmtUSD, daysUntil, iconColor } from '@/lib/web2/api'
import { fetchTokenMeta, fetchDexMeta, dexUrl } from '@/lib/web2/tokenMeta'

export interface CampaignLinks {
  dex?:      string
  twitter?:  string
  website?:  string
  telegram?: string
}

export interface Campaign {
  id: string
  name: string
  protocol?: string
  chain: string
  chain_id?: number
  status: 'live' | 'upcoming' | 'ended' | string
  campaign_type?: 'token_pool' | 'points'
  end_date?: string
  start_date?: string
  pool_usd?: number
  pool_remaining_usd?: number
  daily_payout_usd?: number
  token_symbol?: string
  token_contract?: string
  min_score?: number
  buyer_reward_pct?: number
  referral_reward_pct?: number
  links?: CampaignLinks
  actions?: Record<string, {
    label: string
    points: number
    per_day?: boolean
    one_time?: boolean
    per_referral?: boolean
    per_referred_trade?: boolean
  }>
}

type ActionItem = NonNullable<Campaign['actions']>[string]

function actionSuffix(action: ActionItem): string {
  if (action.per_day)            return '/day'
  if (action.per_referral)       return '/ref'
  if (action.per_referred_trade) return '/trade'
  return ''
}

// ATX: flat duotone pills — hairline border + tinted text, square corners.
function actionPillClass(key: string): string {
  if (key.startsWith('referral')) return 'border border-atx-ink/25 text-atx-mesquite'
  if (key === 'bridge')           return 'border border-atx-ink/25 text-atx-blue'
  if (key === 'trade')            return 'border border-atx-ink/25 text-atx-mesquite'
  if (key === 'hold')             return 'border border-atx-ink/25 text-atx-clay'
  return                                 'border border-atx-ink/25 text-atx-blue'
}

// ─── SVG Icons ──────────────────────────────────────────────────────────────

const IconDex = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)
const IconX = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
)
const IconGlobe = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
)
const IconTelegram = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
  </svg>
)

// ─── Component ───────────────────────────────────────────────────────────────

interface CampaignCardProps {
  campaign: Campaign
}

// ─── Chain name → ID mapping (API returns "base" not 8453) ──────────────────
const CHAIN_NAME_TO_ID: Record<string, number> = {
  base:      8453,
  arbitrum:  42161,
  ethereum:  1,
  eth:       1,
  bsc:       56,
  polygon:   137,
  optimism:  10,
  coredao:   1116,
  core:      1116,
}

export function CampaignCard({ campaign: c }: CampaignCardProps) {
  const router  = useRouter()
  const col     = iconColor(c.name)
  const initial = (c.protocol ?? c.name).charAt(0).toUpperCase()

  // Resolve chain_id from numeric field or chain name string
  const chainId = c.chain_id ?? CHAIN_NAME_TO_ID[c.chain?.toLowerCase() ?? ''] ?? 0

  const isLive     = c.status === 'live'
  const isUpcoming = c.status === 'upcoming'
  const isEnded    = c.status === 'ended'

  const daysLeft    = c.end_date   ? daysUntil(c.end_date)   : null
  const daysToStart = c.start_date ? daysUntil(c.start_date) : null

  // ── Token logo (LI.FI) ──
  const [logoURI, setLogoURI] = useState<string | null>(null)
  const [logoError, setLogoError] = useState(false)

  // ── DexScreener links ──
  const [dexLinks, setDexLinks] = useState<{
    dexUrl: string | null
    website: string | null
    twitter: string | null
    telegram: string | null
  }>({ dexUrl: null, website: null, twitter: null, telegram: null })

  // ── Live market data ──
  const [ticker, setTicker] = useState<{ priceUsd: string | null; priceChange24h: number | null } | null>(null)

  useEffect(() => {
    if (!c.token_contract || !chainId) return

    // Fetch logo
    fetchTokenMeta(chainId, c.token_contract).then(meta => {
      if (meta?.logoURI) setLogoURI(meta.logoURI)
    })

    // Fetch socials + market data — merge with manual links from Supabase
    fetchDexMeta(chainId, c.token_contract).then(meta => {
      setDexLinks({
        dexUrl:   c.links?.dex      ?? meta?.dexUrl   ?? dexUrl(chainId, c.token_contract!),
        website:  c.links?.website  ?? meta?.website  ?? null,
        twitter:  c.links?.twitter  ?? meta?.twitter  ?? null,
        telegram: c.links?.telegram ?? meta?.telegram ?? null,
      })
      if (meta?.priceUsd || meta?.priceChange24h != null) {
        setTicker({ priceUsd: meta.priceUsd ?? null, priceChange24h: meta.priceChange24h ?? null })
      }
    })
  }, [c.token_contract, chainId, c.links])

  // For campaigns with no token_contract (Core DAO manual links)
  useEffect(() => {
    if (c.token_contract) return // handled above
    if (!c.links) return
    setDexLinks({
      dexUrl:   c.links.dex      ?? null,
      website:  c.links.website  ?? null,
      twitter:  c.links.twitter  ?? null,
      telegram: c.links.telegram ?? null,
    })
  }, [c.token_contract, c.links])

  // DexScreener link always available if we have token_contract
  const effectiveDexUrl = dexLinks.dexUrl
    ?? (c.token_contract && chainId ? dexUrl(chainId, c.token_contract) : null)

  const hasSocials = effectiveDexUrl || dexLinks.twitter || dexLinks.website || dexLinks.telegram

  // ── Progress bar ──
  let progressPct = 0
  let totalDays: number | null = null
  let elapsedDays: number | null = null
  if (c.start_date && c.end_date) {
    const now = Date.now()
    const s = new Date(c.start_date).getTime()
    const e = new Date(c.end_date).getTime()
    if (e > s) {
      progressPct = Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100))
      totalDays   = Math.round((e - s) / 86400000)
      elapsedDays = Math.max(0, totalDays - (daysLeft ?? 0))
    }
  }

  const isTokenPool = c.campaign_type === 'token_pool'
  const hasStats   = c.pool_usd != null || c.pool_remaining_usd != null || c.daily_payout_usd != null || c.min_score != null || c.referral_reward_pct != null
  const hasActions = c.actions && Object.keys(c.actions).length > 0
  const showBar    = isLive && (totalDays !== null || daysLeft !== null)
  const showLogo   = logoURI && !logoError

  const LINE = 'border-atx-ink/15'

  return (
    <div
      className={`font-atx-display bg-atx-panel overflow-hidden cursor-pointer transition-shadow duration-200 flex flex-col border border-atx-ink border-l-[3px] border-l-atx-coral hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)] [&_*]:rounded-none${isEnded ? ' opacity-60' : ''}`}
      onClick={() => router.push(`/campaign/${c.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && router.push(`/campaign/${c.id}`)}
    >
      {/* ── Header ── */}
      <div className={`px-5 pt-[18px] pb-4 border-b ${LINE} flex items-start justify-between gap-[10px]`}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 flex items-center justify-center text-[14px] font-bold shrink-0 border border-atx-ink font-atx-mono overflow-hidden"
            style={showLogo ? {} : { background: col.bg, color: col.fg }}
          >
            {showLogo ? (
              <img
                src={logoURI!}
                alt={c.name}
                className="w-10 h-10 object-cover"
                onError={() => setLogoError(true)}
              />
            ) : initial}
          </div>
          <div>
            <div className="text-[15px] font-semibold text-atx-ink font-atx-display mb-1">{c.name}</div>
            <div className="flex items-center gap-[6px] text-[12px] text-atx-ink/55 flex-wrap font-atx-mono">
              {isLive && (
                <span className="inline-flex items-center gap-1.5 border border-atx-ink px-[7px] py-[2px] text-[10px] uppercase tracking-[0.08em] font-medium">
                  <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block" />
                  Live
                </span>
              )}
              {isUpcoming && (
                <span className="border border-atx-ink/40 text-atx-clay px-[7px] py-[2px] text-[10px] uppercase tracking-[0.08em] font-medium">
                  {daysToStart !== null ? `In ${daysToStart}d` : 'Soon'}
                </span>
              )}
              {isEnded && (
                <span className="border border-atx-ink/30 text-atx-ink/50 px-[7px] py-[2px] text-[10px] uppercase tracking-[0.08em]">
                  Ended
                </span>
              )}
              <span className="uppercase tracking-[0.04em]">{c.chain}</span>
              {isLive && daysLeft !== null && <span>· {daysLeft}d left</span>}
            </div>
          </div>
        </div>
        <span className="shrink-0 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em] bg-atx-bone text-atx-ink/55 border border-atx-ink/30 font-atx-mono">
          {c.chain}
        </span>
      </div>

      {/* ── Stats ── */}
      {hasStats && (
        <div className={`grid grid-cols-3 px-5 py-4 gap-3 border-b ${LINE}`}>
          {(c.pool_remaining_usd != null || c.pool_usd != null) && (
            <div>
              <div className="text-[22px] font-bold text-atx-blue font-atx-mono tracking-[-0.5px]">
                {fmtUSD(c.pool_remaining_usd ?? c.pool_usd ?? 0)}
                {c.token_symbol && <span className="text-[11px] font-normal text-atx-ink/45 ml-[2px]">{c.token_symbol}</span>}
              </div>
              <div className="text-[10px] text-atx-ink/45 mt-[3px] font-atx-mono uppercase tracking-[0.08em] font-medium">{isTokenPool ? 'pool remaining' : 'pool size'}</div>
            </div>
          )}
          {isTokenPool && c.referral_reward_pct != null && (
            <div>
              <div className="text-[22px] font-bold text-atx-mesquite font-atx-mono tracking-[-0.5px]">
                {c.referral_reward_pct}%
              </div>
              <div className="text-[10px] text-atx-ink/45 mt-[3px] font-atx-mono uppercase tracking-[0.08em] font-medium">referral earn</div>
            </div>
          )}
          {isTokenPool && c.buyer_reward_pct != null && (
            <div>
              <div className="text-[22px] font-bold text-atx-coral font-atx-mono tracking-[-0.5px]">{c.buyer_reward_pct}%</div>
              <div className="text-[10px] text-atx-ink/45 mt-[3px] font-atx-mono uppercase tracking-[0.08em] font-medium">buyer rebate</div>
            </div>
          )}
          {!isTokenPool && c.daily_payout_usd != null && (
            <div>
              <div className="text-[22px] font-bold text-atx-ink font-atx-mono tracking-[-0.5px]">{fmtUSD(c.daily_payout_usd)}</div>
              <div className="text-[10px] text-atx-ink/45 mt-[3px] font-atx-mono uppercase tracking-[0.08em] font-medium">daily payout</div>
            </div>
          )}
          {!isTokenPool && c.min_score != null && (
            <div>
              <div className="text-[22px] font-bold text-atx-ink font-atx-mono tracking-[-0.5px]">{c.min_score}+</div>
              <div className="text-[10px] text-atx-ink/45 mt-[3px] font-atx-mono uppercase tracking-[0.08em] font-medium">min score</div>
            </div>
          )}
        </div>
      )}

      {/* ── Reward pills ── */}
      {isTokenPool ? (
        <div className={`px-5 py-3 flex flex-wrap gap-[6px] border-b ${LINE}`}>
          <span className="px-[10px] py-1 text-[11px] font-medium font-atx-mono border border-atx-ink/25 text-atx-mesquite">
            {c.referral_reward_pct ?? 0}% per swap you refer
          </span>
          {(c.buyer_reward_pct ?? 0) > 0 && (
            <span className="px-[10px] py-1 text-[11px] font-medium font-atx-mono border border-atx-ink/25 text-atx-blue">
              + {c.buyer_reward_pct}% buyer rebate
            </span>
          )}
        </div>
      ) : hasActions ? (
        <div className={`px-5 py-3 flex flex-wrap gap-[6px] border-b ${LINE}`}>
          {Object.entries(c.actions!).map(([key, action]) => (
            <span key={key} className={`px-[10px] py-1 text-[11px] font-medium font-atx-mono ${actionPillClass(key)}`}>
              +{action.points} {action.label.split(' ')[0].toLowerCase()}{actionSuffix(action)}
            </span>
          ))}
        </div>
      ) : null}

      {/* ── Progress bar ── */}
      {showBar && (
        <div className="px-5 py-3">
          <div className="flex justify-between text-[10px] text-atx-ink/45 mb-[6px] font-atx-mono uppercase tracking-[0.06em]">
            <span>Campaign progress</span>
            {totalDays !== null && elapsedDays !== null
              ? <span>{elapsedDays} of {totalDays} days</span>
              : daysLeft !== null
                ? <span>{daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>
                : null
            }
          </div>
          <div className="h-[8px] border border-atx-ink overflow-hidden relative">
            <div
              className="h-full bg-atx-blue absolute inset-y-0 left-0"
              style={{ width: `${totalDays !== null ? progressPct : Math.max(5, 100 - (daysLeft! / 30) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Live price ticker ── */}
      {ticker?.priceUsd && (
        <div className={`px-5 py-[9px] border-t ${LINE} flex items-center gap-4`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-[6px]">
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-atx-ink/45 font-atx-mono">Price</span>
            <span className="font-atx-mono text-[13px] font-bold text-atx-ink">
              ${parseFloat(ticker.priceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
            </span>
          </div>
          {ticker.priceChange24h != null && (
            <div className="flex items-center gap-[6px]">
              <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-atx-ink/45 font-atx-mono">24h</span>
              <span className={`font-atx-mono text-[13px] font-semibold ${ticker.priceChange24h >= 0 ? 'text-atx-mesquite' : 'text-atx-clay'}`}>
                {ticker.priceChange24h >= 0 ? '+' : ''}{ticker.priceChange24h.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Social links ── */}
      {hasSocials && (
        <div className={`flex items-center gap-[2px] px-5 py-[8px] border-t ${LINE} mt-auto justify-end`}>
          <div className="flex items-center gap-[2px]">
          {effectiveDexUrl && (
            <a
              href={effectiveDexUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-7 h-7 text-atx-ink/45 no-underline transition-colors duration-150 hover:bg-atx-bone hover:text-atx-ink"
              title="DexScreener"
              onClick={e => e.stopPropagation()}
            >
              <IconDex />
            </a>
          )}
          {dexLinks.twitter && (
            <a
              href={dexLinks.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-7 h-7 text-atx-ink/45 no-underline transition-colors duration-150 hover:bg-atx-bone hover:text-atx-ink"
              title="X / Twitter"
              onClick={e => e.stopPropagation()}
            >
              <IconX />
            </a>
          )}
          {dexLinks.website && (
            <a
              href={dexLinks.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-7 h-7 text-atx-ink/45 no-underline transition-colors duration-150 hover:bg-atx-bone hover:text-atx-ink"
              title="Website"
              onClick={e => e.stopPropagation()}
            >
              <IconGlobe />
            </a>
          )}
          {dexLinks.telegram && (
            <a
              href={dexLinks.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-7 h-7 text-atx-ink/45 no-underline transition-colors duration-150 hover:bg-atx-bone hover:text-atx-ink"
              title="Telegram"
              onClick={e => e.stopPropagation()}
            >
              <IconTelegram />
            </a>
          )}
          </div>{/* end social icons */}
        </div>
      )}
    </div>
  )
}
