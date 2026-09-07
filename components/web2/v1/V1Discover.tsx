'use client'

// Discover — the V1 app home surface (Meteora-style): a scannable table of curated pools you can put
// USDG to work in. Real data from /api/gateway/instances; the per-pool add flow is /earn/[pool]. Dark
// app skin. Honest testnet framing; no par / guaranteed / deposit-savings language.

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Instance = { poolAddress: string; pairLabel: string | null; quoteAsset: string; chainId: number }

export function V1Discover() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/gateway/instances')
      .then((r) => r.json())
      .then((d) => setInstances(Array.isArray(d?.instances) ? d.instances : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const slug = (i: Instance) => encodeURIComponent((i.pairLabel ?? i.poolAddress).replace(/\s*\/\s*/g, '-').toLowerCase())
  const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`

  return (
    <div>
      {/* hero */}
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Earn · Robinhood Chain</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5 max-w-[24ch]">
        Put USDG to work in curated pools —{' '}
        <span style={{ backgroundImage: 'linear-gradient(100deg,#8A82F4,#F0A183)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>spend from the yield.</span>
      </h1>
      <p className="text-[14.5px] leading-[1.6] mt-3 max-w-[56ch]" style={{ color: '#9B9BAD' }}>
        Deposit USDG. It earns while staged, then provides liquidity to a pool we&rsquo;ve screened — and a
        liquid buffer stays spendable. You spend the yield, never your position.
      </p>

      {/* stats strip */}
      <div className="flex gap-8 mt-6 flex-wrap">
        <Stat k="Curated pools" v={loading ? '—' : String(instances.length)} />
        <Stat k="Network" v="Robinhood Testnet" />
        <Stat k="Yield venue" v="Morpho + LP fees" />
      </div>

      {/* pools table */}
      <div className="mt-7 rounded-[16px] overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: '#12121C' }}>
        <div
          className="grid items-center px-5 py-3 text-[11px] uppercase tracking-[0.07em] font-semibold"
          style={{ gridTemplateColumns: '2fr 1fr 1.4fr 0.9fr', color: '#63636F', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span>Pool</span>
          <span>Quote</span>
          <span className="max-[720px]:hidden">Contract</span>
          <span className="text-right">&nbsp;</span>
        </div>

        {loading ? (
          <Msg>Loading pools…</Msg>
        ) : instances.length === 0 ? (
          <Msg>
            No pools are live yet. We&rsquo;re screening the hottest Robinhood Chain pools — the first curated
            ones appear here as they&rsquo;re spun up.
          </Msg>
        ) : (
          instances.map((i) => (
            <Link
              key={i.poolAddress}
              href={`/earn/${slug(i)}`}
              className="grid items-center px-5 py-4 no-underline transition-colors group"
              style={{ gridTemplateColumns: '2fr 1fr 1.4fr 0.9fr', color: '#F4F4FA', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="w-8 h-8 rounded-full shrink-0" style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }} />
                <span className="font-semibold text-[15px] truncate">{i.pairLabel ?? 'Pool'}</span>
              </span>
              <span className="font-mono text-[13px]" style={{ color: '#9B9BAD' }}>USDG</span>
              <span className="font-mono text-[12.5px] max-[720px]:hidden" style={{ color: '#63636F' }}>{short(i.poolAddress)}</span>
              <span className="text-right text-[13.5px] font-semibold" style={{ color: '#8A82F4' }}>
                Put to work →
              </span>
            </Link>
          ))
        )}
      </div>

      <p className="text-[12px] mt-5 leading-[1.55] max-w-[74ch]" style={{ color: '#63636F' }}>
        In testing on Robinhood Chain — testnet, not yet audited. A liquidity position is not a deposit, a
        savings product, or a guaranteed or fixed return; its value moves with the pool price and is subject
        to impermanent loss. External audit gates real value.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: '#63636F' }}>{k}</div>
      <div className="font-mono font-bold text-[16px] mt-1">{v}</div>
    </div>
  )
}

function Msg({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-[14px]" style={{ color: '#9B9BAD' }}>{children}</div>
}
