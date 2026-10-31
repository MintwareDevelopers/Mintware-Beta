// Team · Allocation — ILLUSTRATIVE preview of where a treasury's capital sits and what each slice earns
// from: Treasury yield (single-asset USDC lending, no pairing), a curated market's pool (trading fees,
// impermanent loss), prefunded card balances, and an unallocated reserve. No rates are shown: lending rates
// are variable and pool fees depend on trading, so a projected yield would be a promise we can't make.
// Status in the material: solid = deployed, dotted = card balances, hatched = reserve.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { PageHead, KpiRow, SLabel, Panel, StatusChip, IconTile, Note, IconPie, IconGrow, IconSwap, IconCard } from '@/components/web2/TeamKit'

const SUMMARY = [
  { k: 'Total allocated', v: '$7.31M', s: '92% of treasury' },
  { k: 'In Treasury yield', v: '$5.40M', s: 'USDC lending, variable' },
  { k: 'In markets', v: '$1.43M', s: 'one curated pool' },
  { k: 'Reserve', v: '$0.63M', s: 'unallocated' },
]

type Slice = { name: string; what: string; earns: string; risk: string; allocated: string; pct: number; bg: string; tex: string; icon: ReactNode }
const SLICES: Slice[] = [
  { name: 'Treasury yield', what: 'USDC, single asset', earns: 'Lending interest (variable)', risk: 'Lending-market and contract risk', allocated: '$5.40M', pct: 68, bg: '#7C7AF0', tex: '', icon: <IconGrow /> },
  { name: 'TSLA / USDG market', what: 'Curated pool, one MarketEngine', earns: 'A share of trading fees', risk: 'Impermanent loss, issuer risk', allocated: '$1.43M', pct: 18, bg: '#A9A7FA', tex: '', icon: <IconSwap /> },
  { name: 'Card balances', what: 'Prefunded, per card', earns: 'Nothing; ready to spend', risk: 'Card programme not live yet', allocated: '$0.48M', pct: 6, bg: '#E1DBFA', tex: 'mw-tex-dots', icon: <IconCard /> },
  { name: 'Reserve', what: 'Unallocated USDC', earns: 'Nothing', risk: 'None beyond the asset', allocated: '$0.63M', pct: 8, bg: '#ECECF2', tex: 'mw-tex-hatch', icon: <IconPie /> },
]

export default function TeamAllocation() {
  return (
    <>
      <PageHead
        icon={<IconPie size={24} />}
        title="Allocation"
        status={{ tone: 'preview', label: 'Preview · illustrative' }}
        lede="Where the treasury's capital sits, what each part earns from, and what it's exposed to. Moving capital between them goes through Treasury controls."
        actions={<button disabled title="Rebalancing from the terminal isn't built yet" className="mw-btn !min-h-[40px] opacity-60 cursor-not-allowed">Rebalance</button>}
      />

      <KpiRow items={SUMMARY} />

      <SLabel>Breakdown</SLabel>
      <Panel>
        <div className="flex h-5 rounded-full overflow-hidden gap-[3px] p-[3px]" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }} aria-hidden>
          {SLICES.map((a) => <span key={a.name} className={`rounded-full ${a.tex}`} style={{ width: `${a.pct}%`, backgroundColor: a.bg }} />)}
        </div>
        <div className="mt-5 flex flex-col">
          {SLICES.map((a) => (
            <div key={a.name} className="grid grid-cols-[auto_1fr_auto] max-[640px]:grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 py-4 border-t border-[rgba(21,21,29,.06)] first:border-0 first:pt-0">
              <IconTile>{a.icon}</IconTile>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-[15.5px]">{a.name}</span><span className="text-[13px] text-ink-soft">{a.what}</span></div>
                <div className="text-[13.5px] text-ink-mid mt-1">Earns from: <span className="text-ink">{a.earns}</span> · Exposed to: {a.risk}</div>
              </div>
              <div className="text-right max-[640px]:col-start-2 max-[640px]:text-left">
                <div className="font-geist-mono text-[16px]">{a.allocated}</div>
                <div className="font-geist-mono text-[12.5px] text-ink-soft">{a.pct}%</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Markets for your own token — the issuer path, not a vault the treasury builds itself. */}
      <SLabel>Liquidity for your own token</SLabel>
      <div className="mw-inset mw-tex-hatch rounded-[22px] p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3.5 min-w-0">
          <IconTile><IconSwap /></IconTile>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-[15.5px]">A market for your token</span><StatusChip tone="planned">Not available yet</StatusChip></div>
            <div className="text-[13.5px] text-ink-mid mt-1">Issuers bring a tokenized asset to market with one engine per pool, after curation.</div>
          </div>
        </div>
        <Link href="/issuers" className="mw-btn-quiet !min-h-[40px] shrink-0">How it works for issuers</Link>
      </div>

      <Note>Illustrative. Allocations shown are examples, not live positions or an offer. Lending rates are variable and pool fees depend on trading; neither is guaranteed. Testnet only, unaudited.</Note>
    </>
  )
}
