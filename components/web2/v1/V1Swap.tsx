'use client'

// Swap — V1 dark swap surface. Meteora leans on an embedded aggregator ("best rates"); ours routes
// USDG → a curated-pool token through Mintware's own Robinhood-Chain pools (the "real pools per our
// criteria" story). The To list is the live curated set from /api/gateway/discover. On-chain routing
// turns on with the first deployed pool + the V4 quoter/router (v4SwapExec seam) — until then the card
// is fully designed and honest about that, never a fake quote. Centered ~460px card in the V1 shell.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Pool = { poolAddress: string; pairLabel: string; live: boolean }

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }
const INNER = { background: '#0E0E16', border: '1px solid rgba(255,255,255,0.06)' }

export function V1Swap() {
  const [pools, setPools] = useState<Pool[]>([])
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    fetch('/api/gateway/discover')
      .then((r) => r.json())
      .then((d) => setPools(d?.success && Array.isArray(d.pools) ? (d.pools as Pool[]) : []))
      .catch(() => {})
  }, [])

  const selected = useMemo(() => pools.find((p) => p.poolAddress === to) ?? null, [pools, to])
  const hasAmount = Number(amount) > 0
  const routingLive = !!selected?.live // a deployed gateway/quoter exists for this pool

  const btn = !to ? 'Select a token' : !hasAmount ? 'Enter an amount' : routingLive ? 'Swap' : 'Routing goes live with deployed pools'
  const btnEnabled = !!to && hasAmount && routingLive

  return (
    <div className="max-w-[460px] mx-auto">
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold text-center" style={{ color: '#8A82F4' }}>Swap · Robinhood Chain</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.03em] text-[26px] mt-2 text-center">Swap into a curated pool</h1>
      <p className="text-[13.5px] leading-[1.55] mt-2 text-center" style={{ color: '#9B9BAD' }}>
        Routes through Mintware&rsquo;s own Robinhood-Chain pools — the same curated set you can put USDG to work in.
      </p>

      <div className="mt-6 rounded-[18px] p-3.5" style={CARD}>
        {/* From */}
        <div className="rounded-[14px] p-4" style={INNER}>
          <div className="flex justify-between text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>
            <span>From</span><span>Balance —</span>
          </div>
          <div className="flex items-center justify-between gap-3 mt-2">
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="bg-transparent outline-none font-mono font-bold text-[24px] w-full min-w-0"
              style={{ color: '#F4F4FA' }}
            />
            <span className="flex items-center gap-2 shrink-0 px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#2775CA,#1e5aa8)' }}>$G</span>
              <span className="font-semibold text-[14px]">USDG</span>
            </span>
          </div>
        </div>

        {/* flip */}
        <div className="flex justify-center -my-2 relative z-10">
          <span className="w-8 h-8 rounded-[10px] grid place-items-center text-[14px]" style={{ background: '#12121C', border: '1px solid rgba(255,255,255,0.1)', color: '#9B9BAD' }}>↓</span>
        </div>

        {/* To */}
        <div className="rounded-[14px] p-4" style={INNER}>
          <div className="flex justify-between text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>
            <span>To</span><span>{selected ? (selected.live ? 'Live pool' : 'Curating') : ''}</span>
          </div>
          <div className="flex items-center justify-between gap-3 mt-2">
            <span className="font-mono font-bold text-[24px]" style={{ color: '#63636F' }}>0.00</span>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="shrink-0 px-3 py-1.5 rounded-full font-semibold text-[14px] outline-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.06)', color: to ? '#F4F4FA' : '#9B9BAD', border: 'none' }}
            >
              <option value="">Select token</option>
              {pools.map((p) => (
                <option key={p.poolAddress} value={p.poolAddress} style={{ color: '#111' }}>
                  {(p.pairLabel || p.poolAddress).replace(/\s*\/\s*USDG.*/i, '')}{p.live ? '' : ' (curating)'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* review */}
        <div className="px-2 py-3 flex flex-col gap-2 text-[12.5px]" style={{ color: '#9B9BAD' }}>
          <Row k="Route" v="Mintware curated pool" />
          <Row k="Max slippage" v="1.0%" />
          <Row k="Network" v="Robinhood Testnet" />
        </div>

        <button
          disabled={!btnEnabled}
          className="w-full text-[14px] font-semibold py-3.5 rounded-[14px] cursor-pointer disabled:cursor-default"
          style={btnEnabled
            ? { background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', color: '#fff', boxShadow: '0 6px 20px rgba(108,108,240,0.35)' }
            : { background: 'rgba(255,255,255,0.06)', color: '#63636F' }}
        >
          {btn}
        </button>
      </div>

      <p className="text-[12px] mt-4 leading-[1.55] text-center" style={{ color: '#63636F' }}>
        Live swap routing turns on with the first deployed pool.{' '}
        <Link href="/v1" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Browse pools →</Link>
        <br />Testnet, unaudited. Not investment advice.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span style={{ color: '#F4F4FA' }} className="font-medium">{v}</span>
    </div>
  )
}
