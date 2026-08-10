'use client'

// app/[address]/page.tsx
// Public wallet profile — no auth required.
// Any wallet address is a public URL: mintware.finance/0x...
// Wallet connect only needed to claim/customize your own profile.
// Design: ATX Settlemint — light blueprint-grid hero, square/hairline, JetBrains Mono data.

import { useParams, useRouter }  from 'next/navigation'
import { MwNav }                 from '@/components/web2/MwNav'
import { WalletDisplay }         from '@/components/web3/WalletDisplay'
import { Sparkline }             from '@/components/web2/Sparkline'
import { computeBadges, topBadgeLabel } from '@/lib/rewards/badges'
import { getAddress, isAddress }  from 'viem'
import { API, shortAddr }   from '@/lib/web2/api'
import { AnimatedScore }    from '@/components/web2/AnimatedScore'
import { useEffect, useState }   from 'react'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useProfileMeta } from '@/lib/rewards/useProfileMeta'
import { ProfileSocials } from '@/components/rewards/profile/ProfileSocials'
import { AttestationBadge } from '@/components/rewards/profile/AttestationBadge'

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
// ATX duotone tiers: gold→coral, silver→grey, bronze→blue.
function tierColor(tier: string): string {
  const t = tier.toLowerCase()
  if (t === 'gold')   return '#C95E43' // clay
  if (t === 'silver') return '#8A8A84' // grey
  return '#006FCC'   // bronze → texas-blue
}

function fmtTier(tier: string): string {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '—'
}

// Reusable eight-point star marker
function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

// ─── Page ─────────────────────────────────────────────────────────────────────
const EVM_RE    = /^0x[0-9a-f]{40}$/i

