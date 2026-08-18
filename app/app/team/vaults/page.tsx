// Team · Vaults — design-forward allocation view. Two halves: where the treasury's
// capital is DEPLOYED (Growth ULV pools + the Aave idle buffer, rebalance in one
// place) and the vaults this org CURATES (retail LPs deposit into what you build —
// Curator is the create role, pulled from the User surface). ALL illustrative — the
// ULV engine is in testing on Base Sepolia, nothing here is live or an offer.

import Link from 'next/link'

const SUMMARY = [
  { k: 'Allocated to vaults', v: '$5.80M', s: '73% of treasury' },
  { k: 'Idle buffer', v: '$1.14M', s: 'Aave v3 · instant' },
  { k: 'Blended APY', v: '6.2%', s: '30-day net' },
  { k: '30-day yield', v: '$29,940', s: 'across positions' },
]

type Alloc = { name: string; pair: string; allocated: string; pct: number; apy: string; earned: string; tint: string }
const HELD: Alloc[] = [
  { name: 'Growth ULV', pair: 'USDC single-sided', allocated: '$3.02M', pct: 52, apy: '6.8%', earned: '+$17,120', tint: 'var(--color-peri)' },
  { name: 'Pair Vault',  pair: 'ETH / USDC',         allocated: '$1.22M', pct: 21, apy: '7.4%', earned: '+$7,530',  tint: 'var(--color-coral2)' },
  { name: 'Aave idle buffer', pair: 'USDC · v3',     allocated: '$1.14M', pct: 20, apy: '4.1%', earned: '+$3,890',  tint: 'var(--color-peri-deep)' },
  { name: 'Reserve',     pair: 'unallocated',        allocated: '$0.42M', pct: 7,  apy: '—',    earned: '—',        tint: 'var(--color-ink-soft)' },
]

type Curated = { name: string; pair: string; tvl: string; depositors: number; fee: string; status: 'Live' | 'Seeding' }
const CURATED: Curated[] = [
  { name: 'Acme Growth', pair: 'USDC single-sided', tvl: '$1.90M', depositors: 214, fee: '10%', status: 'Live' },
  { name: 'Acme LSA Pair', pair: 'ACME / ETH',       tvl: '$0.34M', depositors: 38,  fee: '15%', status: 'Seeding' },
]

export default function TeamVaults() {
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-atx-display font-semibold text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.025em] text-ink">Vaults</h1>
          <span className="live-chip"><span className="dot" aria-hidden />Preview · illustrative</span>
        </div>
        <Link href="/app/vault/create" className="glass-pill-primary shrink-0">+ Create vault →</Link>
      </div>
      <p className="text-ink-mid text-[14px] leading-[1.55] max-w-[64ch] mt-2.5">Allocate treasury capital across Growth ULV pools and the Aave idle buffer, and curate your own vaults. Creating a vault is a Curator action — retail LPs deposit into what you build; the strategy, lock terms, and fee split are yours to set.</p>

      {/* Summary strip */}
      <div className="grid grid-cols-4 max-[880px]:grid-cols-2 max-[480px]:grid-cols-1 gap-3 mt-5">
        {SUMMARY.map((k) => (
          <div key={k.k} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft">{k.k}</div>
            <div className="font-atx-display font-medium text-[22px] tracking-tight text-ink mt-1.5 tabular-nums">{k.v}</div>
            <div className="text-[11px] text-ink-soft mt-0.5">{k.s}</div>
          </div>
        ))}
      </div>

      {/* Held allocation */}
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft mt-8 mb-3">Treasury allocation</div>
      <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
        <div className="flex h-2.5 rounded-full overflow-hidden mb-5">
          {HELD.map((a) => <span key={a.name} style={{ width: `${a.pct}%`, background: a.tint }} />)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] max-[640px]:min-w-0 border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-hair-soft">
                {['Position', 'Allocated', 'Share', 'APY', '30d earned', ''].map((h, i) => (
                  <th key={h || i} className={`text-[9.5px] uppercase tracking-[0.09em] font-semibold text-ink-soft pb-2.5 ${i === 0 ? 'text-left' : 'text-right'} ${i === 3 ? 'max-[560px]:hidden' : ''} ${i === 4 ? 'max-[520px]:hidden' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HELD.map((a) => (
                <tr key={a.name} className="border-b border-hair-soft last:border-0">
                  <td className="py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: a.tint }} />
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">{a.name}</div>
                        <div className="text-[11px] text-ink-soft truncate font-mono">{a.pair}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 text-right tabular-nums text-ink">{a.allocated}</td>
                  <td className="py-3 text-right tabular-nums text-ink-mid">{a.pct}%</td>
                  <td className="py-3 text-right tabular-nums text-peri-deep font-semibold max-[560px]:hidden">{a.apy}</td>
                  <td className="py-3 text-right tabular-nums text-mw-green font-medium max-[520px]:hidden">{a.earned}</td>
                  <td className="py-3 text-right"><button disabled title="Coming soon" className="text-[11px] font-semibold text-ink-soft uppercase tracking-[0.05em]">Rebalance</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Curated vaults */}
      <div className="flex items-center justify-between gap-3 mt-8 mb-3 flex-wrap">
        <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Vaults you curate · {CURATED.length}</div>
      </div>
      <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
        {CURATED.map((c) => (
          <div key={c.name} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-atx-display font-semibold text-[15px] text-ink truncate">{c.name}</div>
                <div className="text-[11px] text-ink-soft mt-0.5 font-mono">{c.pair}</div>
              </div>
              <span className={`text-[9px] uppercase tracking-[0.08em] font-semibold rounded-full px-2 py-1 shrink-0 ${c.status === 'Live' ? 'text-mw-green bg-mw-green-muted' : 'text-mw-amber bg-[rgba(194,122,0,0.08)]'}`}>{c.status}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[{ l: 'TVL', v: c.tvl }, { l: 'Depositors', v: String(c.depositors) }, { l: 'Your fee', v: c.fee }].map((s) => (
                <div key={s.l}>
                  <div className="text-[10px] uppercase tracking-[0.08em] text-ink-soft">{s.l}</div>
                  <div className="font-atx-display font-medium text-[16px] text-ink tabular-nums mt-0.5">{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {/* create tile */}
        <Link href="/app/vault/create" className="rounded-[var(--radius-card)] border border-dashed border-[rgba(108,108,240,0.4)] bg-[rgba(108,108,240,0.03)] p-5 flex flex-col items-start justify-center gap-1.5 no-underline hover:bg-[rgba(108,108,240,0.06)] transition-colors min-h-[132px]">
          <span className="font-atx-display font-semibold text-[15px] text-peri-deep">+ Create a vault</span>
          <span className="text-[12.5px] text-ink-mid max-w-[40ch] leading-[1.45]">Seed a new ULV pool as a Curator — set the pair, chain, and lock terms. In testing on Base Sepolia.</span>
        </Link>
      </div>

      <p className="text-[11px] text-ink-soft mt-6">Illustrative. The ULV vault engine is in testing on Base Sepolia — allocations, curated vaults, and yields shown here are a mockup, not live positions or an offer.</p>
    </>
  )
}
