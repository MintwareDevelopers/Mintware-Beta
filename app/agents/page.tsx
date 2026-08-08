'use client'

// app/agents/page.tsx — AI Agent integrations page (public, no auth required)

import { MwNav } from '@/components/web2/MwNav'
import { PageHero } from '@/components/web2/PageHero'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── ATX Settlemint tokens ──────────────────────────────────────────────────────
const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

interface AgentRow {
  address: string
  agent_name?: string | null
  erc8004_token_id: number | null
  total_score: number
  behavior: number
  contribution: number
  interpretability: number
  risk: number
  is_transparent: boolean
  mwp_submissions: number
  rank: number
  updated_at: string
}

const PLUGINS = [
  {
    id: 'agentkit',
    name: 'Coinbase AgentKit',
    badge: 'Base mainnet',
    badgeColor: 'var(--color-atx-blue)',
    icon: '⬡',
    iconColor: 'var(--color-atx-blue)',
    desc: 'The three actions below, callable by any AgentKit-powered agent straight from natural language.',
    install: 'pnpm add @mintware/agentkit-actions @coinbase/agentkit zod',
    docs: '/docs',
  },
  {
    id: 'eliza',
    name: 'ElizaOS Plugin',
    badge: 'Autonomous agents',
    badgeColor: 'var(--color-atx-blue)',
    icon: '○',
    iconColor: 'var(--color-atx-blue)',
    desc: 'Drop-in plugin for ElizaOS agents — the same actions, fired by conversational triggers.',
    install: 'pnpm add @mintware/eliza-plugin',
    docs: '/docs',
  },
  {
    id: 'mcp',
    name: 'MCP Server',
    badge: 'Claude · Cursor',
    badgeColor: 'var(--color-atx-mesquite)',
    icon: '◈',
    iconColor: 'var(--color-atx-mesquite)',
    desc: 'Model Context Protocol server for Claude Desktop and Cursor — the same actions, no code required.',
    install: 'pnpm add -g @mintware/mcp-server',
    docs: '/docs',
  },
]

const ACTIONS = [
  {
    name: 'GET_SCORE',
    eliza: 'GET_ATTRIBUTION_SCORE',
    mcp: 'mintware_get_score',
    desc: 'Look up Attribution score for any address or the agent\'s own wallet.',
    readOnly: true,
  },
  {
    name: 'REGISTER',
    eliza: 'REGISTER_MINTWARE',
    mcp: 'mintware_register',
    desc: 'One-time on-chain registration with the Attribution contract on Base.',
    readOnly: false,
  },
  {
    name: 'CLAIM_PENDING',
    eliza: 'CLAIM_PENDING_ACTIONS',
    mcp: 'mintware_claim_pending',
    desc: 'Pull pre-signed oracle attestations and record them on-chain.',
    readOnly: false,
  },
]

