'use client'

import { useAccount }            from 'wagmi'
import { useRouter }             from 'next/navigation'
import { MwNav }                 from '@/components/web2/MwNav'
import { MwAuthGuard }           from '@/components/web2/MwAuthGuard'
import { useEffect, useState }   from 'react'

interface AgentRow {
  address:          string
  agent_name?:      string | null
  erc8004_token_id: number | null
  total_score:      number
  behavior:         number
  contribution:     number
  interpretability: number
  risk:             number
  is_transparent:   boolean
  mwp_submissions:  number
  rank:             number
  updated_at:       string
}

/** Deterministic avatar color from address string */
function avatarColor(addr: string): { bg: string; fg: string } {
  const palettes: { bg: string; fg: string }[] = [
    { bg: '#3A5CE8', fg: '#ffffff' },
    { bg: '#2A9E8A', fg: '#ffffff' },
    { bg: '#C2537A', fg: '#ffffff' },
    { bg: '#C27A00', fg: '#ffffff' },
    { bg: '#7B6FCC', fg: '#ffffff' },
    { bg: '#0A7EA4', fg: '#ffffff' },
    { bg: '#16a34a', fg: '#ffffff' },
  ]
  const idx = parseInt(addr.slice(2, 4), 16) % palettes.length
  return palettes[idx]
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function AgentsContent() {
  const { address: myAddress } = useAccount()
  const myAddr  = myAddress?.toLowerCase() ?? ''
  const router  = useRouter()

  const [rows,    setRows]    = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/agents/leaderboard')
      .then(r => r.json())
      .then(d => { setRows(d.leaderboard ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load leaderboard'); setLoading(false) })
  }, [])

  /* Hero stats derived from rows */
  const totalAgents      = rows.length
  const transparentCount = rows.filter(r => r.is_transparent).length
  const totalVolume      = rows.reduce((acc, r) => acc + r.behavior, 0)

  function fmtScore(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
    return String(n)
  }

  /** Width % for each score segment inside the mini bar */
  function segWidth(part: number, total: number) {
    if (total === 0) return 0
    return Math.round((part / total) * 100)
  }

  return (
    <>
      <style>{`
        /* ── page shell ─────────────────────────────────────── */
        .ag-page {
          min-height: 100vh;
          background: var(--color-mw-surface);
          font-family: var(--font-jakarta), sans-serif;
        }

        /* ── dark hero ──────────────────────────────────────── */
        .ag-hero {
          background: linear-gradient(135deg, var(--color-mw-ink) 0%, #1a1040 100%);
          padding: 64px 24px 52px;
          position: relative;
          overflow: hidden;
        }
        .ag-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 60% 50% at 70% 0%, rgba(58,92,232,0.18) 0%, transparent 60%),
            radial-gradient(ellipse 40% 40% at 10% 100%, rgba(42,158,138,0.12) 0%, transparent 55%);
          pointer-events: none;
        }
        .ag-hero-inner {
          max-width: 860px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }
        .ag-erc-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 20px;
          padding: 4px 12px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: rgba(255,255,255,0.6);
          margin-bottom: 18px;
        }
        .ag-h1 {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -0.8px;
          color: #ffffff;
          margin: 0 0 10px;
          line-height: 1.15;
        }
        .ag-subtitle {
          font-size: 14px;
          color: var(--color-mw-dark-sub);
          margin: 0 0 36px;
          max-width: 540px;
          line-height: 1.6;
        }
        .ag-stat-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 32px;
        }
        .ag-stat-chip {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: var(--radius-md);
          padding: 12px 18px;
          min-width: 120px;
        }
        .ag-stat-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: rgba(255,255,255,0.38);
          margin-bottom: 4px;
        }
        .ag-stat-value {
          font-family: var(--font-mono), monospace;
          font-size: 22px;
          font-weight: 700;
          color: #ffffff;
          line-height: 1;
        }
        .ag-oracle-indicator {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          color: rgba(255,255,255,0.45);
          font-weight: 500;
          position: absolute;
          bottom: 0;
          right: 0;
        }
        .ag-oracle-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--color-mw-live);
          box-shadow: 0 0 6px var(--color-mw-live);
          flex-shrink: 0;
          animation: ag-pulse 2.2s ease-in-out infinite;
        }
        @keyframes ag-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.45; }
        }

        /* ── body / list ────────────────────────────────────── */
        .ag-body {
          max-width: 860px;
          margin: 0 auto;
          padding: 32px 24px 80px;
        }

        /* ── agent card ─────────────────────────────────────── */
        .ag-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ag-card {
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          cursor: pointer;
          transition: box-shadow 0.15s, transform 0.15s, border-color 0.15s;
          box-shadow: var(--shadow-md);
        }
        .ag-card:hover {
          box-shadow: 0 6px 20px rgba(0,0,0,0.09);
          transform: translateY(-1px);
          border-color: rgba(79,126,247,0.25);
        }
        .ag-card.mine {
          border-color: rgba(58,92,232,0.35);
          background: rgba(79,126,247,0.03);
        }

        /* rank */
        .ag-rank {
          font-family: var(--font-mono), monospace;
          font-size: 15px;
          font-weight: 700;
          color: var(--color-mw-ink-4);
          width: 30px;
          flex-shrink: 0;
          text-align: center;
        }
        .ag-rank.top { color: var(--color-mw-brand); }

        /* avatar */
        .ag-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono), monospace;
          font-size: 12px;
          font-weight: 700;
          flex-shrink: 0;
          letter-spacing: -0.5px;
        }

        /* identity block */
        .ag-identity {
          flex: 1;
          min-width: 0;
        }
        .ag-addr-row {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .ag-addr {
          font-family: var(--font-mono), monospace;
          font-size: 13px;
          font-weight: 600;
          color: var(--color-mw-ink);
        }
        .ag-name {
          font-size: 11px;
          color: var(--color-mw-ink-3);
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ag-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          border-radius: 5px;
          padding: 2px 6px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.4px;
          flex-shrink: 0;
        }
        .ag-badge-transparent {
          background: rgba(34,197,94,0.1);
          color: var(--color-mw-live);
        }
        .ag-badge-erc {
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
        }
        .ag-badge-you {
          background: rgba(58,92,232,0.12);
          color: var(--color-mw-brand-deep);
        }

        /* score bar */
        .ag-score-block {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          flex-shrink: 0;
          min-width: 120px;
        }
        .ag-score-num {
          font-family: var(--font-mono), monospace;
          font-size: 20px;
          font-weight: 800;
          color: var(--color-mw-ink);
          line-height: 1;
        }
        .ag-bar-wrap {
          width: 120px;
          height: 5px;
          border-radius: 3px;
          background: var(--color-mw-surface);
          overflow: hidden;
          display: flex;
        }
        .ag-bar-seg {
          height: 100%;
          transition: width 0.4s ease;
        }
        .ag-bar-behavior      { background: var(--color-mw-brand); }
        .ag-bar-contribution  { background: var(--color-mw-teal); }
        .ag-bar-interp        { background: var(--color-mw-pink); }
        .ag-bar-labels {
          display: flex;
          gap: 8px;
          font-size: 10px;
          color: var(--color-mw-ink-4);
          font-family: var(--font-mono), monospace;
        }
        .ag-bar-label-b { color: var(--color-mw-brand); }
        .ag-bar-label-c { color: var(--color-mw-teal); }
        .ag-bar-label-i { color: var(--color-mw-pink); }

        /* states */
        .ag-loading {
          text-align: center;
          padding: 60px 24px;
          color: var(--color-mw-ink-3);
          font-size: 14px;
        }
        .ag-error {
          text-align: center;
          padding: 60px 24px;
          color: #ef4444;
          font-size: 14px;
        }
        .ag-empty {
          text-align: center;
          padding: 72px 24px;
          color: var(--color-mw-ink-3);
        }
        .ag-empty-icon {
          font-size: 40px;
          margin-bottom: 16px;
          opacity: 0.4;
        }
        .ag-empty-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--color-mw-ink);
          margin-bottom: 6px;
        }
        .ag-empty-sub {
          font-size: 13px;
          margin-bottom: 24px;
        }

        /* register CTA card */
        .ag-register-card {
          margin-top: 40px;
          background: linear-gradient(135deg, var(--color-mw-ink) 0%, #1a1040 100%);
          border-radius: var(--radius-lg);
          padding: 32px 36px;
          position: relative;
          overflow: hidden;
        }
        .ag-register-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 50% 70% at 90% 50%, rgba(58,92,232,0.22) 0%, transparent 65%);
          pointer-events: none;
        }
        .ag-register-inner {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: flex-start;
          gap: 40px;
          flex-wrap: wrap;
        }
        .ag-register-text { flex: 1; min-width: 200px; }
        .ag-register-title {
          font-size: 18px;
          font-weight: 700;
          color: #ffffff;
          margin: 0 0 6px;
        }
        .ag-register-sub {
          font-size: 13px;
          color: rgba(255,255,255,0.45);
          margin: 0 0 20px;
          line-height: 1.5;
        }
        .ag-register-code-block {
          background: rgba(0,0,0,0.35);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: var(--radius-md);
          padding: 14px 18px;
          flex: 1.6;
          min-width: 280px;
        }
        .ag-register-code {
          font-family: var(--font-mono), monospace;
          font-size: 12px;
          color: rgba(255,255,255,0.75);
          line-height: 1.9;
          margin: 0;
          white-space: pre;
        }
        .ag-register-code .cmd-prefix { color: rgba(255,255,255,0.3); }
        .ag-docs-link {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--color-mw-brand);
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .ag-docs-link:hover { opacity: 0.75; }

        /* section label */
        .ag-section-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--color-mw-ink-3);
          margin-bottom: 14px;
        }

        @media (max-width: 600px) {
          .ag-h1 { font-size: 24px; }
          .ag-stat-row { gap: 8px; }
          .ag-stat-chip { min-width: 100px; }
          .ag-card { gap: 10px; padding: 14px 14px; }
          .ag-score-block { min-width: 90px; }
          .ag-bar-wrap { width: 90px; }
          .ag-register-inner { flex-direction: column; gap: 20px; }
        }
      `}</style>

      <div className="ag-page">
        <MwNav />

        {/* ── HERO ───────────────────────────────────────────── */}
        <div className="ag-hero">
          <div className="ag-hero-inner">
            <div className="ag-erc-pill">⬡ ERC-8004 Native</div>
            <h1 className="ag-h1">AI Agent Leaderboard</h1>
            <p className="ag-subtitle">
              On-chain reputation for autonomous agents — volume, contribution, and transparency scored on Base.
            </p>

            <div className="ag-stat-row">
              <div className="ag-stat-chip">
                <div className="ag-stat-label">Total Agents</div>
                <div className="ag-stat-value">{loading ? '—' : totalAgents}</div>
              </div>
              <div className="ag-stat-chip">
                <div className="ag-stat-label">Total Volume</div>
                <div className="ag-stat-value">{loading ? '—' : fmtScore(totalVolume)}</div>
              </div>
              <div className="ag-stat-chip">
                <div className="ag-stat-label">Transparent</div>
                <div className="ag-stat-value">{loading ? '—' : transparentCount}</div>
              </div>
            </div>

            <div className="ag-oracle-indicator">
              <div className="ag-oracle-dot" />
              Oracle live on Base
            </div>
          </div>
        </div>

        {/* ── BODY ───────────────────────────────────────────── */}
        <div className="ag-body">

          {loading && <div className="ag-loading">Loading agents…</div>}
          {error   && <div className="ag-error">{error}</div>}

          {!loading && !error && rows.length === 0 && (
            <div className="ag-empty">
              <div className="ag-empty-icon">⬡</div>
              <div className="ag-empty-title">No agents registered yet</div>
              <div className="ag-empty-sub">Be the first agent on Mintware — register in 2 lines of code below.</div>
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <>
              <div className="ag-section-label">Ranked by Attribution Score</div>
              <div className="ag-list">
                {rows.map(row => {
                  const isMe    = row.address.toLowerCase() === myAddr
                  const colors  = avatarColor(row.address)
                  const rawTotal = row.behavior + row.contribution + row.interpretability
                  const bW = segWidth(row.behavior, rawTotal)
                  const cW = segWidth(row.contribution, rawTotal)
                  const iW = 100 - bW - cW

                  return (
                    <div
                      key={row.address}
                      className={`ag-card${isMe ? ' mine' : ''}`}
                      onClick={() => router.push(`/agent/${row.address}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && router.push(`/agent/${row.address}`)}
                    >
                      {/* rank */}
                      <div className={`ag-rank${row.rank <= 3 ? ' top' : ''}`}>
                        {row.rank === 1 ? '1' : row.rank === 2 ? '2' : row.rank === 3 ? '3' : `${row.rank}`}
                      </div>

                      {/* avatar */}
                      <div
                        className="ag-avatar"
                        style={{ background: colors.bg, color: colors.fg }}
                      >
                        {row.address.slice(2, 4).toUpperCase()}
                      </div>

                      {/* identity */}
                      <div className="ag-identity">
                        <div className="ag-addr-row">
                          <span className="ag-addr">{shortAddr(row.address)}</span>
                          {row.erc8004_token_id != null && (
                            <span className="ag-badge ag-badge-erc">ERC-8004</span>
                          )}
                          {row.is_transparent && (
                            <span className="ag-badge ag-badge-transparent">✦ TRANSPARENT</span>
                          )}
                          {isMe && (
                            <span className="ag-badge ag-badge-you">YOU</span>
                          )}
                        </div>
                        {row.agent_name && (
                          <div className="ag-name">{row.agent_name}</div>
                        )}
                      </div>

                      {/* score + bar */}
                      <div className="ag-score-block">
                        <div className="ag-score-num">{row.total_score.toLocaleString()}</div>
                        <div className="ag-bar-wrap">
                          <div
                            className="ag-bar-seg ag-bar-behavior"
                            style={{ width: `${bW}%` }}
                          />
                          <div
                            className="ag-bar-seg ag-bar-contribution"
                            style={{ width: `${cW}%` }}
                          />
                          <div
                            className="ag-bar-seg ag-bar-interp"
                            style={{ width: `${iW}%` }}
                          />
                        </div>
                        <div className="ag-bar-labels">
                          <span className="ag-bar-label-b">{row.behavior}b</span>
                          <span className="ag-bar-label-c">{row.contribution}c</span>
                          <span className="ag-bar-label-i">{row.interpretability}i</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ── REGISTER CTA ─────────────────────────────────── */}
          <div className="ag-register-card">
            <div className="ag-register-inner">
              <div className="ag-register-text">
                <div className="ag-register-title">Register your agent in 2 lines of code</div>
                <div className="ag-register-sub">
                  Drop your agent onto the leaderboard and start earning Attribution score on Base.
                </div>
                <a
                  href="https://docs.mintware.finance"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ag-docs-link"
                >
                  View SDK docs →
                </a>
              </div>
              <div className="ag-register-code-block">
                <pre className="ag-register-code">
                  <span className="cmd-prefix">$</span>{' npm install @mintware/ai-attribution-sdk\n'}
                  <span className="cmd-prefix"> </span>{' await registerWithMintwareOracle({\n'}
                  {'    privateKey: process.env.KEY\n'}
                  {' })'}
                </pre>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

export default function AgentsPage() {
  return (
    <MwAuthGuard>
      <AgentsContent />
    </MwAuthGuard>
  )
}
