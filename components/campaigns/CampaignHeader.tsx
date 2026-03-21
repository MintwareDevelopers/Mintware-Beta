'use client'

// =============================================================================
// CampaignHeader.tsx — Hero header block for /campaign/[id]
//
// Shows: protocol initial (icon), campaign name, chain badge, status badge,
//        pool size, daily payout, days remaining, progress bar.
// =============================================================================

import { useEffect, useState } from 'react'
import { fmtUSD, daysUntil, iconColor } from '@/lib/api'
import { fetchTokenMeta, fetchDexMeta, dexUrl } from '@/lib/tokenMeta'
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
      <style>{`
        @keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      <div style={{
        background: '#fff',
        border: '0.5px solid var(--color-mw-border)',
        borderRadius: 18,
        padding: '24px',
        marginBottom: 24,
        boxShadow: 'var(--shadow-card)',
      }}>
        {/* ── Top row: icon + name + badges ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          {/* Protocol icon */}
          <div style={{
            width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            background: showLogo ? '#fff' : col.bg, color: col.fg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 700,
            border: '0.5px solid rgba(0,0,0,0.08)', overflow: 'hidden',
          }}>
            {showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoURI!} alt={c.name} width={56} height={56} style={{ objectFit: 'cover', width: '100%', height: '100%' }} onError={() => setLogoError(true)} />
            ) : initial}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Name */}
            <div style={{
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: 22, fontWeight: 800, color: '#1A1A2E', marginBottom: 6,
            }}>
              {c.name}
              {c.protocol && c.protocol !== c.name && (
                <span style={{ fontSize: 14, fontWeight: 500, color: '#8A8C9E', marginLeft: 8 }}>
                  by {c.protocol}
                </span>
              )}
            </div>

            {/* Badges row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Chain badge */}
              <span style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, fontWeight: 700,
                background: '#EEF1FF', color: '#3A5CE8',
                borderRadius: 6, padding: '3px 8px',
              }}>
                {c.chain}
              </span>

              {/* Status badge */}
              {isLive && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 700,
                  background: 'rgba(42,158,138,0.10)', color: '#2A9E8A',
                  border: '1px solid rgba(42,158,138,0.2)',
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#2A9E8A',
                    display: 'inline-block', animation: 'dot-pulse 2s ease-in-out infinite',
                  }} />
                  Live
                </span>
              )}
              {isUpcoming && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 700,
                  background: 'rgba(194,122,0,0.10)', color: '#C27A00',
                  border: '1px solid rgba(194,122,0,0.2)',
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  ◷ Coming soon
                </span>
              )}
              {c.status === 'ended' && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#8A8C9E',
                  background: 'rgba(138,140,158,0.1)',
                  border: '1px solid rgba(138,140,158,0.2)',
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  Ended
                </span>
              )}
              {/* Social links */}
              {hasSocials && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 8 }}>
                  {effectiveDexUrl && (
                    <a href={effectiveDexUrl} target="_blank" rel="noopener noreferrer" title="DexScreener"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, color: '#9ca3af', textDecoration: 'none' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLElement).style.color = '#3d3d3d' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      <IconDex />
                    </a>
                  )}
                  {links.twitter && (
                    <a href={links.twitter} target="_blank" rel="noopener noreferrer" title="X / Twitter"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, color: '#9ca3af', textDecoration: 'none' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLElement).style.color = '#3d3d3d' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      <IconX />
                    </a>
                  )}
                  {links.website && (
                    <a href={links.website} target="_blank" rel="noopener noreferrer" title="Website"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, color: '#9ca3af', textDecoration: 'none' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLElement).style.color = '#3d3d3d' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      <IconGlobe />
                    </a>
                  )}
                  {links.telegram && (
                    <a href={links.telegram} target="_blank" rel="noopener noreferrer" title="Telegram"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, color: '#9ca3af', textDecoration: 'none' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLElement).style.color = '#3d3d3d' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      <IconTelegram />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div style={{
          display: 'flex', gap: 0, marginTop: 22,
          background: '#F7F6FF', borderRadius: 12,
          border: '1px solid #E0DFFF', overflow: 'hidden',
        }}>
          {(c.campaign_type === 'token_pool' ? [
            // Token Reward Pool: referral earn is the headline
            (c.pool_remaining_usd != null || c.pool_usd != null) && {
              label: 'Pool remaining',
              value: `${fmtUSD(c.pool_remaining_usd ?? c.pool_usd ?? 0)}${c.token_symbol ? ` ${c.token_symbol}` : ''}`,
              color: 'var(--color-mw-brand)',
            },
            c.referral_reward_pct != null && {
              label: 'Referral earn',
              value: `${c.referral_reward_pct}% per swap`,
              color: '#2A9E8A',
            },
            c.buyer_reward_pct != null && {
              label: 'Buyer rebate',
              value: `${c.buyer_reward_pct}% per swap`,
              color: 'var(--color-mw-brand-deep)',
            },
            daysLeft !== null && isLive && {
              label: 'Days remaining',
              value: `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
              color: 'var(--color-mw-amber)',
            },
          ] : [
            // Points Campaign: pool size, daily payout, days, min score
            c.pool_usd != null && {
              label: 'Pool size',
              value: `${fmtUSD(c.pool_usd)}${c.token_symbol ? ` ${c.token_symbol}` : ''}`,
              color: 'var(--color-mw-brand)',
            },
            c.daily_payout_usd != null && {
              label: 'Daily payout',
              value: `${fmtUSD(c.daily_payout_usd)}/day`,
              color: 'var(--color-mw-green)',
            },
            daysLeft !== null && isLive && {
              label: 'Days remaining',
              value: `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
              color: 'var(--color-mw-amber)',
            },
            c.min_score != null && {
              label: 'Min score',
              value: `${c.min_score}+`,
              color: '#1A1A2E',
            },
          ]).filter(Boolean).map((stat, i, arr) => {
            if (!stat) return null
            return (
              <div key={i} style={{
                flex: 1, padding: '14px 16px',
                borderRight: i < arr.length - 1 ? '1px solid #E0DFFF' : 'none',
              }}>
                <div style={{
                  fontFamily: 'DM Mono, monospace',
                  fontSize: 15, fontWeight: 700,
                  color: (stat as { color: string }).color ?? '#1A1A2E',
                  marginBottom: 2,
                }}>
                  {(stat as { value: string }).value}
                </div>
                <div style={{
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontSize: 10, color: '#8A8C9E',
                }}>
                  {(stat as { label: string }).label}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Live market ticker ── */}
        {ticker && (ticker.priceUsd || ticker.priceChange24h != null || ticker.volume24h || ticker.liquidity) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            marginTop: 10, background: '#F7F6FF',
            borderRadius: 10, border: '1px solid #E0DFFF',
            overflow: 'hidden',
          }}>
            {ticker.priceUsd && (
              <div style={{ padding: '9px 14px', borderRight: '1px solid #E0DFFF', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#1A1A2E' }}>
                  ${parseFloat(ticker.priceUsd) < 0.01
                      ? parseFloat(ticker.priceUsd).toExponential(2)
                      : parseFloat(ticker.priceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </span>
                <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 9, color: '#8A8C9E', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Price</span>
              </div>
            )}
            {ticker.priceChange24h != null && (
              <div style={{ padding: '9px 14px', borderRight: (ticker.volume24h || ticker.liquidity) ? '1px solid #E0DFFF' : 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{
                  fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700,
                  color: ticker.priceChange24h >= 0 ? '#16a34a' : '#ef4444',
                }}>
                  {ticker.priceChange24h >= 0 ? '+' : ''}{ticker.priceChange24h.toFixed(2)}%
                </span>
                <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 9, color: '#8A8C9E', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>24h</span>
              </div>
            )}
            {ticker.volume24h && (
              <div style={{ padding: '9px 14px', borderRight: ticker.liquidity ? '1px solid #E0DFFF' : 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#1A1A2E' }}>
                  {fmtUSD(ticker.volume24h)}
                </span>
                <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 9, color: '#8A8C9E', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Vol 24h</span>
              </div>
            )}
            {ticker.liquidity && (
              <div style={{ padding: '9px 14px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#1A1A2E' }}>
                  {fmtUSD(ticker.liquidity)}
                </span>
                <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 9, color: '#8A8C9E', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Liquidity</span>
              </div>
            )}
          </div>
        )}

        {/* ── Progress bar ── */}
        {progress !== null && (
          <div style={{ marginTop: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginBottom: 6,
              fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, color: '#8A8C9E',
            }}>
              <span>Pool utilization</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: '#3A5CE8' }}>
                {progress.toFixed(1)}%
              </span>
            </div>
            <div style={{
              height: 6, background: '#E0DFFF', borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${progress}%`,
                background: progress > 80 ? '#C2537A' : '#3A5CE8',
                borderRadius: 3, transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
