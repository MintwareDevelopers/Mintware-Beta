import { notFound } from 'next/navigation'
import {
  getRedemptions,
  summarizeRedemptions,
  REDEMPTION_WINDOW_DAYS,
  type RedemptionRequest,
} from '@/lib/rwa/redemptions'
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

function statusColor(s: RedemptionRequest['status']) {
  if (s === 'ready') return 'var(--color-atx-acid)'
  if (s === 'settled') return 'var(--color-atx-mesquite)'
  return 'var(--color-atx-blue)'
}

function Row({ r }: { r: RedemptionRequest }) {
  const elapsed = REDEMPTION_WINDOW_DAYS - r.daysRemaining
  const pct = r.status === 'pending' ? (elapsed / REDEMPTION_WINDOW_DAYS) * 100 : 100
  const canSettle = r.status === 'ready' && r.kycVerified

  return (
    <div className={`px-[18px] py-4 border-t ${LINE} grid [grid-template-columns:1.4fr_1fr_1.1fr_0.8fr_auto] gap-4 items-center max-[860px]:grid-cols-1`}>
      <div>
        <div className="text-[15px] font-semibold leading-tight">{r.vault}</div>
        <div className="font-atx-mono text-[12px] text-atx-ink/55">{r.holder}</div>
      </div>

      <div>
        <div className={LABEL + ' text-[9px] mb-1'}>Amount</div>
        <div className="font-atx-mono text-[15px]">{fmtUsd(r.sharesUsd)}</div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className={LABEL + ' text-[9px]'}>
            {r.status === 'pending' ? `${r.daysRemaining}d remaining` : r.status === 'ready' ? 'Window elapsed' : 'Settled'}
          </span>
          <span className="font-atx-mono text-[10px] text-atx-ink/45">{r.settlesAt}</span>
        </div>
        <span className="block h-2 border border-atx-ink relative">
          <i className="absolute inset-y-0 left-0 block" style={{ width: `${pct}%`, background: statusColor(r.status) }} />
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span
          className="font-atx-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 border border-atx-ink inline-flex items-center gap-1.5 w-fit"
        >
          <span className="w-[8px] h-[8px] border border-atx-ink inline-block" style={{ background: statusColor(r.status) }} />
          {r.status}
        </span>
        <span
          className={`font-atx-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 border w-fit ${
            r.kycVerified ? 'border-atx-ink bg-atx-coral text-atx-ink' : 'border-atx-ink/30 text-atx-ink/50'
          }`}
        >
          {r.kycVerified ? 'KYC cleared' : 'KYC pending'}
        </span>
      </div>

      <button
        disabled={!canSettle}
        className="font-semibold text-[13px] font-atx-mono px-4 py-2.5 border uppercase tracking-[0.06em] border-atx-ink bg-atx-acid text-atx-ink disabled:opacity-30 disabled:bg-transparent"
      >
        Settle
      </button>
    </div>
  )
}

export default async function RedemptionsPreview() {
  if (!ALLOW) notFound()
  const rs = await getRedemptions()
  const agg = summarizeRedemptions(rs)

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* Top bar */}
      <div className="flex items-center gap-3.5 px-7 h-[58px] border-b border-atx-ink/20 sticky top-0 bg-atx-bone z-10">
        <Star className="w-[18px] h-[18px] text-atx-coral" />
        <span className="font-bold">Redemption Queue</span>
        <button className="ml-auto font-semibold text-[13px] font-atx-mono px-3 py-1.5 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em]">
          Issuer Console
        </button>
      </div>

      {/* Header */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="px-7 pt-8 pb-6">
          <p className={`${LABEL} mb-2`}>RWA · async settlement</p>
          <h1 className="font-bold tracking-[-0.03em] leading-[0.85] text-[clamp(38px,7vw,80px)]">
            Redemption<span className="text-atx-grey"> Queue</span>
          </h1>
          <p className="text-atx-ink/55 text-[15px] max-w-[60ch] mt-3.5">
            Requests burn the vRWA claim ticket and enter a 30-day settlement window. The issuer
            settles each one after the window — KYC-gated at the redemption boundary.
          </p>
        </div>
        <div className="border-t border-atx-ink grid [grid-template-columns:repeat(4,1fr)] max-[720px]:[grid-template-columns:1fr_1fr]">
          {[
            ['Pending', String(agg.pending).padStart(2, '0'), ''],
            ['Queued value', fmtUsd(agg.value), ''],
            ['Ready to settle', String(agg.ready).padStart(2, '0'), 'text-atx-blue'],
            ['Window', `${REDEMPTION_WINDOW_DAYS}d`, ''],
          ].map(([k, v, c], i) => (
            <div key={k} className={`px-7 py-3.5 ${i < 3 ? 'border-r border-atx-ink/20' : ''}`}>
              <div className={`${LABEL} text-[9px] mb-1.5`}>{k}</div>
              <div className={`font-bold text-[16px] ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Queue */}
      <div className="px-7 py-8">
        <div className="flex items-center gap-3.5 mb-4">
          <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">{String(rs.length).padStart(2, '0')}</span>
          <span className={LABEL}>Requests</span>
        </div>
        <div className="border border-atx-ink">
          {/* header row */}
          <div className="px-[18px] py-2.5 grid [grid-template-columns:1.4fr_1fr_1.1fr_0.8fr_auto] gap-4 bg-atx-panel max-[860px]:hidden">
            {['Vault · Holder', 'Amount', 'Settlement', 'Status', ''].map((h) => (
              <div key={h} className={LABEL + ' text-[9px]'}>{h}</div>
            ))}
          </div>
          {rs.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </div>
      </div>
    </div>
  )
}
