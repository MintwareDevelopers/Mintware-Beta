'use client'

import React, { useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

const SAMPLE_ADDRS = [
  { label: 'vitalik.eth',    addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: '0xAb58…eC9B',   addr: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B' },
  { label: '0x47ac…D503',   addr: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503' },
]

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'
const btn = 'font-semibold text-[14px] px-6 py-3 border uppercase tracking-[0.04em] cursor-pointer transition-none'

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

export default function HomePage() {
  const { isConnected } = useMintwareIdentity()
  const { openConnectModal } = useConnectModal()
  const privy = useMintwarePrivy()
  const router = useRouter()
  const [walletInput, setWalletInput] = useState('')

  function handleHeroConnect() {
    if (isConnected) router.push('/profile')
    else openConnectModal?.()
  }
  function handlePrivyOnboarding() {
    if (isConnected) { router.push('/profile'); return }
    if (privy.authenticated) { privy.connectOrCreateWallet(); return }
    privy.login({ loginMethods: ['email'], walletChainType: 'ethereum-only' })
  }
  function handleAnalyze(addr?: string) {
    const target = (addr ?? walletInput).trim().toLowerCase()
    if (target) router.push(`/${target}`)
  }

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink [&_*]:rounded-none">
      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-7 h-[58px] bg-atx-bone border-b border-atx-ink max-md:px-4">
        <Link href="/" className="flex items-center gap-2.5 no-underline text-atx-ink">
          <Star className="w-5 h-5 text-atx-blue" />
          <span className="font-bold text-[16px] tracking-tight">MINTWARE</span>
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {[
            { label: 'Swap', href: '/swap' },
            { label: 'Profile', href: '/profile' },
            { label: 'Earn', href: '/dashboard' },
            { label: 'Leaderboard', href: '/leaderboard' },
          ].map(({ label, href }) =>
            !isConnected ? (
              <button key={label} onClick={() => openConnectModal?.()} className="px-3 py-1.5 font-atx-mono text-[12px] uppercase tracking-[0.08em] text-atx-ink/60 hover:text-atx-ink bg-transparent border-none cursor-pointer">
                {label}
              </button>
            ) : (
              <Link key={label} href={href} className="px-3 py-1.5 font-atx-mono text-[12px] uppercase tracking-[0.08em] text-atx-ink/60 hover:text-atx-ink no-underline">
                {label}
              </Link>
            )
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {privy.enabled && (
            <button onClick={handlePrivyOnboarding} className={`${btn} border-atx-ink bg-transparent text-atx-ink max-md:hidden`}>
              Email
            </button>
          )}
          <button onClick={handleHeroConnect} className={`${btn} border-atx-blue bg-atx-blue text-white`}>
            {isConnected ? 'Dashboard →' : 'Connect'}
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="border-b border-atx-ink pt-[58px]" style={{ backgroundImage: GRID_BG }}>
        <div className="max-w-[1160px] mx-auto px-7 pt-14 pb-12 grid [grid-template-columns:1.5fr_0.85fr] gap-10 items-center max-[900px]:grid-cols-1">
          <div>
            <p className={`${LABEL} mb-4`}>On-chain reputation · 100+ chains</p>
            <h1 className="font-bold tracking-[-0.03em] leading-[0.92] text-[clamp(44px,7vw,88px)] text-wrap-balance">
              Your history should mean <span className="text-atx-blue">something.</span>
            </h1>
            <p className="text-atx-ink/55 text-[16px] max-w-[46ch] mt-5">
              Every interaction. Every position. Every referral. Paste any wallet to see what it&apos;s built.
            </p>

            {/* Search */}
            <div className="mt-8 max-w-[560px]">
              <div className="flex">
                <input
                  type="text"
                  placeholder="0x… wallet address or ENS"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                  className="flex-1 py-3.5 px-4 bg-transparent border border-atx-ink border-r-0 font-atx-mono text-[14px] text-atx-ink outline-none focus:bg-white placeholder:text-atx-ink/40"
                />
                <button onClick={() => handleAnalyze()} title="Analyze" className="px-5 border border-atx-blue bg-atx-blue text-white cursor-pointer">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className={LABEL}>Try</span>
                {SAMPLE_ADDRS.map((s) => (
                  <button key={s.label} onClick={() => { setWalletInput(s.label); handleAnalyze(s.addr) }} className="font-atx-mono text-[11px] text-atx-ink/70 border border-atx-ink px-2.5 py-1 cursor-pointer hover:bg-atx-ink hover:text-atx-bone">
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6 flex-wrap">
              <button onClick={handleHeroConnect} className={`${btn} border-atx-blue bg-atx-blue text-white`}>
                {isConnected ? 'Go to my profile →' : 'Connect your wallet →'}
              </button>
              {privy.enabled && !isConnected && (
                <button onClick={handlePrivyOnboarding} className={`${btn} border-atx-ink bg-atx-coral text-atx-ink`}>
                  Continue with email
                </button>
              )}
            </div>
          </div>

          {/* FIG engineering drawing */}
          <figure className="border border-atx-ink bg-atx-bone m-0 max-[900px]:hidden">
            <svg viewBox="0 0 300 230" className="block w-full h-auto" aria-hidden="true">
              <circle cx="150" cy="110" r="84" fill="none" stroke="#111111" strokeOpacity="0.35" strokeDasharray="3 5" />
              <circle cx="150" cy="110" r="50" fill="#F4FF00" stroke="#111111" />
              <use href="#atxstar" x="112" y="72" width="76" height="76" fill="none" stroke="#111111" strokeWidth="1.5" />
              <line x1="20" y1="110" x2="280" y2="110" stroke="#111111" strokeOpacity="0.3" />
              <line x1="150" y1="20" x2="150" y2="200" stroke="#111111" strokeOpacity="0.3" />
              <circle cx="150" cy="110" r="3" fill="#006FCC" />
            </svg>
            <figcaption className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-ink/55 px-3 py-2.5 border-t border-atx-ink/20">
              FIG 01 · Attribution Score · 0–925
            </figcaption>
          </figure>
        </div>

        {/* Stats title-block */}
        <div className="border-t border-atx-ink grid [grid-template-columns:repeat(4,1fr)] max-[600px]:grid-cols-2">
          {[['24,817', 'Wallets scored'], ['100+', 'Chains indexed'], ['138K', 'Referral links'], ['Free', 'Always']].map(([v, k], i) => (
            <div key={k} className={`px-7 py-4 ${i < 3 ? 'border-r border-atx-ink/20' : ''} max-[600px]:border-b max-[600px]:border-atx-ink/20`}>
              <div className="font-bold text-[24px] tracking-tight">{v}</div>
              <div className={`${LABEL} text-[9px] mt-1`}>{k}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Three audiences ── */}
      <section className="border-b border-atx-ink max-w-[1160px] mx-auto px-7 py-16">
        <div className="flex items-center gap-3.5 mb-8">
          <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">01</span>
          <span className={LABEL}>Built for everyone in DeFi</span>
          <h2 className="ml-auto font-bold text-[clamp(22px,3vw,34px)] tracking-tight max-md:hidden">One score. Three audiences.</h2>
        </div>
        <div className="grid grid-cols-3 border border-atx-ink max-md:grid-cols-1">
          {[
            { tag: 'Protocols', accent: 'var(--color-atx-blue)', h: "You've been rewarding the wrong people.", sub: 'Most emissions go to mercenary farmers. Attribution changes who gets rewarded — and why.', points: ['Reward contributors, not bots', 'Score-weighted distributions', 'One call: getScore(wallet)'] },
            { tag: 'People', accent: 'var(--color-atx-coral)', h: 'You show up every day. DeFi should reward that.', sub: 'Every LP position, every vote, every referral — invisible to protocols until now.', points: ['One score across 100+ chains', 'Public profile per wallet', 'Referral network builds rank'] },
            { tag: 'Agents', accent: 'var(--color-atx-mesquite)', h: 'Agents transact. Attribution makes them trustworthy.', sub: 'AI agents are major DeFi participants. Attribution gives them a reputation that compounds.', points: ['Machine-readable manifests', 'On-chain EAS attestations', 'Reputation that compounds'] },
          ].map((c, i) => (
            <div key={c.tag} className={`p-6 flex flex-col gap-4 ${i < 2 ? 'border-r border-atx-ink max-md:border-r-0 max-md:border-b' : ''}`}>
              <div className="flex items-center justify-between">
                <Star className="w-5 h-5" style={{ color: c.accent }} />
                <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] px-2 py-1 border border-atx-ink" style={{ background: c.accent, color: c.accent === 'var(--color-atx-mesquite)' ? '#F1F0E9' : c.accent === 'var(--color-atx-blue)' ? '#fff' : '#111' }}>{c.tag}</span>
              </div>
              <h3 className="font-bold text-[18px] tracking-tight leading-tight">{c.h}</h3>
              <p className="text-[13px] text-atx-ink/55 leading-relaxed">{c.sub}</p>
              <ul className="flex flex-col gap-2 mt-auto pt-3 border-t border-atx-ink/20">
                {c.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-[13px]">
                    <span className="w-[7px] h-[7px] mt-1.5 border border-atx-ink shrink-0" style={{ background: c.accent }} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="border-b border-atx-ink max-w-[1160px] mx-auto px-7 py-16">
        <div className="flex items-center gap-3.5 mb-8">
          <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">02</span>
          <span className={LABEL}>How it works</span>
        </div>
        <h2 className="font-bold text-[clamp(28px,4vw,50px)] tracking-[-0.02em] leading-[1.02] max-w-[18ch] text-wrap-balance">
          Every wallet has a history. We make it <span className="text-atx-blue">legible.</span>
        </h2>
        <div className="grid grid-cols-4 border border-atx-ink mt-9 max-md:grid-cols-2 max-sm:grid-cols-1">
          {[
            { n: '01', title: 'We read the chain', desc: 'Every LP, swap, vote, and referral — across 100+ chains, indexed in real time.' },
            { n: '02', title: 'We compute a score', desc: 'Six behavioral signals weighted into one score out of 925.' },
            { n: '03', title: 'We attest on-chain', desc: 'Scores published as EAS attestations — verifiable by any contract.' },
            { n: '04', title: 'Protocols distribute', desc: 'Vaults call getScore(wallet) to weight distributions by contribution.' },
          ].map((s, i) => (
            <div key={s.n} className={`p-6 ${i < 3 ? 'border-r border-atx-ink max-md:[&:nth-child(1)]:border-r max-md:[&:nth-child(2)]:border-r-0 max-md:border-b' : 'max-md:border-b'}`}>
              <div className="font-atx-mono text-[12px] text-atx-blue mb-3">{s.n}</div>
              <div className="font-bold text-[16px] tracking-tight mb-2 leading-tight">{s.title}</div>
              <div className="text-[12px] text-atx-ink/55 leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>

        {/* 6 signals */}
        <div className="border border-atx-ink mt-6">
          <div className={`${LABEL} px-[18px] py-3 border-b border-atx-ink/20`}>Six scoring signals</div>
          <div className="grid grid-cols-3 max-md:grid-cols-1">
            {[
              { name: 'Liquidity', pts: 150, color: '#C27A00' }, { name: 'Volume', pts: 100, color: '#006FCC' },
              { name: 'Holding', pts: 100, color: '#2A9E8A' }, { name: 'Trading', pts: 75, color: '#8A8A84' },
              { name: 'Governance', pts: 100, color: '#7B6FCC' }, { name: 'Sharing', pts: 400, color: '#FF8574' },
            ].map((sig, i) => (
              <div key={sig.name} className={`px-[18px] py-4 border-atx-ink/20 ${(i % 3 !== 2) ? 'border-r' : ''} ${i < 3 ? 'border-b' : ''} max-md:border-r-0`}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[14px]">{sig.name}</span>
                  <span className="font-atx-mono text-[13px] text-atx-ink/55">{sig.pts} pts</span>
                </div>
                <span className="block h-2 border border-atx-ink relative">
                  <i className="absolute inset-y-0 left-0 block" style={{ width: `${Math.round((sig.pts / 400) * 100)}%`, background: sig.color }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Attribution ── */}
      <section id="attribution" className="border-b border-atx-ink max-w-[1160px] mx-auto px-7 py-16">
        <div className="grid grid-cols-2 gap-12 items-center max-md:grid-cols-1 max-md:gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-[9px] h-[9px] bg-atx-acid border border-atx-ink inline-block" />
              <span className={LABEL}>Attribution · live now</span>
            </div>
            <h2 className="font-bold text-[clamp(28px,3.5vw,42px)] tracking-[-0.015em] leading-[1.05] mb-3">Your on-chain reputation, finally visible.</h2>
            <p className="text-[15px] text-atx-ink/55 leading-relaxed mb-6 max-w-[46ch]">
              Attribution reads your full on-chain history and computes one score that captures your real contribution to DeFi — not just your balance.
            </p>
            <div className="border border-atx-ink mb-6">
              {[
                ['Wallet score', 'LP behavior, competence, age, network — scored across 100+ chains.'],
                ['Global leaderboard', 'Top score, top earners, top referrers — live rankings.'],
                ['Referral network', 'Refer wallets and build your network. Quality lifts your score.'],
                ['Public profiles', 'Every wallet gets a profile. Paste any address to explore.'],
              ].map(([t, d], i) => (
                <div key={t} className={`flex items-start gap-3 px-4 py-3 ${i ? 'border-t border-atx-ink/20' : ''}`}>
                  <Star className="w-4 h-4 text-atx-blue shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[13px] font-semibold">{t}</div>
                    <div className="text-[12px] text-atx-ink/55 leading-relaxed">{d}</div>
                  </div>
                </div>
              ))}
            </div>
            <Link href="/explorer" className={`${btn} border-atx-blue bg-atx-blue text-white no-underline inline-block`}>Check your score →</Link>
          </div>

          {/* Score card (ink) */}
          <div className="border border-atx-ink bg-atx-ink text-atx-bone">
            <div className="p-6 border-b border-atx-bone/15">
              <div className="font-atx-mono text-[10px] uppercase tracking-[0.12em] text-atx-bone/45 mb-1">Attribution score</div>
              <div className="flex items-start justify-between">
                <div className="font-bold text-[58px] leading-none text-atx-blue tracking-[-0.03em]" style={{ color: '#4d9fff' }}>82</div>
                <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] px-2 py-1 border border-atx-bone/40 mt-1">Builder</span>
              </div>
              <div className="font-atx-mono text-[11px] text-atx-bone/40 mt-1">vaultking.mintware · top 5%</div>
            </div>
            <div className="p-6 flex flex-col gap-2.5">
              {[['LP behavior', '91'], ['DeFi competence', '85'], ['Wallet longevity', '78'], ['Network & referral', '64'], ['Mintware native', '72']].map(([label, val]) => (
                <div key={label} className="flex flex-col gap-1">
                  <div className="flex justify-between font-atx-mono text-[11px] text-atx-bone/45">
                    <span>{label}</span><span style={{ color: '#4d9fff' }}>{val}</span>
                  </div>
                  <span className="block h-1.5 bg-atx-bone/10 relative"><i className="absolute inset-y-0 left-0 block bg-atx-blue" style={{ width: `${val}%` }} /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Mintware / vaults ── */}
      <section id="mintware" className="bg-atx-blue text-white border-b border-atx-ink">
        <div className="max-w-[1160px] mx-auto px-7 py-16 grid grid-cols-2 gap-12 items-start max-md:grid-cols-1 max-md:gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-[9px] h-[9px] bg-atx-acid border border-white inline-block" />
              <span className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-acid">Mintware · coming soon</span>
            </div>
            <h2 className="font-bold text-[clamp(28px,3.5vw,42px)] tracking-[-0.015em] leading-[1.05] mb-3">Where reputation becomes earnings.</h2>
            <p className="text-[15px] text-white/80 leading-relaxed mb-6 max-w-[46ch]">
              Protocols deploy two-surface vaults on Mintware. Your Attribution score determines how rewards flow — the more you contribute, the more you earn.
            </p>
            <div className="flex flex-col gap-2.5 mb-6">
              {[
                ['Two-surface vaults', 'DeFi + RWA on a shared ERC-4626 base. Deposit once.'],
                ['Attribution fee share', 'Your score lifts your share of swap fees up to 2×.'],
                ['MEV protection', 'V4 hooks capture value that would go to bots — back to LPs.'],
                ['Idle-capital routing', 'Reserve auto-routed to yield when not actively LPing.'],
              ].map(([t, d]) => (
                <div key={t} className="flex items-start gap-3 py-1">
                  <Star className="w-4 h-4 text-atx-acid shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[13px] font-semibold">{t}</div>
                    <div className="text-[12px] text-white/70 leading-relaxed">{d}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border border-white/40 p-5">
              <div className="font-bold text-[17px] mb-1">Join the waitlist</div>
              <div className="text-[13px] text-white/70 mb-4">Be first when Mintware vaults go live. Score-holders get priority.</div>
              <WaitlistForm />
            </div>
          </div>

          {/* Vaults preview */}
          <div>
            <div className="font-atx-mono uppercase tracking-[0.14em] text-[11px] text-white/60 mb-3">Vaults preview</div>
            <div className="border border-white">
              {[
                ['Social Blue-Chip', 'ETH / USDC · DeFi', '11.0%'],
                ['LiquidHectar Note', 'vRWA / USDC · RWA', '9.0%'],
                ['Degen Emerging', 'ARB / USDC · DeFi', '18.4%'],
                ['ATX Credit Facility', 'vRWA / USDC · RWA', '10.4%'],
              ].map(([name, pair, apy], i) => (
                <div key={name} className={`flex items-center gap-3.5 px-[18px] py-3.5 ${i ? 'border-t border-white/25' : ''}`}>
                  <Star className="w-4 h-4 text-atx-acid shrink-0" />
                  <div>
                    <div className="text-[14px] font-bold">{name}</div>
                    <div className="font-atx-mono text-[11px] text-white/60 mt-0.5">{pair}</div>
                  </div>
                  <div className="ml-auto font-atx-mono text-[16px] text-atx-acid">{apy}</div>
                </div>
              ))}
              <div className="text-center py-3 font-atx-mono text-[11px] text-white/45 border-t border-white/25">+ more vaults at launch</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Teams ── */}
      <section id="teams" className="border-b border-atx-ink max-w-[1160px] mx-auto px-7 py-16">
        <div className="flex items-center gap-3.5 mb-3">
          <span className="font-atx-mono text-[14px] border border-atx-ink px-3 py-2">03</span>
          <span className={LABEL}>For teams &amp; protocols</span>
        </div>
        <h2 className="font-bold text-[clamp(28px,3.5vw,42px)] tracking-[-0.02em] mb-3">Deploy smarter. Reward better.</h2>
        <p className="text-[15px] text-atx-ink/55 max-w-[52ch] mb-8 leading-relaxed">
          Deploy vaults and reward pools that distribute to participants who actually contribute — not just whoever holds the most tokens.
        </p>
        <div className="grid grid-cols-3 border border-atx-ink mb-8 max-md:grid-cols-1">
          {[
            ['Two-surface vaults', 'Community deposits USDC. Mintware handles MEV capture, range management, and score-weighted distribution.', 'Mintware'],
            ['Reward pools', 'Attribution scores determine who earns and how much. Reward your real community — not bots.', 'Mintware'],
            ['Attribution plugin', "One contract integration. getScore(wallet) routes rewards through your existing infra.", 'Coming soon'],
          ].map(([title, desc, tag], i) => (
            <div key={title as string} className={`p-6 ${i < 2 ? 'border-r border-atx-ink max-md:border-r-0 max-md:border-b' : ''}`}>
              <Star className="w-5 h-5 text-atx-blue mb-3" />
              <div className="font-bold text-[17px] tracking-tight mb-1.5">{title}</div>
              <div className="text-[13px] text-atx-ink/55 leading-relaxed">{desc}</div>
              <span className="inline-block mt-3 font-atx-mono text-[10px] uppercase tracking-[0.08em] px-2 py-1 border border-atx-ink/40">{tag}</span>
            </div>
          ))}
        </div>
        <button className={`${btn} border-atx-ink bg-atx-ink text-atx-bone`}>Join the team waitlist →</button>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-atx-ink text-atx-bone">
        <div className="max-w-[1160px] mx-auto px-7 py-10 flex items-center justify-between flex-wrap gap-5">
          <Link href="/" className="flex items-center gap-2.5 no-underline text-atx-bone">
            <Star className="w-5 h-5 text-atx-acid" />
            <span className="font-bold text-[16px]">MINTWARE</span>
          </Link>
          <div className="flex gap-5 flex-wrap font-atx-mono text-[12px] uppercase tracking-[0.06em]">
            {[
              { href: '/explorer', label: 'Explorer' },
              { href: '/#how-it-works', label: 'How it works' },
              { href: '/for-protocols.html', label: 'Protocols' },
              { href: '/for-agents.html', label: 'Agents' },
              { href: 'https://x.com/Mintware_org', label: 'Twitter', external: true },
            ].map((l) => (
              <a key={l.label} href={l.href} className="text-atx-bone/50 no-underline hover:text-atx-bone" {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}>{l.label}</a>
            ))}
          </div>
          <div className="font-atx-mono text-[11px] text-atx-bone/35">© 2026 Mintware ✴ Powered by Attribution</div>
        </div>
      </footer>

      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <symbol id="atxstar" viewBox="0 0 100 100">
          <path d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
        </symbol>
      </svg>
    </div>
  )
}

// ─── Waitlist form (ATX, on blue) ────────────────────────────────────────────
function WaitlistForm() {
  const [email, setEmail] = React.useState('')
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = React.useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'loading' || status === 'done') return
    setStatus('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Something went wrong')
      setStatus('done')
    } catch (err) {
      setErrMsg((err as Error).message)
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="font-atx-mono text-[12px] uppercase tracking-[0.08em] py-3 px-4 border border-atx-acid bg-atx-acid text-atx-ink">
        ✴ You&apos;re on the list
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex">
        <input
          className="flex-1 py-3 px-3.5 bg-white/10 border border-white/40 border-r-0 font-atx-mono text-[13px] text-white outline-none focus:bg-white/20 placeholder:text-white/40"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" disabled={status === 'loading'} className="py-3 px-5 bg-atx-acid text-atx-ink font-semibold text-[13px] uppercase tracking-[0.04em] border border-atx-acid cursor-pointer disabled:opacity-60">
          {status === 'loading' ? '…' : 'Notify me'}
        </button>
      </div>
      {status === 'error' && <div className="font-atx-mono text-[12px] text-atx-acid">{errMsg}</div>}
    </form>
  )
}
