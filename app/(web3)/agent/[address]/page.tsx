'use client'

import { useAccount }   from 'wagmi'
import { useParams }    from 'next/navigation'
import { MwNav }        from '@/components/web2/MwNav'
import { MwAuthGuard }  from '@/components/web2/MwAuthGuard'
import { safeUrl }      from '@/lib/web2/safeUrl'
import { useEffect, useState } from 'react'

interface AgentScore {
  address:            string
  erc8004_token_id:   number | null
  total_score:        number
  behavior:           number
  contribution:       number
  interpretability:   number
  risk:               number
  is_transparent:     boolean
  mwp_submissions:    number
  last_mwp_hash:      string | null
  rank:               number
  updated_at:         string
  // ERC-8004 metadata fields
  agent_name:         string | null
  agent_description:  string | null
  x402_support:       boolean
  operational_status: 'active' | 'paused' | 'offline'
  services:           { name: string; endpoint: string; version?: string }[]
  metadata_url:       string | null
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

// Design v2 (Privy-esque) helpers.
const META_PILL = 'inline-flex items-center gap-1 rounded-full border border-hair px-[10px] py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em]'
const STAT_BOX = 'flex-1 min-w-[120px] rounded-xl bg-ground-cool border border-hair px-[14px] py-[10px]'
const STAT_LABEL = 'text-[10px] font-semibold text-ink-soft uppercase tracking-[0.08em] mb-[5px]'

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
    <div className="min-h-screen bg-white font-atx-display text-ink overflow-x-clip">
      <MwNav />
      <div className="max-w-[640px] mx-auto px-6 pt-10 pb-20">
        <a href="/agents/leaderboard" className="inline-flex items-center gap-1.5 text-ink-mid text-[13px] no-underline mb-7 hover:text-ink">← Back to leaderboard</a>

        {loading && <div className="text-center py-[60px] px-6 text-ink-mid">Loading agent…</div>}
        {error   && <div className="text-center py-[60px] px-6 text-[#D14343]">{error}</div>}
        {!loading && !error && !agent && (
          <div className="text-center py-[60px] px-6 text-ink-mid">
            <div>Agent not found or not yet registered.</div>
          </div>
        )}

