'use client'

// /vaults — PURELY EDUCATIONAL (marketing tier). Explains the tech: the Unified
// Liquidity Vault, the two ways to LP, idle-capital yield, and reputation-weighted
// fees. The functional browse + deposit/create live in the app (/app/vaults).

import { MarketingNav } from '@/components/web2/MarketingNav'
import { PageHero } from '@/components/web2/PageHero'
import Link from 'next/link'
import { VaultAmplify } from '@/components/vaults/VaultAmplify'
import { ULVMechanics } from '@/components/vaults/ULVMechanics'
import { SwapWalkthrough } from '@/components/vaults/SwapWalkthrough'
import { TrustPosture } from '@/components/vaults/TrustPosture'

const VAULTS_LOCKED = process.env.NEXT_PUBLIC_VAULTS_LOCKED === 'true'
const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

const EY = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'

const HEAD = ['Same deposit. Your reputation. ', 'More yield.'] as const
const SUB = 'MEV-protected, auto-managed LP on Uniswap V4. Your Attribution score and lock tier lift your fee share — so the exact same position earns you more than the wallet next to you.'
const BULLETS = ['MEV protection — V4 hooks route bot value back to LPs', 'Auto-managed range — no rebalancing', 'Idle capital routed to yield', 'Reputation fee share, up to 1.95×']
const FEATURED: [string, string, string][] = [['Social Blue-Chip', 'ETH / USDC', '11.0%'], ['Degen Emerging', 'ARB / USDC', '18.4%']]

// The two ways to LP.
const TYPES: { tag: string; name: string; who: string; accent: string; points: string[] }[] = [
  {
    tag: 'For tokens & treasuries', name: 'Growth Vaults', who: 'Single-sided or paired',
    accent: 'var(--color-atx-blue)',
    points: [
      'Deposit one side of the pair — or both. The vault balances it and issues you shares.',
      'Idle capital earns lending yield in Aave; the V4 hook pulls just-in-time liquidity for each swap.',
      'MEV-protected, auto-managed range — no rebalancing, no active management.',
      'Your Attribution score + lock tier lift your fee share up to 1.95× vs. the wallet beside you.',
    ],
  },
  {
    tag: 'For teams', name: 'Matched Liquidity', who: 'Two-sided, community-backed',
    accent: 'var(--color-atx-coral)',
    points: [
      'The team locks its token; the community matches it in USDC — real two-sided depth, not a promise.',
      'A hard ≥ 90-day cliff, enforced on-chain — a restriction on withdrawal, not a transfer of ownership.',
      'During the lock, the fees the position earns go entirely to the people who backed you.',
      'Tighter spreads and better fills from day one, because the depth is actually there.',
    ],
  },
]

function VaultsComingSoon() {
  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center backdrop-blur-[14px] bg-atx-bone/70 font-atx-display [&_*]:rounded-none">
      <div className="text-center max-w-[380px] px-6">
        <div className="text-[24px] font-bold tracking-[-0.5px] text-atx-ink mb-2">Vaults — Coming Soon</div>
        <div className="text-[14px] text-atx-ink/55 leading-[1.6] mb-6">
          Social LP vaults with Attribution-weighted rewards. Earn more based on your on-chain reputation.
        </div>
        <span className="inline-flex items-center gap-1.5 bg-atx-bone border border-atx-ink/25 text-atx-blue px-4 py-1.5 text-[12px] font-semibold tracking-[0.5px] uppercase font-atx-mono">Phase 2</span>
      </div>
    </div>
  )
}

