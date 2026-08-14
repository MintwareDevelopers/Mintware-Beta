// BuiltProofSection — "Built in the open": the sub-150ms mechanism (dark pop band,
// echoing the ULV × YPN model doc's spendable-layer) + a proof grid of what is
// already live / verified on Base Sepolia. HONEST framing preserved: in testing,
// not audited, not mainnet, card rail in integration. v2 Privy-esque. Server component.
// Copy lives in constants/ypn-landing.ts.

import { YPN_PROOF } from '@/constants/ypn-landing'

export function BuiltProofSection() {
  return (
    <section className="bg-white border-b border-hair-soft">
      <div className="mx-auto max-w-[1180px] px-6 max-[800px]:px-4 py-[88px] max-[800px]:py-[56px]">
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">{YPN_PROOF.eyebrow}</div>
        <h2 className="font-atx-display font-medium text-ink tracking-[-0.04em] leading-[1.04] text-[clamp(1.9rem,4.2vw,3rem)] mt-3 max-w-[18ch] [text-wrap:balance]">
          {YPN_PROOF.title}
        </h2>
        <p className="text-ink-mid text-[16px] leading-[1.55] mt-4 max-w-[68ch]">{YPN_PROOF.intro}</p>

        {/* Mechanism — dark pop band (echoes the model doc's spendable layer) */}
        <div className="mt-10 rounded-[24px] bg-[#1B1B2E] text-white overflow-hidden relative">
          <div
            aria-hidden
            className="absolute inset-0 opacity-90"
            style={{
              background:
                'radial-gradient(60% 120% at 88% 0%, rgba(108,108,240,0.45), transparent 55%), radial-gradient(50% 110% at 6% 100%, rgba(244,161,131,0.26), transparent 55%)',
            }}
          />
          <div className="relative px-8 py-9 max-[800px]:px-6 max-[800px]:py-7">
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#A9B6FC]">
              How a swipe actually works
            </div>
            <div className="grid grid-cols-3 gap-0 mt-6 border-t border-white/15 max-[720px]:grid-cols-1">
              {YPN_PROOF.steps.map((s, i) => (
                <div
                  key={s.n}
                  className={`pt-5 pr-6 max-[720px]:pr-0 ${
                    i > 0
                      ? 'pl-6 border-l border-white/10 max-[720px]:pl-0 max-[720px]:border-l-0 max-[720px]:border-t max-[720px]:border-white/10'
                      : ''
                  }`}
                >
                  <div className="font-mono text-[11px] text-[#A9B6FC]">
                    {s.n} · {s.k.toUpperCase()}
                  </div>
                  <div className="font-atx-display font-medium text-[16px] text-white mt-2">{s.k}</div>
                  <p className="text-[13px] text-[#B9B9D0] leading-[1.5] mt-1.5">{s.d}</p>
                </div>
              ))}
            </div>
            <p className="text-[13.5px] text-[#C7C7DC] leading-[1.55] mt-6 max-w-[68ch] border-t border-white/10 pt-5">
              {YPN_PROOF.priceFree}
            </p>
          </div>
        </div>

        {/* Proof grid — what's already live on Base Sepolia */}
        <div className="grid grid-cols-2 gap-4 mt-6 max-[720px]:grid-cols-1">
          {YPN_PROOF.proof.map((p) => (
            <div key={p.k} className="rounded-2xl border border-hair bg-white p-5 flex gap-3.5">
              <span className="mt-0.5 w-[22px] h-[22px] rounded-full grid place-items-center text-[12px] font-bold shrink-0 bg-[rgba(46,158,107,0.12)] text-[#2E9E6B]">
                ✓
              </span>
              <div>
                <div className="font-atx-display font-medium text-[15px] text-ink tracking-[-0.01em]">{p.k}</div>
                <p className="text-[13px] text-ink-mid leading-[1.5] mt-1">{p.d}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[12.5px] text-ink-soft leading-[1.5] mt-6 max-w-[70ch]">{YPN_PROOF.note}</p>
      </div>
    </section>
  )
}
