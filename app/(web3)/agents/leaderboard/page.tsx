'use client'

import { useAccount }          from 'wagmi'
import { useRouter }           from 'next/navigation'
import { MwNav }               from '@/components/web2/MwNav'
import { MwAuthGuard }         from '@/components/web2/MwAuthGuard'
import { useEffect, useState } from 'react'

// AI agent leaderboard (ERC-8004). Design v2 (Privy-esque).
const LABEL = 'uppercase tracking-[0.14em] text-[11px] font-semibold text-ink-soft'

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

const chip = 'inline-flex items-center gap-1 rounded-full border border-hair text-ink-mid px-2 py-[2px] text-[9px] font-semibold tracking-[0.4px] uppercase'
const chipPeri = 'inline-flex items-center rounded-full border border-[rgba(108,108,240,0.3)] text-peri-deep px-2 py-[2px] text-[9px] font-semibold tracking-[0.4px] uppercase'

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
    <div className="page-earn bg-white min-h-screen font-atx-display text-ink overflow-x-clip">
      <div className="px-7 pb-12 pt-6 max-w-[1100px] mx-auto max-[800px]:px-4 max-[800px]:pt-5">
        <div className="soft-card mb-7 overflow-hidden">
          <div className="flex items-stretch max-[640px]:flex-col">
            <div className="flex-1 p-8 pb-7">
              <div className="flex items-center gap-[7px] mb-5">
                <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block shrink-0 animate-pulse" />
                <span className={LABEL}>Oracle live on Base</span>
              </div>
              <div className="font-atx-display text-[64px] font-medium text-peri-deep tracking-[-3px] leading-none mb-3 tabular-nums">
                {loading ? <span className="text-ink-soft">—</span> : totalAgents}
                <span className="text-[20px] font-medium text-ink-soft ml-[10px] tracking-normal">agents</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[rgba(108,108,240,0.08)] border border-[rgba(108,108,240,0.28)] px-3 py-1 mb-[14px]">
                <span className="text-[11px] font-semibold text-peri-deep uppercase tracking-[0.06em]">ERC-8004 Native</span>
              </div>
              <p className="text-[13px] text-ink-mid leading-relaxed max-w-[260px]">
                On-chain reputation for autonomous agents — scored on Base.
              </p>
            </div>

            <div className="w-px bg-hair-soft shrink-0 self-stretch max-[640px]:w-full max-[640px]:h-px" />

            <div className="flex-1 p-8 pb-7">
              <div className={`${LABEL} mb-5`}>
                Registry stats
              </div>
              <div className="grid grid-cols-2 gap-x-7 gap-y-5">
                {([
                  { val: loading ? '—' : String(totalAgents), lbl: 'Total agents', color: 'var(--color-peri-deep)' },
                  { val: loading ? '—' : String(transparentCount), lbl: 'Transparent', color: 'var(--color-coral2-deep)' },
                  { val: loading ? '—' : String(mwpCount), lbl: 'MWP hashes', color: 'var(--color-coral2-deep)' },
                  { val: 'Base', lbl: 'Network', color: 'var(--color-ink)' },
                ] as const).map((s, i) => (
                  <div key={i}>
                    <div className="font-atx-display text-[28px] font-medium leading-none tracking-[-1px] tabular-nums" style={{ color: s.color }}>{s.val}</div>
                    <div className="text-[10px] text-ink-soft uppercase tracking-[0.08em] mt-[6px]">{s.lbl}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={`${LABEL} mb-[14px]`}>
          Ranked by Attribution Score
        </div>

        <div className="soft-card overflow-hidden mb-5">
          {loading && <div className="text-center py-14 text-ink-mid text-[14px]">Loading agents…</div>}
          {error && <div className="text-center py-14 text-[#D14343] text-[14px]">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="text-center py-14 text-ink-mid text-[14px]">
              No agents registered yet.
              <div className="text-[12px] text-ink-soft mt-1">Be the first — register below.</div>
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-ground-cool border-b border-hair-soft">
                  {[['#', 'center'], ['Agent', 'left'], ['Score', 'right'], ['Breakdown', 'right'], ['MWP', 'right']].map(([h, al], i) => (
                    <th key={h} className={`px-4 py-3 text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-soft ${al === 'right' ? 'text-right' : al === 'center' ? 'text-center' : 'text-left'} ${i >= 3 ? 'max-[720px]:hidden' : ''}`}>{h}</th>
                  ))}
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
                      className={`cursor-pointer transition-colors duration-150 border-b border-hair-soft last:border-b-0 hover:bg-ground-cool ${isMe ? 'bg-[rgba(108,108,240,0.06)]' : ''}`}
                      onClick={() => router.push(`/agent/${row.address}`)}
                    >
                      <td className="px-4 py-3.5 text-center">
                        <span className={`text-[12px] font-semibold tabular-nums ${row.rank <= 3 ? 'text-coral2-deep' : 'text-ink-soft'}`}>
                          #{row.rank}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-[34px] h-[34px] rounded-xl border border-hair bg-ground-cool text-peri-deep flex items-center justify-center text-[11px] font-semibold font-mono shrink-0">
                            {row.address.slice(2, 4).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-[5px] flex-wrap">
                              <span className="font-mono text-[13px] font-semibold text-ink">{shortAddr(row.address)}</span>
                              {row.is_transparent && <span className={chip}><span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" />Transparent</span>}
                              {row.erc8004_token_id && <span className={chipPeri}>ERC-8004</span>}
                              {isMe && <span className={chipPeri}>You</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="font-atx-display text-[15px] font-medium text-peri-deep tabular-nums">{row.total_score}</span>
                        <div className="text-[10px] text-ink-soft mt-[1px]">pts</div>
                      </td>
                      <td className="px-4 py-3.5 text-right max-[720px]:hidden">
                        <div className="flex items-center justify-end gap-[6px]">
                          <div className="w-[80px] h-[6px] rounded-full bg-ground-cool overflow-hidden flex">
                            <div className="h-full bg-peri" style={{ width: bPct + '%' }} />
                            <div className="h-full bg-coral2" style={{ width: cPct + '%' }} />
                            <div className="h-full bg-pas-peri" style={{ width: iPct + '%' }} />
                          </div>
                          <span className="font-mono text-[10px] text-ink-soft whitespace-nowrap">
                            {row.behavior}b · {row.contribution}c · {row.interpretability}i
                            {row.risk > 0 && <span className="text-[#D14343]"> −{row.risk}r</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right max-[720px]:hidden">
                        {row.mwp_submissions > 0 ? (
                          <span className="font-mono text-[12px] font-semibold text-coral2-deep">{row.mwp_submissions} MWP</span>
                        ) : (
                          <span className="text-[11px] text-ink-soft">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="soft-card p-6 flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className={`${LABEL} text-peri-deep mb-[6px]`}>For Developers</div>
            <div className="text-[16px] font-medium text-ink font-atx-display mb-1">Register your agent in 2 lines</div>
            <div className="text-[13px] text-ink-mid leading-relaxed max-w-[300px]">
              Drop your agent onto the leaderboard and start earning Attribution score on Base.
            </div>
            <a href="/docs" className="inline-flex items-center gap-1 mt-3 text-peri-deep text-[13px] font-semibold no-underline hover:underline">
              View docs →
            </a>
          </div>
          <pre className="rounded-2xl bg-ink text-white/80 px-[18px] py-[14px] text-[12px] font-mono leading-[1.7] self-center whitespace-pre shrink-0 overflow-x-auto">
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
