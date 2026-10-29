'use client'

// Agent parking account — testnet read surface. The former Arc spend-in-place path is retired.

import { useState, useCallback } from 'react'

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
}

const LEGS = [
  { t: 'Park', d: 'USDC can be placed in the testnet Earn vault over one adapter.' },
  { t: 'Adapter', d: 'The vault uses one yield adapter; source availability can limit exits.' },
  { t: 'Withdraw', d: 'The former x402 spend-in-place settlement path is retired.' },
]

export default function AgentParkingPage() {
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
      setAcct((await res.json()) as Account)
    } catch {
      setAcct({ agent: addr, error: 'Could not reach the account API' })
    } finally {
      setLoading(false)
    }
  }, [address])

  return (
    <>
    <div className="max-w-[880px] mx-auto px-6 py-10">
      <div className="text-[11px] font-bold tracking-[1.5px] uppercase text-mw-brand mb-3 font-sans">
        Agent treasury
      </div>
      <h1 className="text-[32px] leading-tight font-bold text-mw-ink tracking-[-0.02em] mb-3 font-sans">
        A place to park capital that stays spendable.
      </h1>
      <p className="text-[16px] text-mw-ink-2 max-w-[62ch] mb-8">
        Agent parking is a separate testnet surface. Arc/CCTP settlement is retired; this page does not represent a live card or x402 spend path.
      </p>

      {/* Address input */}
      <div className="flex gap-2 mb-8">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="0x… agent address"
          className="flex-1 rounded-xl border border-mw-border bg-mw-surface-card px-4 py-3 font-mono text-[13.5px] text-mw-ink outline-none focus:border-mw-brand"
        />
        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl bg-mw-brand px-5 py-3 text-white font-semibold text-[14px] disabled:opacity-60"
        >
          {loading ? 'Loading…' : 'Load account'}
        </button>
      </div>

      {/* Account card */}
      {acct && !acct.error && (
        <div className="rounded-2xl border border-mw-border shadow-card p-6 mb-8 bg-mw-surface-card">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3 mb-2 font-sans">
                Reported vault shares
              </div>
              <div className="text-[36px] font-bold text-mw-ink tracking-[-0.02em] font-mono tabular-nums">
                ${acct.parkedUsdcFormatted ?? '0'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3 mb-2 font-sans">
                Reported asset value
              </div>
              <div className="text-[36px] font-bold text-mw-teal tracking-[-0.02em] font-mono tabular-nums">
                ${acct.spendableUsdcFormatted ?? '0'}
              </div>
            </div>
          </div>
          <div className="text-[13px] text-mw-ink-3 mt-4">
            Testnet account data on {acct.network ?? 'Base Sepolia'} · unaudited. Former spend-in-place settlement is retired.
          </div>
        </div>
      )}
      {acct?.error && <div className="text-[14px] text-mw-red mb-8">{acct.error}</div>}

      {/* The loop */}
      <div className="text-[11px] font-bold tracking-[1px] uppercase text-mw-ink-3 mb-4 font-sans">
        Testnet vault account
      </div>
      <div className="grid gap-3 mb-8">
        {LEGS.map((l) => (
          <div key={l.t} className="rounded-xl border border-mw-border shadow-card p-4 flex gap-3 bg-mw-surface-card">
            <div className="text-mw-brand font-bold shrink-0">◆</div>
            <div>
              <div className="font-semibold text-mw-ink text-[15px]">{l.t}</div>
              <div className="text-[13.5px] text-mw-ink-2 mt-0.5">{l.d}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[12.5px] text-mw-ink-4">
        Via AgentKit: <span className="font-mono">MINTWARE_PARK</span> to park,{' '}
        <span className="font-mono">MINTWARE_TREASURY</span> to check, <span className="font-mono">MINTWARE_X402_PAY</span>{' '}
        to spend per call. Testnet — deployed ≠ audited; external audit gates real value.
      </p>
    </div>
    </>
  )
}