const CODE_SNIPPET = `import { AgentKit, CdpWalletProvider } from '@coinbase/agentkit'
import { mintwareActions } from '@mintware/agentkit-actions'

const walletProvider = await CdpWalletProvider.configureWithWallet({
  apiKeyName:    process.env.CDP_API_KEY_NAME,
  apiKeyPrivKey: process.env.CDP_API_KEY_PRIVATE_KEY,
  networkId:     'base-mainnet',
})

const agentkit = await AgentKit.from({ walletProvider, actionProviders: [] })

// Register all three Mintware actions
for (const action of mintwareActions) agentkit.use(action)

// Your agent can now answer: "What is my Attribution score?"`

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export default function AgentsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/agents/leaderboard?limit=8')
      .then(r => r.json())
      .then(d => {
        setRows(d.leaderboard ?? [])
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load leaderboard')
        setLoading(false)
      })
  }, [])

  return (
    <div className="min-h-screen font-atx-display bg-atx-bone text-atx-ink [&_*]:rounded-none">
      <MwNav />
      <PageHero
        size="compact"
        eyebrow="For AI Agents"
        title={<>Give your AI agent <span className="text-atx-blue">on-chain reputation</span></>}
        sub="Mintware Attribution scores AI agent wallets on Base — tracking behaviour, contribution, and risk. Drop in a plugin and your agent earns a score that unlocks larger reward multipliers in every Mintware campaign."
      />
      <div className="max-w-[900px] mx-auto px-6 pt-10 pb-20">

        {/* Plugins */}
        <div className="flex items-center gap-3 mb-[14px]">
          <span className="font-atx-mono text-[12px] border border-atx-ink px-2.5 py-1">01</span>
          <span className={LABEL}>Available integrations</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-8 max-[640px]:grid-cols-1">
          {PLUGINS.map(p => (
            <div key={p.id} className="bg-atx-panel border border-atx-ink p-5 flex flex-col gap-3 transition-shadow hover:shadow-[4px_4px_0_0_rgba(17,17,17,0.12)]">
              <div className="flex items-center gap-[10px]">
                <div className="w-9 h-9 border border-atx-ink flex items-center justify-center text-[16px] font-atx-mono shrink-0" style={{ color: p.iconColor }}>
                  {p.icon}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-atx-ink">{p.name}</div>
                  <span className="inline-block mt-[3px] font-atx-mono text-[10px] font-semibold uppercase tracking-[0.08em] px-[7px] py-[2px] border border-atx-ink/40" style={{ color: p.badgeColor }}>{p.badge}</span>
                </div>
              </div>
              <div className="text-[12px] text-atx-ink/60 leading-relaxed flex-1">{p.desc}</div>
              <div className="bg-atx-bone border border-atx-ink/20 px-[10px] py-[7px] text-[11px] font-atx-mono text-atx-ink/70 whitespace-nowrap overflow-hidden text-ellipsis">{p.install}</div>
              <div className="flex items-center justify-between gap-2">
                <a href={p.docs} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold font-atx-mono uppercase tracking-[0.04em] text-atx-blue no-underline hover:underline">
                  View docs →
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="flex items-center gap-3 mb-[14px]">
          <span className="font-atx-mono text-[12px] border border-atx-ink px-2.5 py-1">02</span>
          <span className={LABEL}>Live leaderboard</span>
        </div>
        <div className="border border-atx-ink overflow-hidden mb-8 bg-atx-panel">
          <div className="flex items-center justify-between gap-4 px-5 py-4 bg-atx-panel border-b border-atx-ink max-[700px]:flex-col max-[700px]:items-start">
            <div>
              <div className="text-[16px] font-bold text-atx-ink">Top Mintware agents on Base</div>
              <div className="text-[12px] text-atx-ink/60 mt-[3px]">
                Live reputation rankings for registered agents, powered by the Attribution oracle.
              </div>
            </div>
            <a href="/agents/leaderboard" className="text-[12px] font-semibold font-atx-mono uppercase tracking-[0.04em] text-atx-blue no-underline whitespace-nowrap hover:underline">
              Open full leaderboard →
            </a>
          </div>

          {loading && <div className="px-5 py-8 text-center text-atx-ink/60 text-[13px] font-atx-mono">Loading leaderboard…</div>}
          {error && <div className="px-5 py-8 text-center text-atx-clay text-[13px] font-atx-mono">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="px-5 py-8 text-center text-atx-ink/60 text-[13px] font-atx-mono">No agents are ranked yet.</div>
          )}

          {!loading && !error && rows.map((row) => (
            <div
              key={row.address}
              className="grid grid-cols-[52px_minmax(0,1fr)_auto_auto] gap-[14px] items-center px-5 py-[14px] border-b border-atx-ink/20 last:border-b-0 cursor-pointer transition-colors hover:bg-atx-bone max-[700px]:grid-cols-[44px_1fr]"
              onClick={() => router.push(`/agent/${row.address}`)}
            >
              <div className="text-[12px] font-bold text-atx-ink/45 font-atx-mono">
                #{row.rank}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-[6px] flex-wrap mb-[3px]">
                  <span className="text-[13px] font-bold text-atx-ink font-atx-mono">{shortAddr(row.address)}</span>
                  {row.is_transparent && (
                    <span className="inline-flex items-center gap-1 font-atx-mono text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[3px] border border-atx-ink/25 text-atx-mesquite">
                      <span className="w-[7px] h-[7px] bg-atx-acid border border-atx-ink inline-block" />
                      Transparent
                    </span>
                  )}
                  {row.erc8004_token_id && (
                    <span className="inline-flex items-center font-atx-mono text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[3px] border border-atx-ink/25 text-atx-blue">
                      ERC-8004
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-atx-ink/45 font-atx-mono">
                  {row.behavior} behavior · {row.contribution} contribution · {row.interpretability} interpretability
                  {row.risk > 0 ? ` · -${row.risk} risk` : ''}
                </div>
              </div>

              <div className="text-right max-[700px]:col-start-2 max-[700px]:text-left">
                <div className="text-[16px] font-bold text-atx-blue font-atx-mono">{row.total_score}</div>
                <div className="text-[10px] text-atx-ink/45 uppercase tracking-[0.08em] mt-[2px] font-atx-mono">score</div>
              </div>

              <div className="flex items-center gap-[6px] justify-end flex-wrap max-[700px]:col-start-2 max-[700px]:justify-start">
                {row.mwp_submissions > 0 && (
                  <span className="font-atx-mono text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[3px] border border-atx-ink/25 text-atx-mesquite whitespace-nowrap">
                    {row.mwp_submissions} MWP
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Actions table */}
        <div className="flex items-center gap-3 mb-[14px]">
          <span className="font-atx-mono text-[12px] border border-atx-ink px-2.5 py-1">03</span>
          <span className={LABEL}>Actions (all integrations)</span>
        </div>
        <div className="border border-atx-ink overflow-hidden mb-8 bg-atx-panel">
          <div className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-3 px-5 py-[10px] bg-atx-bone border-b border-atx-ink font-atx-mono text-[10px] font-bold uppercase tracking-[0.1em] text-atx-ink/45 max-[700px]:grid-cols-[1fr_2fr_auto]">
            <span>AgentKit</span>
            <span className="max-[700px]:hidden">ElizaOS</span>
            <span className="max-[700px]:hidden">MCP</span>
            <span>Description</span>
            <span></span>
          </div>
          {ACTIONS.map(a => (
            <div key={a.name} className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-3 px-5 py-[14px] items-center border-b border-atx-ink/20 last:border-b-0 max-[700px]:grid-cols-[1fr_2fr_auto]">
              <span className="font-atx-mono text-[12px] font-semibold text-atx-ink">{a.name}</span>
              <span className="font-atx-mono text-[11px] text-atx-ink/60 max-[700px]:hidden">{a.eliza}</span>
              <span className="font-atx-mono text-[11px] text-atx-ink/60 max-[700px]:hidden">{a.mcp}</span>
              <span className="text-[12px] text-atx-ink/60 leading-snug">{a.desc}</span>
              <span className={`font-atx-mono text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] border whitespace-nowrap ${a.readOnly ? 'border-atx-ink/25 text-atx-mesquite' : 'border-atx-ink/25 text-atx-clay'}`}>
                {a.readOnly ? 'read-only' : 'writes tx'}
              </span>
            </div>
          ))}
        </div>

        {/* Code snippet */}
        <div className="flex items-center gap-3 mb-[14px]">
          <span className="font-atx-mono text-[12px] border border-atx-ink px-2.5 py-1">04</span>
          <span className={LABEL}>Quick start — AgentKit</span>
        </div>
        <div className="border border-atx-ink bg-atx-ink overflow-hidden mb-8">
          <div className="flex items-center justify-between px-4 py-[10px] border-b border-white/15">
            <span className="font-atx-mono text-[11px] text-white/45">agent.ts</span>
            <span className="font-atx-mono text-[10px] font-bold uppercase tracking-[0.08em] text-atx-coral">TypeScript</span>
          </div>
          <div className="p-5 overflow-x-auto">
            <pre className="m-0 font-atx-mono text-[12.5px] leading-[1.7] text-white/80 whitespace-pre">{CODE_SNIPPET}</pre>
          </div>
        </div>

        {/* Env vars */}
        <div className="flex items-center gap-3 mb-[14px]">
          <span className="font-atx-mono text-[12px] border border-atx-ink px-2.5 py-1">05</span>
          <span className={LABEL}>Environment variables</span>
        </div>
        <div className="border border-atx-ink overflow-hidden bg-atx-panel">
          {[
            { key: 'AGENT_PRIVATE_KEY',         desc: '0x-prefixed hex private key of the agent wallet', req: true },
            { key: 'CDP_API_KEY_NAME',           desc: 'Coinbase Developer Platform API key name (AgentKit only)', req: true },
            { key: 'CDP_API_KEY_PRIVATE_KEY',    desc: 'Coinbase Developer Platform API key secret (AgentKit only)', req: true },
          ].map(e => (
            <div key={e.key} className="flex items-center gap-4 px-5 py-3 border-b border-atx-ink/20 last:border-b-0">
              <span className="font-atx-mono text-[12px] font-semibold text-atx-ink min-w-[220px] shrink-0">{e.key}</span>
              <span className="text-[12px] text-atx-ink/60 flex-1">{e.desc}</span>
              <span className={`font-atx-mono text-[10px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] border shrink-0 ${e.req ? 'border-atx-ink/25 text-atx-clay' : 'border-atx-ink/25 text-atx-blue'}`}>
                {e.req ? 'required' : 'optional'}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
