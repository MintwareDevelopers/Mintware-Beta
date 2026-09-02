'use client'

// /vaults — PURELY EDUCATIONAL (marketing tier). Design v2 (Privy-esque).
// Explains the tech: the Unified Liquidity Vault, the two ways to LP, idle-capital
// yield, pro-rata fees. Functional browse/deposit live in /app/vaults.

import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import Link from 'next/link'
import { VaultAmplify } from '@/components/vaults/VaultAmplify'
import { ULVMechanics } from '@/components/vaults/ULVMechanics'
import { SwapWalkthrough } from '@/components/vaults/SwapWalkthrough'

const VAULTS_LOCKED = process.env.NEXT_PUBLIC_VAULTS_LOCKED === 'true'

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'

const HEAD = ['Liquidity that ', 'never sits idle.'] as const
const SUB = 'Managed liquidity on Uniswap v4. One balance earns three ways at once — Aave lending, swap fees, and recaptured MEV — with an auto-managed range and zero rebalancing. You earn your pro-rata share of everything the pool makes.'
const BULLETS = ['Three income streams — Aave lending + swap fees + recaptured MEV', 'Auto-managed range — no rebalancing', 'MEV-protected — bot value routed back to LPs', 'Paid pro-rata — you earn your share of all three streams, by the size of your stake']
const FEATURED: [string, string, string][] = [['Social Blue-Chip', 'ETH / USDC', '11.0%'], ['Degen Emerging', 'ARB / USDC', '18.4%']]

// The two ways to LP.
const TYPES: { tag: string; name: string; who: string; accent: string; points: string[] }[] = [
  {
    tag: 'For tokens & treasuries', name: 'Growth Vaults', who: 'Single-sided or paired',
    accent: 'var(--color-peri)',
    points: [
      'Deposit one side of the pair — or both. The vault balances it and issues you shares.',
      'Idle capital earns lending yield in Aave; the V4 hook pulls just-in-time liquidity for each swap.',
      'MEV-protected, auto-managed range — no rebalancing, no active management.',
      'You earn your pro-rata share of every fee and recaptured MEV the pool makes — by the size of your position.',
    ],
  },
  {
    tag: 'For teams', name: 'Matched Liquidity', who: 'Two-sided, community-backed',
    accent: 'var(--color-coral2)',
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
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center backdrop-blur-[14px] bg-white/70 font-atx-display">
      <div className="text-center max-w-[380px] px-6">
        <div className="font-atx-display text-[24px] font-semibold tracking-[-0.02em] text-ink mb-2">Vaults — Coming Soon</div>
        <div className="text-[14px] text-ink-mid leading-[1.6] mb-6">
          Managed Uniswap v4 LP vaults — one balance earning lending, swap fees, and recaptured MEV at once.
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-4 py-1.5 text-[12px] font-semibold tracking-[0.06em] uppercase">Phase 2</span>
      </div>
    </div>
  )
}

