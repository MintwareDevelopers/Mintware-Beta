'use client'

import { useAccount }   from 'wagmi'
import { useParams }    from 'next/navigation'
import { MwNav }        from '@/components/web2/MwNav'
import { MwAuthGuard }  from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'

interface AgentScore {
  address:          string
  erc8004_token_id: number | null
  total_score:      number
  behavior:         number
  contribution:     number
  interpretability: number
  risk:             number
  is_transparent:   boolean
  mwp_submissions:  number
  last_mwp_hash:    string | null
  rank:             number
  updated_at:       string
  pnl: {
    realized_pnl_eth: string
    realized_pnl_usd: string
    total_eth_in:     string
    total_eth_out:    string
    total_trades:     number
    eth_price_usd:    string
    updated_at:       string
  } | null
}

function AgentProfileContent() {
  const { address: myAddress } = useAccount()
  const params  = useParams()
  const address = (params?.address as string)?.toLowerCase() ?? ''

  const [agent,   setAgent]   = useState<AgentScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (!address) return
    fetch(`/api/agents/${address}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setAgent(d); setLoading(false) })
      .catch(() => { setError('Failed to load agent'); setLoading(false) })
  }, [address])

  function shortAddr(addr: string) {
    return addr.slice(0, 8) + '…' + addr.slice(-6)
  }

  const isMe = myAddress?.toLowerCase() === address

  return (
    <>
      <style>{`
        .agent-page {
          min-height: 100vh;
          background: var(--color-mw-surface);
          font-family: var(--font-jakarta), sans-serif;
        }
        .agent-inner {
          max-width: 640px;
          margin: 0 auto;
          padding: 40px 24px 80px;
        }
        .back-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--color-mw-ink-3);
          font-size: 13px;
          text-decoration: none;
          margin-bottom: 28px;
          transition: color 0.15s;
        }
        .back-link:hover { color: var(--color-mw-ink); }
        .agent-card {
          background: white;
          border-radius: var(--radius-lg);
          border: 1px solid var(--color-mw-border);
          box-shadow: var(--shadow-md);
          padding: 28px;
          margin-bottom: 20px;
        }
        .agent-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 24px;
        }
        .agent-addr-large {
          font-family: var(--font-mono), monospace;
          font-size: 15px;
          font-weight: 700;
          color: var(--color-mw-ink);
          word-break: break-all;
        }
        .agent-meta {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .meta-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 11px;
          font-weight: 600;
        }
        .pill-transparent {
          background: rgba(34,197,94,0.1);
          color: var(--color-mw-live);
        }
        .pill-erc8004 {
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
        }
        .pill-me {
          background: rgba(79,126,247,0.12);
          color: var(--color-mw-brand);
        }
        .score-hero {
          text-align: center;
          padding: 16px 0;
        }
        .score-number {
          font-family: var(--font-mono), monospace;
          font-size: 52px;
          font-weight: 800;
          color: var(--color-mw-brand);
          line-height: 1;
          letter-spacing: -2px;
        }
        .score-label {
          font-size: 12px;
          color: var(--color-mw-ink-3);
          margin-top: 4px;
          letter-spacing: 1px;
          text-transform: uppercase;
          font-weight: 600;
        }
        .score-rank {
          display: inline-block;
          margin-top: 8px;
          font-size: 13px;
          color: var(--color-mw-ink-3);
        }
        .divider {
          height: 1px;
          background: var(--color-mw-border);
          margin: 20px 0;
        }
        .signal-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 0;
        }
        .signal-row + .signal-row {
          border-top: 1px solid var(--color-mw-border);
        }
        .signal-name {
          font-size: 13px;
          color: var(--color-mw-ink-2);
          font-weight: 500;
        }
        .signal-desc {
          font-size: 11px;
          color: var(--color-mw-ink-3);
          margin-top: 1px;
        }
        .signal-value {
          font-family: var(--font-mono), monospace;
          font-size: 14px;
          font-weight: 700;
          color: var(--color-mw-ink);
        }
        .signal-value.positive { color: var(--color-mw-brand); }
        .signal-value.negative { color: var(--color-mw-red); }
        .mwp-card {
          background: var(--color-mw-surface-card);
          border-radius: var(--radius-md);
          border: 1px solid var(--color-mw-border);
          padding: 16px;
        }
        .mwp-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-mw-ink-3);
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .mwp-hash {
          font-family: var(--font-mono), monospace;
          font-size: 11px;
          color: var(--color-mw-ink-2);
          word-break: break-all;
          background: white;
          border: 1px solid var(--color-mw-border);
          border-radius: 6px;
          padding: 8px 10px;
        }
        .pnl-card {
          background: white;
          border-radius: var(--radius-lg);
          border: 1px solid var(--color-mw-border);
          box-shadow: var(--shadow-md);
          padding: 24px 28px;
          margin-bottom: 20px;
        }
        .pnl-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--color-mw-ink-3);
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 16px;
        }
        .pnl-hero {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          margin-bottom: 20px;
        }
        .pnl-number {
          font-family: var(--font-mono), monospace;
          font-size: 36px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -1px;
        }
        .pnl-number.positive { color: var(--color-mw-green); }
        .pnl-number.negative { color: var(--color-mw-red); }
        .pnl-number.zero     { color: var(--color-mw-ink-3); }
        .pnl-usd {
          font-size: 14px;
          color: var(--color-mw-ink-3);
          margin-bottom: 6px;
          font-family: var(--font-mono), monospace;
        }
        .pnl-stats {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
        }
        .pnl-stat {
          background: var(--color-mw-surface-card);
          border-radius: var(--radius-md);
          border: 1px solid var(--color-mw-border);
          padding: 12px;
        }
        .pnl-stat-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--color-mw-ink-4);
          letter-spacing: 0.8px;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .pnl-stat-value {
          font-family: var(--font-mono), monospace;
          font-size: 13px;
          font-weight: 700;
          color: var(--color-mw-ink);
        }
        .pnl-note {
          font-size: 11px;
          color: var(--color-mw-ink-4);
          margin-top: 14px;
        }
        .loading-state, .error-state, .not-found {
          text-align: center;
          padding: 60px 24px;
          color: var(--color-mw-ink-3);
        }
        .error-state { color: var(--color-mw-red); }
      `}</style>

      <div className="agent-page">
        <MwNav />
        <div className="agent-inner">
          <a href="/agents" className="back-link">← Back to leaderboard</a>

          {loading && <div className="loading-state">Loading agent…</div>}
          {error   && <div className="error-state">{error}</div>}
          {!loading && !error && !agent && (
            <div className="not-found">
              <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
              <div>Agent not found or not yet registered.</div>
            </div>
          )}

          {!loading && !error && agent && (
            <>
              <div className="agent-card">
                <div className="agent-card-header">
                  <div>
                    <div className="agent-addr-large">{shortAddr(agent.address)}</div>
                    <div className="agent-meta">
                      {agent.is_transparent && (
                        <span className="meta-pill pill-transparent">✦ Transparent Agent</span>
                      )}
                      {agent.erc8004_token_id && (
                        <span className="meta-pill pill-erc8004">ERC-8004 #{agent.erc8004_token_id}</span>
                      )}
                      {isMe && (
                        <span className="meta-pill pill-me">You</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="score-hero">
                  <div className="score-number">{agent.total_score.toLocaleString()}</div>
                  <div className="score-label">Attribution Score</div>
                  {agent.rank && (
                    <span className="score-rank">Rank #{agent.rank}</span>
                  )}
                </div>

                <div className="divider" />

                <div>
                  {[
                    { key: 'behavior',         label: 'Volume',          desc: 'Verified swap volume (÷ 1e18)',    sign: 'positive' },
                    { key: 'contribution',      label: 'Contribution',    desc: 'Referral & campaign quality',     sign: 'positive' },
                    { key: 'interpretability',  label: 'Interpretability', desc: `MWP transparency — ${agent.mwp_submissions} hash${agent.mwp_submissions !== 1 ? 'es' : ''} submitted`, sign: 'positive' },
                    { key: 'risk',              label: 'Risk Penalty',    desc: 'Deducted from total score',       sign: 'negative' },
                  ].map(sig => (
                    <div key={sig.key} className="signal-row">
                      <div>
                        <div className="signal-name">{sig.label}</div>
                        <div className="signal-desc">{sig.desc}</div>
                      </div>
                      <div className={`signal-value ${agent[sig.key as keyof AgentScore] ? sig.sign : ''}`}>
                        {sig.sign === 'negative' && agent[sig.key as keyof AgentScore] ? '-' : ''}
                        {Number(agent[sig.key as keyof AgentScore]).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* PnL card */}
              {(() => {
                const pnl = agent.pnl
                if (!pnl) return null
                const pnlEth    = parseFloat(pnl.realized_pnl_eth) / 1e18
                const pnlUsd    = parseFloat(pnl.realized_pnl_usd)
                const ethIn     = parseFloat(pnl.total_eth_in)  / 1e18
                const ethOut    = parseFloat(pnl.total_eth_out) / 1e18
                const sign      = pnlEth > 0 ? 'positive' : pnlEth < 0 ? 'negative' : 'zero'
                const prefix    = pnlEth > 0 ? '+' : ''
                return (
                  <div className="pnl-card">
                    <div className="pnl-title">WETH P&amp;L</div>
                    <div className="pnl-hero">
                      <div className={`pnl-number ${sign}`}>
                        {prefix}{pnlEth.toFixed(4)} ETH
                      </div>
                      <div className="pnl-usd">
                        {pnlUsd >= 0 ? '+' : ''}${Math.abs(pnlUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="pnl-stats">
                      <div className="pnl-stat">
                        <div className="pnl-stat-label">Trades</div>
                        <div className="pnl-stat-value">{pnl.total_trades.toLocaleString()}</div>
                      </div>
                      <div className="pnl-stat">
                        <div className="pnl-stat-label">ETH In</div>
                        <div className="pnl-stat-value">{ethIn.toFixed(4)}</div>
                      </div>
                      <div className="pnl-stat">
                        <div className="pnl-stat-label">ETH Out</div>
                        <div className="pnl-stat-value">{ethOut.toFixed(4)}</div>
                      </div>
                    </div>
                    <div className="pnl-note">
                      WETH net flow — ETH at ${parseFloat(pnl.eth_price_usd).toLocaleString()} · updated {new Date(pnl.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                )
              })()}

              {agent.last_mwp_hash && (
                <div className="mwp-card">
                  <div className="mwp-title">Last MWP Hash</div>
                  <div className="mwp-hash">{agent.last_mwp_hash}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default function AgentProfilePage() {
  return (
    <MwAuthGuard>
      <AgentProfileContent />
    </MwAuthGuard>
  )
}
