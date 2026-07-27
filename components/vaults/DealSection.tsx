'use client'

// Shared RWA deal-page content — team-authored overview, yield/NAV explainers,
// key terms, and the reviewed data room. Rendered on both the /style preview and
// the production /vault/[id] RWA branch. ATX Settlemint.

import type { DealMeta } from '@/lib/rwa/deal'
import { fmtUsd } from '@/lib/vaults/discovery'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'

const DOC_LABELS: Record<string, string> = {
  term_sheet: 'Term sheet', legal_opinion: 'Legal opinion', spv_structure: 'SPV structure',
  audit: 'Audit', data_room: 'Data room', other: 'Doc',
}

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

export function DealSection({ deal }: { deal: DealMeta }) {
  const terms: [string, string][] = [
    ['Target APY', deal.targetApyPct != null ? `${deal.targetApyPct}%` : '—'],
    ['Min investment', deal.minInvestmentUsd > 0 ? fmtUsd(deal.minInvestmentUsd) : '—'],
    ['Price band', deal.priceBand],
    ['Settlement', `${deal.settleDays}d`],
    ['KYC at redeem', deal.kycTierRequired],
    ['Asset class', deal.underlyingAssetClass ?? '—'],
  ]
  const docs = deal.documents.filter((d) => d.reviewStatus === 'approved')

  return (
    <div className="mb-9">
      <div className="flex items-center gap-3.5 mb-4">
        <Star className="w-5 h-5 text-atx-coral" />
        <span className={LABEL}>Deal overview</span>
        {deal.reviewStatus !== 'approved' && (
          <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 border border-atx-clay text-atx-clay ml-auto">
            {deal.reviewStatus.replace('_', ' ')}
          </span>
        )}
      </div>

      {deal.description && (
        <p className="text-[15px] leading-[1.6] text-atx-ink/80 mb-5 whitespace-pre-line">{deal.description}</p>
      )}

      {/* Key terms */}
      <div className="border border-atx-ink grid grid-cols-3 max-[620px]:grid-cols-2 mb-5">
        {terms.map(([k, val], i) => (
          <div key={k} className={`px-4 py-3 ${(i + 1) % 3 !== 0 ? 'border-r border-atx-ink/20' : ''} ${i < 3 ? 'border-b border-atx-ink/20' : ''} max-[620px]:[&:nth-child(odd)]:border-r max-[620px]:border-r-atx-ink/20`}>
            <div className={`${LABEL} text-[9px] mb-1`}>{k}</div>
            <div className="font-atx-mono text-[14px]">{val}</div>
          </div>
        ))}
      </div>

      {/* Explainers */}
      {(deal.yieldSourceExplainer || deal.priceExplainer) && (
        <div className="grid grid-cols-2 max-[620px]:grid-cols-1 gap-4 mb-5">
          {deal.yieldSourceExplainer && (
            <div className="border border-atx-ink bg-atx-panel p-4">
              <div className={`${LABEL} text-[10px] mb-2`}>Where yield comes from</div>
              <p className="text-[13px] leading-[1.55] text-atx-ink/75 whitespace-pre-line">{deal.yieldSourceExplainer}</p>
            </div>
          )}
          {deal.priceExplainer && (
            <div className="border border-atx-ink bg-atx-panel p-4">
              <div className={`${LABEL} text-[10px] mb-2`}>Price / NAV</div>
              <p className="text-[13px] leading-[1.55] text-atx-ink/75 whitespace-pre-line">{deal.priceExplainer}</p>
            </div>
          )}
        </div>
      )}

      {/* Data room */}
      {docs.length > 0 && (
        <div className="border border-atx-ink">
          <div className={`${LABEL} text-[10px] px-4 py-2.5 border-b border-atx-ink bg-atx-panel`}>Data room</div>
          {docs.map((d, i) => (
            <a
              key={d.id}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 px-4 py-3 hover:bg-atx-panel ${i ? 'border-t ' + LINE : ''}`}
            >
              <Star className="w-3.5 h-3.5 shrink-0 text-atx-mesquite" />
              <span className="text-[14px] flex-1 min-w-0 truncate">{d.label}</span>
              <span className="font-atx-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 border border-atx-ink/30 shrink-0">{DOC_LABELS[d.kind] ?? d.kind}</span>
              <span className="font-atx-mono text-[13px] text-atx-ink/40 shrink-0">↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
