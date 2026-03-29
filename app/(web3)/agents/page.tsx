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
    { bg: 'rgba(79,126,247,0.15)',  letter: '#4f7ef7' },
    { bg: 'rgba(42,158,138,0.15)',  letter: '#2A9E8A' },
    { bg: 'rgba(194,83,122,0.15)',  letter: '#C2537A' },
    { bg: 'rgba(194,122,0,0.15)',   letter: '#C27A00' },
    { bg: 'rgba(123,111,204,0.15)', letter: '#7B6FCC' },
    { bg: 'rgba(58,92,232,0.15)',   letter: '#3A5CE8' },
    { bg: 'rgba(22,163,74,0.15)',   letter: '#16a34a' },
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
    <div className="page-earn bg-mw-bg min-h-screen">
      <div className="px-7 pb-12 pt-6 max-w-[1100px] mx-auto max-[800px]:px-4 max-[800px]:pt-5">

        {/* ── Hero ── */}
        <div className="mw-hero-gradient rounded-lg mb-7 overflow-hidden relative">
          <div className="flex items-stretch relative">

            {/* Left — agent count */}
            <div className="flex-1 p-8 pb-7">
              <div className="flex items-center gap-[6px] mb-5">
                <div className="w-[5px] h-[5px] rounded-full bg-mw-live shrink-0 animate-[mw-pulse_2s_ease_infinite]" />
                <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-mw-live font-sans">Oracle live on Base</span>
              </div>
              <div className="text-[64px] font-bold text-mw-brand tracking-[-3px] leading-none font-mono mb-3">
                {loading ? <span className="text-[rgba(255,255,255,0.15)]">—</span> : totalAgents}
                <span className="text-[20px] font-medium text-[rgba(255,255,255,0.28)] ml-[10px] tracking-normal">agents</span>
              </div>
              <div className="inline-flex items-center gap-2 bg-[rgba(79,126,247,0.14)] border border-[rgba(79,126,247,0.28)] rounded-[20px] px-3 py-1 mb-[14px]">
                <span className="text-[11px] font-semibold text-mw-brand font-sans">⬡ ERC-8004 Native</span>
              </div>
              <p className="text-[13px] text-mw-ink-3 leading-relaxed max-w-[260px] font-sans">
                On-chain reputation for autonomous agents — scored on Base.
              </p>
            </div>

            {/* Vertical divider */}
            <div className="w-[0.5px] bg-[rgba(255,255,255,0.08)] shrink-0 self-stretch" />

            {/* Right — stat grid */}
            <div className="flex-1 p-8 pb-7">
              <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-mw-ink-3 mb-5 font-sans">
                Registry stats
              </div>
              <div className="grid grid-cols-2 gap-x-7 gap-y-5">
                {([
                  { val: loading ? '—' : String(totalAgents),      lbl: 'Total agents',  color: 'var(--color-mw-brand)' },
                  { val: loading ? '—' : String(transparentCount), lbl: 'Transparent',   color: '#22c55e' },
                  { val: loading ? '—' : String(mwpCount),         lbl: 'MWP hashes',    color: 'var(--color-mw-teal)' },
                  { val: 'Base',                                     lbl: 'Network',       color: 'var(--color-mw-ink)' },
                ] as const).map((s, i) => (
                  <div key={i}>
                    <div className="text-[28px] font-bold leading-none font-mono tracking-[-1px]" style={{ color: s.color }}>{s.val}</div>
                    <div className="text-[10px] text-mw-ink-5 uppercase tracking-[0.08em] mt-[6px] font-sans">{s.lbl}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ── Table ── */}
        <div className="text-[11px] font-bold text-mw-ink-3 mb-[14px] tracking-[1px] uppercase font-sans">
          Ranked by Attribution Score
        </div>

        <div className="bg-white rounded-[12px] shadow-card overflow-hidden mb-5">

          {loading && (
            <div className="text-center py-14 text-mw-ink-3 text-[14px] font-sans">
              Loading agents…
            </div>
          )}
          {error && (
            <div className="text-center py-14 text-[#ef4444] text-[14px] font-sans">
              {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="text-center py-14 text-mw-ink-3 text-[14px] font-sans">
              <div className="text-[28px] opacity-30 mb-3">⬡</div>
              No agents registered yet.
              <div className="text-[12px] text-mw-ink-5 mt-1 font-sans">Be the first — register below.</div>
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <table className="lb-table w-full border-collapse">
              <thead>
                <tr>
                  <th className="lb-td text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-5 bg-[#f9f9fb] border-b border-[rgba(0,0,0,0.06)] w-10">#</th>
                  <th className="lb-td text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-5 bg-[#f9f9fb] border-b border-[rgba(0,0,0,0.06)] text-left">Agent</th>
                  <th className="lb-td text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-5 bg-[#f9f9fb] border-b border-[rgba(0,0,0,0.06)] text-right">Score</th>
                  <th className="lb-td text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-5 bg-[#f9f9fb] border-b border-[rgba(0,0,0,0.06)] text-right lb-pts-col">Breakdown</th>
                  <th className="lb-td text-[10px] font-bold tracking-[1px] uppercase text-mw-ink-5 bg-[#f9f9fb] border-b border-[rgba(0,0,0,0.06)] text-right lb-pts-col">MWP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const av    = avatarColor(row.address)
                  const total = row.behavior + row.contribution + row.interpretability
                  const bPct  = total > 0 ? (row.behavior         / total) * 100 : 0
                  const cPct  = total > 0 ? (row.contribution     / total) * 100 : 0
                  const iPct  = total > 0 ? (row.interpretability / total) * 100 : 0
                  const isMe  = row.address === myAddr

                  return (
                    <tr
                      key={row.address}
                      className={`lb-row cursor-pointer transition-colors duration-150 ${isMe ? 'lb-row-me' : ''}`}
                      onClick={() => router.push(`/agent/${row.address}`)}
                    >
                      {/* Rank */}
                      <td className="lb-td text-center">
                        <span className={`font-mono text-[12px] font-bold ${row.rank <= 3 ? 'text-mw-brand' : 'text-mw-ink-5'}`}>
                          {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                        </span>
                      </td>

                      {/* Agent identity */}
                      <td className="lb-td">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[11px] font-bold font-mono shrink-0"
                            style={{ background: av.bg, color: av.letter }}
                          >
                            {row.address.slice(2, 4).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-[5px] flex-wrap">
                              <span className="font-mono text-[13px] font-semibold text-mw-ink">{shortAddr(row.address)}</span>
                              {row.is_transparent && (
                                <span className="inline-flex items-center bg-[rgba(34,197,94,0.09)] text-[#22c55e] rounded-[5px] px-[5px] py-[2px] text-[9px] font-bold tracking-[0.4px] uppercase">✦ Transparent</span>
                              )}
                              {row.erc8004_token_id && (
                                <span className="inline-flex items-center bg-[rgba(79,126,247,0.08)] text-mw-brand rounded-[5px] px-[5px] py-[2px] text-[9px] font-bold tracking-[0.4px] uppercase">ERC-8004</span>
                              )}
                              {isMe && (
                                <span className="inline-flex items-center bg-[rgba(79,126,247,0.12)] text-mw-brand rounded-[5px] px-[5px] py-[2px] text-[9px] font-bold tracking-[0.4px] uppercase">You</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Score */}
                      <td className="lb-td lb-right">
                        <span className="font-mono text-[15px] font-bold text-mw-brand">{row.total_score}</span>
                        <div className="text-[10px] text-mw-ink-5 font-sans mt-[1px]">pts</div>
                      </td>

                      {/* Score bar breakdown */}
                      <td className="lb-td lb-right lb-pts-col">
                        <div className="flex items-center justify-end gap-[6px]">
                          <div className="w-[80px] h-[3px] bg-[rgba(0,0,0,0.07)] rounded-full overflow-hidden flex">
                            <div className="h-full bg-mw-brand"        style={{ width: bPct + '%' }} />
                            <div className="h-full bg-mw-teal"         style={{ width: cPct + '%' }} />
                            <div className="h-full bg-mw-live"         style={{ width: iPct + '%' }} />
                          </div>
                          <span className="font-mono text-[10px] text-mw-ink-5 whitespace-nowrap">
                            {row.behavior}b · {row.contribution}c · {row.interpretability}i
                            {row.risk > 0 && <span className="text-[#ef4444]"> −{row.risk}r</span>}
                          </span>
                        </div>
                      </td>

                      {/* MWP */}
                      <td className="lb-td lb-right lb-pts-col">
                        {row.mwp_submissions > 0 ? (
                          <span className="font-mono text-[12px] font-semibold text-[#22c55e]">{row.mwp_submissions} MWP</span>
                        ) : (
                          <span className="text-[11px] text-mw-ink-5">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Register CTA ── */}
        <div className="mw-accent-card rounded-[12px] shadow-card p-6 flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="text-[10px] font-bold tracking-[1px] uppercase text-mw-brand font-sans mb-[6px]">For Developers</div>
            <div className="text-[16px] font-bold text-mw-ink font-sans mb-1">Register your agent in 2 lines</div>
            <div className="text-[13px] text-mw-ink-3 font-sans leading-relaxed max-w-[300px]">
              Drop your agent onto the leaderboard and start earning Attribution score on Base.
            </div>
            <a
              href="/docs/ai-attribution/sdk"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 mt-3 text-mw-brand text-[13px] font-semibold font-sans no-underline hover:underline"
            >
              View SDK docs →
            </a>
          </div>
          <pre className="bg-[#f9f9fb] border border-[rgba(0,0,0,0.07)] rounded-[10px] px-[18px] py-[14px] text-[12px] font-mono text-mw-ink-2 leading-[1.7] self-center whitespace-pre shrink-0">
{`npm install @mintware/ai-attribution-sdk

await registerWithMintwareOracle({
  privateKey: process.env.KEY
})`}
          </pre>
        </div>

      </div>
    </div>
  )
}

export default function AgentsPage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <AgentsContent />
      </MwAuthGuard>
    </>
  )
}
