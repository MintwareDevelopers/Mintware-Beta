'use client'

// =============================================================================
// Homepage — the vault-forward reframe (promoted from /style/landing).
// Concept design + the load-bearing production features woven back in with live
// wiring: wallet search (→ /{address}), Privy email onboarding, WaitlistForm.
// =============================================================================

import React, { useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHero } from '@/components/web2/PageHero'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'

const GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='46' height='46'%3E%3Cpath d='M46 0H0V46' fill='none' stroke='%23111111' stroke-opacity='0.07'/%3E%3C/svg%3E\")"

const SAMPLE_ADDRS = [
  { label: 'vitalik.eth', addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: '0xAb58…eC9B', addr: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B' },
  { label: '0x47ac…D503', addr: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503' },
]

const STATS = [
  { n: '925', k: 'Max score' },
  { n: '100+', k: 'Chains indexed' },
  { n: 'EAS', k: 'Attested on Base' },
  { n: 'Free', k: 'Always' },
]

const AUDIENCES = [
  {
    tag: 'Protocols', star: 'text-atx-blue', sq: 'bg-atx-blue',
    tagCls: 'border-atx-blue bg-atx-blue text-white',
    h: 'You’ve been rewarding the wrong people.',
    p: 'Most emissions go to mercenary farmers. Attribution changes who gets rewarded — and why.',
    bullets: ['Reward contributors, not bots', 'Score-weighted distributions', 'One call: getScore(wallet)'],
  },
  {
    tag: 'People', star: 'text-atx-coral', sq: 'bg-atx-coral',
    tagCls: 'border-atx-ink bg-atx-coral text-atx-ink',
    h: 'You show up every day. DeFi should reward that.',
    p: 'Every LP position, every vote, every referral — invisible to protocols until now.',
    bullets: ['One score across 100+ chains', 'Public profile per wallet', 'Referral network builds rank'],
  },
  {
    tag: 'Agents', star: 'text-atx-mesquite', sq: 'bg-atx-mesquite',
    tagCls: 'border-atx-mesquite bg-atx-mesquite text-atx-bone',
    h: 'Agents transact. Attribution makes them trustworthy.',
    p: 'AI agents are major DeFi participants. Attribution gives them a reputation that compounds.',
    bullets: ['Machine-readable manifests', 'On-chain EAS attestations', 'Reputation that compounds'],
  },
]

const SIGNALS = [
  { n: 'Liquidity', w: '74%', v: '111', c: '#006FCC' },
  { n: 'Volume', w: '41%', v: '41', c: '#006FCC' },
  { n: 'Sharing', w: '58%', v: '232', c: '#FF8574' },
  { n: 'Holding', w: '39%', v: '39', c: '#006FCC' },
]

const ACTIONS = [
  { b: 'Swap', fd: 'Every trade feeds Volume + Trading', pts: 'Volume · Trading', hot: false },
  { b: 'Provide liquidity', fd: 'Real LP positions, held', pts: 'Liquidity · 150', hot: true },
  { b: 'Refer a friend', fd: 'Their activity grows your tree, for life', pts: 'Sharing · 400', hot: true },
  { b: 'Hold quality', fd: 'Conviction — positions over 7 days', pts: 'Holding · 100', hot: false },
  { b: 'Govern', fd: 'Votes and proposals across protocols', pts: 'Governance · 100', hot: false },
  { b: 'Run an agent', fd: 'Machines earn reputation — ERC-8004', pts: 'Agent trust', hot: false },
]


function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z"
      />
    </svg>
  )
}

