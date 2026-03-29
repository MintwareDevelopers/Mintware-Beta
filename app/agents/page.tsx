'use client'

// app/agents/page.tsx — AI Agent integrations page (public, no auth required)

import { MwNav } from '@/components/web2/MwNav'

const PLUGINS = [
  {
    id: 'agentkit',
    name: 'Coinbase AgentKit',
    badge: 'Base mainnet',
    badgeColor: '#2563EB',
    icon: '⬡',
    iconBg: 'rgba(37,99,235,0.1)',
    iconColor: '#2563EB',
    desc: 'Three actions any AgentKit-powered agent can register. Look up scores, register on-chain, and claim oracle attestations — all from natural language.',
    install: 'pnpm add @mintware/agentkit-actions @coinbase/agentkit zod',
    docs: 'https://docs.mintware.finance/agents/agentkit',
  },
  {
    id: 'eliza',
    name: 'ElizaOS Plugin',
    badge: 'Autonomous agents',
    badgeColor: '#7B6FCC',
    icon: '○',
    iconBg: 'rgba(123,111,204,0.1)',
    iconColor: '#7B6FCC',
    desc: 'Drop-in plugin for ElizaOS agents. Reputation tracking, on-chain registration, and oracle attestation claiming via conversational triggers.',
    install: 'pnpm add @mintware/eliza-plugin',
    docs: 'https://docs.mintware.finance/agents/eliza',
  },
  {
    id: 'mcp',
    name: 'MCP Server',
    badge: 'Claude · Cursor',
    badgeColor: '#2A9E8A',
    icon: '◈',
    iconBg: 'rgba(42,158,138,0.1)',
    iconColor: '#2A9E8A',
    desc: 'Model Context Protocol server for Claude Desktop and Cursor. Query Attribution scores, register agents, and push oracle attestations — no code required.',
    install: 'pnpm add -g @mintware/mcp-server',
    docs: 'https://docs.mintware.finance/agents/mcp',
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

export default function AgentsPage() {
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

        /* hero */
        .ag-hero {
          background: linear-gradient(135deg, #0d1424 0%, #101e38 100%);
          border-radius: var(--radius-xl);
          padding: 48px 40px;
          margin-bottom: 32px;
          position: relative;
          overflow: hidden;
        }
        .ag-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 60% 70% at 90% -10%, rgba(79,126,247,0.12) 0%, transparent 60%);
          pointer-events: none;
        }
        .ag-hero-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(79,126,247,0.12);
          border: 1px solid rgba(79,126,247,0.2);
          color: var(--color-mw-brand);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          border-radius: 20px;
          padding: 4px 10px;
          margin-bottom: 16px;
        }
        .ag-hero h1 {
          font-size: clamp(26px, 4vw, 36px);
          font-weight: 800;
          color: rgba(255,255,255,0.95);
          margin: 0 0 12px;
          line-height: 1.2;
          letter-spacing: -0.5px;
        }
        .ag-hero p {
          font-size: 15px;
          color: rgba(255,255,255,0.5);
          margin: 0;
          max-width: 540px;
          line-height: 1.65;
        }

        /* section label */
        .ag-section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--color-mw-ink-3);
          margin-bottom: 14px;
        }

        /* plugin cards */
        .ag-plugins {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 32px;
        }
        @media (max-width: 640px) {
          .ag-plugins { grid-template-columns: 1fr; }
        }
        .ag-plugin-card {
          background: #fff;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: box-shadow var(--transition-fast);
        }
        .ag-plugin-card:hover {
          box-shadow: var(--shadow-md);
        }
        .ag-plugin-header {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ag-plugin-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
        }
        .ag-plugin-name {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-mw-ink);
        }
        .ag-plugin-badge {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 20px;
          color: #fff;
          margin-top: 2px;
          display: inline-block;
        }
        .ag-plugin-desc {
          font-size: 12px;
          color: var(--color-mw-ink-3);
          line-height: 1.6;
          flex: 1;
        }
        .ag-plugin-install {
          background: var(--color-mw-surface);
          border-radius: var(--radius-sm);
          padding: 7px 10px;
          font-size: 11px;
          font-family: var(--font-mono), monospace;
          color: var(--color-mw-ink-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ag-plugin-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .ag-docs-link {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-mw-brand);
          text-decoration: none;
        }
        .ag-docs-link:hover { text-decoration: underline; }

        /* actions table */
        .ag-actions-card {
          background: #fff;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          overflow: hidden;
          margin-bottom: 32px;
        }
        .ag-actions-header {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 2fr auto;
          gap: 12px;
          padding: 10px 20px;
          background: var(--color-mw-surface);
          border-bottom: 1px solid var(--color-mw-border);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-mw-ink-4);
        }
        .ag-action-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 2fr auto;
          gap: 12px;
          padding: 14px 20px;
          align-items: center;
          border-bottom: 1px solid var(--color-mw-border);
        }
        .ag-action-row:last-child { border-bottom: none; }
        .ag-mono {
          font-size: 12px;
          font-family: var(--font-mono), monospace;
          color: var(--color-mw-ink);
          font-weight: 600;
        }
        .ag-action-desc {
          font-size: 12px;
          color: var(--color-mw-ink-3);
          line-height: 1.5;
        }
        .ag-read-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 20px;
          white-space: nowrap;
        }
        @media (max-width: 700px) {
          .ag-actions-header, .ag-action-row {
            grid-template-columns: 1fr 2fr auto;
          }
          .ag-action-eliza, .ag-action-mcp { display: none; }
          .ag-col-eliza, .ag-col-mcp { display: none; }
        }

        /* code block */
        .ag-code-card {
          background: #0d1424;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: var(--radius-lg);
          overflow: hidden;
          margin-bottom: 32px;
        }
        .ag-code-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .ag-code-title {
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,0.4);
          font-family: var(--font-mono), monospace;
        }
        .ag-code-lang {
          font-size: 10px;
          font-weight: 700;
          color: rgba(79,126,247,0.8);
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }
        .ag-code-body {
          padding: 20px;
          overflow-x: auto;
        }
        .ag-code-body pre {
          margin: 0;
          font-size: 12.5px;
          font-family: var(--font-mono), monospace;
          line-height: 1.7;
          color: rgba(255,255,255,0.82);
          white-space: pre;
        }
        .ag-code-comment { color: rgba(255,255,255,0.28); }
        .ag-code-keyword { color: #79b8ff; }
        .ag-code-string  { color: #9ecbff; }
        .ag-code-fn      { color: #b392f0; }

        /* env vars */
        .ag-env-card {
          background: #fff;
          border: 1px solid var(--color-mw-border);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        .ag-env-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--color-mw-border);
        }
        .ag-env-row:last-child { border-bottom: none; }
        .ag-env-key {
          font-size: 12px;
          font-family: var(--font-mono), monospace;
          font-weight: 600;
          color: var(--color-mw-ink);
          min-width: 220px;
          flex-shrink: 0;
        }
        .ag-env-desc {
          font-size: 12px;
          color: var(--color-mw-ink-3);
          flex: 1;
        }
        .ag-env-required {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 20px;
          background: rgba(239,68,68,0.08);
          color: var(--color-mw-red);
          flex-shrink: 0;
        }
        .ag-env-optional {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 20px;
          background: var(--color-mw-brand-dim);
          color: var(--color-mw-brand);
          flex-shrink: 0;
        }
      `}</style>

      <div className="ag-page">
        <MwNav />
        <div className="ag-inner">

          {/* Hero */}
          <div className="ag-hero">
            <div className="ag-hero-label">
              <span>◈</span> For AI Agents
            </div>
            <h1>Give your AI agent<br />on-chain reputation</h1>
            <p>
              Mintware Attribution scores AI agent wallets on Base — tracking behaviour,
              contribution, and risk. Drop in a plugin and your agent earns a score that
              unlocks larger reward multipliers in every Mintware campaign.
            </p>
          </div>

          {/* Plugins */}
          <div className="ag-section-label">Available integrations</div>
          <div className="ag-plugins">
            {PLUGINS.map(p => (
              <div key={p.id} className="ag-plugin-card">
                <div className="ag-plugin-header">
                  <div className="ag-plugin-icon" style={{ background: p.iconBg, color: p.iconColor }}>
                    {p.icon}
                  </div>
                  <div>
                    <div className="ag-plugin-name">{p.name}</div>
                    <span className="ag-plugin-badge" style={{ background: p.badgeColor }}>{p.badge}</span>
                  </div>
                </div>
                <div className="ag-plugin-desc">{p.desc}</div>
                <div className="ag-plugin-install">{p.install}</div>
                <div className="ag-plugin-footer">
                  <a href={p.docs} target="_blank" rel="noopener noreferrer" className="ag-docs-link">
                    View docs →
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Actions table */}
          <div className="ag-section-label">Actions (all integrations)</div>
          <div className="ag-actions-card">
            <div className="ag-actions-header">
              <span>AgentKit</span>
              <span className="ag-col-eliza">ElizaOS</span>
              <span className="ag-col-mcp">MCP</span>
              <span>Description</span>
              <span></span>
            </div>
            {ACTIONS.map(a => (
              <div key={a.name} className="ag-action-row">
                <span className="ag-mono">{a.name}</span>
                <span className="ag-mono ag-action-eliza" style={{ color: 'var(--color-mw-ink-3)', fontSize: 11 }}>{a.eliza}</span>
                <span className="ag-mono ag-action-mcp" style={{ color: 'var(--color-mw-ink-3)', fontSize: 11 }}>{a.mcp}</span>
                <span className="ag-action-desc">{a.desc}</span>
                <span className="ag-read-badge" style={
                  a.readOnly
                    ? { background: 'rgba(42,158,138,0.08)', color: 'var(--color-mw-teal)' }
                    : { background: 'rgba(194,122,0,0.08)', color: 'var(--color-mw-amber)' }
                }>
                  {a.readOnly ? 'read-only' : 'writes tx'}
                </span>
              </div>
            ))}
          </div>

          {/* Code snippet */}
          <div className="ag-section-label">Quick start — AgentKit</div>
          <div className="ag-code-card">
            <div className="ag-code-bar">
              <span className="ag-code-title">agent.ts</span>
              <span className="ag-code-lang">TypeScript</span>
            </div>
            <div className="ag-code-body">
              <pre>{CODE_SNIPPET}</pre>
            </div>
          </div>

          {/* Env vars */}
          <div className="ag-section-label">Environment variables</div>
          <div className="ag-env-card">
            {[
              { key: 'AGENT_PRIVATE_KEY',         desc: '0x-prefixed hex private key of the agent wallet', req: true },
              { key: 'CDP_API_KEY_NAME',           desc: 'Coinbase Developer Platform API key name (AgentKit only)', req: true },
              { key: 'CDP_API_KEY_PRIVATE_KEY',    desc: 'Coinbase Developer Platform API key secret (AgentKit only)', req: true },
            ].map(e => (
              <div key={e.key} className="ag-env-row">
                <span className="ag-env-key">{e.key}</span>
                <span className="ag-env-desc">{e.desc}</span>
                <span className={e.req ? 'ag-env-required' : 'ag-env-optional'}>
                  {e.req ? 'required' : 'optional'}
                </span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  )
}
