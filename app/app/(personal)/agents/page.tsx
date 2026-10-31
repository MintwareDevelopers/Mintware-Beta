'use client'

// /app/agents — the agent account screen (Mineral). How an agent pays today (x402 direct: a signed USDC transfer
// from the agent's own wallet), the tools that do it, and an address lookup. The old YPN "parking account"
// (park in a vault, spend per call without un-parking) was retired: GET /api/x402/account now answers 410
// `x402_vault_account_retired`, so the lookup explains that instead of showing a balance it can't read.
// Spec history: docs/developers/agentkit-compute-402-spec.md.

import { useState, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { IconTile, Arrow } from '@/components/marketing/Story'
import { IconTrade, IconPrice, IconOwned, IconHours } from '@/components/ui2/MineralIcons'

const DEMO_ADDR = '0x9c646C48a302f4725450669f1218d3FDb3e933AD'

type Account = {
  agent: string
  parkedUsdcFormatted?: string
  spendableUsdcFormatted?: string
  earning?: boolean
  spendableLive?: boolean
  vault?: string
  network?: string
  error?: string
  replacement?: string
}

const LEGS: [string, string, ReactNode][] = [
  ['Ask', 'Your agent calls any x402 endpoint, like a normal HTTP request.', <IconTrade key="t" size={20} />],
  ['See the price', 'The endpoint answers 402 with an amount in USDC and where to pay.', <IconPrice key="p" size={20} />],
  ['Pay from its own wallet', 'The agent signs a USDC transfer and retries. It lands with the seller directly.', <IconOwned key="o" size={20} />],
]

const ACTIONS: [string, string][] = [
  ['MINTWARE_X402_QUOTE', 'Read a price without paying'],
  ['MINTWARE_X402_PAY', 'Pay for one request and get the result'],
]

const STATUS: { t: string; d: string; tex: 'solid' | 'hatch'; label: string }[] = [
  { t: 'Pay per request', d: 'x402 payments in USDC, straight from the agent’s wallet to the seller.', tex: 'solid', label: 'Live' },
  { t: 'Earning between jobs', d: 'An agent balance that earns until it’s spent. The earlier parking account was retired and is not live.', tex: 'hatch', label: 'Planned' },
]

export default function AgentAccountPage() {
  const [address, setAddress] = useState(DEMO_ADDR)
  const [acct, setAcct] = useState<Account | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const addr = address.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setAcct({ agent: addr, error: 'Enter a valid 0x… address' })
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/x402/account?address=${addr}`)
      setAcct({ agent: addr, ...((await res.json()) as Omit<Account, 'agent'>) })
    } catch {
      setAcct({ agent: addr, error: 'Could not reach the account API' })
    } finally {
      setLoading(false)
    }
  }, [address])

  const retired = acct?.error === 'x402_vault_account_retired'

  return (
    <div className="font-geist text-ink">
      <div className="max-w-[960px] mx-auto px-[clamp(16px,4vw,32px)] pt-8 pb-20 flex flex-col gap-6">
        {/* ── Header ── */}
        <div className="max-w-[620px]">
          <div className="text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mw-peri-deep)' }}>Agent account</div>
          <h1 className="m-0 mt-2 font-semibold text-[clamp(30px,4vw,44px)] leading-[1.04] tracking-[-0.04em]">
            Your agent pays <span className="text-ink-soft">per request.</span>
          </h1>
          <p className="mt-3 mb-0 text-[16px] leading-[1.55] text-ink-mid">With x402, an agent pays for data, compute or an API one request at a time, in USDC, from its own wallet. No account to open, no key to share.</p>
        </div>

        {/* ── 1 · How a paid call works ── */}
        <section className="mw-inset rounded-[24px] p-[clamp(14px,2.4vw,24px)] grid gap-3 grid-cols-1 min-[820px]:grid-cols-3">
          {LEGS.map(([t, d, icon], i) => (
            <div key={t} className="mw-raise-sm rounded-[18px] p-5">
              <div className="flex items-center justify-between"><IconTile>{icon}</IconTile><span className="font-geist-mono text-[12px] text-ink-soft">0{i + 1}</span></div>
              <div className="font-semibold text-[16px] mt-4">{t}</div>
              <div className="text-[13.5px] text-ink-mid leading-[1.5] mt-1">{d}</div>
            </div>
          ))}
        </section>

        {/* ── 2 · Tools + status ── */}
        <div className="grid gap-5 grid-cols-1 min-[820px]:grid-cols-2">
          <section className="mw-raise rounded-[22px] p-6">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">From AgentKit</div>
            <ul className="mt-4 p-0 list-none flex flex-col gap-2.5">
              {ACTIONS.map(([a, d]) => (
                <li key={a} className="rounded-[14px] px-4 py-3" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
                  <code className="font-geist-mono text-[13px]" style={{ color: 'var(--mw-peri-deep)' }}>{a}</code>
                  <div className="text-[13.5px] text-ink-mid mt-0.5">{d}</div>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-ink-soft mt-4 mb-0">The same actions ship for MCP (Claude, Cursor) and ElizaOS. <Link href="/agents" className="font-semibold no-underline hover:underline" style={{ color: 'var(--mw-peri-deep)' }}>See the agent tools</Link></p>
          </section>

          <section className="flex flex-col gap-3">
            {STATUS.map((s) => (
              <div key={s.t} className={`${s.tex === 'solid' ? 'mw-raise' : 'mw-inset'} rounded-[20px] p-5`}>
                <div className={`h-2 rounded-full ${s.tex === 'hatch' ? 'mw-tex-hatch' : ''}`} style={{ backgroundColor: s.tex === 'solid' ? '#7C7AF0' : '#ECECF2' }} aria-hidden="true" />
                <div className="flex items-center justify-between gap-3 mt-4">
                  <span className="font-semibold text-[16px]">{s.t}</span>
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ${s.tex === 'solid' ? 'bg-[#E3F4EA] text-[#0F7A43]' : 'bg-white text-ink-mid'}`}>{s.tex === 'solid' && <span className="w-1.5 h-1.5 rounded-full bg-[#22A45D]" />}{s.label}</span>
                </div>
                <div className="text-[13.5px] text-ink-mid leading-[1.5] mt-1.5">{s.d}</div>
              </div>
            ))}
          </section>
        </div>

        {/* ── 3 · Look up an agent ── */}
        <section className="mw-raise rounded-[22px] p-6">
          <div className="flex items-center gap-3"><IconTile><IconHours size={20} /></IconTile><div><div className="font-semibold text-[16px]">Look up an agent address</div><div className="text-[13.5px] text-ink-mid">Checks the account API for that address.</div></div></div>
          <div className="flex gap-2 mt-5 flex-wrap">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="0x… agent address"
              aria-label="Agent address"
              className="flex-1 min-w-[240px] min-h-[48px] rounded-[12px] border-0 px-4 font-geist-mono text-[14px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--mw-btn)]"
              style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}
            />
            <button onClick={load} disabled={loading} className="mw-btn !min-h-[48px] !px-5 disabled:opacity-60">
              {loading ? 'Checking…' : 'Check'}
            </button>
          </div>

          {retired && (
            <div className="mt-4 rounded-[16px] px-4 py-3.5 mw-tex-hatch" style={{ backgroundColor: '#F2F2F5' }} role="status">
              <div className="font-semibold text-[14.5px]">No parked balance to show</div>
              <div className="text-[13.5px] text-ink-mid leading-[1.5] mt-1">The parking account this screen used to read has been retired. Agents now pay per request straight from their own wallet, so nothing is parked here.</div>
            </div>
          )}
          {acct && !acct.error && (
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-[16px] p-4" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
              <div><div className="text-[12.5px] text-ink-soft">Parked</div><div className="font-geist-mono text-[24px] mt-1">${acct.parkedUsdcFormatted ?? '0'}</div></div>
              <div><div className="text-[12.5px] text-ink-soft">Reported spendable</div><div className="font-geist-mono text-[24px] mt-1">${acct.spendableUsdcFormatted ?? '0'}</div></div>
              <div className="col-span-2 text-[12.5px] text-ink-soft">On {acct.network ?? 'testnet'}. Spendable is an estimate, not a settlement guarantee.</div>
            </div>
          )}
          {acct?.error && !retired && <div className="mt-4 text-[14px] text-[#B42318]" role="alert">{acct.error}</div>}
        </section>

        <p className="text-[13px] text-ink-soft m-0">Testnet. Deployed is not the same as audited; an external audit gates real value. <Link href="/agents" className="inline-flex items-center gap-1 font-semibold no-underline hover:underline" style={{ color: 'var(--mw-peri-deep)' }}>How agents use Mintware <Arrow size={14} /></Link></p>
      </div>
    </div>
  )
}
