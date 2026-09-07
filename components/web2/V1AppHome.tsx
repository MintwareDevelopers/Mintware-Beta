'use client'

// V1 app home — the live LP Gateway money home users land in from the Launch chooser's "V1 · Live"
// track. The model is idle-buffer spend (the canonical "never idle / never locked / always yours"):
// USDG works in live pools around the clock AND a liquid buffer stays spendable, kept topped up by the
// yield — you spend from the yield, never your position. NO "spend the fees" framing, NO par / guaranteed
// / deposit-savings language. Real data: the connected wallet's buffer + working position from
// /api/gateway/position, and curated pools from /api/gateway/instances. The per-pool add flow is /earn/[pool].

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

type Position = {
  positionValueAtomic: string | null
  bufferBalanceAtomic: string | null
}

const ey = 'text-[12px] uppercase tracking-[0.13em] font-semibold text-peri-deep'

// atomic USDG (6dp) → "$1,284.60"
function usdg(atomic: string | null | undefined): string {
  if (atomic == null) return '$0.00'
  const n = Number(BigInt(atomic)) / 1e6
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function num(atomic: string | null | undefined): number {
  if (atomic == null) return 0
  return Number(BigInt(atomic)) / 1e6
}

export function V1AppHome() {
  const { address } = useMintwareIdentity()
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [pos, setPos] = useState<Position | null>(null)
  const [posLoading, setPosLoading] = useState(false)

  useEffect(() => {
    fetch('/api/gateway/instances')
      .then((r) => r.json())
      .then((d) => setInstances(Array.isArray(d?.instances) ? d.instances : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!address) { setPos(null); return }
    setPosLoading(true)
    fetch(`/api/gateway/position?address=${address}`)
      .then((r) => r.json())
      .then((d) => setPos(d?.success ? (d.position as Position) : null))
      .catch(() => setPos(null))
      .finally(() => setPosLoading(false))
  }, [address])

  const slug = (i: Instance) => encodeURIComponent((i.pairLabel ?? i.poolAddress).replace(/\s*\/\s*/g, '-').toLowerCase())

  const buffer = num(pos?.bufferBalanceAtomic)
  const working = num(pos?.positionValueAtomic)
  const total = buffer + working
  const hasPosition = total > 0
  const bufPct = total > 0 ? Math.max(3, Math.min(97, Math.round((buffer / total) * 100))) : 8

  return (
    <div className="font-atx-display bg-ground-cool text-ink min-h-screen overflow-x-clip">
      <V2Nav />

      {/* Hero — the promise, not a product pitch */}
      <section className="bg-ground-cool">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] pt-[60px] pb-[36px] max-[640px]:pt-[40px]">
          <div className={ey}>Your liquid account · Robinhood Chain</div>
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.9rem,4vw,2.8rem)] mt-3 [text-wrap:balance] max-w-[18ch]">
            Never idle. Never locked. <span className="text-gradient-accent">Always yours.</span>
          </h1>
          <p className="text-ink-mid text-[15.5px] leading-[1.6] mt-4 max-w-[50ch]">
            Your USDG works around the clock in live pools — and a liquid buffer stays ready to spend. You
            spend from the yield, never your position.
          </p>
        </div>
      </section>

      {/* The account — spendable buffer + working position (real data) */}
      <section className="bg-ground-cool">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] pb-[44px]">
          {!address ? (
            <div className="soft-card p-[26px]">
              <div className={ey}>Your account</div>
              <p className="text-[14.5px] text-ink-mid mt-2.5 max-w-[46ch] leading-[1.55]">
                Connect your wallet to see your spendable buffer and your working balance.
              </p>
            </div>
          ) : (
            <div className="soft-card overflow-hidden">
              <div className="p-[26px] flex justify-between gap-6 flex-wrap items-start">
                <div>
                  <div className="text-[12px] uppercase tracking-[0.08em] text-ink-soft font-semibold">Spendable now</div>
                  <div className="font-mono font-bold tracking-[-0.02em] leading-none text-[clamp(2.2rem,6vw,3.1rem)] mt-2">
                    {posLoading ? '—' : usdg(pos?.bufferBalanceAtomic)}
                    <span className="text-[0.38em] text-ink-soft font-normal ml-1.5">USDG</span>
                  </div>
                  <p className="text-[13px] text-ink-mid mt-2.5 max-w-[34ch] leading-[1.5]">
                    Your liquid buffer — kept topped up by yield, ready to spend. Spending it never unwinds
                    your position.
                  </p>
                </div>
                <div className="flex gap-2.5 flex-wrap">
                  <Link href="#pools" className="glass-pill-primary">Add USDG</Link>
                  {hasPosition && <button className="glass-pill">Spend →</button>}
                  {hasPosition && <button className="glass-pill">Withdraw</button>}
                </div>
              </div>

              {/* split bar: spendable buffer vs working & earning */}
              <div className="flex h-[14px] rounded-full overflow-hidden mx-[26px]">
                <span className="bg-mw-brand" style={{ width: `${bufPct}%`, background: 'linear-gradient(90deg,var(--color-peri),var(--color-peri-mid))' }} />
                <span className="flex-1" style={{ background: 'linear-gradient(90deg,rgba(199,184,251,.5),rgba(199,184,251,.28))' }} />
              </div>
              <div className="flex gap-6 flex-wrap px-[26px] py-3.5">
                <span className="flex items-center gap-2 text-[13px] text-ink-mid">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'var(--color-peri)' }} />
                  Spendable buffer <span className="font-mono font-bold text-ink ml-1">{usdg(pos?.bufferBalanceAtomic)}</span>
                </span>
                <span className="flex items-center gap-2 text-[13px] text-ink-mid">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'rgba(199,184,251,.5)' }} />
                  Working &amp; earning <span className="font-mono font-bold text-ink ml-1">{usdg(pos?.positionValueAtomic)}</span>
                </span>
              </div>

              {!hasPosition && !posLoading && (
                <div className="border-t border-hair-soft px-[26px] py-4 text-[13.5px] text-ink-mid">
                  Nothing working yet. Add USDG to a pool below — it starts earning immediately, and your
                  spendable buffer fills from the yield.
                </div>
              )}
            </div>
          )}

          <p className="text-[12px] text-ink-soft mt-6 leading-[1.55] max-w-[72ch]">
            In testing on Robinhood Chain — testnet, not yet audited. This is not a deposit, a savings
            product, or a guaranteed or fixed return; the working balance is a liquidity position whose
            value moves with the pool price and is subject to impermanent loss. External audit gates real
            value. <Link href="/legal" className="text-peri-deep font-semibold no-underline hover:underline">Legal →</Link>
          </p>
        </div>
      </section>

      {/* The three pillars — why your money never has to choose */}
      <section className="bg-white border-t border-b border-hair-soft">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[36px]">
          <div className={ey}>Why your money never has to choose</div>
          <div className="grid grid-cols-3 max-[720px]:grid-cols-1 gap-3.5 mt-4">
            <div className="soft-card p-[20px]">
              <div className="font-semibold text-[15.5px]"><span className="text-peri-deep">Never idle.</span></div>
              <p className="text-[13px] text-ink-mid leading-[1.55] mt-1.5">
                Your USDG earns two ways at once — lending yield while it&rsquo;s staged, and trading fees
                once it&rsquo;s providing liquidity in a live pool.
              </p>
            </div>
            <div className="soft-card p-[20px]">
              <div className="font-semibold text-[15.5px]"><span className="text-peri-deep">Never locked.</span></div>
              <p className="text-[13px] text-ink-mid leading-[1.55] mt-1.5">
                A liquid buffer stays spendable at all times, refilled by the yield. You spend the buffer;
                your earning position is never unwound to pay.
              </p>
            </div>
            <div className="soft-card p-[20px]">
              <div className="font-semibold text-[15.5px]"><span className="text-peri-deep">Always yours.</span></div>
              <p className="text-[13px] text-ink-mid leading-[1.55] mt-1.5">
                Non-custodial — your keys, your position. Withdraw the whole balance whenever you want.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Where your USDG works — curated pools */}
      <section id="pools" className="bg-ground-cool scroll-mt-[80px]">
        <div className="mx-auto max-w-[1000px] px-7 max-[640px]:px-[18px] py-[40px]">
          <div className="flex items-baseline justify-between gap-3">
            <div className={ey}>Where your USDG works</div>
            <span className="text-[12px] text-ink-soft">curated pools · screened + spun up by us</span>
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
                  <div className="mt-4 text-peri-deep font-semibold text-[14px]">Put USDG to work →</div>
                </Link>
              ))}
            </div>
          )}

          <p className="text-[12px] text-ink-soft mt-6 leading-[1.55] max-w-[70ch]">
            Fees and lending yield from these pools flow into your spendable buffer automatically — the
            &ldquo;never idle&rdquo; engine behind your balance above.
          </p>
        </div>
      </section>
    </div>
  )
}
