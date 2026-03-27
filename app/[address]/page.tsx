'use client'

// app/[address]/page.tsx
// Public wallet profile — no auth required.
// Any wallet address is a public URL: mintware.finance/0x...
// Wallet connect only needed to claim/customize your own profile.

import { useParams, useRouter }  from 'next/navigation'
import { useAccount }            from 'wagmi'
import { MwNav }                 from '@/components/web2/MwNav'
import { WalletDisplay }         from '@/components/web3/WalletDisplay'
import { Sparkline }             from '@/components/web2/Sparkline'
import { computeBadges, topBadgeLabel } from '@/lib/rewards/badges'
import { API, shortAddr }        from '@/lib/web2/api'
import { createSupabaseBrowserClient } from '@/lib/web2/supabase'
import { useEffect, useState }   from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Signal {
  key: string; name: string; icon: string; max: number; color: string; score: number; insights: string[]
}
interface ScoreData {
  score: number; tier: string; percentile: number
  walletAge: string; firstSeen: string; chains: number; totalTxCount: number
  treeSize: number; treeQuality: string
  signals: Signal[]
  character: { label: string; color: string; desc: string; icon: string }
  totalLo: number; totalHi: number
  timeline?: { date: string; score: number; events: unknown[] }[]
}
interface RefStats {
  tree_size:      number
  sharing_score:  number
  tree_quality:   string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tierColor(tier: string): string {
  const t = tier.toLowerCase()
  if (t === 'gold')   return '#C27A00'
  if (t === 'silver') return '#9898C0'
  return '#4f7ef7'   // bronze → brand
}

function fmtTier(tier: string): string {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '—'
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PublicProfile() {
  const params    = useParams()
  const router    = useRouter()
  const rawAddr   = Array.isArray(params.address) ? params.address[0] : params.address ?? ''
  const address   = rawAddr.toLowerCase()

  const { address: connectedAddr } = useAccount()
  const isOwner = !!connectedAddr && connectedAddr.toLowerCase() === address

  const [score,      setScore]      = useState<ScoreData | null>(null)
  const [refStats,   setRefStats]   = useState<RefStats | null>(null)
  const [referredBy, setReferredBy] = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [copied,     setCopied]     = useState(false)

  // Validate address format
  const isValid = /^0x[0-9a-f]{40}$/i.test(address)

  useEffect(() => {
    if (!isValid) { setLoading(false); return }

    const supabase = createSupabaseBrowserClient()

    // Fetch score + referral stats + referred-by in parallel
    Promise.all([
      fetch(`${API}/score?address=${address}`).then(r => r.json()).catch(() => null),
      supabase
        .from('referral_stats')
        .select('tree_size, sharing_score, tree_quality')
        .eq('address', address)
        .maybeSingle()
        .then(({ data }) => data),
      supabase
        .from('referral_records')
        .select('referrer')
        .eq('referred', address)
        .maybeSingle()
        .then(({ data }) => data?.referrer ?? null),
    ]).then(([scoreData, stats, referrer]) => {
      setScore(scoreData)
      setRefStats(stats)
      setReferredBy(referrer)
    }).finally(() => setLoading(false))
  }, [address, isValid])

  const badges     = score ? computeBadges(score, refStats?.tree_size ?? score?.treeSize ?? 0) : []
  const earnedBadges = badges.filter(b => b.earned)
  const topSignals = score?.signals?.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 2) ?? []
  // Only compute trend if timeline entries actually have a numeric `score` field
  const trendDelta = (() => {
    const tl = score?.timeline?.filter((p: { score?: number }) => typeof p.score === 'number' && !isNaN(p.score))
    if (!tl || tl.length < 2) return null
    const last  = tl[tl.length - 1].score as number
    const first = (tl[Math.max(0, tl.length - 4)] as { score: number }).score
    const delta = last - first
    return isNaN(delta) ? null : delta
  })()

  const profileUrl = typeof window !== 'undefined' ? window.location.href : `https://mintware.finance/${address}`

  function copyUrl() {
    navigator.clipboard.writeText(profileUrl).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function shareOnX() {
    if (!score) return
    const badge = topBadgeLabel(badges)
    const text  = `Checked my onchain reputation on @MintwareFi\n\nScore: ${score.score} · ${fmtTier(score.tier)} tier${badge ? ` · ${badge}` : ''}\n\n${profileUrl}`
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  // ── Invalid address ───────────────────────────────────────────────────────
  if (!isValid && !loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-mw-surface)', fontFamily: 'var(--font-jakarta), sans-serif' }}>
        <MwNav />
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.3 }}>⬡</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-mw-ink)', marginBottom: 8 }}>Invalid address</div>
          <div style={{ fontSize: 14, color: 'var(--color-mw-ink-3)', marginBottom: 24 }}>
            That doesn't look like a valid wallet address.
          </div>
          <button onClick={() => router.push('/')}
            style={{ background: 'var(--color-mw-brand)', color: 'white', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Go home
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        .pp-page {
          min-height: 100vh;
          background: var(--color-mw-surface);
          font-family: var(--font-jakarta), sans-serif;
        }
        .pp-inner {
          max-width: 840px;
          margin: 0 auto;
          padding: 32px 24px 80px;
        }

        /* ── hero card ───────────────────────────────── */
        .pp-hero {
          background: linear-gradient(135deg, #0e1117 0%, #131929 100%);
          border-radius: var(--radius-xl);
          padding: 32px;
          margin-bottom: 16px;
          position: relative;
          overflow: hidden;
        }
        .pp-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 55% 60% at 80% 0%, rgba(79,126,247,0.10) 0%, transparent 60%);
          pointer-events: none;
        }
        .pp-hero-top {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 24px;
          flex-wrap: wrap;
        }
        .pp-avatar {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          background: rgba(255,255,255,0.06);
          border: 1.5px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 800;
          font-family: var(--font-mono), monospace;
          color: rgba(255,255,255,0.85);
          flex-shrink: 0;
          position: relative;
        }
        .pp-avatar-score {
          position: absolute;
          bottom: -1px;
          right: -1px;
          background: var(--color-mw-brand);
          color: white;
          font-size: 10px;
          font-weight: 700;
          font-family: var(--font-mono), monospace;
          padding: 2px 6px;
          border-radius: 8px 0 8px 0;
        }
        .pp-hero-info { flex: 1; min-width: 0; }
        .pp-address-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .pp-address {
          font-size: 20px;
          font-weight: 700;
          color: rgba(255,255,255,0.92);
          letter-spacing: -0.3px;
        }
        .pp-tier-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
          border: 1px solid;
        }
        .pp-full-addr {
          font-size: 11px;
          color: rgba(255,255,255,0.3);
          font-family: var(--font-mono), monospace;
          margin-bottom: 10px;
          word-break: break-all;
        }
        .pp-referred-by {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: rgba(255,255,255,0.38);
          margin-bottom: 12px;
        }
        .pp-referred-link {
          color: rgba(255,255,255,0.55);
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          transition: color 0.15s;
        }
        .pp-referred-link:hover { color: rgba(255,255,255,0.85); }
        .pp-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .pp-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 11px;
          color: rgba(255,255,255,0.45);
        }

        /* ── score block ─────────────────────────────── */
        .pp-score-block {
          display: flex;
          align-items: flex-end;
          gap: 24px;
          flex-wrap: wrap;
        }
        .pp-score-num {
          font-size: 72px;
          font-weight: 900;
          font-family: var(--font-mono), monospace;
          color: white;
          line-height: 1;
          letter-spacing: -3px;
        }
        .pp-score-meta { padding-bottom: 8px; }
        .pp-score-of {
          font-size: 13px;
          color: rgba(255,255,255,0.3);
          font-family: var(--font-mono), monospace;
          margin-bottom: 6px;
        }
        .pp-rank {
          font-size: 12px;
          color: rgba(255,255,255,0.4);
          margin-bottom: 6px;
        }
        .pp-trend {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
          font-family: var(--font-mono), monospace;
        }
        .pp-sparkline-wrap {
          margin-left: auto;
          align-self: flex-end;
          padding-bottom: 6px;
          opacity: 0.85;
        }

        /* ── badges ──────────────────────────────────── */
        .pp-badges-card {
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          padding: 20px 24px;
          margin-bottom: 16px;
          box-shadow: var(--shadow-sm);
        }
        .pp-section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--color-mw-ink-3);
          margin-bottom: 14px;
        }
        .pp-badge-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .pp-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 700;
          border: 1.5px solid;
          transition: transform 0.15s;
          position: relative;
        }
        .pp-badge:hover { transform: translateY(-1px); }
        .pp-badge.earned {}
        .pp-badge.unearned {
          opacity: 0.3;
          filter: grayscale(1);
        }
        .pp-badge-icon { font-size: 14px; }
        .pp-badge-label { font-size: 12px; }
        .pp-badge-desc {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--color-mw-ink);
          color: white;
          font-size: 10px;
          font-weight: 500;
          padding: 4px 8px;
          border-radius: 6px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s;
          z-index: 10;
        }
        .pp-badge:hover .pp-badge-desc { opacity: 1; }

        /* ── stats grid ──────────────────────────────── */
        .pp-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        .pp-stat-card {
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          padding: 20px 24px;
          box-shadow: var(--shadow-sm);
        }
        .pp-stat-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid var(--color-mw-border);
        }
        .pp-stat-row:last-child { border-bottom: none; }
        .pp-stat-key {
          font-size: 12px;
          color: var(--color-mw-ink-3);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pp-stat-val {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-mw-ink);
          font-family: var(--font-mono), monospace;
        }
        .pp-stat-val.brand { color: var(--color-mw-brand); }
        .pp-stat-val.teal  { color: var(--color-mw-teal);  }
        .pp-stat-val.pink  { color: var(--color-mw-pink);  }

        /* ── share strip ─────────────────────────────── */
        .pp-share {
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          padding: 20px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          box-shadow: var(--shadow-sm);
        }
        .pp-share-btns { display: flex; gap: 10px; flex-wrap: wrap; }
        .pp-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 16px;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: opacity 0.15s;
          font-family: var(--font-jakarta), sans-serif;
        }
        .pp-btn:hover { opacity: 0.85; }
        .pp-btn.primary { background: var(--color-mw-brand); color: white; }
        .pp-btn.outline {
          background: transparent;
          border: 1.5px solid var(--color-mw-border-strong);
          color: var(--color-mw-ink-2);
        }
        .pp-claim-cta {
          font-size: 13px;
          color: var(--color-mw-ink-3);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pp-claim-link {
          color: var(--color-mw-brand);
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .pp-claim-link:hover { text-decoration: underline; }

        /* ── owner banner ────────────────────────────── */
        .pp-owner-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--color-mw-brand-dim);
          border: 1px solid var(--color-mw-brand-mid);
          border-radius: var(--radius-md);
          padding: 12px 18px;
          margin-bottom: 16px;
          font-size: 13px;
          color: var(--color-mw-brand);
          font-weight: 500;
          gap: 12px;
          flex-wrap: wrap;
        }

        /* ── loading skeleton ────────────────────────── */
        .pp-skel {
          background: linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 75%);
          background-size: 200% 100%;
          animation: pp-shimmer 1.5s infinite;
          border-radius: 8px;
        }
        @keyframes pp-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        @media (max-width: 600px) {
          .pp-grid { grid-template-columns: 1fr; }
          .pp-score-num { font-size: 52px; }
          .pp-inner { padding: 24px 16px 60px; }
          .pp-share { flex-direction: column; align-items: flex-start; }
        }
      `}</style>

      <div className="pp-page">
        <MwNav />
        <div className="pp-inner">

          {/* Owner banner */}
          {isOwner && (
            <div className="pp-owner-banner">
              <span>👋 This is your public profile — shareable without login.</span>
              <a href="/profile" style={{ color: 'var(--color-mw-brand)', fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
                View full dashboard →
              </a>
            </div>
          )}

          {/* ── Hero card ────────────────────────────────────────────────── */}
          <div className="pp-hero">
            <div className="pp-hero-top">
              {/* Left: avatar + identity */}
              <div className="pp-avatar">
                {address.charAt(2).toUpperCase()}
                {score && <div className="pp-avatar-score">{score.score}</div>}
              </div>
              <div className="pp-hero-info">
                <div className="pp-address-row">
                  <WalletDisplay address={address} className="pp-address" />
                  {score && (
                    <span
                      className="pp-tier-pill"
                      style={{
                        color:           tierColor(score.tier),
                        borderColor:     tierColor(score.tier) + '40',
                        background:      tierColor(score.tier) + '14',
                      }}
                    >
                      {fmtTier(score.tier)} tier
                    </span>
                  )}
                </div>
                <div className="pp-full-addr">{shortAddr(address)}</div>

                {referredBy && (
                  <div className="pp-referred-by">
                    Referred by
                    <a href={`/${referredBy}`} className="pp-referred-link">
                      <WalletDisplay address={referredBy} mono />
                    </a>
                  </div>
                )}

                <div className="pp-chips">
                  {score?.walletAge && (
                    <span className="pp-chip">📅 {score.walletAge} old</span>
                  )}
                  {score?.chains != null && (
                    <span className="pp-chip">🔗 {score.chains} chain{score.chains !== 1 ? 's' : ''}</span>
                  )}
                  {score?.totalTxCount != null && (
                    <span className="pp-chip">⚡ {score.totalTxCount.toLocaleString()} txns</span>
                  )}
                  {score?.character && (
                    <span className="pp-chip">{score.character.icon} {score.character.label}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Score + sparkline */}
            {loading ? (
              <div className="pp-skel" style={{ height: 72, width: 200, background: 'rgba(255,255,255,0.06)' }} />
            ) : score ? (
              <div className="pp-score-block">
                <div className="pp-score-num">{score.score}</div>
                <div className="pp-score-meta">
                  <div className="pp-score-of">of 925 pts</div>
                  <div className="pp-rank">Top {100 - score.percentile}% · {score.percentile}th percentile</div>
                  {trendDelta !== null && (
                    <div
                      className="pp-trend"
                      style={{ color: trendDelta >= 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {trendDelta >= 0 ? '↑' : '↓'} {Math.abs(trendDelta)} pts last 3 months
                    </div>
                  )}
                </div>
                {score.timeline && score.timeline.filter((p: { score?: number }) => typeof p.score === 'number').length >= 2 && (
                  <div className="pp-sparkline-wrap">
                    <Sparkline data={score.timeline as { date: string; score: number }[]} width={140} height={44} />
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                No score data available for this address.
              </div>
            )}
          </div>

          {/* ── Badges ───────────────────────────────────────────────────── */}
          {!loading && badges.length > 0 && (
            <div className="pp-badges-card">
              <div className="pp-section-label">
                Credential Badges — {earnedBadges.length} of {badges.length} earned
              </div>
              <div className="pp-badge-row">
                {badges.map(b => (
                  <div
                    key={b.id}
                    className={`pp-badge ${b.earned ? 'earned' : 'unearned'}`}
                    style={{
                      color:       b.earned ? b.color : 'var(--color-mw-ink-3)',
                      borderColor: b.earned ? b.color + '40' : 'var(--color-mw-border)',
                      background:  b.earned ? b.color + '10' : 'transparent',
                    }}
                  >
                    <span className="pp-badge-icon">{b.icon}</span>
                    <span className="pp-badge-label">{b.label}</span>
                    <span className="pp-badge-desc">{b.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Stats grid ───────────────────────────────────────────────── */}
          {!loading && score && (
            <div className="pp-grid">
              {/* Contribution */}
              <div className="pp-stat-card">
                <div className="pp-section-label">Contribution</div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">🔗 Chains active</span>
                  <span className="pp-stat-val brand">{score.chains}</span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">⚡ Total txns</span>
                  <span className="pp-stat-val">{score.totalTxCount.toLocaleString()}</span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">👤 Character</span>
                  <span className="pp-stat-val" style={{ color: score.character?.color }}>
                    {score.character?.icon} {score.character?.label}
                  </span>
                </div>
                {topSignals.length > 0 && (
                  <div className="pp-stat-row">
                    <span className="pp-stat-key">🏆 Top signals</span>
                    <span className="pp-stat-val" style={{ fontSize: 11 }}>
                      {topSignals.map(s => s.name).join(' · ')}
                    </span>
                  </div>
                )}
                <div className="pp-stat-row">
                  <span className="pp-stat-key">💰 Est. earnings</span>
                  <span className="pp-stat-val teal">
                    ${score.totalLo.toLocaleString()}–${score.totalHi.toLocaleString()}/yr
                  </span>
                </div>
              </div>

              {/* Referral network */}
              <div className="pp-stat-card">
                <div className="pp-section-label">Referral Network</div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">◉ Wallets referred</span>
                  <span className="pp-stat-val brand">
                    {refStats?.tree_size ?? score.treeSize ?? 0}
                  </span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">📊 Network quality</span>
                  <span className="pp-stat-val">
                    {refStats?.tree_quality ?? score.treeQuality ?? '0.00'}
                  </span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">⭐ Sharing score</span>
                  <span className="pp-stat-val pink">
                    {refStats?.sharing_score ?? 0}
                  </span>
                </div>
                {referredBy ? (
                  <div className="pp-stat-row">
                    <span className="pp-stat-key">🔗 Referred by</span>
                    <a href={`/${referredBy}`} style={{ textDecoration: 'none' }}>
                      <span className="pp-stat-val" style={{ color: 'var(--color-mw-brand)', fontSize: 11 }}>
                        <WalletDisplay address={referredBy} mono />
                      </span>
                    </a>
                  </div>
                ) : (
                  <div className="pp-stat-row">
                    <span className="pp-stat-key">🔗 Referred by</span>
                    <span className="pp-stat-val" style={{ opacity: 0.3 }}>—</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Share strip ──────────────────────────────────────────────── */}
          <div className="pp-share">
            <div className="pp-share-btns">
              <button className="pp-btn outline" onClick={copyUrl}>
                {copied ? '✓ Copied!' : '🔗 Copy profile URL'}
              </button>
              {score && (
                <button className="pp-btn primary" onClick={shareOnX}>
                  𝕏 Share on X
                </button>
              )}
            </div>

            {!isOwner && (
              <div className="pp-claim-cta">
                This your wallet?
                <a href="/" className="pp-claim-link">
                  Connect to claim your profile →
                </a>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
