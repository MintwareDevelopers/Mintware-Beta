'use client'

// Portfolio — the connected wallet's positions across the live markets. Positions are chain-derived
// (/api/gateway/positions: shares × NAV ÷ supply); quote symbol/decimals come from the live-markets list.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { marketChain } from '@/lib/chains/marketChains'
import type { LiveMarket } from '@/app/api/gateway/markets/route'
import { LaneHeader, PLAIN } from './LaneHeader'
import { GlassFrame } from './GlassFrame'

type Position = { poolAddress: string; marketEngine: string; pairLabel: string; chainId: number; shares: string; positionValueAtomic: string; live: boolean }

export function V1Portfolio() {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [partial, setPartial] = useState(false)
  const [markets, setMarkets] = useState<LiveMarket[]>([])

  useEffect(() => {
    fetch('/api/gateway/markets').then((r) => r.json()).then((d) => setMarkets(d?.success ? d.markets : [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!address) { setPositions(null); return }
    setPositions(null)
    fetch(`/api/gateway/positions?address=${address}`)
      .then((r) => r.json())
      .then((d) => { setPositions(d?.success ? d.positions : []); setPartial(d?.success ? !d.complete : true) })
      .catch(() => { setPositions([]); setPartial(true) })
  }, [address])

  const rows = useMemo(() => (positions ?? []).map((p) => {
    const mk = markets.find((x) => x.poolAddress.toLowerCase() === p.poolAddress.toLowerCase() && x.chainId === p.chainId)
    const dec = mk?.quoteDecimals ?? null
    const value = dec == null ? null : Number(BigInt(p.positionValueAtomic)) / 10 ** dec
    return { ...p, value, symbol: mk?.quoteSymbol ?? null }
  }), [positions, markets])

  return (
    <div>
      <LaneHeader eyebrow="Portfolio" title="Your positions," accent="always yours." lede="Every market you hold shares in, valued from chain. Withdraw pro-rata in both tokens whenever you like." />

      {!isConnected ? (
        <div className="mt-6 rounded-[16px] p-7" style={PLAIN}>
          <div className="font-semibold text-[16px]">Connect a wallet to see your positions</div>
          <p className="text-[13.5px] mt-1.5" style={{ color: '#454552' }}>Positions are read straight from the market contracts, nothing is stored about you.</p>
          <button onClick={() => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })} className="mt-4 rounded-full px-5 py-2.5 text-[13.5px] font-semibold text-white cursor-pointer" style={{ background: '#5B5BE6', boxShadow: '0 6px 18px -6px rgba(70,67,209,0.6), 0 0 0 1px rgba(60,57,200,0.9), inset 0 1px 0 rgba(255,255,255,0.22)' }}>
            Connect wallet
          </button>
        </div>
      ) : positions == null ? (
        <div className="mt-6 h-[140px] rounded-[16px] mw-shimmer" />
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-[16px] p-7" style={PLAIN}>
          <div className="font-semibold text-[16px]">{partial ? 'Some markets could not be read right now' : 'No positions yet'}</div>
          <p className="text-[13.5px] mt-1.5" style={{ color: '#454552' }}>{partial ? 'Try again in a moment; your funds are unaffected.' : 'Open a live market and deposit one or both tokens to start earning its fees.'}</p>
          <Link href="/v1" className="inline-flex mt-4 text-[13.5px] font-semibold no-underline hover:underline" style={{ color: '#4643D1' }}>Browse live markets →</Link>
        </div>
      ) : (
        <GlassFrame className="mt-6">
          <div className="grid px-5 py-3 text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ gridTemplateColumns: '2fr 1fr 1fr 0.8fr', color: '#62626F', borderBottom: '1px solid rgba(22,22,44,0.06)' }}>
            <span>Market</span><span>Network</span><span className="text-right">Value</span><span className="text-right" />
          </div>
          {rows.map((p) => (
            <Link key={`${p.chainId}:${p.marketEngine}`} href={`/markets/${encodeURIComponent(p.poolAddress)}?pair=${encodeURIComponent(p.pairLabel)}&pm=${p.marketEngine}`} className="grid items-center px-5 py-4 no-underline hover:bg-white/60" style={{ gridTemplateColumns: '2fr 1fr 1fr 0.8fr', color: '#15151D', borderBottom: '1px solid rgba(22,22,44,0.05)' }}>
              <span className="font-semibold text-[14.5px]">{p.pairLabel}{!p.live && <span className="ml-2 text-[11px] font-semibold" style={{ color: '#8A5300' }}>closed · exit available</span>}</span>
              <span className="text-[13px]" style={{ color: '#454552' }}>{marketChain(p.chainId)?.short ?? `Chain ${p.chainId}`} · testnet</span>
              <span className="text-right font-mono font-semibold text-[14px]">{p.value == null ? `${p.shares} shares` : `${p.value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${p.symbol ?? ''}`}</span>
              <span className="text-right text-[13px] font-semibold" style={{ color: '#4643D1' }}>Manage →</span>
            </Link>
          ))}
        </GlassFrame>
      )}
    </div>
  )
}