export default function VaultsPage() {
  return (
    <div className="font-atx-display bg-white min-h-screen text-ink overflow-x-clip">
      {VAULTS_LOCKED && <VaultsComingSoon />}
      <V2Nav active="vaults" />

      {/* ── testnet note ── */}
      <div className="border-b border-hair-soft bg-ground-cool">
        <div className="max-w-[1100px] mx-auto px-6 py-2.5 max-[800px]:px-4 flex items-center gap-2.5 flex-wrap">
          <span className="live-chip"><span className="dot" aria-hidden />In testing on Base Sepolia</span>
          <span className="text-[11px] text-ink-soft">Figures below are illustrative — the mechanism is what’s live.</span>
        </div>
      </div>

      {/* ── HERO ── */}
      <section className="bg-ground-cool border-b border-hair-soft">
        <div className="mx-auto max-w-[1100px] px-6 max-[800px]:px-4 py-[80px] max-[800px]:py-[52px]">
          <h1 className="font-atx-display font-semibold text-ink tracking-[-0.04em] leading-[1.02] text-[clamp(2.2rem,5.4vw,3.9rem)] max-w-[16ch] [text-wrap:balance]">
            {HEAD[0]}<span className="text-gradient-accent">{HEAD[1]}</span>
          </h1>
          <p className="text-ink-mid text-[clamp(1rem,1.6vw,1.2rem)] leading-[1.5] mt-6 max-w-[62ch]">{SUB}</p>

          <div className="grid grid-cols-2 gap-y-2.5 gap-x-8 max-w-[760px] mt-7 max-[560px]:grid-cols-1">
            {BULLETS.map(b => (
              <div key={b} className="flex gap-2.5 items-start text-[14px] leading-[1.4] text-ink-mid">
                <span className="w-[7px] h-[7px] mt-1.5 rounded-full bg-peri inline-block shrink-0" />
                {b}
              </div>
            ))}
          </div>

          <div className={`${ey} mt-9 mb-2.5`}>Example vaults · illustrative</div>
          <div className="grid grid-cols-2 gap-3 max-w-[760px] max-[560px]:grid-cols-1">
            {FEATURED.map(([name, pair, apy]) => (
              <div key={name} className="soft-card p-[18px]" style={{ borderTop: '4px solid var(--color-peri)' }}>
                <div className="font-atx-display text-[17px] font-medium text-ink">{name}</div>
                <div className="text-[11px] text-ink-soft mt-1">{pair}</div>
                <div className="flex items-center justify-between mt-3.5 border-t border-hair-soft pt-3">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-atx-display text-[20px] font-medium text-peri-deep tabular-nums">{apy}</span>
                    <span className="text-[9px] uppercase tracking-[0.1em] text-ink-soft">example APY</span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.08em] font-semibold rounded-full border border-hair text-ink-soft px-3 py-1.5">Example</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/app/vaults" className="glass-pill-primary">Browse the vaults →</Link>
            <a href="#how" className="glass-pill">How it works ↓</a>
          </div>
        </div>
      </section>

      {/* ── the mechanism (tech · ULV · idle-capital yield) ── */}
      <div id="how" className="scroll-mt-[62px]"><ULVMechanics /></div>

      {/* ── worked example — one swap in numbers ── */}
      <SwapWalkthrough />

      {/* ── the two ways to LP ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="max-w-[1100px] mx-auto px-6 py-[72px] max-[800px]:px-4 max-[800px]:py-[52px] mw-reveal">
          <div className={ey}>✴ Two ways to provide liquidity</div>
          <h2 className="font-atx-display font-semibold text-ink tracking-[-0.035em] leading-[1.04] text-[clamp(1.7rem,3.4vw,2.6rem)] mt-3.5 max-w-[20ch] [text-wrap:balance]">
            The same engine, <span className="text-gradient-accent">two different jobs.</span>
          </h2>
          <p className="text-[clamp(15px,1.7vw,18px)] leading-[1.55] text-ink-mid max-w-[62ch] mt-4">
            Every vault runs the same Unified Liquidity engine — idle capital in Aave, JIT liquidity per swap,
            fees split pro-rata by your share. Only who provides the two sides changes.
          </p>

          <div className="grid grid-cols-2 gap-4 mt-9 max-[820px]:grid-cols-1">
            {TYPES.map(t => (
              <div key={t.name} className="soft-card flex flex-col overflow-hidden" style={{ borderTop: `4px solid ${t.accent}` }}>
                <div className="p-5 border-b border-hair-soft">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-atx-display text-[20px] font-medium text-ink">{t.name}</span>
                    <span className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">{t.tag}</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.08em] font-semibold mt-1.5" style={{ color: t.accent }}>{t.who}</div>
                </div>
                <div className="p-5 flex flex-col gap-3">
                  {t.points.map(p => (
                    <div key={p} className="flex gap-2.5 items-start text-[13.5px] leading-[1.5] text-ink-mid">
                      <span className="w-[7px] h-[7px] mt-1.5 rounded-full inline-block shrink-0" style={{ background: t.accent }} />
                      {p}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── the value deep-dive (three income streams · pro-rata · spendable) ── */}
      <VaultAmplify />

      {/* ── closing CTA ── */}
      <section className="bg-white border-b border-hair-soft">
        <div className="max-w-[1100px] mx-auto px-6 py-[72px] max-[800px]:px-4 max-[800px]:py-[52px] mw-reveal">
          <GradientPanel tone="lavender" className="p-10 max-[800px]:p-6 flex items-center justify-between gap-6 flex-wrap">
            <div className="max-w-[46ch]">
              <div className="font-atx-display text-[clamp(1.4rem,2.4vw,2rem)] font-semibold tracking-[-0.02em] leading-[1.1] text-ink [text-wrap:balance]">
                Put your capital <span className="text-gradient-accent">to work.</span>
              </div>
              <p className="text-[15px] text-ink-mid mt-2.5">Browse the live vaults, or open your own — deposits run in the app.</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link href="/app/vaults" className="glass-pill-primary whitespace-nowrap">Browse the vaults →</Link>
              <Link href="/app/vault/create" className="glass-pill whitespace-nowrap">Create a vault</Link>
            </div>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}
