'use client'

// Read-only issuer view of owned engines, appraisal health and permissions.

import Link from 'next/link'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import { RWA_UNITS, type RwaUnitDefinition } from '@/lib/rwa/units'
import { amount, observedDate, LiveDot, ReadState, Disclosure } from './RwaVisuals'
import { useRwaUnit, ago, rwaStatus, STATUS_CLS } from './useRwaUnit'

export function RwaIssuerConsole() {
  return (
    <div className="text-ink">
      <div className="grid gap-5">
        {RWA_UNITS.map((u) => <GradientPanel key={u.slug} tone="lavender" className="p-2.5"><UnitCard unit={u} /></GradientPanel>)}
      </div>
      <Disclosure chainName={RWA_UNITS[0].chainName} symbol={RWA_UNITS[0].symbol} />
    </div>
  )
}

function UnitCard({ unit }: { unit: RwaUnitDefinition }) {
  const { unit: live, now, failed } = useRwaUnit(unit.slug, 30_000)
  const status = rwaStatus(live)
  const engine = live?.engine
  const hook = live?.hook
  const permissions = hook?.permissions
  const ageLeft = live?.source === 'live' && hook ? hook.observedAt + hook.maxAgeSecs - now : null
  const allowed = (value: boolean | undefined) => value === undefined ? '—' : value ? 'Allowed' : 'Not allowed'

  return (
    <div className="rounded-[22px] p-6 max-[640px]:p-4 mw-raise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-ink-mid">{unit.chainName} · {unit.symbol}{live?.source !== 'undeployed' && <LiveDot block={live?.block} failed={failed} />}</div>
          <div className="mt-1 text-[21px] font-semibold tracking-[-0.025em]">{unit.name}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status && <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_CLS[status.tone]}`}>{status.t}</span>}
          <Link href={`/app/rwas/${unit.slug}`} className="mw-btn-quiet !min-h-[40px] no-underline">Open market</Link>
        </div>
      </div>

      <div className="mt-4"><ReadState unit={live} failed={failed} /></div>
      <div className="mt-5 grid grid-cols-4 gap-3 max-[820px]:grid-cols-2">
        <Tile k={live?.source === 'cached' ? 'NAV at snapshot (USDC)' : 'Engine NAV (USDC)'} v={amount(engine?.nav, 6)} s={engine?.nav === null ? 'unavailable — appraisal may be stale' : 'property and USDC holdings'} />
        <Tile k="Share supply" v={amount(engine?.supply, 18)} s="one non-transferable share class" />
        <Tile k="Pool liquidity" v={engine?.position.liquidity ?? '—'} s={engine ? `ticks ${engine.position.tickLower} to ${engine.position.tickUpper}` : ''} />
        <Tile k="Engine" v={engine ? engine.activated ? 'Active' : 'Inactive' : '—'} s="full exits pay assets in kind" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 max-[820px]:grid-cols-1">
        <Tile k={live?.source === 'cached' ? 'Appraisal at snapshot (USDC)' : 'Appraisal (USDC per unit)'} v={amount(hook?.priceWad, 18)} s={hook ? `observed ${observedDate(hook.observedAt)} · ${ago(now - hook.observedAt)}` : ''} />
        <Tile k="Core / outer band" v={hook ? `±${hook.coreBandTicks} / ±${hook.specBandTicks}` : '—'} s={hook ? `ticks · ${hook.coreFeePips / 10000}% / ${hook.specFeePips / 10000}% fees` : ''} />
        <Tile k="Appraisal valid for" v={ageLeft === null ? '—' : ageLeft <= 0 ? 'Expired' : `${Math.ceil(ageLeft / 3600)} h`} s="stale observations stop new trades; full in-kind exits need no mark" tone={ageLeft !== null && ageLeft <= 0 ? 'warn' : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 max-[820px]:grid-cols-1">
        <Tile k="Engine wrapper permission" v={allowed(permissions?.engineWrapper)} s={live?.source === 'cached' ? 'at snapshot' : 'required for new liquidity'} />
        <Tile k="Engine liquidity permission" v={allowed(permissions?.engineLiquidity)} s={live?.source === 'cached' ? 'at snapshot' : 'holders also need issuer permission'} />
        <Tile k="Trading switch" v={allowed(permissions?.swappingEnabled)} s={hook ? `${live?.source === 'cached' ? 'at snapshot · ' : ''}${hook.paused ? 'guardian pause active' : 'hook unpaused'}` : ''} />
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-soft">
        {([['Engine', engine?.address], ['Hook', hook?.address], ['Permissions adapter', hook?.adapter]] as const).map(([label, address]) => address && <span key={label}>{label} <a href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer" className="font-geist-mono text-ink-mid no-underline hover:text-peri-deep">{address.slice(0, 8)}…{address.slice(-6)}</a></span>)}
      </div>
    </div>
  )
}

function Tile({ k, v, s, tone }: { k: string; v: string; s?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-[14px] px-4 py-3" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
      <div className="text-[12px] text-ink-soft">{k}</div>
      <div className={`mt-1 font-geist-mono text-[18px] tracking-[-0.02em] break-words ${tone === 'warn' ? 'text-[#9A3F1C]' : ''}`}>{v}</div>
      {s && <div className="mt-1 text-[11.5px] leading-[1.4] text-ink-soft">{s}</div>}
    </div>
  )
}
