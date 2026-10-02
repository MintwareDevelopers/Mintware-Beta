import Link from 'next/link'
import { Disclosure } from '@/components/rwa/RwaVisuals'
import { RWA_UNITS } from '@/lib/rwa/demo'

// /app/rwa/how — the RWA liquidity unit explained. Static (gated by the rwa layout). Light-only; copy rules:
// "supply", never deposit / savings / guaranteed / fixed APY.

const WRAP = 'max-w-[1160px] mx-auto px-8 max-[900px]:px-5'
const EY = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft'
const H2 = 'font-atx-display font-semibold text-ink tracking-[-0.025em] text-[clamp(1.4rem,2.4vw,1.9rem)] leading-[1.15]'

const RULES: { k: string; t: string; d: string }[] = [
  { k: 'Band', t: 'Trades stay near the appraisal', d: 'A swap that would end outside the hard band reverts. Inside it, a tighter core band carries the lowest fee.' },
  { k: 'Gap-closing', t: 'Corrections are always allowed', d: 'A trade that moves the price back toward the appraisal clears even from outside the band — the market can heal itself.' },
  { k: 'Appraisal limits', t: 'The issuer cannot jerk the price', d: 'Each appraisal update is step-capped, rate-limited and bounded by a rolling 24-hour drift cap.' },
  { k: 'Timelocks', t: 'No instant changes', d: 'Rotating the appraisal keeper or changing the band config waits 48 hours once the pool is live.' },
  { k: 'Exit window', t: 'A stale appraisal never traps LPs', d: 'If the appraisal goes stale, trading halts but liquidity providers keep a grace window to redeem.' },
  { k: 'Pause', t: 'Guardian brake, exits stay open', d: 'A guardian can pause trading in an emergency. Pausing never blocks redemptions.' },
]

export default function RwaHow() {
  return (
    <div className="text-ink">
      <section className="border-b border-hair-soft bg-[radial-gradient(1000px_360px_at_90%_-20%,rgba(108,108,240,0.12),transparent_60%)]">
        <div className={`${WRAP} pt-10 pb-10`}>
          <div className={EY}>How it works</div>
          <h1 className="mt-4 max-w-[20ch] font-atx-display text-[clamp(2rem,4vw,3.1rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Divisible is not liquid. Here is the missing layer.
          </h1>
          <p className="mt-4 max-w-[64ch] text-[15.5px] leading-[1.6] text-ink-mid">
            A tokenized property still needs someone on the other side of every trade. Mintware is that liquidity: one unit per
            asset, supplied by anyone in dollars, priced around a licensed appraisal, with ownership rules enforced by the
            issuer&apos;s own token.
          </p>
        </div>
      </section>

      {/* THE UNIT — structure diagram */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>The liquidity unit</div>
          <h2 className={`${H2} mt-1.5`}>One vault, one pool, two tranches</h2>
          <div className="mt-8 grid grid-cols-[1fr_1.3fr_1fr] items-center gap-4 max-[900px]:grid-cols-1">
            <Box tone="teal" title="Liquidity providers" lines={['Supply dollars — any wallet', 'Senior tranche, at par', 'Exit in dollars only', 'Never hold the property token']} />
            <div className="rounded-[24px] border-2 border-[rgba(108,108,240,0.35)] bg-white p-6 shadow-[0_18px_48px_-26px_rgba(59,58,143,0.35)]">
              <div className="text-center text-[11px] font-bold uppercase tracking-[0.12em] text-peri-deep">The vault</div>
              <div className="mt-4 grid grid-cols-[4fr_1fr] gap-2 text-center text-[12.5px]">
                <div className="rounded-[12px] bg-[rgba(42,158,138,0.12)] px-3 py-4 text-[#1F7A6A]"><div className="font-semibold">Lending venue</div><div className="mt-0.5 text-[11.5px]">~80% · earning while idle</div></div>
                <div className="rounded-[12px] bg-[rgba(108,108,240,0.14)] px-2 py-4 text-peri-deep"><div className="font-semibold">Pool</div><div className="mt-0.5 text-[11.5px]">~20%</div></div>
              </div>
              <div className="mt-2 rounded-[12px] bg-[rgba(232,138,103,0.14)] px-3 py-3 text-center text-[12.5px] text-[#B4532A]"><span className="font-semibold">Junior: issuer inventory</span> · locked ≥ 90 days · first-loss</div>
              <div className="mt-4 text-center text-[12px] text-ink-soft">Valued at min(pool price, appraisal) — never marked up</div>
            </div>
            <Box tone="coral" title="Verified traders" lines={['Buy and sell the property token', 'Checked by the issuer’s token on receipt', 'Unverified wallets refused', 'Through the issuer’s licensed front end']} />
          </div>
        </div>
      </section>

      {/* RULES */}
      <section className="border-b border-hair-soft bg-[#FAFAFD]">
        <div className={`${WRAP} py-12`}>
          <div className={EY}>Rules the chain enforces</div>
          <h2 className={`${H2} mt-1.5`}>Anchored to the appraisal, by code</h2>
          <div className="mt-7 grid grid-cols-3 gap-4 max-[900px]:grid-cols-2 max-[600px]:grid-cols-1">
            {RULES.map((r) => (
              <div key={r.k} className="rounded-[20px] border border-hair bg-white p-6">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-peri-deep">{r.k}</div>
                <h3 className="mt-2 font-atx-display text-[17px] font-semibold">{r.t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-mid">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SPLIT OF RESPONSIBILITY */}
      <section className="border-b border-hair-soft">
        <div className={`${WRAP} py-12 grid grid-cols-2 gap-5 max-[820px]:grid-cols-1`}>
          <div className="rounded-[22px] border border-hair bg-white p-7">
            <div className={EY}>The issuer keeps</div>
            <ul className="mt-4 grid gap-2.5 text-[14px] text-ink-mid">
              {['The licence and the offering', 'Investor verification (the identity registry)', 'The token’s transfer rules', 'The appraisal, by a licensed appraiser'].map((t) => <li key={t} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-coral2-deep" />{t}</li>)}
            </ul>
          </div>
          <div className="rounded-[22px] border border-hair bg-white p-7">
            <div className={EY}>Mintware provides</div>
            <ul className="mt-4 grid gap-2.5 text-[14px] text-ink-mid">
              {['The liquidity vault and the appraisal-banded pool', 'Idle liquidity routed to lending', 'Live market data and on-chain proof', 'The same unit on any EVM chain'].map((t) => <li key={t} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-peri" />{t}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* HONEST STATUS */}
      <section className="border-b border-hair-soft bg-[#FAFAFD]">
        <div className={`${WRAP} py-10`}>
          <div className={EY}>Before real value</div>
          <p className="mt-3 max-w-[78ch] text-[14px] leading-[1.6] text-ink-mid">
            This is a testnet demonstration. Before any real asset: an external audit of the hook and vault, counsel on venue
            and LP eligibility, integration with the issuer&apos;s production token standard, and a mainnet deployment on Base.
          </p>
          <Link href="/app/rwa/proof" className="mt-4 inline-flex text-[13.5px] font-semibold text-peri-deep no-underline hover:underline">See what is already proven on-chain →</Link>
        </div>
      </section>

      <section><div className={`${WRAP} py-8`}><Disclosure chainName={RWA_UNITS[0].chain.name} symbol={RWA_UNITS[0].demo.property.symbol} /></div></section>
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
