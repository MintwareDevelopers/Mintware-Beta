'use client'
import { explorer, revertReasonText, shortHash, type RwaUnit } from '@/config/rwa-archive/proof'
import { IconTile, IconRefused } from './RwaVisuals'

export function RefusalCards({ unit, compact = false }: { unit: RwaUnit; compact?: boolean }) {
  const ex = explorer(unit)
  const refused = unit.demo.legs.flatMap((l) => l.txs.map((t) => ({ ...t, leg: l }))).filter((t) => t.status === 'reverted')
  return (
    <div className={`grid gap-4 ${compact ? 'grid-cols-1' : 'grid-cols-2 max-[760px]:grid-cols-1'}`}>
      {refused.map((t) => (
        <div key={t.hash} className="mw-raise rounded-[22px] p-6 flex flex-col" style={{ outline: '1.5px solid rgba(201,87,43,.28)', outlineOffset: -1.5 }}>
          <div className="flex items-center gap-3">
            <IconTile tone="coral"><IconRefused /></IconTile>
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9A3F1C]">Refused on-chain{t.reason ? ` · ${t.reason.error}` : ''}</span>
          </div>
          <h3 className="mt-4 text-[19px] font-semibold tracking-[-0.02em] leading-snug">{t.leg.title}</h3>
          <p className="mt-1.5 mb-0 text-[14px] leading-[1.55] text-ink-mid">{revertReasonText(t) ?? t.label}</p>
          <a href={ex.tx(t.hash)} target="_blank" rel="noreferrer" className="mt-5 self-start inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-geist-mono text-[12px] text-peri-deep no-underline hover:underline" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
            {shortHash(t.hash)} · mined, reverted ↗
          </a>
        </div>
      ))}
    </div>
  )
}