export default function PublicProfile() {
  const params    = useParams()
  const router    = useRouter()
  const rawAddr   = Array.isArray(params.address) ? params.address[0] : params.address ?? ''

  const address      = rawAddr.toLowerCase()

  const { evmAddress: connectedAddr, walletSettled } = useMintwareIdentity()
  const isOwner = !!connectedAddr && connectedAddr.toLowerCase() === address

  const [score,      setScore]      = useState<ScoreData | null>(null)
  const [refStats,   setRefStats]   = useState<RefStats | null>(null)
  const [referredBy, setReferredBy] = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [copied,     setCopied]     = useState(false)

  const isValid = EVM_RE.test(address)
  const { meta, refetch: refetchMeta } = useProfileMeta(isValid ? address : undefined)

  useEffect(() => {
    if (!isValid) { setLoading(false); return }

    // Score comes from the external Attribution API; referral stats + referred-by
    // come from our server route (service-role) — the browser anon key can't read
    // referral_stats / referral_records directly.
    const scoreAddr = isAddress(address) ? getAddress(address) : address
    Promise.all([
      fetch(`${API}/score?address=${scoreAddr}`).then(r => r.json()).catch(() => null),
      fetch(`/api/referral?address=${address}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([scoreData, ref]) => {
      setScore(scoreData)
      setRefStats(ref ? {
        tree_size:     ref.tree_size ?? 0,
        sharing_score: ref.sharing_score ?? 0,
        tree_quality:  ref.tree_quality ?? '0.00',
      } : null)
      setReferredBy(ref?.referred_by ?? null)
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
    const text = isOwner
      ? `I just got my DeFi reputation score on @MintwareFi\n\nTop ${100 - score.percentile}% · ${score.score} pts across ${score.chains} chain${score.chains !== 1 ? 's' : ''}\n\nSee where you rank — it's free:\n${profileUrl}`
      : `Check out this wallet's onchain reputation on @MintwareFi\n\n${fmtTier(score.tier)} tier · ${score.score} pts · Top ${100 - score.percentile}%\n\n${profileUrl}`
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  // ── Invalid address ───────────────────────────────────────────────────────
  if (!isValid && !loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-atx-bone)', fontFamily: 'var(--font-space-grotesk), sans-serif' }}>
        <MwNav />
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
          <Star className="w-8 h-8 text-atx-coral mx-auto mb-4" />
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-atx-ink)', marginBottom: 8 }}>Invalid address</div>
          <div style={{ fontSize: 14, color: 'rgba(17,17,17,0.55)', marginBottom: 24 }}>
            That doesn&apos;t look like a valid wallet address.
          </div>
          <button onClick={() => router.push('/')}
            style={{ background: 'var(--color-atx-blue)', color: 'white', border: '1px solid var(--color-atx-ink)', borderRadius: 0, padding: '10px 20px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', fontFamily: 'var(--font-jetbrains), monospace' }}>
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
          background: var(--color-atx-bone);
          font-family: var(--font-space-grotesk), sans-serif;
          color: var(--color-atx-ink);
        }
        .pp-page *, .pp-page *::before, .pp-page *::after { border-radius: 0 !important; }
        .pp-inner {
          max-width: 840px;
          margin: 0 auto;
          padding: 32px 24px 80px;
        }

        /* ── hero card ───────────────────────────────── */
        .pp-hero {
          background-color: var(--color-atx-panel);
          background-image: ${GRID_BG};
          border: 1px solid var(--color-atx-ink);
          padding: 32px;
          margin-bottom: 16px;
          position: relative;
          overflow: hidden;
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
          background: var(--color-atx-bone);
          border: 1px solid var(--color-atx-ink);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 800;
          font-family: var(--font-jetbrains), monospace;
          color: var(--color-atx-ink);
          flex-shrink: 0;
          position: relative;
        }
        .pp-avatar-score {
          position: absolute;
          bottom: -1px;
          right: -1px;
          background: var(--color-atx-blue);
          color: white;
          font-size: 10px;
          font-weight: 700;
          font-family: var(--font-jetbrains), monospace;
          padding: 2px 6px;
          border: 1px solid var(--color-atx-ink);
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
          color: var(--color-atx-ink);
          letter-spacing: -0.3px;
          font-family: var(--font-jetbrains), monospace;
        }
        .pp-tier-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-family: var(--font-jetbrains), monospace;
          border: 1px solid;
        }
        .pp-full-addr {
          font-size: 11px;
          color: rgba(17,17,17,0.5);
          font-family: var(--font-jetbrains), monospace;
          margin-bottom: 10px;
          word-break: break-all;
        }
        .pp-referred-by {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: rgba(17,17,17,0.5);
          margin-bottom: 12px;
          font-family: var(--font-jetbrains), monospace;
        }
        .pp-referred-link {
          color: var(--color-atx-blue);
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          transition: color 0.15s;
        }
        .pp-referred-link:hover { color: var(--color-atx-ink); }
        .pp-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .pp-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: 1px solid rgba(17,17,17,0.25);
          padding: 3px 10px;
          font-size: 11px;
          color: rgba(17,17,17,0.6);
          font-family: var(--font-jetbrains), monospace;
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
          font-family: var(--font-jetbrains), monospace;
          color: var(--color-atx-blue);
          line-height: 1;
          letter-spacing: -3px;
        }
        .pp-score-meta { padding-bottom: 8px; }
        .pp-score-of {
          font-size: 13px;
          color: rgba(17,17,17,0.45);
          font-family: var(--font-jetbrains), monospace;
          margin-bottom: 6px;
        }
        .pp-rank {
          font-size: 12px;
          color: rgba(17,17,17,0.55);
          margin-bottom: 6px;
          font-family: var(--font-jetbrains), monospace;
        }
        .pp-trend {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
          font-family: var(--font-jetbrains), monospace;
        }
        .pp-sparkline-wrap {
          margin-left: auto;
          align-self: flex-end;
          padding-bottom: 6px;
          opacity: 0.85;
        }

        /* ── badges ──────────────────────────────────── */
        .pp-badges-card {
          background: var(--color-atx-panel);
          border: 1px solid var(--color-atx-ink);
          padding: 20px 24px;
          margin-bottom: 16px;
        }
        .pp-section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(17,17,17,0.55);
          margin-bottom: 14px;
          font-family: var(--font-jetbrains), monospace;
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
          font-size: 12px;
          font-weight: 700;
          border: 1px solid;
          transition: transform 0.15s;
          position: relative;
          font-family: var(--font-jetbrains), monospace;
        }
        .pp-badge:hover { transform: translateY(-1px); }
        .pp-badge.earned {}
        .pp-badge.unearned {
          opacity: 0.35;
        }
        .pp-badge-icon { font-size: 14px; }
        .pp-badge-label { font-size: 12px; }
        .pp-badge-desc {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--color-atx-ink);
          color: white;
          font-size: 10px;
          font-weight: 500;
          padding: 4px 8px;
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
          background: var(--color-atx-panel);
          border: 1px solid var(--color-atx-ink);
          padding: 20px 24px;
        }
        .pp-stat-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid rgba(17,17,17,0.12);
        }
        .pp-stat-row:last-child { border-bottom: none; }
        .pp-stat-key {
          font-size: 12px;
          color: rgba(17,17,17,0.55);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pp-stat-val {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-atx-ink);
          font-family: var(--font-jetbrains), monospace;
        }
        .pp-stat-val.brand { color: var(--color-atx-blue); }
        .pp-stat-val.teal  { color: var(--color-atx-mesquite);  }
        .pp-stat-val.pink  { color: var(--color-atx-coral);  }

        /* ── share strip ─────────────────────────────── */
        .pp-share {
          background: var(--color-atx-panel);
          border: 1px solid var(--color-atx-ink);
          padding: 20px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .pp-share-btns { display: flex; gap: 10px; flex-wrap: wrap; }
        .pp-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 16px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: 1px solid var(--color-atx-ink);
          cursor: pointer;
          transition: opacity 0.15s;
          font-family: var(--font-jetbrains), monospace;
        }
        .pp-btn:hover { opacity: 0.85; }
        .pp-btn.primary { background: var(--color-atx-blue); color: white; }
        .pp-btn.outline {
          background: transparent;
          color: var(--color-atx-ink);
        }
        .pp-claim-cta {
          font-size: 13px;
          color: rgba(17,17,17,0.55);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pp-claim-link {
          color: var(--color-atx-blue);
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
          background: var(--color-atx-panel);
          border: 1px solid var(--color-atx-ink);
          border-left: 3px solid var(--color-atx-coral);
          padding: 12px 18px;
          margin-bottom: 16px;
          font-size: 13px;
          color: var(--color-atx-ink);
          font-weight: 500;
          gap: 12px;
          flex-wrap: wrap;
        }

        /* ── loading skeleton ────────────────────────── */
        .pp-skel {
          background: linear-gradient(90deg, rgba(17,17,17,0.04) 25%, rgba(17,17,17,0.08) 50%, rgba(17,17,17,0.04) 75%);
          background-size: 200% 100%;
          animation: pp-shimmer 1.5s infinite;
        }
        @keyframes pp-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* ── signal breakdown ────────────────────────── */
        .pp-meters-card {
          background: var(--color-atx-panel);
          border: 1px solid var(--color-atx-ink);
          padding: 20px 24px;
          margin-bottom: 16px;
        }
        .pp-meters { display: flex; flex-direction: column; gap: 10px; }
        .pp-meter {
          display: grid;
          grid-template-columns: 100px 1fr auto;
          align-items: center;
          gap: 12px;
        }
        .pp-meter-name {
          font-size: 12px;
          color: rgba(17,17,17,0.6);
          font-family: var(--font-jetbrains), monospace;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .pp-meter-track {
          height: 9px;
          border: 1px solid var(--color-atx-ink);
          background: var(--color-atx-bone);
          overflow: hidden;
        }
        .pp-meter-fill { display: block; height: 100%; }
        .pp-meter-val {
          font-size: 11px;
          color: rgba(17,17,17,0.45);
          font-family: var(--font-jetbrains), monospace;
          text-align: right;
          min-width: 56px;
        }

        /* ── vault handoff ───────────────────────────── */
        .pp-vault {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          background: var(--color-atx-blue);
          border: 1px solid var(--color-atx-ink);
          padding: 18px 24px;
          margin-bottom: 16px;
          text-decoration: none;
        }
        .pp-vault-title { font-size: 17px; font-weight: 800; color: white; letter-spacing: -0.02em; }
        .pp-vault-sub { font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 2px; }
        .pp-vault-btn {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-family: var(--font-jetbrains), monospace;
          background: white;
          color: var(--color-atx-blue);
          padding: 10px 18px;
          border: 1px solid var(--color-atx-ink);
          white-space: nowrap;
        }

        @media (max-width: 600px) {
          .pp-grid { grid-template-columns: 1fr; }
          .pp-score-num { font-size: 52px; }
          .pp-inner { padding: 24px 16px 60px; }
          .pp-share { flex-direction: column; align-items: flex-start; }
          .pp-meter { grid-template-columns: 80px 1fr auto; }
        }
      `}</style>

      <div className="pp-page">
        <MwNav />
        <div className="pp-inner">

          {/* Owner banner — only show once wallet has settled to avoid flash */}
          {walletSettled && isOwner && (
            <div className="pp-owner-banner">
              <span>This is your public profile — shareable without login.</span>
              <a href="/profile" style={{ color: 'var(--color-atx-blue)', fontWeight: 700, textDecoration: 'none', fontSize: 12, fontFamily: 'var(--font-jetbrains), monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                View full dashboard →
              </a>
            </div>
          )}

          {/* ── Hero card ────────────────────────────────────────────────── */}
          <div className="pp-hero">
            <div className="pp-hero-top">
              {/* Left: avatar + identity */}
              <div className="pp-avatar" style={{ overflow: 'hidden' }}>
                {meta?.avatar?.ref
                  ? <img src={meta.avatar.ref} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : address.charAt(2).toUpperCase()}
                {score && <div className="pp-avatar-score">{score.score}</div>}
              </div>
              <div className="pp-hero-info">
                <div className="pp-address-row">
                  {meta?.displayName
                    ? <span className="pp-address">{meta.displayName}</span>
                    : <WalletDisplay address={address} className="pp-address" />}
                  {score && (
                    <span
                      className="pp-tier-pill"
                      style={{
                        color:           tierColor(score.tier),
                        borderColor:     tierColor(score.tier),
                      }}
                    >
                      {fmtTier(score.tier)} tier
                    </span>
                  )}
                </div>
                <div className="pp-full-addr">{shortAddr(address)}</div>
                {meta?.bio && <div style={{ fontSize: 13, color: 'rgba(17,17,17,0.7)', margin: '2px 0 10px', maxWidth: '52ch', lineHeight: 1.45 }}>{meta.bio}</div>}

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
                    <span className="pp-chip">{score.walletAge} old</span>
                  )}
                  {score?.chains != null && (
                    <span className="pp-chip">{score.chains} chain{score.chains !== 1 ? 's' : ''}</span>
                  )}
                  {score?.totalTxCount != null && (
                    <span className="pp-chip">{score.totalTxCount.toLocaleString()} txns</span>
                  )}
                  {score?.character && (
                    <span className="pp-chip" style={{ color: score.character.color }}>{score.character.label}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <ProfileSocials socials={meta?.socials} />
                  <AttestationBadge attestationUid={meta?.attestationUid ?? null} address={address} isOwner={isOwner} onAttested={refetchMeta} />
                </div>
              </div>
            </div>

            {/* Score + sparkline */}
            {loading ? (
              <div className="pp-skel" style={{ height: 72, width: 200 }} />
            ) : score ? (
              <div className="pp-score-block">
                <div className="pp-score-num"><AnimatedScore value={score.score} /></div>
                <div className="pp-score-meta">
                  <div className="pp-score-of">of 925 pts</div>
                  <div className="pp-rank">Top {100 - score.percentile}% · {score.percentile}th percentile</div>
                  {trendDelta !== null && (
                    <div
                      className="pp-trend"
                      style={{ color: trendDelta >= 0 ? 'var(--color-atx-mesquite)' : 'var(--color-atx-clay)' }}
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
              <div style={{ color: 'rgba(17,17,17,0.45)', fontSize: 14 }}>
                No score data available for this address.
              </div>
            )}
          </div>

          {/* ── Signal breakdown — the six signals that make the score ────── */}
          {!loading && score?.signals && score.signals.length > 0 && (
            <div className="pp-meters-card">
              <div className="pp-section-label">Signal breakdown</div>
              <div className="pp-meters">
                {score.signals.map(s => (
                  <div key={s.key} className="pp-meter">
                    <span className="pp-meter-name">{s.name}</span>
                    <span className="pp-meter-track">
                      <span className="pp-meter-fill" style={{ width: `${Math.max(0, Math.min(100, Math.round((s.score / s.max) * 100)))}%`, background: s.color }} />
                    </span>
                    <span className="pp-meter-val">{s.score} / {s.max}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── V4 vault handoff — your score multiplies your returns ──────── */}
          {!loading && score && (
            <a href="/vaults" className="pp-vault">
              <div>
                <div className="pp-vault-title">Deposit into a V4 Vault.</div>
                <div className="pp-vault-sub">Your score multiplies your share of every pool&apos;s fees.</div>
              </div>
              <span className="pp-vault-btn">Deposit →</span>
            </a>
          )}

          {/* ── Share strip ──────────────────────────────────────────────── */}
          <div className="pp-share" style={{ marginBottom: 16, flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', gap: 16, flexWrap: 'wrap' }}>
              <div>
                {isOwner ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-atx-ink)', marginBottom: 3 }}>
                      Invite friends &amp; grow your network
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(17,17,17,0.55)', lineHeight: 1.5 }}>
                      Friends who connect via your link count toward your sharing score
                    </div>
                  </>
                ) : walletSettled ? (
                  <div className="pp-claim-cta">
                    This your wallet?
                    <a href="/" className="pp-claim-link">Connect to claim your profile →</a>
                  </div>
                ) : null}
              </div>
              <div className="pp-share-btns">
                <button className="pp-btn outline" onClick={copyUrl}>
                  {copied ? 'Copied' : isOwner ? 'Copy invite link' : 'Copy profile URL'}
                </button>
                {score && (
                  <button className="pp-btn primary" onClick={shareOnX}>
                    𝕏 Share on X
                  </button>
                )}
              </div>
            </div>
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
                      color:       b.earned ? b.color : 'rgba(17,17,17,0.55)',
                      borderColor: b.earned ? b.color : 'rgba(17,17,17,0.2)',
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
                  <span className="pp-stat-key">Chains active</span>
                  <span className="pp-stat-val brand">{score.chains ?? '—'}</span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">Total txns</span>
                  <span className="pp-stat-val">{(score.totalTxCount ?? 0).toLocaleString()}</span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">Character</span>
                  <span className="pp-stat-val" style={{ color: score.character?.color }}>
                    {score.character?.label}
                  </span>
                </div>
                {topSignals.length > 0 && (
                  <div className="pp-stat-row">
                    <span className="pp-stat-key">Top signals</span>
                    <span className="pp-stat-val" style={{ fontSize: 11 }}>
                      {topSignals.map(s => s.name).join(' · ')}
                    </span>
                  </div>
                )}
                {(score.totalLo > 0 || score.totalHi > 0) && (
                  <div className="pp-stat-row">
                    <span className="pp-stat-key">Est. earnings</span>
                    <span className="pp-stat-val teal">
                      ${score.totalLo.toLocaleString()}–${score.totalHi.toLocaleString()}/yr
                    </span>
                  </div>
                )}
              </div>

              {/* Referral network */}
              <div className="pp-stat-card">
                <div className="pp-section-label">Referral Network</div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">Wallets referred</span>
                  <span className="pp-stat-val brand">
                    {refStats?.tree_size ?? score.treeSize ?? 0}
                  </span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">Network quality</span>
                  <span className="pp-stat-val">
                    {refStats?.tree_quality ?? score.treeQuality ?? '0.00'}
                  </span>
                </div>
                <div className="pp-stat-row">
                  <span className="pp-stat-key">Sharing score</span>
                  <span className="pp-stat-val pink">
                    {refStats?.sharing_score ?? 0}
                  </span>
                </div>
                {referredBy ? (
                  <div className="pp-stat-row">
                    <span className="pp-stat-key">Referred by</span>
                    <a href={`/${referredBy}`} style={{ textDecoration: 'none' }}>
                      <span className="pp-stat-val" style={{ color: 'var(--color-atx-blue)', fontSize: 11 }}>
                        <WalletDisplay address={referredBy} mono />
                      </span>
                    </a>
                  </div>
                ) : (
                  <div className="pp-stat-row">
                    <span className="pp-stat-key">Referred by</span>
                    <span className="pp-stat-val" style={{ opacity: 0.3 }}>—</span>
                  </div>
                )}
              </div>
            </div>
          )}


        </div>
      </div>
    </>
  )
}