        {!loading && !error && agent && (
          <>
            <div className="soft-card p-7 mb-5">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="font-mono text-[15px] font-semibold text-ink break-all">{shortAddr(agent.address)}</div>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {agent.is_transparent && (
                      <span className={`${META_PILL} text-coral2-deep`}>
                        <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />
                        Transparent Agent
                      </span>
                    )}
                    {agent.erc8004_token_id && (
                      <span className={`${META_PILL} text-peri-deep`}>ERC-8004 #{agent.erc8004_token_id}</span>
                    )}
                    <span className={`${META_PILL} ${agent.operational_status === 'paused' ? 'text-[#D14343]' : agent.operational_status === 'offline' ? 'text-ink-soft' : 'text-peri-deep'}`}>
                      {agent.operational_status === 'active' || !agent.operational_status
                        ? <span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />
                        : null}
                      {agent.operational_status === 'paused' ? 'Paused' : agent.operational_status === 'offline' ? 'Offline' : 'Active'}
                    </span>
                    {agent.x402_support && (
                      <span className={`${META_PILL} text-peri-deep`}>x402</span>
                    )}
                    {isMe && (
                      <span className={`${META_PILL} text-peri-deep`}>You</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-center py-4">
                <div className="font-atx-display text-[52px] font-medium text-peri-deep leading-none tracking-[-2px] tabular-nums">{agent.total_score.toLocaleString()}</div>
                <div className="text-[12px] text-ink-mid mt-1 tracking-[0.1em] uppercase font-semibold">Attribution Score</div>
                {agent.rank && (
                  <span className="inline-block mt-2 text-[13px] text-ink-mid">Rank #{agent.rank}</span>
                )}
              </div>

              <div className="h-px bg-hair-soft my-5" />

              <div>
                {[
                  { key: 'behavior',         label: 'Volume',          desc: 'Verified swap volume (÷ 1e18)',    sign: 'positive' },
                  { key: 'contribution',      label: 'Contribution',    desc: 'Referral & contribution quality', sign: 'positive' },
                  { key: 'interpretability',  label: 'Interpretability', desc: `MWP transparency — ${agent.mwp_submissions} hash${agent.mwp_submissions !== 1 ? 'es' : ''} submitted`, sign: 'positive' },
                  { key: 'risk',              label: 'Risk Penalty',    desc: 'Deducted from total score',       sign: 'negative' },
                ].map(sig => {
                  const hasVal = !!agent[sig.key as keyof AgentScore]
                  const valColor = hasVal ? (sig.sign === 'negative' ? 'text-[#D14343]' : 'text-peri-deep') : 'text-ink'
                  return (
                    <div key={sig.key} className="flex items-center justify-between py-[10px] border-t border-hair-soft first:border-t-0">
                      <div>
                        <div className="text-[13px] text-ink font-medium">{sig.label}</div>
                        <div className="text-[11px] text-ink-soft mt-[1px]">{sig.desc}</div>
                      </div>
                      <div className={`font-mono text-[14px] font-semibold ${valColor}`}>
                        {sig.sign === 'negative' && agent[sig.key as keyof AgentScore] ? '-' : ''}
                        {Number(agent[sig.key as keyof AgentScore]).toLocaleString()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ERC-8004 metadata card */}
            <div className="soft-card px-7 py-5 mb-5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft tracking-[0.1em] uppercase mb-[14px]">
                ERC-8004 Identity
                {agent.metadata_url && (
                  <a href={agent.metadata_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-peri-deep no-underline font-semibold inline-flex items-center gap-1 px-[10px] py-1 rounded-full bg-ground-cool border border-hair hover:border-[rgba(108,108,240,0.4)]">
                    View metadata ↗
                  </a>
                )}
              </div>
              {agent.agent_description && (
                <div className="text-[13px] text-ink-mid leading-relaxed mb-[14px]">{agent.agent_description}</div>
              )}
              <div className="flex gap-2 flex-wrap">
                <div className={STAT_BOX}>
                  <div className={STAT_LABEL}>Status</div>
                  <div className={`text-[13px] font-semibold ${agent.operational_status === 'active' ? 'text-peri-deep' : agent.operational_status === 'paused' ? 'text-[#D14343]' : 'text-ink-soft'}`}>
                    {agent.operational_status === 'active' ? 'Active' : agent.operational_status === 'paused' ? 'Paused' : 'Offline'}
                  </div>
                </div>
                <div className={STAT_BOX}>
                  <div className={STAT_LABEL}>x402 Payments</div>
                  <div className={`text-[13px] font-semibold ${agent.x402_support ? 'text-peri-deep' : 'text-ink-soft'}`}>
                    {agent.x402_support ? 'Supported' : '— Not set'}
                  </div>
                </div>
                <div className={STAT_BOX}>
                  <div className={STAT_LABEL}>Services</div>
                  <div className="text-[13px] font-semibold text-ink">
                    {agent.services?.length > 0 ? `${agent.services.length} endpoint${agent.services.length !== 1 ? 's' : ''}` : '— None set'}
                  </div>
                </div>
              </div>
              {agent.services?.length > 0 && (
                <div className="flex flex-col gap-2 mt-3">
                  {agent.services.map((svc, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-ground-cool border border-hair px-[14px] py-[9px] gap-2">
                      <div>
                        <div className="text-[12px] font-semibold text-ink">{svc.name}{svc.version ? ` v${svc.version}` : ''}</div>
                        <div className="font-mono text-[11px] text-ink-mid overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">{svc.endpoint}</div>
                      </div>
                      <a href={safeUrl(svc.endpoint)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-peri-deep no-underline font-semibold whitespace-nowrap">↗</a>
                    </div>
                  ))}
                </div>
              )}
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
              const numColor  = sign === 'positive' ? 'text-coral2-deep' : sign === 'negative' ? 'text-[#D14343]' : 'text-ink-soft'
              return (
                <div className="soft-card px-7 py-6 mb-5">
                  <div className="text-[11px] font-semibold text-ink-soft tracking-[0.1em] uppercase mb-4">WETH P&amp;L</div>
                  <div className="flex items-end gap-2 mb-5">
                    <div className={`font-atx-display text-[36px] font-medium leading-none tracking-[-1px] tabular-nums ${numColor}`}>
                      {prefix}{pnlEth.toFixed(4)} ETH
                    </div>
                    <div className="text-[14px] text-ink-mid mb-1.5 font-mono">
                      {pnlUsd >= 0 ? '+' : ''}${Math.abs(pnlUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl bg-ground-cool border border-hair p-3">
                      <div className={STAT_LABEL}>Trades</div>
                      <div className="font-mono text-[13px] font-semibold text-ink">{pnl.total_trades.toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl bg-ground-cool border border-hair p-3">
                      <div className={STAT_LABEL}>ETH In</div>
                      <div className="font-mono text-[13px] font-semibold text-ink">{ethIn.toFixed(4)}</div>
                    </div>
                    <div className="rounded-xl bg-ground-cool border border-hair p-3">
                      <div className={STAT_LABEL}>ETH Out</div>
                      <div className="font-mono text-[13px] font-semibold text-ink">{ethOut.toFixed(4)}</div>
                    </div>
                  </div>
                  <div className="text-[11px] text-ink-soft mt-[14px]">
                    WETH net flow — ETH at ${parseFloat(pnl.eth_price_usd).toLocaleString()} · updated {new Date(pnl.updated_at).toLocaleDateString()}
                  </div>
                </div>
              )
            })()}

            {agent.last_mwp_hash && (
              <div className="soft-card p-4">
                <div className="text-[12px] font-semibold text-ink-soft tracking-[0.1em] uppercase mb-2">Last MWP Hash</div>
                <div className="font-mono text-[11px] text-ink-mid break-all rounded-xl bg-ground-cool border border-hair px-[10px] py-2">{agent.last_mwp_hash}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function AgentProfilePage() {
  return (
    <MwAuthGuard>
      <AgentProfileContent />
    </MwAuthGuard>
  )
}
