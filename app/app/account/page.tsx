'use client'

// /app/account — the Liquid Sovereign Account: the retail money home. Reads
// top-to-bottom as balance → earning → spending. This is where the User's capital
// now lives (moved out of Profile, which is now purely reputation/identity). The
// card spends against YOUR OWN balance (debit-style) — distinct from the Team card
// program (shared treasury credit line + roles/quorum).
//
// ALL figures ILLUSTRATIVE (vaults in testing on Base Sepolia; no live position
// data). The settlement engine behind the card genuinely exists off-chain
// (services/edge-auth + services/relayer) but is deploy-gated — see footnotes.

import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { MwAuthGuard } from '@/components/web2/MwAuthGuard'
import { MintwareMark } from '@/components/ui2/MintwareMark'

const WRAP = 'max-w-[1040px] mx-auto px-6 max-sm:px-4'
const EY = 'text-[11px] uppercase tracking-[0.14em] font-semibold text-ink-soft flex items-center gap-2.5'

const TOP = [
  { l: 'Available to spend', v: '$48,512', sub: 'all of it · never locked', hl: true },
  { l: 'Blended APY', v: '7.4%', sub: '30-day net' },
  { l: 'Accrued yield', v: '$312.40', sub: 'claimable' },
]

const POSITIONS = [
  { name: 'Growth Vault',      pair: 'ETH / USDC', deposited: '$32,000', apy: '8.1%', earned: '+$1,204.10', lock: 'Flexible',     tint: 'var(--color-pas-peri)' },
  { name: 'Matched Liquidity', pair: 'MW / ETH',   deposited: '$16,200', apy: '6.2%', earned: '+$638.30',   lock: '90-day cliff', tint: 'var(--color-pas-peach)' },
]

const SPEND = [
  { merchant: 'Blue Bottle Coffee', amt: '$6.80',   when: 'Today · 112ms' },
  { merchant: 'Uber',               amt: '$24.40',  when: 'Yesterday' },
  { merchant: 'Amazon',             amt: '$88.12',  when: 'Aug 12' },
  { merchant: 'Spotify',            amt: '$11.99',  when: 'Aug 10' },
]

