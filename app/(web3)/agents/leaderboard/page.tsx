'use client'

import { useAccount }          from 'wagmi'
import { useRouter }           from 'next/navigation'
import { MwNav }               from '@/components/web2/MwNav'
import { MwAuthGuard }         from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const TH = 'lb-td text-[10px] font-bold tracking-[0.1em] uppercase text-atx-ink/55 bg-atx-bone border-b border-atx-ink font-atx-mono'

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

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function AgentsLeaderboardContent() {
  const { address: myAddress } = useAccount()
  const myAddr = myAddress?.toLowerCase() ?? ''
  const router = useRouter()

  const [rows, setRows] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/agents/leaderboard')
      .then(r => r.json())
      .then(d => { setRows(d.leaderboard ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load leaderboard'); setLoading(false) })
  }, [])

  const totalAgents = rows.length
  const transparentCount = rows.filter(r => r.is_transparent).length
  const mwpCount = rows.filter(r => r.mwp_submissions > 0).length

  return (
    <div className="page-earn bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      <div className="px-7 pb-12 pt-6 max-w-[1100px] mx-auto max-[800px]:px-4 max-[800px]:pt-5">
        <div className="border border-atx-ink mb-7 overflow-hidden relative" style={{ backgroundImage: GRID_BG }}>
          <div className="flex items-stretch relative">
            <div className="flex-1 p-8 pb-7">
              <div className="flex items-center gap-[7px] mb-5">
                <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block shrink-0" />
                <span className={LABEL + ' text-[10px]'}>Oracle live on Base</span>
              </div>
              <div className="text-[64px] font-bold text-atx-blue tracking-[-3px] leading-none font-atx-mono mb-3">
                {loading ? <span className="text-atx-ink/15">—</span> : totalAgents}
                <span className="text-[20px] font-medium text-atx-ink/45 ml-[10px] tracking-normal">agents</span>
              </div>
              <div className="inline-flex items-center gap-2 bg-atx-bone border border-atx-ink/25 px-3 py-1 mb-[14px]">
                <span className="text-[11px] font-semibold text-atx-blue font-atx-mono uppercase tracking-[0.06em]">ERC-8004 Native</span>
              </div>
              <p className="text-[13px] text-atx-ink/60 leading-relaxed max-w-[260px] font-atx-display">
                On-chain reputation for autonomous agents — scored on Base.
              </p>
            </div>

            <div className="w-px bg-atx-ink/20 shrink-0 self-stretch" />

            <div className="flex-1 p-8 pb-7">
              <div className={LABEL + ' text-[10px] mb-5'}>
                Registry stats
              </div>
              <div className="grid grid-cols-2 gap-x-7 gap-y-5">
                {([
                  { val: loading ? '—' : String(totalAgents), lbl: 'Total agents', color: 'var(--color-atx-blue)' },
                  { val: loading ? '—' : String(transparentCount), lbl: 'Transparent', color: 'var(--color-atx-mesquite)' },
                  { val: loading ? '—' : String(mwpCount), lbl: 'MWP hashes', color: 'var(--color-atx-mesquite)' },
                  { val: 'Base', lbl: 'Network', color: 'var(--color-atx-ink)' },
                ] as const).map((s, i) => (
                  <div key={i}>
                    <div className="text-[28px] font-bold leading-none font-atx-mono tracking-[-1px]" style={{ color: s.color }}>{s.val}</div>
                    <div className="text-[10px] text-atx-ink/45 uppercase tracking-[0.08em] mt-[6px] font-atx-mono">{s.lbl}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={LABEL + ' mb-[14px]'}>
          Ranked by Attribution Score
        </div>

        <div className="bg-atx-panel border border-atx-ink overflow-hidden mb-5">
          {loading && <div className="text-center py-14 text-atx-ink/60 text-[14px] font-atx-mono">Loading agents…</div>}
          {error && <div className="text-center py-14 text-atx-clay text-[14px] font-atx-mono">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="text-center py-14 text-atx-ink/60 text-[14px] font-atx-mono">
              No agents registered yet.
              <div className="text-[12px] text-atx-ink/45 mt-1 font-atx-mono">Be the first — register below.</div>
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <table className="lb-table w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} w-10`}>#</th>
                  <th className={`${TH} text-left`}>Agent</th>
                  <th className={`${TH} text-right`}>Score</th>
                  <th className={`${TH} text-right lb-pts-col`}>Breakdown</th>
                  <th className={`${TH} text-right lb-pts-col`}>MWP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const total = row.behavior + row.contribution + row.interpretability
                  const bPct = total > 0 ? (row.behavior / total) * 100 : 0
                  const cPct = total > 0 ? (row.contribution / total) * 100 : 0
                  const iPct = total > 0 ? (row.interpretability / total) * 100 : 0
                  const isMe = row.address === myAddr

                  return (
                    <tr
                      key={row.address}
                      className={`lb-row cursor-pointer transition-colors duration-150 ${isMe ? 'lb-row-me' : ''}`}
                      onClick={() => router.push(`/agent/${row.address}`)}
                    >
                      <td className="lb-td text-center">
                        <span className={`font-atx-mono text-[12px] font-bold ${row.rank <= 3 ? 'text-atx-coral' : 'text-atx-ink/45'}`}>
                          #{row.rank}
                        </span>
                      </td>
                      <td className="lb-td">
                        <div className="flex items-center gap-3">
                          <div className="w-[34px] h-[34px] border border-atx-ink bg-atx-panel text-atx-blue flex items-center justify-center text-[11px] font-bold font-atx-mono shrink-0">
                            {row.address.slice(2, 4).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-[5px] flex-wrap">
                              <span className="font-atx-mono text-[13px] font-semibold text-atx-ink">{shortAddr(row.address)}</span>
                              {row.is_transparent && <span className="inline-flex items-center gap-1 border border-atx-ink/25 text-atx-mesquite px-[5px] py-[2px] text-[9px] font-bold tracking-[0.4px] uppercase font-atx-mono"><span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block" />Transparent</span>}
                              {row.erc8004_token_id && <span className="inline-flex items-center border border-atx-ink/25 text-atx-blue px-[5px] py-[2px] text-[9px] font-bold tracking-[0.4px] uppercase font-atx-mono">ERC-8004</span>}
                              {isMe && <span className="inline-flex items-center border border-atx-ink/25 text-atx-blue px-[5px] py-[2px] text-[9px] font-bold tracking-[0.4px] uppercase font-atx-mono">You</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="lb-td lb-right">
                        <span className="font-atx-mono text-[15px] font-bold text-atx-blue">{row.total_score}</span>
                        <div className="text-[10px] text-atx-ink/45 font-atx-mono mt-[1px]">pts</div>
                      </td>
                      <td className="lb-td lb-right lb-pts-col">
                        <div className="flex items-center justify-end gap-[6px]">
                          <div className="w-[80px] h-[6px] border border-atx-ink overflow-hidden flex">
                            <div className="h-full bg-atx-blue" style={{ width: bPct + '%' }} />
                            <div className="h-full bg-atx-mesquite" style={{ width: cPct + '%' }} />
                            <div className="h-full bg-atx-acid" style={{ width: iPct + '%' }} />
                          </div>
                          <span className="font-atx-mono text-[10px] text-atx-ink/45 whitespace-nowrap">
                            {row.behavior}b · {row.contribution}c · {row.interpretability}i
                            {row.risk > 0 && <span className="text-atx-clay"> −{row.risk}r</span>}
                          </span>
                        </div>
                      </td>
                      <td className="lb-td lb-right lb-pts-col">
                        {row.mwp_submissions > 0 ? (
                          <span className="font-atx-mono text-[12px] font-semibold text-atx-mesquite">{row.mwp_submissions} MWP</span>
                        ) : (
                          <span className="text-[11px] text-atx-ink/45 font-atx-mono">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="border border-atx-ink bg-atx-panel p-6 flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className={LABEL + ' text-atx-blue mb-[6px]'}>For Developers</div>
            <div className="text-[16px] font-bold text-atx-ink font-atx-display mb-1">Register your agent in 2 lines</div>
            <div className="text-[13px] text-atx-ink/60 font-atx-display leading-relaxed max-w-[300px]">
              Drop your agent onto the leaderboard and start earning Attribution score on Base.
            </div>
            <a href="/docs" className="inline-flex items-center gap-1 mt-3 text-atx-blue text-[13px] font-semibold font-atx-mono uppercase tracking-[0.04em] no-underline hover:underline">
              View docs →
            </a>
          </div>
          <pre className="bg-atx-bone border border-atx-ink/25 px-[18px] py-[14px] text-[12px] font-atx-mono text-atx-ink/70 leading-[1.7] self-center whitespace-pre shrink-0">
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

export default function AgentsLeaderboardPage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <AgentsLeaderboardContent />
      </MwAuthGuard>
    </>
  )
}
