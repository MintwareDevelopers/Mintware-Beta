// CoreMechanismSection — "Making locked liquidity liquid". The problem (trapped
// capital) → the fix (a programmable payment rail) → the 4 mechanics. Server
// component. Frames vault-level settlement to spendable cards as the DESIGNED
// mechanism (in testing), never a live claim.

import { YPN_MECHANISM } from '@/constants/ypn-landing'

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

export function CoreMechanismSection() {
  return (
    <section className="border-b border-atx-ink [&_*]:rounded-none">
      <div className="mx-auto max-w-[1180px] px-6 py-[54px] max-[800px]:px-4 max-[800px]:py-[40px]">
        <div className={LABEL}>{YPN_MECHANISM.eyebrow}</div>
        <h2 className="font-atx-display font-bold tracking-[-0.02em] leading-[1.04] text-[clamp(26px,4.2vw,48px)] mt-3 max-w-[18ch]">
          {YPN_MECHANISM.title}
        </h2>

        {/* Problem → fix */}
        <div className="mt-8 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
          <div className="border border-atx-ink bg-atx-panel border-l-[3px] border-l-atx-clay p-5">
            <div className={`${LABEL} text-[10px] text-atx-clay`}>{YPN_MECHANISM.problem.label}</div>
            <p className="text-[14px] text-atx-ink/70 leading-[1.55] mt-2.5">{YPN_MECHANISM.problem.body}</p>
          </div>
          <div className="border border-atx-ink bg-atx-panel border-l-[3px] border-l-atx-blue p-5">
            <div className={`${LABEL} text-[10px] text-atx-blue`}>{YPN_MECHANISM.solution.label}</div>
            <p className="text-[14px] text-atx-ink/70 leading-[1.55] mt-2.5">{YPN_MECHANISM.solution.body}</p>
          </div>
        </div>

        {/* The 4 mechanics */}
        <div className="mt-4 grid grid-cols-4 gap-4 max-[980px]:grid-cols-2 max-[560px]:grid-cols-1">
          {YPN_MECHANISM.steps.map((s) => (
            <div key={s.key} className="border border-atx-ink bg-atx-bone p-5 flex flex-col">
              <span className="font-atx-mono text-[13px] font-bold text-atx-blue">{s.n}</span>
              <div className="font-bold text-[14px] tracking-tight mt-2 leading-[1.2]">{s.title}</div>
              <p className="text-[12.5px] text-atx-ink/60 leading-[1.5] mt-2">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
