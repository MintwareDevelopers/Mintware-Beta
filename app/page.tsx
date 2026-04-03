'use client'

import React, { useState } from 'react'
import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const SAMPLE_ADDRS = [
  { label: 'vitalik.eth',    addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: '0xAb58…eC9B',   addr: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B' },
  { label: '0x47ac…D503',   addr: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503' },
]

export default function HomePage() {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()
  const [walletInput, setWalletInput] = useState('')

  function handleHeroConnect() {
    if (isConnected) router.push('/profile')
    else openConnectModal?.()
  }

  function handleAnalyze(addr?: string) {
    const target = (addr ?? walletInput).trim().toLowerCase()
    if (target) router.push(`/${target}`)
  }

  return (
    <>
      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-[52px] py-4 bg-mw-surface/95 backdrop-blur-sm border-b border-mw-border max-md:px-5">
        <Link href="/" className="font-[Georgia,serif] text-[18px] font-bold text-mw-ink no-underline">
          Mint<em className="not-italic text-mw-brand">ware</em>
        </Link>
        {/* Nav links */}
        <div className="hidden md:flex items-center gap-0.5">
          {[
            { label: 'Swap',         href: '/swap',        auth: true },
            { label: 'Profile',      href: '/profile',     auth: true },
            { label: 'Earn',         href: '/dashboard',   auth: true },
            { label: 'Leaderboard',  href: '/leaderboard', auth: true },
          ].map(({ label, href, auth }) => (
            auth && !isConnected ? (
              <button
                key={label}
                onClick={() => openConnectModal?.()}
                className="px-3.5 py-1.5 text-[13px] font-medium text-mw-ink-3 rounded-[8px] transition-all duration-150 hover:bg-[rgba(0,0,0,0.05)] hover:text-mw-ink cursor-pointer bg-transparent border-none"
              >
                {label}
              </button>
            ) : (
              <Link
                key={label}
                href={href}
                className="px-3.5 py-1.5 text-[13px] font-medium text-mw-ink-3 rounded-[8px] transition-all duration-150 hover:bg-[rgba(0,0,0,0.05)] hover:text-mw-ink no-underline"
              >
                {label}
              </Link>
            )
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleHeroConnect}
            className="bg-mw-brand text-white py-2 px-5 rounded-[10px] text-[13px] font-semibold cursor-pointer transition-all duration-150 hover:bg-[#0040cc]"
          >
            {isConnected ? 'Dashboard →' : 'Connect to trade'}
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="flex flex-col items-center justify-center pt-[140px] px-[52px] pb-20 relative overflow-hidden text-center bg-mw-surface max-md:px-5 max-md:pt-[120px] max-md:pb-16">
        <div className="mw-hero-radial" />
        <div className="mw-light-grid" />

        {/* Headline */}
        <h1 className="font-[Georgia,serif] text-[clamp(42px,5.5vw,76px)] font-bold leading-[1.04] tracking-[-2.5px] text-mw-ink max-w-[780px] mx-auto [animation:fadeUp_0.5s_0.06s_ease_both] relative">
          Your history should<br />mean <em className="not-italic text-mw-brand">something.</em>
        </h1>

        <p className="text-[clamp(16px,1.8vw,20px)] font-medium text-mw-ink-3 max-w-[480px] mx-auto leading-[1.55] [animation:fadeUp_0.5s_0.14s_ease_both] relative mt-5">
          Every interaction. Every position. Every referral.<br />
          Paste any wallet to explore it first. Connect only when you&apos;re ready to trade.
        </p>

        {/* Search bar */}
        <div className="w-full max-w-[560px] mt-9 [animation:fadeUp_0.5s_0.22s_ease_both] relative">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-mw-ink-4 text-[15px] pointer-events-none">⬡</span>
              <input
                type="text"
                placeholder="0x… wallet address or ENS"
                value={walletInput}
                onChange={e => setWalletInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                className="w-full py-4 pl-10 pr-4 bg-white border-[1.5px] border-mw-border-strong rounded-[12px] text-[14px] text-mw-ink font-[var(--font-mono),'DM_Mono',monospace] outline-none transition-[border-color,box-shadow] duration-150 focus:border-mw-brand focus:shadow-[0_0_0_3px_rgba(79,126,247,0.12)] placeholder:text-mw-ink-4 placeholder:font-[var(--font-jakarta)] placeholder:font-normal"
              />
            </div>
            <button
              onClick={() => handleAnalyze()}
              className="bg-mw-brand text-white w-[56px] rounded-[12px] flex items-center justify-center shrink-0 cursor-pointer transition-all duration-150 hover:bg-[#0040cc] hover:-translate-y-px self-stretch"
              title="Analyze"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
          </div>
          {/* Sample addresses */}
          <div className="flex items-center gap-2 mt-3 justify-center flex-wrap">
            <span className="text-[11px] text-mw-ink-4">Try:</span>
            {SAMPLE_ADDRS.map(s => (
              <button
                key={s.label}
                onClick={() => { setWalletInput(s.label); handleAnalyze(s.addr) }}
                className="text-[11px] font-mono text-mw-ink-3 bg-white border border-mw-border-strong rounded-full px-2.5 py-[3px] cursor-pointer transition-all duration-150 hover:border-mw-brand hover:text-mw-brand"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Or connect your own */}
        <div className="flex items-center gap-3 mt-6 [animation:fadeUp_0.5s_0.3s_ease_both] relative">
          <button
            onClick={handleHeroConnect}
            className="bg-mw-brand text-white py-3 px-7 rounded-[12px] text-[14px] font-semibold cursor-pointer transition-all duration-150 no-underline inline-block hover:bg-[#0040cc] hover:-translate-y-px"
          >
            {isConnected ? 'Go to my profile →' : 'Connect to trade →'}
          </button>
        </div>

        <p className="text-[12px] text-mw-ink-4 mt-4 max-w-[360px] mx-auto leading-[1.6] [animation:fadeUp_0.5s_0.34s_ease_both] relative">
          You can explore scores, wallets, and rankings without connecting first.
          Connect a wallet only when you want to trade or claim.
        </p>

        {/* Stats strip */}
        <div className="flex items-stretch mt-12 border border-mw-border-strong rounded-[14px] overflow-hidden bg-white shadow-[0_2px_12px_rgba(26,26,46,0.06)] [animation:fadeUp_0.5s_0.38s_ease_both] relative max-md:flex-col">
          {[
            ['24,817',  'Wallets scored'],
            ['100+',    'Chains indexed'],
            ['138K',    'Referral connections'],
            ['Free',    'Always'],
          ].map(([val, label]) => (
            <div key={label} className="py-4 px-8 border-r border-mw-border text-center last:border-r-0 max-md:border-r-0 max-md:border-b max-md:last:border-b-0">
              <div className="font-[Georgia,serif] text-[24px] font-bold text-mw-ink tracking-[-0.5px]">{val}</div>
              <div className="text-[12px] text-mw-ink-3 mt-[3px]">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── For: Protocols / People / Agents ── */}
      <section className="bg-white py-[96px] px-[52px] border-t border-mw-border max-md:py-[72px] max-md:px-5">
        <div className="max-w-[1080px] mx-auto">
          <div className="text-center mb-14">
            <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3 block text-mw-brand">Built for everyone in DeFi</span>
            <h2 className="font-[Georgia,serif] text-[clamp(28px,3vw,44px)] font-bold text-mw-ink tracking-[-1px] leading-[1.1]">One score. Three audiences.</h2>
          </div>
          <div className="grid grid-cols-3 gap-5 max-md:grid-cols-1">
            {[
              {
                tag: 'For protocols',
                tagColor: 'text-mw-brand',
                tagBg: 'bg-mw-brand-dim border-[rgba(79,126,247,0.2)]',
                icon: '🎯',
                h2: "You've been rewarding the wrong people.",
                sub: "Most emissions go to mercenary farmers who leave the moment incentives dry up. Attribution changes who gets rewarded — and why.",
                points: [
                  "Reward actual contributors, not bots",
                  "Score-weighted vault distributions",
                  "One contract: getScore(wallet)",
                ],
              },
              {
                tag: 'For people',
                tagColor: 'text-mw-teal',
                tagBg: 'bg-[rgba(42,158,138,0.08)] border-[rgba(42,158,138,0.2)]',
                icon: '🔍',
                h2: "You show up every day. DeFi should reward that.",
                sub: "Your participation — every LP position, every vote, every referral — has been invisible to protocols. Attribution makes it count.",
                points: [
                  "Single score across 100+ chains",
                  "Public profile for every wallet",
                  "Referral network that builds your rank",
                ],
              },
              {
                tag: 'For agents',
                tagColor: 'text-mw-amber',
                tagBg: 'bg-[rgba(194,122,0,0.08)] border-[rgba(194,122,0,0.2)]',
                icon: '🤖',
                h2: "Agents transact. Attribution makes them trustworthy.",
                sub: "AI agents are becoming major DeFi participants. Attribution gives agents a reputation that compounds over time — and unlocks better terms at every protocol.",
                points: [
                  "Machine-readable score manifests",
                  "On-chain EAS attestations",
                  "Reputation that compounds with activity",
                ],
              },
            ].map(c => (
              <div key={c.tag} className="bg-mw-surface border border-mw-border rounded-[16px] p-7 flex flex-col gap-4 transition-all duration-200 hover:border-mw-border-strong hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between">
                  <span className="text-[28px]">{c.icon}</span>
                  <span className={`text-[10px] font-bold tracking-[0.5px] uppercase py-[3px] px-[9px] rounded-full border ${c.tagColor} ${c.tagBg}`}>{c.tag}</span>
                </div>
                <div>
                  <h3 className="font-[Georgia,serif] text-[18px] font-bold text-mw-ink tracking-[-0.3px] leading-[1.25] mb-2">{c.h2}</h3>
                  <p className="text-[13px] text-mw-ink-3 leading-[1.6]">{c.sub}</p>
                </div>
                <ul className="flex flex-col gap-1.5 mt-auto pt-3 border-t border-mw-border">
                  {c.points.map(p => (
                    <li key={p} className="flex items-start gap-2 text-[12px] text-mw-ink-2">
                      <span className="text-mw-brand mt-px shrink-0">✓</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-mw-surface py-[96px] px-[52px] border-t border-mw-border max-md:py-[72px] max-md:px-5" id="how-it-works">
        <div className="max-w-[1080px] mx-auto">
          <div className="text-center mb-14">
            <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3 block text-mw-ink-3">How it works</span>
            <h2 className="font-[Georgia,serif] text-[clamp(28px,3vw,44px)] font-bold text-mw-ink tracking-[-1px] leading-[1.1]">
              Every wallet has a history.<br />We make it legible.
            </h2>
            <p className="text-[16px] text-mw-ink-3 max-w-[500px] mx-auto mt-4 leading-[1.65]">
              Attribution reads your full on-chain record and translates it into a single verifiable score — attested on-chain and readable by any protocol.
            </p>
          </div>

          {/* 4 steps */}
          <div className="grid grid-cols-4 gap-4 mb-14 max-md:grid-cols-2 max-sm:grid-cols-1">
            {[
              { n: '01', title: 'We read the chain',     desc: 'Every LP position, swap, vote, and referral — across 100+ chains, indexed in real time.' },
              { n: '02', title: 'We compute a score',    desc: 'Six behavioral signals are weighted and combined into a score out of 925.' },
              { n: '03', title: 'We attest on-chain',    desc: 'Scores are published as EAS attestations — verifiable by any smart contract, trustlessly.' },
              { n: '04', title: 'Protocols distribute',  desc: 'Vaults and reward pools call getScore(wallet) to weight distributions by real contribution.' },
            ].map(s => (
              <div key={s.n} className="bg-white border border-mw-border rounded-[14px] p-6 relative overflow-hidden">
                <div className="font-[Georgia,serif] text-[36px] font-bold text-mw-brand/10 tracking-[-1px] absolute top-3 right-4 leading-none select-none">{s.n}</div>
                <div className="text-[11px] font-bold tracking-[1px] uppercase text-mw-brand mb-3">{s.n}</div>
                <div className="font-[Georgia,serif] text-[16px] font-bold text-mw-ink tracking-[-0.2px] mb-2 leading-[1.25]">{s.title}</div>
                <div className="text-[12px] text-mw-ink-3 leading-[1.6]">{s.desc}</div>
              </div>
            ))}
          </div>

          {/* 6 signals */}
          <div className="bg-white border border-mw-border rounded-[16px] p-7">
            <div className="text-[11px] font-bold tracking-[1.5px] uppercase text-mw-ink-3 mb-5">Six scoring signals</div>
            <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2 max-sm:grid-cols-1">
              {[
                { icon: '◈', name: 'Liquidity',    pts: 150, color: '#C27A00'  },
                { icon: '⇄', name: 'Volume',       pts: 100, color: '#3A52CC'  },
                { icon: '◆', name: 'Holding',      pts: 100, color: '#2A9E8A'  },
                { icon: '⬡', name: 'Trading',      pts: 75,  color: '#6B8FFF'  },
                { icon: '⊕', name: 'Governance',   pts: 100, color: '#7B6FCC'  },
                { icon: '◉', name: 'Sharing',      pts: 400, color: '#C2537A'  },
              ].map(sig => (
                <div key={sig.name} className="flex items-center gap-3 p-3.5 bg-mw-surface rounded-[10px] border border-mw-border">
                  <span className="text-[18px] shrink-0" style={{ color: sig.color }}>{sig.icon}</span>
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold text-mw-ink">{sig.name}</div>
                    <div className="h-[3px] mt-1.5 rounded-full" style={{ background: sig.color + '22' }}>
                      <div className="h-full rounded-full" style={{ background: sig.color, width: `${Math.round((sig.pts / 400) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-[12px] font-bold font-mono text-mw-ink-3 shrink-0">{sig.pts} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Attribution dark card ── */}
      <section className="bg-white py-[96px] px-[52px] border-t border-mw-border max-md:py-[72px] max-md:px-5" id="attribution">
        <div className="max-w-[1080px] mx-auto">
          <div className="grid grid-cols-2 gap-16 items-center max-md:grid-cols-1 max-md:gap-10">
            <div>
              <div className="inline-flex items-center gap-1.5 bg-mw-green-muted border border-mw-green-edge rounded-full py-[5px] px-[14px] text-[12px] font-semibold text-mw-green mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-mw-green animate-pulse-slow" />Live now
              </div>
              <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3 block text-mw-green">Attribution</span>
              <h2 className="font-[Georgia,serif] text-[clamp(28px,3.5vw,44px)] font-bold tracking-[-1px] leading-[1.1] mb-3 text-mw-ink">Your on-chain reputation, finally visible</h2>
              <p className="text-[15px] text-mw-ink-3 leading-[1.65] mb-7">Attribution reads your full on-chain history and computes a single score that captures the real picture of your contribution to DeFi — not just your balance.</p>
              <div className="flex flex-col gap-2.5 mb-8">
                {[
                  { icon: '🔍', title: 'Wallet score',       desc: 'LP behavior, DeFi competence, wallet age, network quality — scored across 100+ chains.' },
                  { icon: '🏆', title: 'Global leaderboard', desc: 'See where you rank. Top score, top earners, top referrers — live rankings.' },
                  { icon: '🔗', title: 'Referral network',   desc: 'Refer wallets and build your network. Network quality improves your score.' },
                  { icon: '👤', title: 'Public profiles',    desc: 'Every wallet gets a profile. Paste any address to explore their reputation.' },
                ].map(f => (
                  <div key={f.title} className="flex items-start gap-3 py-3 px-3.5 bg-mw-surface border border-mw-border rounded-[10px] transition-[border-color] duration-150 hover:border-mw-green">
                    <div className="w-7 h-7 rounded-[7px] bg-mw-green-muted flex items-center justify-center text-[14px] shrink-0">{f.icon}</div>
                    <div>
                      <div className="text-[12px] font-semibold text-mw-ink mb-0.5">{f.title}</div>
                      <div className="text-[11px] text-mw-ink-3 leading-[1.5]">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/explorer" className="bg-mw-brand text-white py-3.5 px-7 rounded-[12px] text-[14px] font-semibold cursor-pointer transition-all duration-150 no-underline inline-block hover:bg-[#0040cc] hover:-translate-y-px">
                Check your score →
              </Link>
            </div>

            {/* Score card */}
            <div className="bg-mw-ink rounded-[20px] p-7">
              <div className="text-[10px] text-[rgba(255,255,255,0.22)] font-mono tracking-[1px] uppercase mb-1">Attribution score</div>
              <div className="flex items-start justify-between mb-1">
                <div>
                  <div className="font-[Georgia,serif] text-[58px] font-bold text-mw-brand tracking-[-2px] leading-[1]">82</div>
                </div>
                <div className="text-[11px] font-semibold bg-mw-brand-mid text-[#6b9fff] py-1 px-3 rounded-full border border-[rgba(0,82,255,0.25)] mt-1">Builder tier</div>
              </div>
              <div className="text-[11px] text-[rgba(255,255,255,0.2)] font-mono mb-5">vaultking.mintware · top 5%</div>
              <div className="flex flex-col gap-2.5 mb-5">
                {[['LP behavior','91'],['DeFi competence','85'],['Wallet longevity','78'],['Network & referral','64'],['Mintware native','72']].map(([label, val]) => (
                  <div key={label} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[11px] text-[rgba(255,255,255,0.28)]">
                      <span>{label}</span>
                      <span className="text-mw-brand font-mono">{val}</span>
                    </div>
                    <div className="h-[3px] bg-[rgba(255,255,255,0.07)] rounded overflow-hidden">
                      <div className="h-full bg-mw-brand rounded" style={{width: val+'%'}} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-[rgba(255,255,255,0.22)] mb-[3px]">Lifetime earnings</div>
                  <div className="font-mono text-[18px] font-medium text-[#4ade80]">$2,760.24</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-[rgba(255,255,255,0.22)] mb-[3px]">This month</div>
                  <div className="font-mono text-[13px] text-[rgba(255,255,255,0.32)]">+$184.50</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Mintware (dark) ── */}
      <section className="bg-mw-dark py-[96px] px-[52px] max-md:py-[72px] max-md:px-5" id="mintware">
        <div className="max-w-[1080px] mx-auto">
          <div className="grid grid-cols-2 gap-16 items-center max-md:grid-cols-1 max-md:gap-10">
            <div>
              <div className="inline-flex items-center gap-1.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.09)] rounded-full py-[5px] px-[14px] text-[12px] font-semibold text-[rgba(255,255,255,0.28)] mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,165,0,0.7)]" />Coming soon
              </div>
              <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3 block text-[rgba(255,255,255,0.25)]">Mintware</span>
              <h2 className="font-[Georgia,serif] text-[clamp(28px,3.5vw,44px)] font-bold tracking-[-1px] leading-[1.1] mb-3 text-mw-dark-text">Where reputation becomes earnings</h2>
              <p className="text-[15px] text-mw-dark-sub leading-[1.65] mb-7">Protocols deploy vaults and reward pools on Mintware. Your Attribution score determines how rewards flow to you — the more you've contributed, the more you earn.</p>
              <div className="flex flex-col gap-3 mb-7">
                {[
                  { icon: '🏦', title: 'Social LP vaults',       desc: 'Deposit USDC. Teams seed the token side. Your score weights your share of fees and MEV capture.' },
                  { icon: '🎯', title: 'Reward pools',            desc: 'Token teams deploy pools. Distributions flow to participants weighted by contribution — not holdings.' },
                  { icon: '⚡', title: 'MEV capture',             desc: 'Uniswap V4 hooks redirect value that would normally go to bots back to LPs.' },
                  { icon: '🤖', title: 'AI range management',     desc: 'Concentrated liquidity optimized automatically. No manual management required.' },
                ].map(f => (
                  <div key={f.title} className="flex items-start gap-3 py-3">
                    <div className="w-7 h-7 rounded-[7px] bg-[rgba(0,82,255,0.12)] flex items-center justify-center text-[14px] shrink-0">{f.icon}</div>
                    <div>
                      <div className="text-[12px] font-semibold text-[rgba(255,255,255,0.7)] mb-0.5">{f.title}</div>
                      <div className="text-[11px] text-[rgba(255,255,255,0.28)] leading-[1.5]">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-[14px] p-6">
                <div className="font-[Georgia,serif] text-[18px] font-bold text-mw-dark-text mb-1 tracking-[-0.3px]">Join the waitlist</div>
                <div className="text-[13px] text-[rgba(255,255,255,0.28)] mb-4 leading-[1.5]">Be first when Mintware vaults go live. Attribution score-holders get priority access.</div>
                <WaitlistForm />
              </div>
            </div>

            {/* Vaults preview */}
            <div>
              <div className="text-[11px] font-bold tracking-[1px] text-[rgba(255,255,255,0.18)] uppercase mb-3">Vaults preview</div>
              <div className="flex flex-col gap-2.5">
                {[
                  { icon: '🐸', name: 'Pepe vault',  pair: 'PEPE / USDC · Ethereum', apr: '28.4%', bg: 'rgba(34,197,94,0.1)'   },
                  { icon: '🐕', name: 'Doge vault',  pair: 'DOGE / USDC · Base',     apr: '21.2%', bg: 'rgba(251,191,36,0.1)'  },
                  { icon: '🐱', name: 'Keke vault',  pair: 'KEKE / USDC · Base',     apr: '34.1%', bg: 'rgba(168,85,247,0.1)'  },
                  { icon: '🦴', name: 'Bonk vault',  pair: 'BONK / USDC · Sonic',    apr: '41.8%', bg: 'rgba(249,115,22,0.1)'  },
                ].map(v => (
                  <div key={v.name} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.04)] rounded-[12px] py-3.5 px-[18px] flex items-center gap-3.5 transition-[border-color] duration-150 hover:border-[rgba(0,82,255,0.25)]">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[17px] shrink-0 border border-mw-dark-border" style={{background: v.bg}}>{v.icon}</div>
                    <div>
                      <div className="text-[13px] font-bold text-mw-dark-text">{v.name}</div>
                      <div className="text-[11px] text-[rgba(255,255,255,0.28)] mt-0.5 font-mono">{v.pair}</div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-[15px] font-bold text-[#4ade80] font-mono">{v.apr}</div>
                      <div className="text-[10px] text-[rgba(255,255,255,0.22)] mt-px">APR</div>
                    </div>
                  </div>
                ))}
                <div className="text-center py-3 text-[12px] text-[rgba(255,255,255,0.16)]">+ more vaults at launch</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Teams ── */}
      <section className="bg-mw-surface py-[96px] px-[52px] border-t border-mw-border max-md:py-[72px] max-md:px-5" id="teams">
        <div className="text-center max-w-[1080px] mx-auto">
          <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3 block text-mw-brand">For teams &amp; protocols</span>
          <h2 className="font-[Georgia,serif] text-[clamp(28px,3vw,42px)] font-bold text-mw-ink tracking-[-1px] mb-3">Deploy smarter. Reward better.</h2>
          <p className="text-[15px] text-mw-ink-3 max-w-[480px] mx-auto mb-10 leading-[1.65]">Use Mintware to deploy vaults and reward pools that distribute to participants who actually contribute — not just whoever holds the most tokens.</p>
          <div className="grid grid-cols-3 gap-4 mb-10 max-md:grid-cols-1">
            {[
              { icon: '🏦', title: 'Social LP vaults',    desc: 'Commit your tokens upfront. Community deposits USDC. Mintware handles MEV capture, AI range management, and score-weighted distribution.', tag: 'Mintware',    tagCls: 'bg-mw-brand-dim text-mw-brand' },
              { icon: '🎯', title: 'Reward pools',         desc: 'Deploy a reward pool. Attribution scores determine who earns and how much. Reward your real community — not bots and farmers.',              tag: 'Mintware',    tagCls: 'bg-mw-brand-dim text-mw-brand' },
              { icon: '🔗', title: 'Attribution plugin',   desc: "One contract integration. Attribution's getScore(wallet) routes rewards through your existing protocol infrastructure.",                     tag: 'Coming soon', tagCls: 'bg-[rgba(26,26,46,0.06)] text-mw-ink-3' },
            ].map(c => (
              <div key={c.title} className="bg-white border border-mw-border rounded-[14px] p-6 text-left transition-all duration-150 hover:border-mw-brand hover:-translate-y-0.5">
                <span className="text-[24px] mb-3 block">{c.icon}</span>
                <div className="font-[Georgia,serif] text-[17px] font-bold text-mw-ink mb-1.5 tracking-[-0.2px]">{c.title}</div>
                <div className="text-[13px] text-mw-ink-3 leading-[1.6]">{c.desc}</div>
                <span className={`inline-block mt-3 text-[10px] font-bold tracking-[0.5px] uppercase py-[3px] px-[9px] rounded-full ${c.tagCls}`}>{c.tag}</span>
              </div>
            ))}
          </div>
          <button className="bg-mw-ink text-white py-3.5 px-8 rounded-[12px] text-[15px] font-semibold cursor-pointer transition-[background] duration-150 hover:bg-mw-brand">
            Join the team waitlist →
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-mw-ink border-t border-mw-dark-border py-11 px-[52px] flex items-center justify-between flex-wrap gap-5 max-md:py-8 max-md:px-5">
        <Link href="/" className="font-[Georgia,serif] text-[18px] font-bold text-mw-dark-text flex items-center gap-2 no-underline">
          <div className="w-[22px] h-[22px] rounded-[5px] bg-mw-brand flex items-center justify-center">
            <svg viewBox="0 0 14 14" width="13" height="13" fill="white"><path d="M7 1L13 4.5V9.5L7 13L1 9.5V4.5Z"/></svg>
          </div>
          Mintware
        </Link>
        <div className="flex gap-6 flex-wrap">
          {[
            { href: '/explorer',         label: 'Attribution Explorer' },
            { href: '/#how-it-works',    label: 'How it works' },
            { href: '/for-protocols.html', label: 'For protocols' },
            { href: '/for-agents.html',  label: 'For agents' },
            { href: '#',                 label: 'GitHub',  external: true },
            { href: 'https://x.com/Mintware_org', label: 'Twitter', external: true },
            { href: '#',                 label: 'Discord', external: true },
          ].map(l => (
            <a
              key={l.label}
              href={l.href}
              className="text-[13px] text-[rgba(255,255,255,0.28)] no-underline transition-[color] duration-150 hover:text-[rgba(255,255,255,0.8)]"
              {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
            >{l.label}</a>
          ))}
        </div>
        <div className="text-[12px] text-[rgba(255,255,255,0.16)]">© 2026 Mintware. Powered by Attribution.</div>
      </footer>
    </>
  )
}

// ─── Waitlist form ─────────────────────────────────────────────────────────────
function WaitlistForm() {
  const [email,  setEmail]  = React.useState('')
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = React.useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'loading' || status === 'done') return
    setStatus('loading')
    setErrMsg('')
    try {
      const res  = await fetch('/api/waitlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Something went wrong')
      setStatus('done')
    } catch (err) {
      setErrMsg((err as Error).message)
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="flex items-center gap-2 py-[11px] px-4 bg-[rgba(22,163,74,0.12)] border border-[rgba(22,163,74,0.25)] rounded-[10px] text-[13px] font-semibold text-[#4ade80]">
        ✓ You&apos;re on the list
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className="flex-1 py-[11px] px-3.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded-[10px] text-[13px] text-mw-dark-text outline-none font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-[border-color] duration-150 focus:border-[rgba(0,82,255,0.5)] placeholder:text-[rgba(255,255,255,0.18)]"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="py-[11px] px-5 bg-mw-brand text-white rounded-[10px] text-[13px] font-semibold cursor-pointer transition-[background] duration-150 hover:bg-[#0040cc] disabled:opacity-60 font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif]"
        >
          {status === 'loading' ? '…' : 'Notify me'}
        </button>
      </div>
      {status === 'error' && (
        <div className="text-[12px] text-[#f87171]">{errMsg}</div>
      )}
    </form>
  )
}