export default function VaultsPage() {
  return (
    <div className="font-atx-display bg-atx-bone min-h-screen text-atx-ink [&_*]:rounded-none">
      {VAULTS_LOCKED && <VaultsComingSoon />}
      <MarketingNav active="vaults" />

      {/* ── testnet note ── */}
      <div className="border-b border-atx-ink bg-atx-panel">
        <div className="max-w-[1100px] mx-auto px-7 py-2.5 max-[800px]:px-4 font-atx-mono text-[11px] text-atx-ink/60 flex items-center gap-2.5 flex-wrap">
          <span className="w-[8px] h-[8px] bg-atx-acid border border-atx-ink inline-block shrink-0" />
          <span className="uppercase tracking-[0.14em]">In testing on Base Sepolia</span>
          <span className="text-atx-ink/45">Figures below are illustrative — the mechanism is what’s live.</span>
        </div>
      </div>

      {/* ── HERO ── */}
      <PageHero
        size="compact"
        eyebrow="DeFi surface · reputation-weighted yield"
        title={<>{HEAD[0]}<span className="text-atx-blue">{HEAD[1]}</span></>}
        sub={SUB}
      >
        <div className="grid grid-cols-2 gap-y-2.5 gap-x-8 max-w-[760px] max-[560px]:grid-cols-1">
          {BULLETS.map(b => (
            <div key={b} className="flex gap-2.5 items-start text-[14px] leading-[1.4]">
              <span className="w-[9px] h-[9px] mt-1 border border-atx-ink inline-block shrink-0 bg-atx-blue" />
              {b}
            </div>
          ))}
        </div>

        <div className={`${EY} mt-8 mb-2.5`}>Example vaults · illustrative</div>
        <div className="grid grid-cols-2 gap-3 max-w-[760px] max-[560px]:grid-cols-1">
          {FEATURED.map(([name, pair, apy]) => (
            <div key={name} className="border border-atx-ink bg-atx-panel p-[18px] border-t-4 border-t-atx-blue mw-lift">
              <div className="text-[17px] font-bold">{name}</div>
              <div className="font-atx-mono text-[11px] text-atx-ink/55 mt-1">{pair}</div>
              <div className="flex items-center justify-between mt-3.5 border-t border-atx-ink/15 pt-3">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-atx-mono text-[20px] font-bold text-atx-blue">{apy}</span>
                  <span className="font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-ink/45">example APY</span>
                </span>
                <span className="font-atx-mono text-[11px] uppercase tracking-[0.08em] border border-atx-ink/40 text-atx-ink/55 px-3 py-1.5">Example</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-8">
          <Link href="/app/vaults" className="font-atx-mono text-[12px] uppercase tracking-[0.09em] px-5 py-3 border border-atx-blue bg-atx-blue text-white no-underline">Browse the vaults →</Link>
          <a href="#how" className="font-atx-mono text-[12px] uppercase tracking-[0.09em] px-5 py-3 border border-atx-ink text-atx-ink no-underline">How it works ↓</a>
        </div>
      </PageHero>

      {/* ── the mechanism (tech · ULV · idle-capital yield) ── */}
      <div id="how"><ULVMechanics /></div>

      {/* ── worked example — one swap in numbers ── */}
      <SwapWalkthrough />

      {/* ── the two ways to LP ── */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="max-w-[1100px] mx-auto px-7 py-[56px] max-[800px]:px-4 mw-reveal">
          <div className={EY}>✴ Two ways to provide liquidity</div>
          <h2 className="font-bold tracking-[-0.02em] leading-[1.04] text-[clamp(26px,3.4vw,42px)] mt-3.5 max-w-[20ch]">
            The same engine, <span className="text-atx-blue">two different jobs.</span>
          </h2>
          <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-atx-ink/70 max-w-[62ch] mt-4">
            Every vault runs the same Unified Liquidity engine — idle capital in Aave, JIT liquidity per swap,
            reputation-weighted fees. What differs is who provides the two sides.
          </p>

          <div className="grid grid-cols-2 gap-4 mt-9 max-[820px]:grid-cols-1">
            {TYPES.map(t => (
              <div key={t.name} className="border border-atx-ink bg-atx-bone flex flex-col mw-lift" style={{ borderTop: `4px solid ${t.accent}` }}>
                <div className="p-5 border-b border-atx-ink/15">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[20px] font-bold">{t.name}</span>
                    <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-ink/45">{t.tag}</span>
                  </div>
                  <div className="font-atx-mono text-[11px] uppercase tracking-[0.08em] mt-1.5" style={{ color: t.accent }}>{t.who}</div>
                </div>
                <div className="p-5 flex flex-col gap-3">
                  {t.points.map(p => (
                    <div key={p} className="flex gap-2.5 items-start text-[13.5px] leading-[1.5] text-atx-ink/75">
                      <span className="w-[8px] h-[8px] mt-1.5 border border-atx-ink inline-block shrink-0" style={{ background: t.accent }} />
                      {p}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── reputation = yield deep-dive ── */}
      <VaultAmplify />

      {/* ── trust · honest current state ── */}
      <TrustPosture />

      {/* ── closing CTA ── */}
      <section className="border-b border-atx-ink">
        <div className="max-w-[1100px] mx-auto px-7 py-11 max-[800px]:px-4 flex items-center justify-between gap-6 flex-wrap mw-reveal">
          <div className="max-w-[46ch]">
            <div className="text-[clamp(22px,2.6vw,32px)] font-bold tracking-[-0.02em] leading-[1.08]">
              Put your reputation to work.
            </div>
            <p className="text-[15px] text-atx-ink/60 mt-2.5">Browse the live vaults, or open your own — deposits run in the app.</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/app/vaults" className="font-atx-mono text-[12px] uppercase tracking-[0.09em] px-6 py-4 border border-atx-blue bg-atx-blue text-white no-underline whitespace-nowrap">Browse the vaults →</Link>
            <Link href="/app/vault/create" className="font-atx-mono text-[12px] uppercase tracking-[0.09em] px-6 py-4 border border-atx-ink text-atx-ink no-underline whitespace-nowrap">Create a vault</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
