// Team · Developers — design-forward preview. Wire the treasury into your own
// systems: scoped API keys, webhooks for authorization/settlement/policy events,
// an events reference, and a sandbox against Base Sepolia. ALL illustrative — the
// developer surface is in development, no keys here are real and nothing is live.

const KEYS = [
  { label: 'Production · read', key: 'mw_live_7f3a…9c21', scope: 'treasury:read, cards:read', created: 'Aug 2' },
  { label: 'Automation · spend', key: 'mw_live_a18b…44df', scope: 'cards:read, webhooks', created: 'Jul 28' },
  { label: 'Sandbox', key: 'mw_test_02c9…7be0', scope: 'all · Base Sepolia', created: 'Jul 14' },
]

const HOOKS = [
  { url: 'https://acme.xyz/hooks/mintware', events: 'authorization.*, settlement.*', status: 'Active' },
  { url: 'https://acme.xyz/hooks/policy', events: 'policy.updated, signer.added', status: 'Active' },
]

const EVENTS = [
  { name: 'authorization.approved', desc: 'A card authorization cleared edge-auth within policy.' },
  { name: 'authorization.declined', desc: 'An authorization was refused — over limit, blocked merchant, or frozen card.' },
  { name: 'settlement.completed', desc: 'An approved authorization settled on-chain against treasury liquidity.' },
  { name: 'vault.rebalanced', desc: 'Treasury capital moved between a ULV pool and the idle buffer.' },
  { name: 'policy.updated', desc: 'The quorum threshold, a spending limit, or a signer set changed.' },
]

const SNIPPET = `// POST from Mintware → your endpoint
{
  "type": "authorization.approved",
  "id": "evt_2s9f…",
  "data": {
    "card": "•••• 4821",
    "merchant": "Amazon Web Services",
    "amount_usd": 4182.00,
    "decided_in_ms": 118,
    "settles_against": "USDC · Growth ULV"
  }
}`

export default function TeamDevelopers() {
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-atx-display font-semibold text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Developers</h1>
          <span className="live-chip"><span className="dot" aria-hidden />Preview · illustrative</span>
        </div>
        <button disabled title="Coming soon" className="glass-pill glass-pill-sm shrink-0">+ Create key</button>
      </div>
      <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[64ch] mt-2.5">Wire the treasury into your own systems. Scoped API keys, webhooks for authorization and settlement events, and role-based access so automation runs under the same policy as people.</p>

      {/* API keys */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-7 mb-3">API keys</div>
      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-x-auto">
        <table className="w-full min-w-[600px] max-[640px]:min-w-0 border-collapse text-[13px]">
          <thead>
            <tr className="bg-ground-cool border-b border-hair-soft">
              {['Label', 'Key', 'Scope', 'Created'].map((h, i) => (
                <th key={h} className={`text-[9.5px] uppercase tracking-[0.09em] font-semibold text-ink-soft px-4 py-2.5 text-left ${i === 2 ? 'max-[560px]:hidden' : ''} ${i === 3 ? 'max-[640px]:hidden' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KEYS.map((k) => (
              <tr key={k.key} className="border-b border-hair-soft last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{k.label}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-ink-mid">{k.key}</td>
                <td className="px-4 py-3 text-ink-soft text-[12px] max-[560px]:hidden">{k.scope}</td>
                <td className="px-4 py-3 text-ink-soft max-[640px]:hidden">{k.created}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Webhooks + snippet */}
      <div className="grid grid-cols-[1fr_1fr] max-[880px]:grid-cols-1 gap-4 mt-8">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mb-3">Webhook endpoints</div>
          <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card">
            {HOOKS.map((h) => (
              <div key={h.url} className="px-5 py-3.5 border-b border-hair-soft last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[12px] text-ink truncate">{h.url}</span>
                  <span className="text-[9px] uppercase tracking-[0.08em] font-semibold text-mw-green bg-mw-green-muted rounded-full px-2 py-1 shrink-0">{h.status}</span>
                </div>
                <div className="text-[11px] text-ink-soft mt-1 font-mono">{h.events}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mb-3">Example event</div>
          <pre className="rounded-[var(--radius-card)] border border-hair bg-[#17171F] text-[#C7CCF2] p-4 text-[11.5px] leading-[1.55] overflow-x-auto font-mono shadow-card"><code>{SNIPPET}</code></pre>
        </div>
      </div>

      {/* Events reference */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Events</div>
      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card divide-y divide-hair-soft max-w-[820px]">
        {EVENTS.map((e) => (
          <div key={e.name} className="flex items-start gap-4 px-5 py-3.5 flex-wrap">
            <code className="font-mono text-[12px] text-peri-deep bg-[rgba(108,108,240,0.07)] rounded-md px-2 py-1 shrink-0">{e.name}</code>
            <span className="text-[13px] text-ink-mid leading-[1.5] flex-1 min-w-[200px]">{e.desc}</span>
          </div>
        ))}
      </div>

      <div className="rounded-[var(--radius-card)] border border-hair bg-ground-cool p-5 mt-6 max-w-[820px] flex items-start gap-3">
        <span className="w-[7px] h-[7px] rounded-full bg-peri mt-1.5 shrink-0" />
        <p className="text-[13px] text-ink-mid leading-[1.5]">Every key and webhook runs against the <span className="font-semibold text-ink">Base Sepolia sandbox</span> before it touches mainnet — replay authorization and settlement flows end-to-end without moving real value.</p>
      </div>

      <p className="text-[11px] text-ink-soft mt-6">Illustrative. The developer platform is in development — the keys, endpoints, and events shown here are a mockup, not real credentials or a live API.</p>
    </>
  )
}
