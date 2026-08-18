'use client'

// app/agents/page.tsx — AI Agent integrations page (public, no auth). Design v2.

import { V2Nav } from '@/components/ui2/V2Nav'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const LABEL = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'
const NUM = 'text-[12px] font-semibold text-peri-deep tabular-nums'

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
    desc: 'The three actions below, callable by any AgentKit-powered agent straight from natural language.',
    install: 'pnpm add @mintware/agentkit-actions @coinbase/agentkit zod',
    docs: '/docs',
  },
  {
    id: 'eliza',
    name: 'ElizaOS Plugin',
    badge: 'Autonomous agents',
    desc: 'Drop-in plugin for ElizaOS agents — the same actions, fired by conversational triggers.',
    install: 'pnpm add @mintware/eliza-plugin',
    docs: '/docs',
  },
  {
    id: 'mcp',
    name: 'MCP Server',
    badge: 'Claude · Cursor',
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

// ── Roadmap: the JIT 402 payment engine (NOT BUILT — the direction we're building
// toward). Composes pieces that already exist in testing: the ULV engine, a live
// V4 JIT hook, and the edge-auth settlement engine. Framed unmistakably as vision.
const PAY_FLOW = [
  { n: '01', t: 'Challenge', d: 'The agent hits a paid endpoint — an API, a compute node, a merchant POS — and gets back HTTP 402 Payment Required: the price, and the rails it accepts.' },
  { n: '02', t: 'Pick a rail', d: 'The agent reads the 402 payload and chooses — a native machine rail (x402, on-chain) or a legacy card rail (Visa / Mastercard).' },
  { n: '03', t: 'Settle', d: 'Native: sign an EIP-712 session permit, stream USDC on-chain, retry with a proof header. Legacy: mint a just-in-time card.' },
  { n: '04', t: 'Resume & burn', d: 'The resource unlocks and the task resumes — while the single-use card or token auto-burns. Nothing reusable is left behind.' },
]

const RAILS = [
  { tag: 'Native machine rail', ex: 'x402 · on-chain', tone: 'var(--color-peri)', steps: ['Sign a sub-second EIP-712 session permit', 'Stream USDC directly on-chain', 'Attach the tx proof header and retry the request'] },
  { tag: 'Legacy card rail', ex: 'Visa / Mastercard · Rain · Bridge', tone: 'var(--color-coral2)', steps: ['Debit the exact price in USDC from the yield vault', 'Mint a single-use PAN, hard-capped to the price, 10-min expiry', 'Autofill the merchant — the card burns on settlement'] },
]

const WHY = [
  { t: 'Zero idle float', d: '100% of the agent’s capital stays in yield-bearing vaults. Money only moves to a rail at the millisecond a 402 asks for it.' },
  { t: 'No standing attack surface', d: 'Compromise the agent and you find no valid card. Every PAN auto-destructs after one charge and can’t be re-billed.' },
  { t: 'Guardrails on the vault', d: 'Set policy once — “$50/day on infra, $5 per tx.” The JIT hook enforces the bounds before it ever issues a token.' },
  { t: 'One stack, every merchant', d: 'The same agent navigates on-chain x402 micro-payments and real-world Visa / Mastercard POS — one financial stack.' },
]

const ULV_ROLES = [
  { role: 'Liquidity Supplier', action: 'Auto-deposits idle treasury USDC into single-sided ULV pools — one clean call, depositUSDC(amount), no two-asset rebalancing.', prim: 'ERC-7579 session keys' },
  { role: 'Yield Arbitrageur', action: 'Shifts capital across Uniswap v4 fee tiers by pool volume, around the clock, with no human signature prompts.', prim: 'v4 dynamic hooks · EIP-712 permits' },
  { role: 'JIT Liquidation Node', action: 'Withdraws the exact USDC needed to fund a JIT card the instant a 402 challenge lands.', prim: 'HTTP 402 interceptor · flash settlement' },
]

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

const warnPill = 'text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-[3px] rounded-full border border-[rgba(209,67,67,0.3)] text-[#D14343]'
const okPill = 'text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-[3px] rounded-full border border-hair text-ink-mid'

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
    <div className="min-h-screen font-atx-display bg-white text-ink overflow-x-clip">
      <V2Nav active="agents" />

      {/* HERO — leads with the treasury/liquidity/payments vision; reputation is a secondary mention */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">For AI Agents</div>
          <h1 className="font-atx-display font-semibold text-ink mt-6 tracking-[-0.04em] leading-[1.03] text-[clamp(2rem,5vw,3.6rem)] max-w-[18ch] [text-wrap:balance]">
            Give your AI agent a treasury that <span className="text-gradient-accent">earns and pays.</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">
            Idle capital becomes a real liquidity position in a Mintware vault — earning around the clock — and spends straight from that position the instant an endpoint asks, without ever withdrawing. Drop in a plugin and your agent also earns a portable on-chain reputation, carried across Mintware.
          </p>
          <a href="#reputation" className="text-[14px] font-medium text-ink-mid hover:text-ink no-underline inline-flex items-center min-h-[44px] mt-2">See what's live today ↓</a>
        </div>
      </section>

      {/* ── AGENT TREASURY · the JIT 402 payment engine (blueprint, not built) — the lead story ── */}
      <section className="border-t border-hair-soft bg-ground-cool">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[76px] max-[800px]:py-[52px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-peri" />Blueprint · not yet built</span>
          <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mt-4">Agent treasury · liquidity &amp; payments</div>
          <h2 className="font-atx-display font-semibold text-ink mt-4 tracking-[-0.04em] leading-[1.05] text-[clamp(1.7rem,4vw,2.8rem)] max-w-[20ch] [text-wrap:balance]">
            Agents that pay for themselves — and <span className="text-gradient-accent">never sit idle.</span>
          </h2>
          <p className="text-ink-mid text-[clamp(1rem,1.5vw,1.15rem)] leading-[1.55] mt-5 max-w-[64ch]">
            The direction we're building toward: an agent whose idle capital becomes real liquidity in a Mintware vault — earning fees and MEV like any LP — and pays any endpoint the instant it asks, crypto-native or legacy, over one standard: HTTP 402. Portable on-chain reputation comes with it, as a second, optional layer.
          </p>

          {/* The 402 flow */}
          <div className="flex items-center gap-3 mt-12 mb-4">
            <span className={NUM}>→</span>
            <span className={LABEL}>The JIT 402 payment engine</span>
          </div>
          <div className="grid grid-cols-4 max-[860px]:grid-cols-2 max-[520px]:grid-cols-1 gap-3">
            {PAY_FLOW.map((s) => (
              <div key={s.n} className="soft-card p-4">
                <div className="font-atx-display font-medium text-[15px] text-peri-deep tabular-nums">{s.n}</div>
                <div className="font-atx-display font-semibold text-[14px] text-ink mt-1">{s.t}</div>
                <p className="text-[12px] text-ink-mid leading-[1.5] mt-1.5">{s.d}</p>
              </div>
            ))}
          </div>

          {/* Rail fork */}
          <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3 mt-3">
            {RAILS.map((r) => (
              <div key={r.tag} className="soft-card p-5">
                <div className="flex items-center gap-2.5">
                  <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: r.tone }} />
                  <span className="font-atx-display font-semibold text-[14.5px] text-ink">{r.tag}</span>
                </div>
                <div className="font-mono text-[11px] text-ink-soft mt-1 ml-[19px]">{r.ex}</div>
                <ol className="mt-3.5 flex flex-col gap-2">
                  {r.steps.map((st, i) => (
                    <li key={i} className="flex gap-2.5 text-[12.5px] text-ink-mid leading-[1.45]">
                      <span className="font-mono text-[11px] text-peri-deep shrink-0 mt-[1px]">{i + 1}</span>{st}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          {/* Why */}
          <div className="flex items-center gap-3 mt-12 mb-4">
            <span className={NUM}>→</span>
            <span className={LABEL}>Why it changes the math</span>
          </div>
          <div className="grid grid-cols-4 max-[860px]:grid-cols-2 max-[520px]:grid-cols-1 gap-3">
            {WHY.map((w) => (
              <div key={w.t} className="soft-card p-4">
                <div className="font-atx-display font-semibold text-[13.5px] text-ink leading-tight">{w.t}</div>
                <p className="text-[12px] text-ink-mid leading-[1.5] mt-2">{w.d}</p>
              </div>
            ))}
          </div>

          {/* Agentic ULV — leads with LP participation */}
          <div className="flex items-center gap-3 mt-12 mb-4">
            <span className={NUM}>→</span>
            <span className={LABEL}>The vault is the rail · agentic ULV</span>
          </div>
          <p className="text-[13.5px] text-ink-mid leading-[1.55] max-w-[68ch] -mt-1 mb-4">
            Single-sided ULV pools let an agent supply liquidity with one call — <span className="font-mono text-[12.5px] text-ink">depositUSDC(amount)</span> — no two-token inventory, no impermanent-loss math. Capital earns right up to the exact second it's spent.
          </p>
          <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-3">
            {ULV_ROLES.map((r) => (
              <div key={r.role} className="soft-card p-5 flex flex-col">
                <div className="font-atx-display font-semibold text-[14.5px] text-ink">{r.role}</div>
                <p className="text-[12.5px] text-ink-mid leading-[1.5] mt-2 flex-1">{r.action}</p>
                <span className="mt-3.5 inline-block self-start rounded-full bg-white border border-hair px-2.5 py-1 font-mono text-[10.5px] text-peri-deep">{r.prim}</span>
              </div>
            ))}
          </div>

          {/* Honesty footer */}
          <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5 mt-8 flex items-start gap-3 max-w-[860px]">
            <span className="w-[7px] h-[7px] rounded-full bg-peri mt-1.5 shrink-0" />
            <p className="text-[13px] text-ink-mid leading-[1.55]">This is the architecture we're building toward — <span className="font-semibold text-ink">not a live product</span>. It composes pieces Mintware has already built and is testing: the ULV engine, a V4 JIT liquidity hook, and the edge-auth settlement engine. Nothing here is deployed, audited, or an offer.</p>
          </div>
        </div>
      </section>

      <div id="reputation" className="max-w-[900px] mx-auto px-6 pt-14 pb-20 mw-reveal scroll-mt-20">

        <p className="text-[13px] text-ink-mid leading-[1.55] max-w-[68ch] mb-8">
          Alongside the treasury vision above, every agent wallet also earns a portable on-chain reputation — <span className="font-semibold text-ink">live today</span>, and optional: the integrations below work with or without it.
        </p>

        {/* Plugins */}
        <div className="flex items-center gap-3 mb-4">
          <span className={NUM}>01</span>
          <span className={LABEL}>Available integrations</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-10 max-[640px]:grid-cols-1">
          {PLUGINS.map(p => (
            <div key={p.id} className="soft-card p-5 flex flex-col gap-3">
              <div>
                <div className="font-atx-display text-[14px] font-medium text-ink">{p.name}</div>
                <span className="inline-block mt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] px-2 py-[2px] rounded-full border border-[rgba(108,108,240,0.28)] text-peri-deep">{p.badge}</span>
              </div>
              <div className="text-[12px] text-ink-mid leading-relaxed flex-1">{p.desc}</div>
              <div className="rounded-xl bg-ground-cool border border-hair px-2.5 py-[7px] text-[11px] font-mono text-ink-mid whitespace-nowrap overflow-hidden text-ellipsis">{p.install}</div>
              <a href={p.docs} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold uppercase tracking-[0.04em] text-peri-deep no-underline hover:underline inline-flex items-center min-h-[40px]">
                View docs →
              </a>
            </div>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="flex items-center gap-3 mb-4">
          <span className={NUM}>02</span>
          <span className={LABEL}>Live leaderboard</span>
          <span className="live-chip"><span className="dot" aria-hidden />Live</span>
        </div>
        <div className="soft-card overflow-hidden mb-10">
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-hair-soft max-[700px]:flex-col max-[700px]:items-start">
            <div>
              <div className="font-atx-display text-[16px] font-medium text-ink">Top Mintware agents on Base</div>
              <div className="text-[12px] text-ink-mid mt-[3px]">
                Live reputation rankings for registered agents, powered by the Attribution oracle.
              </div>
            </div>
            <a href="/agents/leaderboard" className="glass-pill-primary glass-pill-sm whitespace-nowrap">
              Open leaderboard →
            </a>
          </div>

          {loading && <div className="px-5 py-8 text-center text-ink-soft text-[13px]">Loading leaderboard…</div>}
          {error && <div className="px-5 py-8 text-center text-[#D14343] text-[13px]">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="px-5 py-8 text-center text-ink-soft text-[13px]">No agents are ranked yet.</div>
          )}

          {!loading && !error && rows.map((row) => (
            <div
              key={row.address}
              className="grid grid-cols-[52px_minmax(0,1fr)_auto_auto] gap-[14px] items-center px-5 py-[14px] border-b border-hair-soft last:border-b-0 cursor-pointer transition-colors hover:bg-ground-cool max-[700px]:grid-cols-[44px_1fr]"
              onClick={() => router.push(`/agent/${row.address}`)}
            >
              <div className="text-[12px] font-semibold text-ink-soft tabular-nums">
                #{row.rank}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-[6px] flex-wrap mb-[3px]">
                  <span className="text-[13px] font-medium text-ink font-mono">{shortAddr(row.address)}</span>
                  {row.is_transparent && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-[3px] rounded-full border border-hair text-ink-mid">
                      <span className="w-[6px] h-[6px] rounded-full bg-peri inline-block" />
                      Transparent
                    </span>
                  )}
                  {row.erc8004_token_id && (
                    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-[3px] rounded-full border border-[rgba(108,108,240,0.28)] text-peri-deep">
                      ERC-8004
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-ink-soft">
                  {row.behavior} behavior · {row.contribution} contribution · {row.interpretability} interpretability
                  {row.risk > 0 ? ` · -${row.risk} risk` : ''}
                </div>
              </div>

              <div className="text-right max-[700px]:col-start-2 max-[700px]:text-left">
                <div className="text-[16px] font-medium text-peri-deep tabular-nums">{row.total_score}</div>
                <div className="text-[10px] text-ink-soft uppercase tracking-[0.08em] mt-[2px]">score</div>
              </div>

              <div className="flex items-center gap-[6px] justify-end flex-wrap max-[700px]:col-start-2 max-[700px]:justify-start">
                {row.mwp_submissions > 0 && (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-[3px] rounded-full border border-hair text-ink-mid whitespace-nowrap">
                    {row.mwp_submissions} MWP
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Actions table */}
        <div className="flex items-center gap-3 mb-4">
          <span className={NUM}>03</span>
          <span className={LABEL}>Actions (all integrations)</span>
        </div>
        <div className="soft-card overflow-hidden mb-10">
          <div className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-3 px-5 py-[10px] bg-ground-cool border-b border-hair-soft text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft max-[700px]:grid-cols-[1fr_2fr_auto]">
            <span>AgentKit</span>
            <span className="max-[700px]:hidden">ElizaOS</span>
            <span className="max-[700px]:hidden">MCP</span>
            <span>Description</span>
            <span></span>
          </div>
          {ACTIONS.map(a => (
            <div key={a.name} className="grid grid-cols-[1fr_1fr_1fr_2fr_auto] gap-3 px-5 py-[14px] items-center border-b border-hair-soft last:border-b-0 max-[700px]:grid-cols-[1fr_2fr_auto]">
              <span className="font-mono text-[12px] font-semibold text-ink">
                {a.name}
                <span className="hidden max-[700px]:flex flex-col gap-0.5 mt-1 font-normal tracking-normal text-[10px] text-ink-soft">
                  <span>Eliza · {a.eliza}</span>
                  <span>MCP · {a.mcp}</span>
                </span>
              </span>
              <span className="font-mono text-[11px] text-ink-mid max-[700px]:hidden">{a.eliza}</span>
              <span className="font-mono text-[11px] text-ink-mid max-[700px]:hidden">{a.mcp}</span>
              <span className="text-[12px] text-ink-mid leading-snug">{a.desc}</span>
              <span className={a.readOnly ? okPill : warnPill}>
                {a.readOnly ? 'read-only' : 'writes tx'}
              </span>
            </div>
          ))}
        </div>

        {/* Code snippet */}
        <div className="flex items-center gap-3 mb-4">
          <span className={NUM}>04</span>
          <span className={LABEL}>Quick start — AgentKit</span>
        </div>
        <div className="rounded-2xl border border-hair bg-ink overflow-hidden mb-10">
          <div className="flex items-center justify-between px-4 py-[10px] border-b border-white/15">
            <span className="font-mono text-[11px] text-white/45">agent.ts</span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-coral2">TypeScript</span>
          </div>
          <div className="p-5 overflow-x-auto">
            <pre className="m-0 font-mono text-[12.5px] leading-[1.7] text-white/80 whitespace-pre">{CODE_SNIPPET}</pre>
          </div>
        </div>

        {/* Env vars */}
        <div className="flex items-center gap-3 mb-4">
          <span className={NUM}>05</span>
          <span className={LABEL}>Environment variables</span>
        </div>
        <div className="soft-card overflow-hidden">
          {[
            { key: 'AGENT_PRIVATE_KEY',         desc: '0x-prefixed hex private key of the agent wallet', req: true },
            { key: 'CDP_API_KEY_NAME',           desc: 'Coinbase Developer Platform API key name (AgentKit only)', req: true },
            { key: 'CDP_API_KEY_PRIVATE_KEY',    desc: 'Coinbase Developer Platform API key secret (AgentKit only)', req: true },
          ].map(e => (
            <div key={e.key} className="flex items-center gap-4 px-5 py-3 border-b border-hair-soft last:border-b-0 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1.5">
              <span className="font-mono text-[12px] font-semibold text-ink min-w-[220px] shrink-0 max-[560px]:min-w-0 max-[560px]:break-all">{e.key}</span>
              <span className="text-[12px] text-ink-mid flex-1">{e.desc}</span>
              <span className={e.req ? warnPill + ' shrink-0' : okPill + ' shrink-0'}>
                {e.req ? 'required' : 'optional'}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
