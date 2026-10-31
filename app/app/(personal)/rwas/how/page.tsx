import Link from 'next/link'
import { Disclosure } from '@/components/rwa/RwaVisuals'
import { RWA_UNITS } from '@/lib/rwa/units'

// /app/rwas/how — the owned engine explained. Static and light-only.

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5'
const EY = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'
const H2 = 'font-geist font-semibold text-ink tracking-[-0.025em] text-[clamp(1.4rem,2.4vw,1.9rem)] leading-[1.15]'

const RULES: { k: string; t: string; d: string }[] = [
  { k: 'Band', t: 'Trades stay near the appraisal', d: 'Trades stay inside the outer band or narrow the gap toward the appraisal. Fees use the pre-swap band, with a lower fee in the core.' },
  { k: 'Gap-closing', t: 'Corrections still need permission', d: 'With a fresh appraisal and trading enabled, a permitted trade outside the band must narrow the gap on the same side. Crossing beyond the opposite boundary is refused.' },
  { k: 'Appraisal limits', t: 'Appraisal changes have limits', d: 'Each appraisal update is step-capped, rate-limited and bounded by a rolling 24-hour drift cap.' },
  { k: 'Timelocks', t: 'No instant changes', d: 'Rotating the appraisal keeper or changing the band config waits 48 hours once the pool is live.' },
  { k: 'In-kind exits', t: 'Full exits need no appraisal', d: 'A full in-kind exit works even after appraisal grace. Incomplete delivery needs a valid grace-period mark and preserves shares for the undelivered value. Issuer transfer restrictions still apply.' },
  { k: 'Pause', t: 'Guardian brake, exits stay open', d: 'A guardian can pause trading. Pool removal ignores the pause and permission revocation; delivery remains subject to the property token’s transfer rules.' },
]

export default function RwaHow() {
  return (
    <div className="text-ink">
      <section className="border-b border-hair-soft bg-[radial-gradient(1000px_360px_at_90%_-20%,rgba(201,192,244,0.5),transparent_60%)]">
        <div className={`${WRAP} pt-10 pb-10`}>
          <div className={EY}>How it works</div>
          <h1 className="mt-4 max-w-[20ch] font-geist text-[clamp(2rem,4vw,3.1rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Divisible is not liquid. Here is the missing layer.
          </h1>
          <p className="mt-4 max-w-[64ch] text-[15.5px] leading-[1.6] text-ink-mid">
            A tokenized property still needs someone on the other side of every trade. Mintware is that liquidity: one unit per
            asset, owned by qualified holders through non-transferable engine shares, with a dated appraisal and
            permissions enforced by the hook and the issuer&apos;s own token.
          </p>
        </div>
      </section>

      {/* THE UNIT — structure diagram */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>The liquidity unit</div>
          <h2 className={`${H2} mt-1.5`}>One engine, one pool, one share class</h2>
          <div className="mt-8 grid grid-cols-[1fr_1.3fr_1fr] items-center gap-4 max-[900px]:grid-cols-1">
            <Box tone="teal" title="Liquidity providers" lines={['Issuer liquidity permission required', 'Contribute property tokens and USDC', 'Receive non-transferable shares', 'Exit with assets in kind']} />
            <div className="rounded-[24px] border-2 border-[rgba(108,108,240,0.35)] bg-white p-6 shadow-[0_18px_48px_-26px_rgba(59,58,143,0.35)]">
              <div className="text-center text-[11px] font-bold uppercase tracking-[0.12em] text-peri-deep">The owned engine</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-center text-[12.5px]">
                <div className="rounded-[12px] bg-[rgba(42,158,138,0.12)] px-3 py-4 text-[#1F7A6A]"><div className="font-semibold">Idle adapters</div><div className="mt-0.5 text-[11.5px]">Property + USDC</div></div>
                <div className="rounded-[12px] bg-[rgba(108,108,240,0.14)] px-2 py-4 text-peri-deep"><div className="font-semibold">Pool</div><div className="mt-0.5 text-[11.5px]">Direct v4 position</div></div>
              </div>
              <div className="mt-2 rounded-[12px] bg-[rgba(232,138,103,0.14)] px-3 py-3 text-center text-[12.5px] text-[#B4532A]"><span className="font-semibold">One share class</span> · proportional holdings</div>
              <div className="mt-4 text-center text-[12px] text-ink-soft">Dated appraisal · band · issuer permissions</div>
            </div>
            <Box tone="coral" title="Verified traders" lines={['Issuer swap permission required', 'Universal Router + Permit2', 'Fresh appraisal and trading enabled', 'Token checks recipients on receipt']} />
          </div>
        </div>
      </section>

      {/* RULES */}
      <section className="border-b border-hair-soft bg-[#F6F6FA]">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>Rules the chain enforces</div>
          <h2 className={`${H2} mt-1.5`}>Anchored to the appraisal, by code</h2>
          <div className="mt-7 grid grid-cols-3 gap-4 max-[900px]:grid-cols-2 max-[600px]:grid-cols-1">
            {RULES.map((r) => (
              <div key={r.k} className="rounded-[20px] mw-raise p-6">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-peri-deep">{r.k}</div>
                <h3 className="mt-2 font-geist text-[17px] font-semibold">{r.t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-mid">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SPLIT OF RESPONSIBILITY */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12 grid grid-cols-2 gap-5 max-[820px]:grid-cols-1`}>
          <div className="rounded-[22px] mw-raise p-7">
            <div className={EY}>The issuer keeps</div>
            <ul className="mt-4 grid gap-2.5 text-[14px] text-ink-mid">
              {['The offering and holder eligibility', 'Liquidity and trading permissions', 'The token’s transfer rules', 'Dated appraisal observations and reports'].map((t) => <li key={t} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-coral2-deep" />{t}</li>)}
            </ul>
          </div>
          <div className="rounded-[22px] mw-raise p-7">
            <div className={EY}>Mintware provides</div>
            <ul className="mt-4 grid gap-2.5 text-[14px] text-ink-mid">
              {['The owned engine and appraisal-banded pool', 'Per-token idle custody adapters', 'Shared engine reads at one chain block', 'Non-transferable shares and in-kind exits'].map((t) => <li key={t} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-peri" />{t}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* HONEST STATUS */}
      <section className="border-b border-hair-soft bg-[#F6F6FA]">
        <div className={`${WRAP} py-10`}>
          <div className={EY}>Before real value</div>
          <p className="mt-3 max-w-[78ch] text-[14px] leading-[1.6] text-ink-mid">
            Before any real asset: an external audit of the engine and hook, review of venue and holder eligibility,
            integration with the issuer&apos;s production token, and a production deployment.
          </p>
          <Link href="/app/rwas/proof" className="mt-4 inline-flex text-[13.5px] font-semibold text-peri-deep no-underline hover:underline">View archived proof from the previous model →</Link>
        </div>
      </section>

      <section><div className={`${WRAP} py-8`}><Disclosure chainName={RWA_UNITS[0].chainName} symbol={RWA_UNITS[0].symbol} /></div></section>
    </div>
  )
}

function Box({ tone, title, lines }: { tone: 'teal' | 'coral'; title: string; lines: string[] }) {
  const c = tone === 'teal' ? 'border-[rgba(42,158,138,0.35)] text-[#1F7A6A]' : 'border-[rgba(232,138,103,0.45)] text-[#B4532A]'
  return (
    <div className={`rounded-[22px] border bg-white p-6 ${c}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.12em]">{title}</div>
      <ul className="mt-3 grid gap-1.5 text-[13.5px] text-ink-mid">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  )
}
