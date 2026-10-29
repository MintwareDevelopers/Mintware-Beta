'use client'

// /vaults — PURELY EDUCATIONAL (marketing tier). Design v2 (Privy-esque).
// Explains the tech: the Unified Liquidity Vault, the two ways to LP, idle-capital
// yield, pro-rata fees. Functional V1 liquidity is available through the LP Gateway.

import { V2Nav } from '@/components/ui2/V2Nav'
import { GradientPanel } from '@/components/ui2/GradientPanel'
import Link from 'next/link'
import { VaultAmplify } from '@/components/vaults/VaultAmplify'
import { ULVMechanics } from '@/components/vaults/ULVMechanics'
import { SwapWalkthrough } from '@/components/vaults/SwapWalkthrough'
import { useV2Mode } from "@/components/web2/V2ModeProvider"
import { V1MarketingStub } from "@/components/web2/V1MarketingStub"
import { LiveTodayStrip } from '@/components/web2/LiveTodayStrip'

const VAULTS_LOCKED = process.env.NEXT_PUBLIC_VAULTS_LOCKED === 'true'

const ey = 'text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep'

const HEAD = ['Liquidity that ', 'never sits idle.'] as const
const SUB = 'Curated Uniswap v4 liquidity through one MarketEngine per pool. Shares are valued in the quote asset; pool liquidity rests in a managed band, with per-token ERC-4626 adapters for capital outside that band.'
const BULLETS = ['Deposit either pool token or both, with a minimum-share floor', 'Deposits require a fresh mark and spot near that mark', 'Withdraw pro-rata in kind, with minimum outputs', 'On Robinhood testnet, adapters hold assets ready and do not earn yield']
const FEATURED: [string, string, string][] = [['Robinhood Chain', 'tUSDG / tPONS', 'Testnet'], ['Base Sepolia', 'MarketEngine', 'Testnet']]

// Current and retired liquidity paths.
const TYPES: { tag: string; name: string; who: string; accent: string; points: string[] }[] = [
  {
    tag: 'Current · testnet', name: 'MarketEngine', who: 'Single- or two-token deposit',
    accent: 'var(--color-peri)',
    points: [
      'Deposit either pool token or both; receive quote-valued MarketEngine shares.',
      'Capital sits in a resting v4 band plus per-token ERC-4626 adapters.',
      'Robinhood testnet adapters are idle-custody adapters: assets are held ready, not earning.',
      'Withdraw pro-rata in kind from both pool tokens, subject to minimum outputs.',
    ],
  },
  {
    tag: 'Retired', name: 'Matched Liquidity', who: 'Not a current product',
    accent: 'var(--color-coral2)',
    points: [
      'Community-matched launch issuance is retired.',
      'The current MarketEngine does not offer lock tiers or matched issuance.',
      'Pool curation and registry records remain available.',
      'External audit gates any use with real value.',
    ],
  },
]

function VaultsComingSoon() {
  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center backdrop-blur-[14px] bg-white/70 font-atx-display">
      <div className="text-center max-w-[380px] px-6">
        <div className="font-atx-display text-[24px] font-semibold tracking-[-0.02em] text-ink mb-2">Vaults — Coming Soon</div>
        <div className="text-[14px] text-ink-mid leading-[1.6] mb-6">
          MarketEngine pool shares are live on Robinhood Chain testnet · unaudited. Withdraw both pool tokens pro-rata.
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[rgba(108,108,240,0.3)] text-peri-deep px-4 py-1.5 text-[12px] font-semibold tracking-[0.06em] uppercase">Phase 2</span>
      </div>
    </div>
  )
}

function VaultsPageV2() {
  return (
    <div className="font-atx-display bg-white min-h-screen text-ink overflow-x-clip">
      {VAULTS_LOCKED && <VaultsComingSoon />}
      <V2Nav active="vaults" />

      {/* ── testnet note ── */}
      <div className="border-b border-hair-soft bg-ground-cool">
        <div className="max-w-[1100px] mx-auto px-6 py-2.5 max-[800px]:px-4 flex items-center gap-2.5 flex-wrap">
          <span className="live-chip"><span className="dot" aria-hidden />Live on Robinhood Chain testnet · unaudited</span>
          <span className="text-[11px] text-ink-soft">Base Sepolia deployment is also available; external audit gates real value.</span>
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

          <div className={`${ey} mt-9 mb-2.5`}>Testnet deployments</div>
          <div className="grid grid-cols-2 gap-3 max-w-[760px] max-[560px]:grid-cols-1">
            {FEATURED.map(([name, pair, apy]) => (
              <div key={name} className="soft-card p-[18px]" style={{ borderTop: '4px solid var(--color-peri)' }}>
                <div className="font-atx-display text-[17px] font-medium text-ink">{name}</div>
                <div className="text-[11px] text-ink-soft mt-1">{pair}</div>
                <div className="flex items-center justify-between mt-3.5 border-t border-hair-soft pt-3">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-atx-display text-[20px] font-medium text-peri-deep tabular-nums">{apy}</span>
                    <span className="text-[9px] uppercase tracking-[0.1em] text-ink-soft">status</span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.08em] font-semibold rounded-full border border-hair text-ink-soft px-3 py-1.5">Example</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mt-9">
            <Link href="/v1" className="glass-pill-primary">Browse the vaults →</Link>
            <a href="#how" className="glass-pill">How it works ↓</a>
          </div>
        </div>
      </section>

      <LiveTodayStrip />

      {/* ── the current MarketEngine mechanics ── */}
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
            Each curated pool has one MarketEngine. Deposits require a fresh oracle mark; withdrawals remain available when the mark is stale.
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
              <p className="text-[15px] text-ink-mid mt-2.5">Explore curated pools and their MarketEngine status. The contracts are unaudited testnet deployments.</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link href="/v1" className="glass-pill-primary whitespace-nowrap">Browse the vaults →</Link>
              <Link href="/curate" className="glass-pill whitespace-nowrap">Curate a pool</Link>
            </div>
          </GradientPanel>
        </div>
      </section>
    </div>
  )
}


export default function VaultsPage() {
  return useV2Mode() ? <VaultsPageV2 /> : <V1MarketingStub topic="Earn" headline="Curated pools, one deposit." blurb="Use a single- or two-token deposit in a curated Robinhood Chain pool. MarketEngine shares track quote-asset value; exits return both pool tokens pro-rata." live={true} />
}
