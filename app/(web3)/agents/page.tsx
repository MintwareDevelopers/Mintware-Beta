'use client'

import { useAccount }          from 'wagmi'
import { useRouter }           from 'next/navigation'
import { MwNav }               from '@/components/web2/MwNav'
import { MwAuthGuard }         from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'

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

function avatarColor(addr: string): { bg: string; letter: string } {
  const palettes = [
    { bg: 'rgba(79,126,247,0.12)',  letter: 'var(--color-mw-brand)' },
    { bg: 'rgba(42,158,138,0.12)',  letter: 'var(--color-mw-teal)'  },
    { bg: 'rgba(194,83,122,0.12)',  letter: 'var(--color-mw-pink)'  },
    { bg: 'rgba(194,122,0,0.12)',   letter: 'var(--color-mw-amber)' },
    { bg: 'rgba(123,111,204,0.12)', letter: '#7B6FCC'               },
    { bg: 'rgba(58,92,232,0.12)',   letter: 'var(--color-mw-brand-deep)' },
    { bg: 'rgba(22,163,74,0.12)',   letter: 'var(--color-mw-green)' },
  ]
  const idx = parseInt(addr.slice(2, 4), 16) % palettes.length
  return palettes[idx]
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function AgentsContent() {
  const { address: myAddress } = useAccount()
  const myAddr = myAddress?.toLowerCase() ?? ''
  const router = useRouter()

  const [rows,    setRows]    = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/agents/leaderboard')
      .then(r => r.json())
      .then(d => { setRows(d.leaderboard ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load leaderboard'); setLoading(false) })
  }, [])

  const totalAgents      = rows.length
  const transparentCount = rows.filter(r => r.is_transparent).length
  const mwpCount         = rows.filter(r => r.mwp_submissions > 0).length

  return (
    <>
      <style>{`
        .ag-page {
          min-height: 100vh;
          background: var(--color-mw-surface);
          font-family: var(--font-jakarta), sans-serif;
        }
        .ag-inner {
          max-width: 900px;
          margin: 0 auto;
          padding: 40px 24px 80px;
        }

        /* ── header ──────────────────────────────────────── */
        .ag-header { margin-bottom: 28px; }
        .ag-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
          border-radius: 20px;
          padding: 3px 11px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 14px;
        }
        .ag-title {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--color-mw-ink);
          margin: 0 0 6px;
        }
        .ag-subtitle {
          font-size: 14px;
          color: var(--color-mw-ink-3);
          margin: 0;
          line-height: 1.5;
        }

        /* ── oracle live pill ────────────────────────────── */
        .ag-oracle-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(34,197,94,0.08);
          border: 1px solid rgba(34,197,94,0.18);
          border-radius: 20px;
          padding: 4px 11px;
          font-size: 11px;
          font-weight: 600;
          color: var(--color-mw-live);
          margin-bottom: 24px;
        }
        .ag-oracle-dot {
          width: 7px;
          height: 7px;
          background: var(--color-mw-live);
          border-radius: 50%;
          animation: ag-pulse 2s infinite;
        }
        @keyframes ag-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }

        /* ── stat row ────────────────────────────────────── */
        .ag-stats {
          display: flex;
          gap: 12px;
          margin-bottom: 24px;
        }
        .ag-stat {
          flex: 1;
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-md);
          padding: 16px 18px;
          box-shadow: var(--shadow-sm);
        }
        .ag-stat-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-mw-ink-3);
          margin-bottom: 6px;
        }
        .ag-stat-value {
          font-size: 26px;
          font-weight: 800;
          font-family: var(--font-mono), monospace;
          color: var(--color-mw-ink);
          letter-spacing: -0.5px;
          line-height: 1;
        }
        .ag-stat-value.teal  { color: var(--color-mw-teal); }
        .ag-stat-value.green { color: var(--color-mw-live); }

        /* ── table card ──────────────────────────────────── */
        .ag-card {
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          overflow: hidden;
          box-shadow: var(--shadow-md);
          margin-bottom: 20px;
        }
        .ag-card-head {
          padding: 13px 20px;
          border-bottom: 1px solid var(--color-mw-border);
          background: var(--color-mw-surface-card);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ag-card-head-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-mw-ink-3);
        }

        /* ── agent rows ──────────────────────────────────── */
        .ag-row {
          display: flex;
          align-items: center;
          padding: 14px 20px;
          border-bottom: 1px solid var(--color-mw-border);
          cursor: pointer;
          transition: background 0.12s;
          gap: 14px;
        }
        .ag-row:last-child { border-bottom: none; }
        .ag-row:hover      { background: var(--color-mw-surface); }
        .ag-row.mine       { background: var(--color-mw-brand-dim); }
        .ag-row.mine:hover { background: rgba(79,126,247,0.1); }

        .ag-rank {
          width: 28px;
          text-align: center;
          font-size: 13px;
          font-family: var(--font-mono), monospace;
          font-weight: 700;
          color: var(--color-mw-ink-3);
          flex-shrink: 0;
        }
        .ag-rank.top { color: var(--color-mw-brand); }

        .ag-avatar {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 800;
          font-family: var(--font-mono), monospace;
          flex-shrink: 0;
        }

        .ag-info { flex: 1; min-width: 0; }
        .ag-addr-row {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .ag-addr {
          font-size: 13px;
          font-weight: 600;
          font-family: var(--font-mono), monospace;
          color: var(--color-mw-ink);
        }
        .ag-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          border-radius: 5px;
          padding: 2px 6px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }
        .ag-badge.transparent {
          background: rgba(34,197,94,0.09);
          color: var(--color-mw-live);
        }
        .ag-badge.erc {
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
        }
        .ag-badge.you {
          background: rgba(79,126,247,0.12);
          color: var(--color-mw-brand);
        }

        /* score bar */
        .ag-bar-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ag-bar-track {
          flex: 1;
          height: 3px;
          background: var(--color-mw-border);
          border-radius: 2px;
          overflow: hidden;
          display: flex;
          max-width: 100px;
        }
        .ag-bar-b { background: var(--color-mw-brand); height: 100%; }
        .ag-bar-c { background: var(--color-mw-teal);  height: 100%; }
        .ag-bar-i { background: var(--color-mw-live);  height: 100%; }
        .ag-bar-sub {
          font-size: 10px;
          color: var(--color-mw-ink-3);
          font-family: var(--font-mono), monospace;
          white-space: nowrap;
        }

        /* score + mwp columns */
        .ag-score-col {
          text-align: right;
          flex-shrink: 0;
          min-width: 52px;
        }
        .ag-score-num {
          font-size: 15px;
          font-weight: 800;
          font-family: var(--font-mono), monospace;
          color: var(--color-mw-brand);
          line-height: 1;
        }
        .ag-score-sub {
          font-size: 10px;
          color: var(--color-mw-ink-3);
          margin-top: 2px;
        }
        .ag-mwp-col {
          text-align: right;
          flex-shrink: 0;
          min-width: 44px;
          font-size: 11px;
          font-family: var(--font-mono), monospace;
          color: var(--color-mw-ink-3);
        }
        .ag-mwp-col.has { color: var(--color-mw-live); font-weight: 600; }

        /* ── empty / loading / error ─────────────────────── */
        .ag-state {
          text-align: center;
          padding: 56px 24px;
          color: var(--color-mw-ink-3);
          font-size: 14px;
        }
        .ag-state-icon { font-size: 28px; margin-bottom: 10px; opacity: 0.4; }
        .ag-state-sub  { font-size: 12px; margin-top: 6px; }

        /* ── register CTA card ───────────────────────────── */
        .ag-cta {
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
          padding: 24px 28px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          flex-wrap: wrap;
        }
        .ag-cta-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-mw-brand);
          margin-bottom: 6px;
        }
        .ag-cta-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--color-mw-ink);
          margin-bottom: 4px;
        }
        .ag-cta-sub {
          font-size: 13px;
          color: var(--color-mw-ink-3);
          line-height: 1.5;
          max-width: 300px;
        }
        .ag-cta-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-top: 12px;
          color: var(--color-mw-brand);
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
        }
        .ag-cta-link:hover { text-decoration: underline; }
        .ag-cta-code {
          background: var(--color-mw-surface-card);
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-md);
          padding: 14px 18px;
          font-size: 12px;
          font-family: var(--font-mono), monospace;
          color: var(--color-mw-ink-2);
          line-height: 1.7;
          white-space: pre;
          flex-shrink: 0;
          align-self: center;
        }

        @media (max-width: 640px) {
          .ag-stats    { flex-direction: column; }
          .ag-cta      { flex-direction: column; }
          .ag-cta-code { width: 100%; }
          .ag-bar-track { max-width: 70px; }
          .ag-mwp-col  { display: none; }
        }
      `}</style>

      <div className="ag-page">
        <MwNav />
        <div className="ag-inner">

          {/* Header */}
          <div className="ag-header">
            <div className="ag-eyebrow">⬡ ERC-8004 Native</div>
            <h1 className="ag-title">AI Agent Leaderboard</h1>
            <p className="ag-subtitle">
              On-chain reputation for autonomous agents — volume, contribution, and MWP transparency scored on Base.
            </p>
          </div>

          {/* Oracle live pill */}
          <div className="ag-oracle-pill">
            <div className="ag-oracle-dot" />
            Oracle live on Base
          </div>

          {/* Stats */}
          <div className="ag-stats">
            <div className="ag-stat">
              <div className="ag-stat-label">Total Agents</div>
              <div className="ag-stat-value">{loading ? '—' : totalAgents}</div>
            </div>
            <div className="ag-stat">
              <div className="ag-stat-label">Transparent</div>
              <div className="ag-stat-value green">{loading ? '—' : transparentCount}</div>
            </div>
            <div className="ag-stat">
              <div className="ag-stat-label">MWP Hashes</div>
              <div className="ag-stat-value teal">{loading ? '—' : mwpCount}</div>
            </div>
          </div>

          {/* Leaderboard table */}
          <div className="ag-card">
            <div className="ag-card-head">
              <span className="ag-card-head-label">Ranked by Attribution Score</span>
              <span style={{ fontSize: 11, color: 'var(--color-mw-ink-3)' }}>
                {!loading && !error ? `${rows.length} agent${rows.length !== 1 ? 's' : ''}` : ''}
              </span>
            </div>

            {loading && (
              <div className="ag-state">
                <div className="ag-state-icon">⬡</div>
                Loading agents…
              </div>
            )}
            {error && (
              <div className="ag-state" style={{ color: 'var(--color-mw-red)' }}>
                {error}
              </div>
            )}
            {!loading && !error && rows.length === 0 && (
              <div className="ag-state">
                <div className="ag-state-icon">⬡</div>
                No agents registered yet.
                <div className="ag-state-sub">Be the first — register below.</div>
              </div>
            )}

            {!loading && !error && rows.map(row => {
              const av    = avatarColor(row.address)
              const total = row.behavior + row.contribution + row.interpretability
              const bPct  = total > 0 ? (row.behavior         / total) * 100 : 0
              const cPct  = total > 0 ? (row.contribution     / total) * 100 : 0
              const iPct  = total > 0 ? (row.interpretability / total) * 100 : 0
              const isMe  = row.address === myAddr

              return (
                <div
                  key={row.address}
                  className={`ag-row${isMe ? ' mine' : ''}`}
                  onClick={() => router.push(`/agent/${row.address}`)}
                >
                  <div className={`ag-rank${row.rank <= 3 ? ' top' : ''}`}>
                    {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                  </div>

                  <div className="ag-avatar" style={{ background: av.bg, color: av.letter }}>
                    {row.address.slice(2, 4).toUpperCase()}
                  </div>

                  <div className="ag-info">
                    <div className="ag-addr-row">
                      <span className="ag-addr">{shortAddr(row.address)}</span>
                      {row.is_transparent && (
                        <span className="ag-badge transparent">✦ Transparent</span>
                      )}
                      {row.erc8004_token_id && (
                        <span className="ag-badge erc">ERC-8004</span>
                      )}
                      {isMe && <span className="ag-badge you">You</span>}
                    </div>
                    <div className="ag-bar-wrap">
                      <div className="ag-bar-track">
                        <div className="ag-bar-b" style={{ width: bPct + '%' }} />
                        <div className="ag-bar-c" style={{ width: cPct + '%' }} />
                        <div className="ag-bar-i" style={{ width: iPct + '%' }} />
                      </div>
                      <span className="ag-bar-sub">
                        {row.behavior}b · {row.contribution}c · {row.interpretability}i
                        {row.risk > 0 && (
                          <span style={{ color: 'var(--color-mw-red)' }}> −{row.risk}r</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="ag-score-col">
                    <div className="ag-score-num">{row.total_score}</div>
                    <div className="ag-score-sub">pts</div>
                  </div>

                  <div className={`ag-mwp-col${row.mwp_submissions > 0 ? ' has' : ''}`}>
                    {row.mwp_submissions > 0 ? `${row.mwp_submissions} MWP` : '—'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Register CTA */}
          <div className="ag-cta">
            <div>
              <div className="ag-cta-eyebrow">For Developers</div>
              <div className="ag-cta-title">Register your agent in 2 lines</div>
              <div className="ag-cta-sub">
                Drop your agent onto the leaderboard and start earning Attribution score on Base.
              </div>
              <a className="ag-cta-link" href="/docs/ai-attribution/sdk" target="_blank" rel="noopener">
                View SDK docs →
              </a>
            </div>
            <div className="ag-cta-code">{`npm install @mintware/ai-attribution-sdk

await registerWithMintwareOracle({
  privateKey: process.env.KEY
})`}</div>
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
