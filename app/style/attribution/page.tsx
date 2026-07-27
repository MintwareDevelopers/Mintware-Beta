import { notFound } from 'next/navigation'
import { getAttributionProfile } from '@/lib/attribution/profile'
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

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <span className="block h-2 border border-atx-ink relative">
      <i className="absolute inset-y-0 left-0 block" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </span>
  )
}

export default async function AttributionPreview() {
  if (!ALLOW) notFound()
  const p = await getAttributionProfile()

  const vectors = [
    { label: 'Economic', value: p.vectors.economic, color: 'var(--color-atx-blue)' },
    { label: 'Network', value: p.vectors.network, color: 'var(--color-atx-coral)' },
    { label: 'Technical', value: p.vectors.technical, color: 'var(--color-atx-acid)' },
  ]
  const vecMax = Math.max(...vectors.map((v) => v.value))

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Top bar */}
      <div className="flex items-center gap-3.5 px-7 h-[58px] border-b border-atx-ink/20 sticky top-0 bg-atx-bone z-10">
        <Star className="w-[18px] h-[18px] text-atx-blue" />
        <span className="font-bold">Attribution</span>
        <button className="ml-auto font-atx-mono text-[12px] text-atx-ink/55 border border-atx-ink/20 px-2.5 py-1.5">
          Search wallet ⌘K
        </button>
      </div>

      {/* Header */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="px-7 pt-8 pb-6 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className={`${LABEL} mb-2`}>Attribution score · {p.address}</p>
            <div className="flex items-end gap-5">
              <h1 className="font-bold tracking-[-0.03em] leading-[0.8] text-[clamp(72px,13vw,152px)]">{p.total}</h1>
              <div className="pb-4">
                <div className="font-atx-mono text-[13px] uppercase tracking-[0.1em] text-atx-blue">{p.tier}</div>
                <div className="font-atx-mono text-[13px] text-atx-ink/55">{p.percentile}th percentile</div>
                <div className="font-atx-mono text-[13px] text-atx-ink/55">/ {p.maxTotal} max</div>
              </div>
            </div>
          </div>
          {/* Soulbound token */}
          <div className="border border-atx-ink bg-atx-bone w-[220px]">
            <div className="p-3.5 flex items-center justify-between border-b border-atx-ink/20">
              <span className={LABEL}>mwATT #{p.tokenId}</span>
              <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 border border-atx-ink bg-atx-ink text-atx-bone">Soulbound</span>
            </div>
            <div className="p-5 flex items-center justify-center bg-atx-panel">
              <Star className="w-16 h-16 text-atx-blue" />
            </div>
            <button className="w-full font-semibold text-[13px] py-2.5 border-t border-atx-ink bg-atx-acid text-atx-ink uppercase tracking-[0.06em]">
              Attest score
            </button>
          </div>
        </div>
      </section>

      {/* Body */}
      <div className="px-7 py-8 grid [grid-template-columns:1.5fr_1fr] gap-8 max-[900px]:grid-cols-1">
        {/* Left column */}
        <div className="min-w-0">
          {/* Vectors */}
          <div className="flex items-center gap-3.5 mb-4">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">01</span>
            <span className={LABEL}>Score vectors · on-chain rollup</span>
          </div>
          <div className="border border-atx-ink">
            {vectors.map((v, i) => (
              <div key={v.label} className={`px-[18px] py-4 ${i ? 'border-t ' + LINE : ''}`}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[15px] font-semibold">{v.label}</span>
                  <span className="font-atx-mono text-[15px]">{v.value}</span>
                </div>
                <Bar pct={(v.value / (vecMax || 1)) * 100} color={v.color} />
              </div>
            ))}
            <div className="px-[18px] py-3 border-t border-atx-ink bg-atx-panel font-atx-mono text-[11px] text-atx-ink/55 uppercase tracking-[0.06em]">
              Surface weight · DeFi 70 / 30 / 0 · RWA 60 / 25 / 15
            </div>
          </div>

          {/* Signals */}
          <div className="flex items-center gap-3.5 mb-4 mt-9">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">02</span>
            <span className={LABEL}>Signals · off-chain score</span>
          </div>
          <div className="border border-atx-ink">
            {p.signals.map((s, i) => (
              <div key={s.key} className={`grid [grid-template-columns:110px_1fr_64px] items-center gap-4 px-[18px] py-3 ${i ? 'border-t ' + LINE : ''}`}>
                <span className="text-[14px]">{s.label}</span>
                <Bar pct={(s.score / s.max) * 100} color="var(--color-atx-blue)" />
                <span className="font-atx-mono text-[13px] text-right tabular-nums">{s.score}/{s.max}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="min-w-0">
          {/* Network graph */}
          <div className="flex items-center gap-3.5 mb-4">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">03</span>
            <span className={LABEL}>Referral network</span>
          </div>
          <figure className="border border-atx-ink bg-atx-bone m-0">
            <svg viewBox="0 0 300 200" className="block w-full h-auto" aria-hidden="true">
              <circle cx="150" cy="100" r="86" fill="none" stroke="#111111" strokeOpacity="0.3" strokeDasharray="3 5" />
              {[
                [60, 50], [250, 46], [46, 150], [258, 150], [150, 22], [150, 182],
              ].map(([x, y], i) => (
                <line key={i} x1="150" y1="100" x2={x} y2={y} stroke="#111111" strokeOpacity="0.35" />
              ))}
              {[
                [60, 50, '#006FCC'], [250, 46, '#FF8574'], [46, 150, '#006FCC'],
                [258, 150, '#FF8574'], [150, 22, '#006FCC'], [150, 182, '#006FCC'],
              ].map(([x, y, c], i) => (
                <rect key={i} x={(x as number) - 6} y={(y as number) - 6} width="12" height="12" fill={c as string} stroke="#111111" />
              ))}
              <circle cx="150" cy="100" r="24" fill="#F4FF00" stroke="#111111" />
              <use href="#atxstar" x="132" y="82" width="36" height="36" fill="none" stroke="#111111" strokeWidth="1.5" />
            </svg>
            <figcaption className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-ink/55 px-3 py-2.5 border-t border-atx-ink/20 flex justify-between">
              <span>FIG · Referral tree</span>
              <span>{p.network.treeSize} nodes · depth {p.network.depth} · q {p.network.quality}</span>
            </figcaption>
          </figure>

          {/* Badges */}
          <div className="flex items-center gap-3.5 mb-4 mt-9">
            <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">04</span>
            <span className={LABEL}>Badges</span>
          </div>
          <div className="grid grid-cols-3 border border-atx-ink">
            {p.badges.map((b, i) => (
              <div
                key={b.id}
                className={`border-atx-ink p-3.5 flex flex-col items-center gap-2 text-center ${(i % 3 !== 2) ? 'border-r' : ''} ${i < 3 ? 'border-b' : ''} ${b.earned ? '' : 'opacity-35'}`}
              >
                <Star className={`w-7 h-7 ${b.earned ? (b.rarity === 'epic' ? 'text-atx-coral' : b.rarity === 'rare' ? 'text-atx-blue' : 'text-atx-ink') : 'text-atx-ink'}`} />
                <div className="text-[13px] font-semibold leading-tight">{b.name}</div>
                <div className="font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-ink/50">{b.rarity}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Positions */}
      <div className="px-7 pb-10">
        <div className="flex items-center gap-3.5 mb-4">
          <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">05</span>
          <span className={LABEL}>Positions</span>
        </div>
        <div className="border border-atx-ink">
          {p.positions.map((pos, i) => (
            <div key={pos.vault} className={`flex items-center gap-4 px-[18px] py-3.5 ${i ? 'border-t ' + LINE : ''}`}>
              <span className={`font-atx-mono text-[11px] uppercase tracking-[0.07em] px-2 py-1 border ${pos.surface === 'DeFi' ? 'border-atx-blue bg-atx-blue text-white' : 'border-atx-ink bg-atx-coral text-atx-ink'}`}>
                {pos.surface}
              </span>
              <span className="text-[15px] flex-1">{pos.vault}</span>
              <span className="font-atx-mono text-[15px]">{fmtUsd(pos.valueUsd)}</span>
            </div>
          ))}
        </div>
      </div>

      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <symbol id="atxstar" viewBox="0 0 100 100">
          <path d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
        </symbol>
      </svg>
    </div>
  )
}
