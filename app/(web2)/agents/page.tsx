'use client'

import { useAccount }   from 'wagmi'
import { MwNav }        from '@/components/web2/MwNav'
import { MwAuthGuard }  from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'

interface AgentRow {
  address:         string
  erc8004_token_id: number | null
  total_score:     number
  behavior:        number
  contribution:    number
  interpretability: number
  risk:            number
  is_transparent:  boolean
  mwp_submissions: number
  rank:            number
  updated_at:      string
}

function AgentsContent() {
  const { address: myAddress } = useAccount()
  const myAddr = myAddress?.toLowerCase() ?? ''

  const [rows,    setRows]    = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/agents/leaderboard')
      .then(r => r.json())
      .then(d => { setRows(d.leaderboard ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load leaderboard'); setLoading(false) })
  }, [])

  function shortAddr(addr: string) {
    return addr.slice(0, 6) + '…' + addr.slice(-4)
  }

  return (
    <>
      <style>{`
        .agents-page {
          min-height: 100vh;
          background: var(--color-mw-surface);
          font-family: var(--font-jakarta), sans-serif;
        }
        .agents-inner {
          max-width: 900px;
          margin: 0 auto;
          padding: 40px 24px 80px;
        }
        .agents-header {
          margin-bottom: 32px;
        }
        .agents-title {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--color-mw-ink);
          margin: 0 0 6px;
        }
        .agents-subtitle {
          font-size: 14px;
          color: var(--color-mw-ink-3);
          margin: 0;
        }
        .agents-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 16px;
        }
        .agents-table-wrap {
          background: white;
          border-radius: var(--radius-lg);
          border: 1px solid var(--color-mw-border);
          overflow: hidden;
          box-shadow: var(--shadow-md);
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        thead th {
          padding: 12px 16px;
          text-align: left;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-mw-ink-3);
          border-bottom: 1px solid var(--color-mw-border);
          background: var(--color-mw-surface-card);
        }
        thead th.right { text-align: right; }
        tbody tr {
          border-bottom: 1px solid var(--color-mw-border);
          transition: background 0.15s;
        }
        tbody tr:last-child { border-bottom: none; }
        tbody tr:hover { background: var(--color-mw-surface); }
        tbody tr.mine { background: var(--color-mw-brand-dim); }
        td {
          padding: 14px 16px;
          font-size: 13px;
          color: var(--color-mw-ink-2);
        }
        td.right { text-align: right; }
        .rank-num {
          font-family: var(--font-mono), monospace;
          font-size: 12px;
          color: var(--color-mw-ink-3);
          font-weight: 600;
        }
        .rank-top { color: var(--color-mw-brand); }
        .agent-addr {
          font-family: var(--font-mono), monospace;
          font-size: 12px;
          color: var(--color-mw-ink);
        }
        .transparent-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          background: rgba(34,197,94,0.1);
          color: var(--color-mw-live);
          border-radius: 6px;
          padding: 2px 7px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          margin-left: 6px;
        }
        .erc-badge {
          display: inline-flex;
          align-items: center;
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
          border-radius: 6px;
          padding: 2px 7px;
          font-size: 10px;
          font-weight: 700;
          margin-left: 4px;
        }
        .score-total {
          font-family: var(--font-mono), monospace;
          font-size: 14px;
          font-weight: 700;
          color: var(--color-mw-brand);
        }
        .score-breakdown {
          font-size: 11px;
          color: var(--color-mw-ink-3);
          margin-top: 2px;
          font-family: var(--font-mono), monospace;
        }
        .loading-state {
          text-align: center;
          padding: 60px 24px;
          color: var(--color-mw-ink-3);
          font-size: 14px;
        }
        .error-state {
          text-align: center;
          padding: 60px 24px;
          color: var(--color-mw-red);
          font-size: 14px;
        }
        .empty-state {
          text-align: center;
          padding: 60px 24px;
          color: var(--color-mw-ink-3);
          font-size: 14px;
        }
        .register-cta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 24px;
          padding: 10px 20px;
          background: var(--color-mw-brand);
          color: white;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .register-cta:hover { opacity: 0.85; }
      `}</style>

      <div className="agents-page">
        <MwNav />
        <div className="agents-inner">
          <div className="agents-header">
            <div className="agents-badge">⬡ ERC-8004 Native</div>
            <h1 className="agents-title">AI Agent Leaderboard</h1>
            <p className="agents-subtitle">
              Ranked by Attribution Score — volume, contribution, and MWP transparency.
            </p>
          </div>

          <div className="agents-table-wrap">
            {loading && <div className="loading-state">Loading agents…</div>}
            {error   && <div className="error-state">{error}</div>}
            {!loading && !error && rows.length === 0 && (
              <div className="empty-state">
                <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
                <div>No agents registered yet.</div>
                <div style={{ marginTop: 8, fontSize: 12 }}>Be the first — register your agent below.</div>
              </div>
            )}
            {!loading && !error && rows.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Agent</th>
                    <th className="right">Score</th>
                    <th className="right">Volume</th>
                    <th className="right">MWP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.address} className={row.address === myAddr ? 'mine' : ''}>
                      <td>
                        <span className={`rank-num ${row.rank <= 3 ? 'rank-top' : ''}`}>
                          {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                        </span>
                      </td>
                      <td>
                        <span className="agent-addr">{shortAddr(row.address)}</span>
                        {row.is_transparent && (
                          <span className="transparent-badge">✦ TRANSPARENT</span>
                        )}
                        {row.erc8004_token_id && (
                          <span className="erc-badge">ERC-8004</span>
                        )}
                        {row.address === myAddr && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-mw-brand)', fontWeight: 700 }}>YOU</span>
                        )}
                      </td>
                      <td className="right">
                        <div className="score-total">{row.total_score.toLocaleString()}</div>
                        <div className="score-breakdown">
                          {row.behavior}b · {row.contribution}c · {row.interpretability}i
                          {row.risk > 0 && <span style={{ color: 'var(--color-mw-red)' }}> -{row.risk}r</span>}
                        </div>
                      </td>
                      <td className="right" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {row.behavior.toLocaleString()}
                      </td>
                      <td className="right">
                        {row.mwp_submissions > 0 ? (
                          <span style={{ color: 'var(--color-mw-live)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                            {row.mwp_submissions} hash{row.mwp_submissions !== 1 ? 'es' : ''}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-mw-ink-3)', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
