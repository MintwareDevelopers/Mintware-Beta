// Team · Developers — ILLUSTRATIVE preview. Wire the treasury into your own systems: scoped API keys,
// webhooks for payment, card and policy events, an events reference, and a sandbox against Base Sepolia.
// Events mirror what the real org surfaces record (payments recorded/settled in the ledger, card events
// from the card provider). The developer platform is in development; no key here is real and nothing is live.

import { PageHead, SLabel, Panel, StatusChip, IconTile, Note, IconCode, IconLedger } from '@/components/web2/TeamKit'

const KEYS = [
  { label: 'Production · read', key: 'mw_live_7f3a…9c21', scope: 'treasury:read, payments:read', created: 'Aug 2' },
  { label: 'Automation · payments', key: 'mw_live_a18b…44df', scope: 'payments:write, webhooks', created: 'Jul 28' },
  { label: 'Sandbox', key: 'mw_test_02c9…7be0', scope: 'all · Base Sepolia', created: 'Jul 14' },
]

const HOOKS = [
  { url: 'https://acme.xyz/hooks/mintware', events: 'payment.*, card.*' },
  { url: 'https://acme.xyz/hooks/policy', events: 'policy.updated, member.*' },
]

const EVENTS = [
  { name: 'payment.recorded', desc: 'A vendor payment or payroll batch was recorded in the treasury ledger.' },
  { name: 'payment.settled', desc: 'A recorded payment’s on-chain transaction confirmed.' },
  { name: 'card.transaction', desc: 'A card purchase was reported by the card provider.' },
  { name: 'card.refilled', desc: 'A card balance was topped up from the treasury, within its limit.' },
  { name: 'policy.updated', desc: 'A role cap, signer or approval threshold changed.' },
]

const SNIPPET = `// POST from Mintware → your endpoint
{
  "type": "payment.recorded",
  "id": "evt_2s9f…",
  "data": {
    "kind": "vendor_pay",
    "recipient": "0xA1c4…9F3b",
    "amount_usdc": "4182.00",
    "category": "Infrastructure",
    "status": "recorded"
  }
}`

export default function TeamDevelopers() {
  return (
    <>
      <PageHead
        icon={<IconCode size={24} />}
        title="Developers"
        status={{ tone: 'preview', label: 'Preview · illustrative' }}
        lede="Wire the treasury into your own systems: scoped API keys, webhooks for payment and card events, and the same role caps for automation as for people."
        actions={<button disabled title="API keys aren't available yet" className="mw-btn-quiet !min-h-[40px] opacity-60 cursor-not-allowed">+ Create key</button>}
      />

      {/* API keys */}
      <SLabel>API keys</SLabel>
      <div className="mw-raise rounded-[22px] overflow-hidden">
        {KEYS.map((k) => (
          <div key={k.key} className="flex items-center gap-4 px-5 py-4 border-b border-[rgba(21,21,29,.06)] last:border-0 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[15px]">{k.label}</div>
              <div className="text-[12.5px] text-ink-soft mt-0.5">{k.scope} · created {k.created}</div>
            </div>
            <code className="font-geist-mono text-[13px] text-ink-mid rounded-[10px] px-3 py-1.5" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>{k.key}</code>
          </div>
        ))}
      </div>

      {/* Webhooks + example */}
      <div className="grid grid-cols-[1fr_1fr] max-[880px]:grid-cols-1 gap-4">
        <div>
          <SLabel>Webhook endpoints</SLabel>
          <div className="mw-raise rounded-[22px] overflow-hidden">
            {HOOKS.map((h) => (
              <div key={h.url} className="px-5 py-4 border-b border-[rgba(21,21,29,.06)] last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-geist-mono text-[13px] text-ink truncate">{h.url}</span>
                  <StatusChip tone="preview">Example</StatusChip>
                </div>
                <div className="text-[12.5px] text-ink-soft mt-1 font-geist-mono">{h.events}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SLabel>Example event</SLabel>
          <pre className="m-0 rounded-[22px] p-5 text-[12.5px] leading-[1.6] overflow-x-auto font-geist-mono text-ink" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}><code>{SNIPPET}</code></pre>
        </div>
      </div>

      {/* Events reference */}
      <SLabel>Events</SLabel>
      <Panel pad={false} className="max-w-[860px]">
        {EVENTS.map((e) => (
          <div key={e.name} className="flex items-start gap-4 px-5 py-3.5 border-b border-[rgba(21,21,29,.06)] last:border-0 flex-wrap">
            <code className="font-geist-mono text-[13px] rounded-[8px] px-2 py-1 shrink-0" style={{ background: 'var(--mw-band)', color: 'var(--mw-peri-deep)' }}>{e.name}</code>
            <span className="text-[14px] text-ink-mid leading-[1.5] flex-1 min-w-[200px]">{e.desc}</span>
          </div>
        ))}
      </Panel>

      <div className="mw-raise rounded-[22px] p-5 mt-4 max-w-[860px] flex items-start gap-4">
        <IconTile><IconLedger /></IconTile>
        <p className="m-0 text-[14px] text-ink-mid leading-[1.55]">Every key and webhook runs against the <span className="font-semibold text-ink">Base Sepolia sandbox</span> first, so you can replay payment and card flows end to end without moving real value.</p>
      </div>

      <Note>Illustrative. The developer platform is in development; the keys, endpoints and events shown here are a mockup, not real credentials or a live API.</Note>
    </>
  )
}
