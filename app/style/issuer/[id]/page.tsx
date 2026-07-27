import { notFound } from 'next/navigation'
import { getIssuer } from '@/lib/rwa/issuer'
import { fmtUsd } from '@/lib/vaults/discovery'

const ALLOW =
  process.env.NEXT_PUBLIC_ATX_PREVIEW === 'true' ||
  process.env.NODE_ENV === 'development'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const LINE = 'border-atx-ink/20'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

export default async function IssuerPreview({ params }: { params: Promise<{ id: string }> }) {
  if (!ALLOW) notFound()
  await params
  const p = await getIssuer()
  const avgApy = p.vaults.reduce((s, v) => s + v.apyPct, 0) / p.vaults.length

  const metrics = [
    { k: 'On-time settlement', v: `${p.onTimeSettlementPct}%`, pct: p.onTimeSettlementPct, color: 'var(--color-atx-blue)' },
    { k: 'Default rate', v: `${p.defaultRatePct.toFixed(1)}%`, pct: 100 - p.defaultRatePct, color: 'var(--color-atx-mesquite)' },
    { k: 'Avg APY', v: `${avgApy.toFixed(1)}%`, pct: (avgApy / 15) * 100, color: 'var(--color-atx-coral)' },
  ]

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Top bar */}
      <div className="flex items-center gap-3.5 px-7 h-[58px] border-b border-atx-ink/20 sticky top-0 bg-atx-bone z-10">
        <Star className="w-[18px] h-[18px] text-atx-coral" />
        <span className="font-bold">Issuer</span>
        <button className="ml-auto font-semibold text-[13px] font-atx-mono px-3 py-1.5 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em]">
          Connect Wallet
        </button>
      </div>

      {/* Header */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="px-7 pt-8 pb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-atx-mono text-[11px] uppercase tracking-[0.08em] px-2 py-1 border border-atx-ink bg-atx-acid text-atx-ink">
                ✴ {p.status}
              </span>
              <span className="font-atx-mono text-[12px] text-atx-ink/55">RWA issuer · SPV-wrapped</span>
            </div>
            <h1 className="font-bold tracking-[-0.03em] leading-[0.85] text-[clamp(44px,9vw,108px)]">{p.name}</h1>
            <p className="font-atx-mono text-[13px] text-atx-ink/55 mt-2">
              {p.address} · verified since {p.since}
            </p>
          </div>
          <div className="text-right">
            <div className={LABEL}>Attribution</div>
            <div className="font-bold text-[clamp(40px,6vw,64px)] leading-none text-atx-blue">{p.attributionScore}</div>
          </div>
        </div>
        <div className="border-t border-atx-ink grid [grid-template-columns:repeat(4,1fr)] max-[720px]:[grid-template-columns:1fr_1fr]">
          {[
            ['Deals completed', String(p.dealsCompleted).padStart(2, '0'), ''],
            ['Total raised', fmtUsd(p.totalRaisedUsd), ''],
            ['Default rate', `${p.defaultRatePct.toFixed(1)}%`, 'text-atx-blue'],
            ['Active vaults', String(p.vaults.filter((v) => v.status === 'active').length).padStart(2, '0'), ''],
          ].map(([k, v, c], i) => (
            <div key={k} className={`px-7 py-3.5 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
              <div className={`${LABEL} text-[9px] mb-1.5`}>{k}</div>
              <div className={`font-bold text-[16px] ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Body */}
      <div className="px-7 py-8 grid [grid-template-columns:1.5fr_1fr] gap-8 max-[900px]:grid-cols-1">
        {/* Left */}
        <div className="min-w-0">
          <div className="flex items-center gap-3.5 mb-4">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">01</span>
            <span className={LABEL}>Track record</span>
          </div>
          <div className="border border-atx-ink">
            {metrics.map((m, i) => (
              <div key={m.k} className={`px-[18px] py-4 ${i ? 'border-t ' + LINE : ''}`}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[15px] font-semibold">{m.k}</span>
                  <span className="font-atx-mono text-[15px]">{m.v}</span>
                </div>
                <span className="block h-2 border border-atx-ink relative">
                  <i className="absolute inset-y-0 left-0 block" style={{ width: `${Math.min(100, m.pct)}%`, background: m.color }} />
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3.5 mb-4 mt-9">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">02</span>
            <span className={LABEL}>Vaults by this issuer</span>
          </div>
          <div className="border border-atx-ink">
            {p.vaults.map((v, i) => (
              <div key={v.name} className={`flex items-center gap-4 px-[18px] py-3.5 ${i ? 'border-t ' + LINE : ''}`}>
                <Star className="w-4 h-4 text-atx-coral shrink-0" />
                <span className="text-[15px] flex-1">{v.name}</span>
                <span className="font-atx-mono text-[14px]">{fmtUsd(v.tvlUsd)}</span>
                <span className="font-atx-mono text-[14px] text-atx-coral w-14 text-right">{v.apyPct.toFixed(1)}%</span>
                <span className={`font-atx-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 border w-fit ${v.status === 'active' ? 'border-atx-ink' : 'border-atx-ink/30 text-atx-ink/50'}`}>
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right */}
        <div className="min-w-0">
          <div className="flex items-center gap-3.5 mb-4">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">03</span>
            <span className={LABEL}>Verification</span>
          </div>
          <div className="border border-atx-ink">
            <div className="p-[18px] bg-atx-panel border-b border-atx-ink flex items-center gap-3">
              <span className="w-[10px] h-[10px] bg-atx-acid border border-atx-ink inline-block" />
              <div>
                <div className="font-bold text-[16px]">{p.status}</div>
                <div className="font-atx-mono text-[12px] text-atx-ink/55">SPVAssetProviderRegistry · since {p.since}</div>
              </div>
            </div>
            {['Provider registered', 'Due diligence cleared', 'SPV formed & wrapped', 'KYC provider integrated'].map((step) => (
              <div key={step} className={`flex items-center gap-3 px-[18px] py-3 border-t ${LINE}`}>
                <span className="w-[8px] h-[8px] bg-atx-blue border border-atx-ink inline-block shrink-0" />
                <span className="text-[14px]">{step}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3.5 mb-4 mt-9">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">04</span>
            <span className={LABEL}>Transparency</span>
          </div>
          <div className="border border-atx-ink">
            {p.transparency.map((t, i) => (
              <div key={t.label} className={`flex items-center justify-between px-[18px] py-3.5 ${i ? 'border-t ' + LINE : ''}`}>
                <span className="text-[14px]">{t.label}</span>
                <span className="font-atx-mono text-[13px] text-atx-ink/70">{t.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