function AccountContent() {
  return (
    <div className="min-h-screen bg-white font-atx-display text-ink overflow-x-clip">
      {/* ── Balance hero ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className={`${WRAP} py-[52px] max-sm:py-[40px]`}>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep">Liquid Sovereign Account</div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="w-[6px] h-[6px] rounded-full bg-peri" />Preview · illustrative</span>
          </div>

          <div className="flex justify-between items-end gap-8 mt-5 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-soft">Total balance</div>
              <div className="font-atx-display font-medium text-ink tracking-[-0.03em] leading-[0.9] text-[clamp(2.6rem,7vw,4rem)] mt-2.5 tabular-nums">$48,512</div>
              <div className="text-[13px] text-ink-mid mt-3">Earning and spendable at once · <span className="text-ink font-semibold">principal never touched</span></div>
            </div>
            <div className="flex gap-9 max-sm:gap-6 flex-wrap">
              {TOP.map((m) => (
                <div key={m.l} className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-ink-soft whitespace-nowrap">{m.l}</div>
                  <div className={`font-atx-display font-medium text-[26px] tracking-[-0.02em] mt-1.5 tabular-nums ${m.hl ? 'text-peri-deep' : 'text-ink'}`}>{m.v}</div>
                  <div className="text-[11px] text-ink-soft mt-0.5">{m.sub}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-7 flex-wrap">
            <Link href="/app/vaults" className="glass-pill glass-pill-sm">Deposit →</Link>
            <Link href="/app/swap" className="glass-pill glass-pill-sm">Swap</Link>
            <button disabled title="Coming soon" className="text-[11px] font-semibold text-ink-soft uppercase tracking-[0.06em]">Move money · coming</button>
          </div>
        </div>
      </section>

      {/* ── Earning ── */}
      <div className={`${WRAP} py-8`}>
        <div className={EY}><span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />Earning · your positions</div>
        <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3 mt-5">
          {POSITIONS.map((p) => (
            <div key={p.name} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-[38px] h-[38px] rounded-xl shrink-0 border border-hair" style={{ background: p.tint }} />
                  <div className="min-w-0">
                    <div className="font-atx-display font-semibold text-[15px] text-ink truncate">{p.name}</div>
                    <div className="text-[11px] text-ink-soft mt-0.5 font-mono">{p.pair}</div>
                  </div>
                </div>
                <span className="text-[9px] uppercase tracking-[0.08em] font-semibold rounded-full bg-ground-cool text-ink-soft px-2 py-1 shrink-0">{p.lock}</span>
              </div>
              <div className="flex items-end justify-between gap-4 mt-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">Deposited</div>
                  <div className="font-atx-display font-medium text-[19px] text-ink tabular-nums mt-0.5">{p.deposited}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">APY · earned</div>
                  <div className="text-[13px] mt-0.5"><span className="text-peri-deep font-semibold tabular-nums">{p.apy}</span> <span className="text-mw-green font-semibold tabular-nums">{p.earned}</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-soft mt-4">Illustrative — vaults are in testing on Base Sepolia. Real positions appear here once you deposit into a live pool.</p>
      </div>

      {/* ── Spending ── */}
      <div className="border-y border-hair-soft bg-ground-cool">
        <div className={`${WRAP} py-8`}>
          <div className={EY}><span className="w-[7px] h-[7px] rounded-full bg-peri inline-block" />Spending · your card</div>
          <div className="grid grid-cols-[minmax(0,340px)_1fr] max-[720px]:grid-cols-1 gap-5 mt-5 items-start">
            {/* Card visual */}
            <div>
              <div className="rounded-[20px] p-5 aspect-[1.586] flex flex-col justify-between shadow-lift relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-peri-deep), var(--color-peri) 60%, var(--color-coral2))' }}>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-white"><MintwareMark size={20} tone="inverse" /><span className="font-atx-display font-bold text-[14px] tracking-[-0.02em]">Mintware</span></span>
                  <span className="text-[9px] uppercase tracking-[0.1em] font-semibold text-white/80 border border-white/30 rounded-full px-2 py-0.5">Virtual</span>
                </div>
                <div>
                  <div className="font-mono text-white text-[16px] tracking-[0.12em]">••••  ••••  ••••  4821</div>
                  <div className="flex items-center justify-between mt-2.5">
                    <span className="text-white/85 text-[11px] uppercase tracking-[0.06em]">Your name</span>
                    <span className="text-white/85 text-[11px] font-mono">05/29</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button disabled title="Coming soon" className="glass-pill glass-pill-sm flex-1">Freeze</button>
                <button disabled title="Coming soon" className="glass-pill glass-pill-sm flex-1">Limits</button>
              </div>
            </div>

            {/* Spend feed + how it works */}
            <div>
              <div className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-hair-soft">
                  <span className="font-atx-display font-semibold text-[13.5px] text-ink">Recent spend</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-soft">principal untouched</span>
                </div>
                {SPEND.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-hair-soft last:border-0">
                    <span className="w-[7px] h-[7px] rounded-full bg-mw-green shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-ink truncate">{s.merchant}</div>
                      <div className="text-[10.5px] text-ink-soft">{s.when}</div>
                    </div>
                    <span className="text-[13px] tabular-nums text-ink shrink-0">{s.amt}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 max-[520px]:grid-cols-1 gap-2.5 mt-3">
                {[
                  ['Spend against, not out of', 'Your balance keeps earning while you spend against it.'],
                  ['Principal never touched', 'You draw on yield and liquidity, not your position.'],
                  ['Sub-150ms authorization', 'The same edge-auth engine that decides treasury spend.'],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-3.5">
                    <div className="font-atx-display font-semibold text-[12.5px] text-ink leading-tight">{t}</div>
                    <p className="text-[11.5px] text-ink-mid leading-[1.45] mt-1.5">{d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-ink-soft mt-5">The card and on-chain settlement are in development. The settlement engine (decide → sign → settle) is built off-chain but not yet wired to a funded relayer or a live vault — nothing here is a live card or an offer.</p>
        </div>
      </div>

      {/* ── Reputation cross-link ── */}
      <div className={`${WRAP} py-8`}>
        <Link href="/app/profile" className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-hair bg-white shadow-card p-5 no-underline hover:border-[rgba(108,108,240,0.35)] transition-colors flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="w-[40px] h-[40px] rounded-xl grid place-items-center text-white text-[16px] shrink-0" style={{ background: 'linear-gradient(135deg, var(--color-peri-mid), var(--color-peri))' }}>✴</span>
            <div className="min-w-0">
              <div className="font-atx-display font-semibold text-[15px] text-ink">Your reputation lives on your Profile</div>
              <div className="text-[12.5px] text-ink-mid mt-0.5">Attribution score, signals, and referrals — the identity layer, kept separate from your money.</div>
            </div>
          </div>
          <span className="text-[12px] font-semibold text-peri-deep uppercase tracking-[0.06em] shrink-0">View Profile →</span>
        </Link>
      </div>
    </div>
  )
}

export default function AccountPage() {
  return (
    <>
      <MwNav />
      <MwAuthGuard>
        <AccountContent />
      </MwAuthGuard>
    </>
  )
}
