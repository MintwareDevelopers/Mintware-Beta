'use client'

// /app/rwas/[unit] — the owned engine and its permission/appraisal hook, read at one block.
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { getUnit } from '@/lib/rwa/units'
import { useRwaUnit, rwaStatus, STATUS_CLS, ago } from './useRwaUnit'
import { BandGauge, LiquidityMap, LiveDot, ReadState, Disclosure, IconParcel, IconBand, IconTile, IconTrades, IconChainLink, amount, observedDate, EY, H2 } from './RwaVisuals'

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5 max-[640px]:px-3'

export function RwaMarket({ slug }: { slug: string }) {
  const definition = getUnit(slug)!
  const { address } = useAccount()
  const { unit, failed, now } = useRwaUnit(slug, 12_000, address)
  const status = rwaStatus(unit)
  const hook = unit?.hook
  const permissions = hook?.permissions
  const permissionRows = [
    ['Engine wrapper', permissions?.engineWrapper],
    ['Engine liquidity', permissions?.engineLiquidity],
    ['Trading switch', permissions?.swappingEnabled],
    ...(address ? [['Your trading permission', permissions?.accountSwap], ['Your liquidity permission', permissions?.accountLiquidity]] as const : []),
  ] as const

  return (
    <div className="text-ink">
      <section className="bg-[radial-gradient(1000px_380px_at_90%_-20%,rgba(201,192,244,0.5),transparent_60%)] border-b border-hair-soft">
        <div className={`${WRAP} pt-9 pb-9`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/app/rwas" className="text-[13.5px] font-semibold text-ink-mid no-underline hover:text-ink">← Real-world assets</Link>
            <Link href="/app/rwas/how" className="text-[13.5px] font-semibold text-peri-deep no-underline hover:underline">How it works →</Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <span className="w-14 h-14 rounded-[16px] grid place-items-center" style={{ background: 'linear-gradient(160deg,#EAF4E4,#B9D9A6)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8), var(--mw-raise-sm)', color: '#15151D' }}><IconParcel size={26} /></span>
            <div className="min-w-0">
              <h1 className="m-0 font-geist text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.04] tracking-[-0.04em]">{definition.name}</h1>
              <p className="mt-1.5 mb-0 text-[14px] text-ink-mid"><span className="font-geist-mono">{definition.symbol} / USDC</span> · Uniswap v4 · {definition.chainName}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {status && <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
            {unit?.source !== 'undeployed' && <LiveDot block={unit?.block} failed={failed} />}
          </div>
          <div className="mt-4"><ReadState unit={unit} failed={failed} /></div>
        </div>
      </section>

      <section>
        <div className={`${WRAP} py-10 grid grid-cols-[1.25fr_1fr] gap-5 max-[980px]:grid-cols-1`}>
          <div className="rounded-[26px] mw-raise-lg p-7 max-[640px]:p-5">
            <div className="flex items-center gap-3"><IconTile><IconBand /></IconTile><div className={EY}>Appraisal per {definition.symbol}</div></div>
            <div className="mt-5 font-geist-mono text-[clamp(32px,5vw,48px)] leading-none tracking-[-0.04em] break-words">{amount(hook?.priceWad, 18)} <span className="text-[16px] text-ink-soft">USDC</span></div>
            <p className="mt-3 text-[12px] text-ink-soft">{hook ? <>Observed <time dateTime={new Date(hook.observedAt * 1000).toISOString()}>{observedDate(hook.observedAt)}</time> · {ago(now - hook.observedAt)}</> : 'Awaiting a dated appraisal.'}</p>
            <div className="mt-8">{unit ? <BandGauge unit={unit} /> : <div className="h-[150px] rounded-[14px] bg-[var(--mw-ground)]" />}</div>
            <p className="mt-6 mb-0 pt-5 text-[13px] text-ink-soft border-t border-hair-soft">Trades require issuer permission, a fresh appraisal and an unpaused hook. Fees use the band before the swap.</p>
          </div>
          <div className="rounded-[26px] mw-raise p-7 max-[640px]:p-5">
            <div className={EY}>Where the liquidity sits</div>
            <p className="mt-2 mb-0 text-[14px] leading-[1.55] text-ink-mid">One engine owns the pool position and holds the remaining property tokens and USDC through idle adapters.</p>
            <div className="mt-6">{unit ? <LiquidityMap unit={unit} symbol={definition.symbol} /> : <p className="text-[13px] text-ink-soft">Holdings unavailable until the engine is read.</p>}</div>
          </div>
        </div>
      </section>

      <section className="bg-white border-y border-hair-soft">
        <div className={`${WRAP} py-12`}>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-[620px]">
              <div className={EY}>Price vs appraisal</div>
              <h2 className={`${H2} mt-2`}>A dated reference. A bounded trading range.</h2>
            </div>
            <p className="m-0 max-w-[400px] text-[15px] leading-[1.55] text-ink-mid">Outside the outer band, a permitted trade must narrow the gap on the same side of the appraisal. It cannot cross beyond the opposite boundary.</p>
          </div>
          <div className="mt-7 rounded-[24px] p-5 max-[640px]:p-3" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            <div className="rounded-[18px] mw-raise p-6">
              <div className="mb-5 text-[12px] text-ink-soft">{unit?.source === 'cached' ? 'Cached band snapshot' : 'Current band snapshot'}{unit?.block != null && <> · block {unit.block.toLocaleString()}</>}. Price history is not provided by this reader.</div>
              {unit ? <BandGauge unit={unit} /> : <p className="text-[14px] text-ink-mid">The band will appear after the engine is read.</p>}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className={`${WRAP} py-12`}>
          <div className="flex items-center gap-3"><IconTile><IconTrades /></IconTile><div className={EY}>Trading and contributions</div></div>
          <h2 className={`${H2} mt-3`}>Permissions checked on-chain.</h2>
          <p className="mt-3 max-w-[72ch] text-[14px] leading-[1.6] text-ink-mid">Trades use the permissioned Universal Router and Permit2. New contributions require liquidity permission for the holder and engine, plus wrapper approval. The property token also checks recipients.</p>
          <div className="mt-6 overflow-x-auto rounded-[22px] mw-raise">
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-[11.5px] uppercase tracking-[0.08em] text-ink-soft bg-[var(--mw-ground)]"><th className="px-5 py-3 font-semibold">Permission</th><th className="px-5 py-3 font-semibold">{unit?.source === 'cached' ? 'At snapshot' : 'Status'}</th></tr></thead>
              <tbody>{permissionRows.map(([label, allowed]) => <tr key={label} className="border-t border-hair-soft"><td className="px-5 py-3">{label}</td><td className="px-5 py-3">{allowed == null ? 'Unavailable' : allowed ? 'Allowed' : 'Not allowed'}</td></tr>)}</tbody>
            </table>
          </div>
          {!address && <p className="mt-4 text-[13px] text-ink-soft">Connect a wallet to read your permissions and shares.</p>}
          <p className="mt-5 text-[13px] leading-[1.6] text-ink-mid">Shares are non-transferable. Full in-kind exits need no appraisal, even after its grace period. Incomplete delivery needs a valid grace-period mark and preserves shares for undelivered value. Issuer transfer restrictions still apply.</p>
        </div>
      </section>

      <section className="pb-12">
        <div className={WRAP}>
          <Link href={`/app/rwas/proof?unit=${definition.slug}`} className="mw-raise mw-lift relative overflow-hidden rounded-[26px] p-7 max-[640px]:p-5 flex flex-wrap items-center justify-between gap-5 no-underline text-ink">
            <div aria-hidden="true" className="absolute -right-24 -top-28 w-72 h-72 rounded-full opacity-25 blur-[50px]" style={{ background: 'var(--mw-sheen)' }} />
            <div className="relative flex items-center gap-4"><IconTile><IconChainLink /></IconTile><div><div className="font-semibold text-[19px] tracking-[-0.02em]">The earlier transaction proof</div><div className="text-[14px] text-ink-mid mt-0.5">Archived lifecycle transactions from the previous model, separate from this engine.</div></div></div>
            <span className="relative mw-btn">View archive →</span>
          </Link>
          <div className="mt-6"><Disclosure chainName={definition.chainName} symbol={definition.symbol} /></div>
        </div>
      </section>
    </div>
  )
}
