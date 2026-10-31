'use client'
import Link from 'next/link'
import { formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { getUnit } from '@/lib/rwa/units'
import { useRwaUnit, rwaStatus, STATUS_CLS, ago } from './useRwaUnit'
import { LiquidityMap, LiveDot, Disclosure, EY, H2 } from './RwaVisuals'

export function RwaMarket({ slug }: { slug: string }) {
  const definition = getUnit(slug)!
  const { address } = useAccount()
  const { unit, failed, now } = useRwaUnit(slug, 12_000, address)
  const status = rwaStatus(unit)
  const hook = unit?.hook
  return <div className="max-w-[1160px] mx-auto px-8 py-10 text-ink">
    <div className={EY}>{definition.chainName} · Testnet</div>
    <h1 className={`${H2} mt-3`}>{definition.name}</h1>
    <p className="mt-4 max-w-[70ch] text-ink-mid">An owned liquidity pool with non-transferable engine shares. Issuer permissions govern new contributions and trades; an observed appraisal sets the trading band.</p>
    <div className="mt-5 flex flex-wrap gap-4 items-center">
      {status && <span className={`rounded-full px-3 py-1 text-sm ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
      {unit?.source !== 'undeployed' && <LiveDot block={unit?.block ?? undefined} failed={failed} />}
    </div>
    {unit?.source === 'undeployed' && <p className="my-8 text-ink-mid">The owned engine has not been deployed yet. Current holdings and permissions will appear here after installation.</p>}
    <div className="mt-8 grid gap-6">
      {unit && <LiquidityMap unit={unit} />}
      {hook && <section className="mw-raise rounded-[22px] p-6">
        <h2 className={H2}>Appraisal and permissions</h2>
        <dl className="mt-4 grid gap-3">
          <div><dt>Appraisal (USDC per unit)</dt><dd>{formatUnits(BigInt(hook.priceWad),18)} · observed {ago(now-hook.observedAt)}</dd></div>
          <div><dt>Band</dt><dd>Appraisal tick {hook.appraisalTick}; spot {hook.spotTick}; core ±{hook.coreBandTicks}, outer ±{hook.specBandTicks} ticks</dd></div>
          <div><dt>Fees</dt><dd>{hook.coreFeePips/10000}% core · {hook.specFeePips/10000}% outer</dd></div>
          <div><dt>Engine permission</dt><dd>{hook.permissions.engineWrapper && hook.permissions.engineLiquidity ? 'Approved for liquidity' : 'New liquidity unavailable'}</dd></div>
          {address && <div><dt>Your permissions</dt><dd>Trading: {hook.permissions.accountSwap ? 'allowed' : 'not allowed'} · liquidity: {hook.permissions.accountLiquidity ? 'allowed' : 'not allowed'}</dd></div>}
        </dl>
      </section>}
    </div>
    <p className="mt-6 text-sm text-ink-mid">Full in-kind exits do not require a fresh appraisal. Issuer transfer restrictions still apply to recipients.</p>
    <Link className="inline-block mt-6 text-peri-deep" href={`/v1/rwas/proof?unit=${slug}`}>View archived proof of the previous model →</Link>
    <Disclosure chainName={definition.chainName} symbol={definition.symbol} />
  </div>
}
