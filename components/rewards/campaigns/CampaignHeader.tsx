'use client'

// =============================================================================
// CampaignHeader.tsx — Hero header block for /campaign/[id]
//
// Shows: protocol initial (icon), campaign name, chain badge, status badge,
//        pool size, daily payout, days remaining, progress bar.
// =============================================================================

import { useEffect, useState } from 'react'
import { fmtUSD, daysUntil, iconColor } from '@/lib/web2/api'
import { fetchTokenMeta, fetchDexMeta, dexUrl } from '@/lib/web2/tokenMeta'
import type { Campaign } from './CampaignCard'

const CHAIN_NAME_TO_ID: Record<string, number> = {
  base: 8453, arbitrum: 42161, ethereum: 1, eth: 1,
  bsc: 56, polygon: 137, optimism: 10, coredao: 1116, core: 1116,
}

interface CampaignHeaderProps {
  campaign: Campaign
  poolUsed?: number
}

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

export function CampaignHeader({ campaign: c, poolUsed }: CampaignHeaderProps) {
  const col     = iconColor(c.name)
  const initial = (c.protocol ?? c.name).charAt(0).toUpperCase()
  const chainId = c.chain_id ?? CHAIN_NAME_TO_ID[c.chain?.toLowerCase() ?? ''] ?? 0

  const [logoURI,   setLogoURI]   = useState<string | null>(null)
  const [logoError, setLogoError] = useState(false)
  const [links, setLinks] = useState<{ dexUrl: string | null; twitter: string | null; website: string | null; telegram: string | null }>({ dexUrl: null, twitter: null, website: null, telegram: null })
  const [ticker, setTicker] = useState<{ priceUsd: string | null; priceChange24h: number | null; volume24h: number | null; liquidity: number | null } | null>(null)

  useEffect(() => {
    if (!c.token_contract || !chainId) {
      // Manual links (e.g. Core DAO)
      if (c.links) setLinks({ dexUrl: c.links.dex ?? null, twitter: c.links.twitter ?? null, website: c.links.website ?? null, telegram: c.links.telegram ?? null })
      return
    }
    fetchTokenMeta(chainId, c.token_contract).then(m => { if (m?.logoURI) setLogoURI(m.logoURI) })
    fetchDexMeta(chainId, c.token_contract).then(m => {
      setLinks({
        dexUrl:   c.links?.dex     ?? m?.dexUrl   ?? dexUrl(chainId, c.token_contract!),
        twitter:  c.links?.twitter ?? m?.twitter  ?? null,
        website:  c.links?.website ?? m?.website  ?? null,
        telegram: c.links?.telegram ?? m?.telegram ?? null,
      })
      if (m) {
        setTicker({
          priceUsd:       m.priceUsd       ?? null,
          priceChange24h: m.priceChange24h ?? null,
          volume24h:      m.volume24h      ?? null,
          liquidity:      m.liquidity      ?? null,
        })
      }
    })
  }, [c.token_contract, chainId, c.links])

  const showLogo   = logoURI && !logoError
  const effectiveDexUrl = links.dexUrl ?? (c.token_contract && chainId ? dexUrl(chainId, c.token_contract) : null)
  const hasSocials = effectiveDexUrl || links.twitter || links.website || links.telegram
  const isLive     = c.status === 'live'
  const isUpcoming = c.status === 'upcoming'
  const daysLeft   = c.end_date ? daysUntil(c.end_date) : null
  const progress   = (c.pool_usd && poolUsed != null)
    ? Math.min(100, (poolUsed / c.pool_usd) * 100)
    : null

  return (
    <>
      <div className="bg-white border border-mw-border rounded-[18px] p-6 mb-6 shadow-card">
        {/* ── Top row: icon + name + badges ── */}
        <div className="flex items-start gap-4 flex-wrap">
          {/* Protocol icon */}
          <div
            className="w-14 h-14 rounded-[14px] shrink-0 flex items-center justify-center font-mono text-[22px] font-bold border border-[rgba(0,0,0,0.08)] overflow-hidden"
            style={{ background: showLogo ? '#fff' : col.bg, color: col.fg }}
          >
            {showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoURI!} alt={c.name} width={56} height={56} className="object-cover w-full h-full" onError={() => setLogoError(true)} />
            ) : initial}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name */}
            <div className="font-sans text-[22px] font-extrabold text-[#1A1A2E] mb-[6px]">
              {c.name}
              {c.protocol && c.protocol !== c.name && (
                <span className="text-[14px] font-medium text-mw-ink-4 ml-2">
                  by {c.protocol}
                </span>
              )}
            </div>

            {/* Badges row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Chain badge */}
              <span className="font-sans text-[11px] font-bold bg-[#EEF1FF] text-mw-brand-deep rounded-[6px] px-2 py-[3px]">
                {c.chain}
              </span>

              {/* Status badge */}
              {isLive && (
                <span className="inline-flex items-center gap-[5px] text-[11px] font-bold bg-[rgba(42,158,138,0.10)] text-mw-teal border border-[rgba(42,158,138,0.2)] rounded-full px-[10px] py-[3px]">
                  <span className="w-[6px] h-[6px] rounded-full bg-mw-teal inline-block" style={{ animation: 'dot-pulse 2s ease-in-out infinite' }} />
                  Live
                </span>
              )}
              {isUpcoming && (
                <span className="inline-flex items-center gap-[5px] text-[11px] font-bold bg-[rgba(194,122,0,0.10)] text-mw-amber border border-[rgba(194,122,0,0.2)] rounded-full px-[10px] py-[3px]">
                  ◷ Coming soon
                </span>
              )}
              {c.status === 'ended' && (
                <span className="text-[11px] font-bold text-mw-ink-4 bg-[rgba(138,140,158,0.1)] border border-[rgba(138,140,158,0.2)] rounded-full px-[10px] py-[3px]">
                  Ended
                </span>
              )}
              {/* Social links */}
              {hasSocials && (
                <div className="flex items-center gap-[2px] mt-2">
                  {effectiveDexUrl && (
                    <a href={effectiveDexUrl} target="_blank" rel="noopener noreferrer" title="DexScreener"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-mw-ink-5 no-underline hover:bg-[rgba(0,0,0,0.05)] hover:text-mw-ink-2 transition-colors duration-150">
                      <IconDex />
                    </a>
                  )}
                  {links.twitter && (
                    <a href={links.twitter} target="_blank" rel="noopener noreferrer" title="X / Twitter"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-mw-ink-5 no-underline hover:bg-[rgba(0,0,0,0.05)] hover:text-mw-ink-2 transition-colors duration-150">
                      <IconX />
                    </a>
                  )}
                  {links.website && (
                    <a href={links.website} target="_blank" rel="noopener noreferrer" title="Website"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-mw-ink-5 no-underline hover:bg-[rgba(0,0,0,0.05)] hover:text-mw-ink-2 transition-colors duration-150">
                      <IconGlobe />
                    </a>
                  )}
                  {links.telegram && (
                    <a href={links.telegram} target="_blank" rel="noopener noreferrer" title="Telegram"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-mw-ink-5 no-underline hover:bg-[rgba(0,0,0,0.05)] hover:text-mw-ink-2 transition-colors duration-150">
                      <IconTelegram />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="flex gap-0 mt-[22px] bg-mw-surface-purple rounded-md border border-[#E0DFFF] overflow-hidden">
          {(c.campaign_type === 'token_pool' ? [
            // Token Reward Pool: referral earn is the headline
            (c.pool_remaining_usd != null || c.pool_usd != null) && {
              label: 'Pool remaining',
              value: `${fmtUSD(c.pool_remaining_usd ?? c.pool_usd ?? 0)}${c.token_symbol ? ` ${c.token_symbol}` : ''}`,
              color: 'text-mw-brand',
            },
            c.referral_reward_pct != null && {
              label: 'Referral earn',
              value: `${c.referral_reward_pct}% per swap`,
              color: 'text-mw-teal',
            },
            c.buyer_reward_pct != null && {
              label: 'Buyer rebate',
              value: `${c.buyer_reward_pct}% per swap`,
              color: 'text-mw-brand-deep',
            },
            daysLeft !== null && isLive && {
              label: 'Days remaining',
              value: `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
              color: 'text-mw-amber',
            },
          ] : [
            // Points Campaign: pool size, daily payout, days, min score
            c.pool_usd != null && {
              label: 'Pool size',
              value: `${fmtUSD(c.pool_usd)}${c.token_symbol ? ` ${c.token_symbol}` : ''}`,
              color: 'text-mw-brand',
            },
            c.daily_payout_usd != null && {
              label: 'Daily payout',
              value: `${fmtUSD(c.daily_payout_usd)}/day`,
              color: 'text-mw-green',
            },
            daysLeft !== null && isLive && {
              label: 'Days remaining',
              value: `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
              color: 'text-mw-amber',
            },
            c.min_score != null && {
              label: 'Min score',
              value: `${c.min_score}+`,
              color: 'text-[#1A1A2E]',
            },
          ]).filter(Boolean).map((stat, i, arr) => {
            if (!stat) return null
            return (
              <div key={i} className={`flex-1 px-4 py-[14px]${i < arr.length - 1 ? ' border-r border-[#E0DFFF]' : ''}`}>
                <div className={`font-mono text-[15px] font-bold mb-[2px] ${(stat as { color: string }).color}`}>
                  {(stat as { value: string }).value}
                </div>
                <div className="font-sans text-[10px] text-mw-ink-4">
                  {(stat as { label: string }).label}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Live market ticker ── */}
        {ticker && (ticker.priceUsd || ticker.priceChange24h != null || ticker.volume24h || ticker.liquidity) && (
          <div className="flex items-center gap-0 mt-[10px] bg-mw-surface-purple rounded-[10px] border border-[#E0DFFF] overflow-hidden">
            {ticker.priceUsd && (
              <div className="px-[14px] py-[9px] border-r border-[#E0DFFF] flex flex-col gap-[1px]">
                <span className="font-mono text-[13px] font-bold text-[#1A1A2E]">
                  ${parseFloat(ticker.priceUsd) < 0.01
                      ? parseFloat(ticker.priceUsd).toExponential(2)
                      : parseFloat(ticker.priceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </span>
                <span className="font-sans text-[9px] text-mw-ink-4 uppercase tracking-[0.5px] font-semibold">Price</span>
              </div>
            )}
            {ticker.priceChange24h != null && (
              <div className={`px-[14px] py-[9px] flex flex-col gap-[1px]${(ticker.volume24h || ticker.liquidity) ? ' border-r border-[#E0DFFF]' : ''}`}>
                <span className={`font-mono text-[13px] font-bold ${ticker.priceChange24h >= 0 ? 'text-mw-green' : 'text-mw-red'}`}>
                  {ticker.priceChange24h >= 0 ? '+' : ''}{ticker.priceChange24h.toFixed(2)}%
                </span>
                <span className="font-sans text-[9px] text-mw-ink-4 uppercase tracking-[0.5px] font-semibold">24h</span>
              </div>
            )}
            {ticker.volume24h && (
              <div className={`px-[14px] py-[9px] flex flex-col gap-[1px]${ticker.liquidity ? ' border-r border-[#E0DFFF]' : ''}`}>
                <span className="font-mono text-[13px] font-bold text-[#1A1A2E]">
                  {fmtUSD(ticker.volume24h)}
                </span>
                <span className="font-sans text-[9px] text-mw-ink-4 uppercase tracking-[0.5px] font-semibold">Vol 24h</span>
              </div>
            )}
            {ticker.liquidity && (
              <div className="px-[14px] py-[9px] flex flex-col gap-[1px]">
                <span className="font-mono text-[13px] font-bold text-[#1A1A2E]">
                  {fmtUSD(ticker.liquidity)}
                </span>
                <span className="font-sans text-[9px] text-mw-ink-4 uppercase tracking-[0.5px] font-semibold">Liquidity</span>
              </div>
            )}
          </div>
        )}

        {/* ── Progress bar ── */}
        {progress !== null && (
          <div className="mt-4">
            <div className="flex justify-between mb-[6px] font-sans text-[11px] text-mw-ink-4">
              <span>Pool utilization</span>
              <span className="font-mono font-semibold text-mw-brand-deep">
                {progress.toFixed(1)}%
              </span>
            </div>
            <div className="h-[6px] bg-[#E0DFFF] rounded-[3px] overflow-hidden">
              <div
                className={`h-full rounded-[3px] transition-[width] duration-[500ms] ease-[ease]${progress > 80 ? ' bg-mw-pink' : ' bg-mw-brand-deep'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
