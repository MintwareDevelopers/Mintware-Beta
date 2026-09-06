'use client'

// V1 app home — the live LP Gateway dashboard users land in when they Launch. Discovery (curated pools
// from /api/gateway/instances) + the connected wallet's positions. Honest testnet framing throughout;
// no par / guaranteed / deposit-savings language. The per-pool deposit flow lives on /earn/[pool].

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

type Instance = {
  poolAddress: string
  pairLabel: string | null
  quoteAsset: string
  chainId: number
}

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

export function V1AppHome() {
  const { address } = useMintwareIdentity()
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

  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] pt-[64px] pb-[48px] max-[640px]:pt-[44px]">
          <div className={ey}>Earn · Robinhood Chain</div>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.05] text-[clamp(1.9rem,4vw,2.9rem)] mt-3 [text-wrap:balance] max-w-[20ch]">
            Put USDG to work in live pools — <span className="text-gradient-accent">spend the fees.</span>
          </h1>
          <p className="text-ink-mid text-[15px] leading-[1.6] mt-4 max-w-[52ch]">
            Deposit USDG. It earns while staged, then provides liquidity to a curated pool and earns
            trading fees. You spend the fees, never your principal.
          </p>
        </div>
      </section>

      {/* Your positions */}
      <section className="bg-white border-b border-hair-soft">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[36px]">
          <div className={ey}>Your positions</div>
          {!address ? (
            <div className="soft-card p-[22px] mt-3 text-[14px] text-ink-mid">
              Connect your wallet to see your positions and spendable balance.
            </div>
          ) : (
            <div className="soft-card p-[22px] mt-3 text-[14px] text-ink-mid">
              No positions yet. Pick a pool below to deposit — your position value + spendable fee
              balance will show here.
            </div>
          )}
        </div>
      </section>

      {/* Curated pools */}
      <section className="bg-ground-cool">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[40px]">
          <div className="flex items-baseline justify-between gap-3">
            <div className={ey}>Curated pools</div>
            <span className="text-[12px] text-ink-soft">screened + spun up by us</span>
          </div>

          {loading ? (
            <div className="mt-4 text-[14px] text-ink-soft">Loading pools…</div>
          ) : instances.length === 0 ? (
            <div className="soft-card p-[22px] mt-4 text-[14px] text-ink-mid">
              No pools are live yet. We&rsquo;re screening the hottest Robinhood Chain pools — the first
              curated ones will appear here shortly.
            </div>
          ) : (
            <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3.5 mt-4">
              {instances.map((i) => (
                <Link
                  key={i.poolAddress}
                  href={`/earn/${slug(i)}`}
                  className="soft-card p-[20px] no-underline group hover:shadow-card-hover transition-shadow"
                >
                  <div className="font-atx-display font-semibold text-[17px] text-ink group-hover:text-peri-deep transition-colors">
                    {i.pairLabel ?? 'Pool'}
                  </div>
                  <div className="text-[12px] text-ink-soft font-mono mt-1">
                    {i.poolAddress.slice(0, 10)}…{i.poolAddress.slice(-6)}
                  </div>
                  <div className="mt-4 text-peri-deep font-semibold text-[14px]">Deposit →</div>
                </Link>
              ))}
            </div>
          )}

          <p className="text-[12px] text-ink-soft mt-6 leading-[1.55] max-w-[70ch]">
            In testing on Robinhood Chain — testnet, not yet audited. A liquidity position is not a
            deposit, a savings product, or a guaranteed or fixed return: its value moves with the pool
            price and is subject to impermanent loss. External audit gates real value.{' '}
            <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>
    </div>
  )
}