export default function HomePage() {
  const { isConnected } = useMintwareIdentity()
  const { openConnectModal } = useConnectModal()
  const privy = useMintwarePrivy()
  const router = useRouter()
  const [walletInput, setWalletInput] = useState('')

  // Enter the app: connect first if needed, else route into the authenticated surface.
  function launchApp(dest = '/rewards') {
    if (isConnected) router.push(dest)
    else openConnectModal?.()
  }
  function handlePrivyOnboarding() {
    if (isConnected) { router.push('/rewards'); return }
    if (privy.authenticated) { privy.connectOrCreateWallet(); return }
    privy.login({ loginMethods: ['email'], walletChainType: 'ethereum-only' })
  }
  function handleAnalyze(addr?: string) {
    const target = (addr ?? walletInput).trim().toLowerCase()
    if (target) router.push(`/${target}`)
  }

  const ey = 'font-atx-mono uppercase tracking-[0.16em] text-[11px] text-atx-ink/55'
  const navLink = 'no-underline text-atx-ink/55 hover:text-atx-ink'

  return (
    <div className="font-atx-display bg-atx-bone text-atx-ink min-h-screen [&_*]:rounded-none">
      {/* NAV */}
      <header className="sticky top-0 z-20 bg-atx-bone border-b border-atx-ink">
        <div className="mx-auto max-w-[1220px] px-6 h-[56px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 no-underline text-atx-ink">
            <Star className="w-5 h-5 text-atx-blue" />
            <b className="text-[15px] font-bold tracking-[0.06em]">MINTWARE</b>
          </Link>
          <nav className="hidden md:flex gap-6 font-atx-mono text-[11px] uppercase tracking-[0.14em]">
            <Link href="/vaults" className={navLink}>Vaults</Link>
            <Link href="/swap" className={navLink}>Swap</Link>
            <Link href="/explorer" className={navLink}>Attribution</Link>
            <Link href="/agents" className={navLink}>Agents</Link>
          </nav>
          <div className="flex gap-2.5">
            {privy.enabled && !isConnected && (
              <button onClick={handlePrivyOnboarding} className="cursor-pointer font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-2 border border-atx-ink bg-atx-bone max-md:hidden">Email</button>
            )}
            <button onClick={() => launchApp()} className="cursor-pointer font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-2 border border-atx-blue bg-atx-blue text-white">
              {isConnected ? 'Dashboard →' : 'Launch app →'}
            </button>
          </div>
        </div>
      </header>

      {/* HERO 1 — reputation + wallet search */}
      <PageHero
        eyebrow="On-chain reputation · 100+ chains"
        title={<>Own your share of the <span className="text-atx-blue">market you make.</span></>}
        sub="The same position earns more when your on-chain history is stronger — holding, LPing, referring all lift your share of every pool’s fees. Paste any wallet to see what it’s already built."
      >
          {/* proof strip — honest, evergreen facts (no TVL/wallet-count stats) */}
          <div className="font-atx-mono text-[12px] uppercase tracking-[0.1em] text-atx-ink/55 flex items-center gap-2 flex-wrap">
            <span className="text-atx-ink font-bold">925</span> max score
            <span className="text-atx-ink/30">·</span>
            <span className="text-atx-ink font-bold">100+</span> chains scored
            <span className="text-atx-ink/30">·</span>
            EAS-attested on Base
          </div>

          {/* wallet search */}
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
              <span className={ey}>Try</span>
              {SAMPLE_ADDRS.map((s) => (
                <button key={s.label} onClick={() => { setWalletInput(s.label); handleAnalyze(s.addr) }} className="font-atx-mono text-[11px] text-atx-ink/70 border border-atx-ink px-2.5 py-1 cursor-pointer hover:bg-atx-ink hover:text-atx-bone">
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-7">
            <button onClick={() => launchApp()} className="cursor-pointer font-atx-mono text-[12px] uppercase tracking-[0.08em] px-4 py-3 border border-atx-blue bg-atx-blue text-white">
              {isConnected ? 'Go to the app →' : 'Launch app →'}
            </button>
            {privy.enabled && !isConnected && (
              <button onClick={handlePrivyOnboarding} className="cursor-pointer font-atx-mono text-[12px] uppercase tracking-[0.08em] px-4 py-3 border border-atx-ink bg-atx-coral text-atx-ink">
                Continue with email
              </button>
            )}
          </div>
      </PageHero>

      {/* HERO 2 — two vault products */}
      <section className="border-b border-atx-ink" style={{ backgroundImage: GRID_BG }}>
        <div className="mx-auto max-w-[1180px] px-6 py-[44px]">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className={ey}>✴ Two ways to earn</div>
              <h2 className="font-bold tracking-[-0.02em] leading-[1.04] text-[clamp(26px,3.2vw,42px)] mt-3">
                The same liquidity, <span className="text-atx-blue">two different jobs.</span>
              </h2>
            </div>
            <span className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/55 border border-atx-ink/20 px-2.5 py-1.5">In testing on Base — not yet live</span>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-8 max-[820px]:grid-cols-1">
            {/* Card 1 — Growth Vaults */}
            <div className="border border-atx-ink bg-atx-bone flex flex-col" style={{ borderTop: '4px solid var(--color-atx-blue)' }}>
              <div className="p-5 border-b border-atx-ink/15">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[19px] font-bold">Growth Vaults</span>
                  <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-ink/45">For tokens &amp; treasuries</span>
                </div>
                <p className="text-[14px] leading-[1.5] text-atx-ink/70 mt-2.5">
                  MEV-protected, auto-managed LP on Uniswap V4 — your Attribution score and lock tier lift your fee share up to 1.95× vs. the wallet beside you.
                </p>
              </div>
              <div className="p-5 bg-atx-panel">
                <div className="flex items-baseline justify-between border border-atx-ink px-3.5 py-3 bg-atx-bone">
                  <span className="text-[22px] font-bold tracking-tight">5,000</span>
                  <span className="font-atx-mono text-[11px] text-atx-ink/55">USDC</span>
                </div>
                <div className="mt-3 border-t border-atx-ink/15">
                  <Bdr k="Swap fees + MEV" v="8.5%" />
                  <Bdr k="Idle-capital yield" v="+0.6%" />
                  <div className="flex items-center justify-between py-2 border-b border-atx-ink/10 text-[12px] text-atx-ink/80">
                    <span className="flex items-center gap-2">
                      Your multiplier
                      <span className="font-atx-mono text-[9px] bg-atx-acid border border-atx-ink px-1.5 py-0.5">Builder · 82</span>
                    </span>
                    <span className="font-atx-mono">×1.3</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="font-atx-mono text-[10px] uppercase tracking-[0.14em] text-atx-ink/55">Example APY</span>
                  <span className="font-atx-mono font-bold text-[24px] tracking-tight text-atx-mesquite">10.4%</span>
                </div>
              </div>
              <button onClick={() => launchApp('/vaults')} className="mt-auto w-full py-3 font-atx-mono text-[11px] uppercase tracking-[0.12em] bg-atx-blue text-white border-t border-atx-ink cursor-pointer">
                Browse Growth vaults →
              </button>
            </div>

            {/* Card 2 — Matched Liquidity */}
            <div className="border border-atx-ink bg-atx-bone flex flex-col" style={{ borderTop: '4px solid var(--color-atx-coral)' }}>
              <div className="p-5 border-b border-atx-ink/15">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[19px] font-bold">Matched Liquidity</span>
                  <span className="font-atx-mono text-[10px] uppercase tracking-[0.1em] text-atx-ink/45">For teams</span>
                </div>
                <p className="text-[14px] leading-[1.5] text-atx-ink/70 mt-2.5">
                  Lock your token liquidity. Your community matches it. No early exit — checkable on-chain, not promised. During the lock, your fees flow to the people who backed you.
                </p>
              </div>
              <div className="p-5 bg-atx-panel flex-1">
                <div className="grid grid-cols-2 gap-px bg-atx-ink/15 border border-atx-ink/15">
                  {[['Team locks', 'its own token'], ['Community', 'matches in USDC'], ['Hard cliff', '≥ 90 days'], ['During lock', 'team earns 0%']].map(([k, v]) => (
                    <div key={k} className="bg-atx-bone px-3.5 py-3.5">
                      <div className="font-atx-mono text-[9px] uppercase tracking-[0.1em] text-atx-ink/45">{k}</div>
                      <div className="text-[14px] font-bold mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>
                <p className="font-atx-mono text-[11px] text-atx-ink/50 leading-[1.5] mt-3">
                  A restriction on withdrawal, not a transfer of ownership — enforced by the contract.
                </p>
              </div>
              <Link href="/teams" className="mt-auto w-full py-3 text-center font-atx-mono text-[11px] uppercase tracking-[0.12em] bg-atx-ink text-atx-bone border-t border-atx-ink no-underline cursor-pointer">
                See how it works →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="border-b border-atx-ink grid grid-cols-4 max-[720px]:grid-cols-2">
        {STATS.map((s, i) => (
          <div key={s.k} className={`px-5 py-6 ${i < 3 ? 'border-r border-atx-ink' : ''} max-[720px]:border-b max-[720px]:border-atx-ink`}>
            <div className="font-atx-mono text-[28px] font-bold tracking-[-0.03em]">{s.n}</div>
            <div className="font-atx-mono text-[9px] uppercase tracking-[0.14em] text-atx-ink/55 mt-1.5">{s.k}</div>
          </div>
        ))}
      </section>

      {/* 01 — THREE AUDIENCES */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[52px]">
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-blue">01</span>
            <span className={ey}>Built for everyone</span>
          </div>
          <h2 className="font-bold tracking-[-0.02em] text-[clamp(24px,3vw,38px)] mt-3.5">One score. Three audiences.</h2>
          <div className="grid grid-cols-3 border border-atx-ink mt-7 max-[720px]:grid-cols-1">
            {AUDIENCES.map((a, i) => (
              <div
                key={a.tag}
                className={`p-[22px] ${i < 2 ? 'border-r border-atx-ink max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-atx-ink' : ''}`}
              >
                <div className="flex items-center justify-between mb-[18px]">
                  <Star className={`w-5 h-5 ${a.star}`} />
                  <span className={`font-atx-mono text-[10px] uppercase tracking-[0.1em] px-2.5 py-1.5 border ${a.tagCls}`}>
                    {a.tag}
                  </span>
                </div>
                <h3 className="text-[19px] font-bold tracking-[-0.01em] leading-[1.18]">{a.h}</h3>
                <p className="text-[14px] leading-[1.5] text-atx-ink/55 mt-3">{a.p}</p>
                <div className="mt-[18px] border-t border-atx-ink/20 pt-3.5 flex flex-col gap-1.5">
                  {a.bullets.map((b) => (
                    <div key={b} className="flex items-center gap-2.5 text-[13.5px] py-1.5">
                      <span className={`w-[9px] h-[9px] border border-atx-ink inline-block shrink-0 ${a.sq}`} />
                      {b}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 02 — HOW IT WORKS */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[52px]">
          <div className="flex items-baseline gap-3.5">
            <span className="font-atx-mono text-[12px] text-atx-blue">02</span>
            <span className={ey}>How it works</span>
          </div>
          <h2 className="font-bold tracking-[-0.03em] text-[clamp(24px,3vw,38px)] leading-[1.05] max-w-[22ch] mt-3.5">
            Every swap, every referral, <span className="text-atx-blue">every position — rewarded.</span>
          </h2>
          <p className="text-[16px] leading-[1.55] text-atx-ink/70 max-w-[58ch] mt-3.5">
            {'Your score isn’t a black box — it’s six signals, and everything you already do on-chain feeds them.'}
          </p>
          <div className="grid [grid-template-columns:0.85fr_1.15fr] gap-[26px] mt-7 items-start max-[720px]:grid-cols-1">
            <div className="border border-atx-ink bg-atx-bone">
              <div className="flex items-end justify-between p-[18px] border-b border-atx-ink">
                <div>
                  <div className={ey}>Attribution</div>
                  <div className="font-atx-mono text-[52px] font-bold tracking-[-0.04em] leading-[0.9]">82</div>
                </div>
                <span className="font-atx-mono text-[10px] tracking-[0.06em] bg-atx-acid border border-atx-ink px-2 py-1">Builder · top 5%</span>
              </div>
              <div className="px-[18px] py-4 flex flex-col gap-2.5">
                {SIGNALS.map((s) => (
                  <div key={s.n} className="flex items-center gap-2.5">
                    <span className="font-atx-mono text-[10px] text-atx-ink/55 w-[74px]">{s.n}</span>
                    <span className="flex-1 h-2 border border-atx-ink bg-atx-bone">
                      <span className="block h-full" style={{ width: s.w, background: s.c }} />
                    </span>
                    <span className="font-atx-mono text-[10px] w-7 text-right">{s.v}</span>
                  </div>
                ))}
              </div>
              <div className="font-atx-mono text-[10px] text-atx-mesquite px-[18px] py-3 border-t border-atx-ink/20">
                vaultking.mintware · scored across 6 chains
              </div>
            </div>
            <div>
              <div className={`${ey} mb-2.5`}>What feeds your score</div>
              <div className="border-t border-atx-ink/20">
                {ACTIONS.map((a) => (
                  <div key={a.b} className="flex items-center gap-3.5 py-3.5 border-b border-atx-ink/10">
                    <b className="text-[15px] min-w-[132px] max-[720px]:min-w-[110px]">{a.b}</b>
                    <span className="font-atx-mono text-[10.5px] text-atx-ink/55 flex-1 leading-[1.4]">{a.fd}</span>
                    <span className={`font-atx-mono text-[10px] whitespace-nowrap ${a.hot ? 'bg-atx-acid border border-atx-ink px-1.5 py-1 text-atx-ink' : 'text-atx-blue'}`}>
                      {a.pts}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="font-atx-mono text-[12px] text-atx-mesquite mt-[22px] tracking-[0.02em]">
            <b className="text-atx-blue">↳</b> All six roll into one multiplier — the same ×1.3 you saw on the vault. Nothing you do on-chain is wasted.
          </div>
        </div>
      </section>


      {/* WAITLIST */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[44px] grid [grid-template-columns:1fr_0.9fr] gap-10 items-center max-[720px]:grid-cols-1 max-[720px]:gap-6">
          <div>
            <div className={ey}>✴ Stay in the loop</div>
            <h2 className="font-bold tracking-[-0.02em] text-[clamp(22px,2.6vw,32px)] leading-[1.1] mt-3">
              New vaults, drops, and score boosts — first.
            </h2>
            <p className="text-[15px] text-atx-ink/55 mt-2.5 max-w-[46ch]">Score-holders get priority access. No spam — just the good stuff.</p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      {/* LAUNCH BAND */}
      <section className="border-b border-atx-ink">
        <div className="mx-auto max-w-[1180px] px-6 py-[18px] flex items-center justify-between flex-wrap gap-4">
          <div className="text-[16px] font-bold tracking-[-0.01em] max-w-[30ch]">
            Your wallet already has a history. Come get paid for it.
          </div>
          <button onClick={() => launchApp()} className="cursor-pointer font-atx-mono text-[11px] uppercase tracking-[0.08em] px-3.5 py-2 border border-atx-blue bg-atx-blue text-white">
            {isConnected ? 'Go to the app →' : 'Launch app →'}
          </button>
        </div>
      </section>

    </div>
  )
}

function Bdr({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-atx-ink/10 text-[12px] text-atx-ink/80">
      <span>{k}</span>
      <span className="font-atx-mono">{v}</span>
    </div>
  )
}

// ─── Waitlist form (ATX, on bone) ────────────────────────────────────────────
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
      <div className="font-atx-mono text-[12px] uppercase tracking-[0.08em] py-3.5 px-4 border border-atx-ink bg-atx-acid text-atx-ink">
        ✴ You’re on the list
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex">
        <input
          className="flex-1 py-3.5 px-4 bg-transparent border border-atx-ink border-r-0 font-atx-mono text-[13px] text-atx-ink outline-none focus:bg-white placeholder:text-atx-ink/40"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" disabled={status === 'loading'} className="py-3.5 px-5 bg-atx-blue text-white font-atx-mono text-[12px] uppercase tracking-[0.08em] border border-atx-blue cursor-pointer disabled:opacity-60">
          {status === 'loading' ? '…' : 'Notify me'}
        </button>
      </div>
      {status === 'error' && <div className="font-atx-mono text-[12px] text-atx-clay">{errMsg}</div>}
    </form>
  )
}
