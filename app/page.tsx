'use client'

import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function HomePage() {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()

  async function handleHeroConnect() {
    if (isConnected) {
      router.push('/profile')
    } else {
      openConnectModal?.()
    }
  }

  return (
    <>
      {/* ── Hero ── */}
      <section className="flex flex-col items-center justify-center pt-[72px] px-[52px] pb-20 relative overflow-hidden text-center bg-mw-surface max-md:px-5 max-md:pt-[110px] max-md:pb-16">
        <div className="mw-hero-radial" />
        <div className="mw-light-grid" />

        <div className="font-[Georgia,serif] text-[clamp(48px,6vw,64px)] font-bold text-mw-ink tracking-[-2px] mb-9 relative [animation:fadeUp_0.4s_ease_both]">
          Mintware
        </div>

        <div className="inline-flex items-center gap-2 mb-7 animate-fade-up relative">
          <div className="inline-flex items-center gap-1.5 rounded-full py-1 px-3 text-[12px] font-semibold bg-white border border-mw-border-strong text-mw-ink-2 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-mw-green animate-pulse-slow" />
            Attribution — live now
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full py-1 px-3 text-[12px] font-semibold bg-[rgba(26,26,46,0.06)] border border-mw-border-strong text-mw-ink-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,165,0,0.7)]" />
            Mintware — coming soon
          </div>
        </div>

        <h1 className="font-[Georgia,serif] text-[clamp(42px,5.5vw,80px)] font-bold leading-[1.05] tracking-[-2px] text-mw-ink max-w-[780px] mx-auto [animation:fadeUp_0.5s_0.08s_ease_both] relative">
          The reputation economy<br /><em className="not-italic text-mw-brand">of DeFi</em>
        </h1>

        <p className="text-[clamp(17px,2vw,22px)] font-medium text-mw-ink-2 max-w-[520px] mx-auto leading-[1.5] [animation:fadeUp_0.5s_0.16s_ease_both] relative mt-5">
          Attribution measures every contribution.<br />
          <span className="text-mw-ink-3 font-normal">Mintware is where those contributions earn rewards.</span>
        </p>

        <div className="grid grid-cols-2 gap-3 max-w-[680px] mx-auto mt-10 [animation:fadeUp_0.5s_0.24s_ease_both] relative max-md:grid-cols-1">
          <div className="rounded-[14px] p-[22px] text-left bg-white border-[1.5px] border-mw-border-strong">
            <div className="text-[10px] font-bold tracking-[1.5px] uppercase mb-2 flex items-center gap-[7px] text-mw-green">
              <span>Attribution</span>
              <span className="text-[9px] font-bold py-0.5 px-[7px] rounded-full bg-mw-green-muted text-mw-green border border-mw-green-edge">● Live</span>
            </div>
            <div className="font-[Georgia,serif] text-[17px] font-bold tracking-[-0.3px] mb-1.5 text-mw-ink">Reputation layer</div>
            <div className="text-[13px] leading-[1.6] text-mw-ink-3">Connect your wallet. Get your on-chain reputation score. See where you rank across DeFi.</div>
          </div>
          <div className="rounded-[14px] p-[22px] text-left bg-[rgba(26,26,46,0.04)] border-[1.5px] border-mw-border-strong">
            <div className="text-[10px] font-bold tracking-[1.5px] uppercase mb-2 flex items-center gap-[7px] text-mw-ink-3">
              <span>Mintware</span>
              <span className="text-[9px] font-bold py-0.5 px-[7px] rounded-full bg-[rgba(26,26,46,0.06)] text-mw-ink-3 border border-mw-border-strong">Coming soon</span>
            </div>
            <div className="font-[Georgia,serif] text-[17px] font-bold tracking-[-0.3px] mb-1.5 text-mw-ink">Economic layer</div>
            <div className="text-[13px] leading-[1.6] text-mw-ink-3">Protocols deploy vaults and reward pools. Your score determines how rewards flow to you.</div>
          </div>
        </div>

        <div className="flex items-center gap-3 justify-center mt-9 [animation:fadeUp_0.5s_0.32s_ease_both] relative">
          <button
            className="bg-mw-brand text-white py-3.5 px-8 rounded-[12px] text-[15px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-all duration-150 no-underline inline-block hover:bg-[#0040cc] hover:-translate-y-px"
            onClick={handleHeroConnect}
          >
            {isConnected ? 'Go to profile →' : 'Connect wallet →'}
          </button>
          <Link
            className="bg-white text-mw-ink border-[1.5px] border-mw-border-strong py-3.5 px-8 rounded-[12px] text-[15px] font-semibold cursor-pointer transition-all duration-150 no-underline inline-block hover:border-mw-ink hover:-translate-y-px"
            href="/explorer"
          >
            Explore a wallet
          </Link>
        </div>

        <div className="flex items-stretch mt-14 border border-mw-border-strong rounded-[14px] overflow-hidden bg-white shadow-[0_2px_12px_rgba(26,26,46,0.06)] [animation:fadeUp_0.5s_0.4s_ease_both] relative max-md:flex-col">
          {[
            ['24,817', 'Wallets scored'],
            ['100+', 'Chains indexed'],
            ['138K', 'Referral connections'],
            ['Free', 'Always'],
          ].map(([val, label]) => (
            <div key={label} className="py-4 px-8 border-r border-mw-border text-center last:border-r-0 max-md:border-r-0 max-md:border-b max-md:last:border-b-0">
              <div className="font-[Georgia,serif] text-[24px] font-bold text-mw-ink tracking-[-0.5px]">{val}</div>
              <div className="text-[12px] text-mw-ink-3 mt-[3px]">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Attribution ── */}
      <section className="bg-white py-[100px] px-[52px] border-t border-mw-border max-md:py-[72px] max-md:px-5" id="attribution">
        <div className="max-w-[1080px] mx-auto">
          <div className="grid grid-cols-2 gap-20 items-center max-md:grid-cols-1 max-md:gap-10">
            <div>
              <div className="inline-flex items-center gap-1.5 bg-mw-green-muted border border-mw-green-edge rounded-full py-[5px] px-[14px] text-[12px] font-semibold text-mw-green mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-mw-green animate-pulse-slow" />Live now
              </div>
              <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3.5 block text-mw-green">Attribution</span>
              <h2 className="font-[Georgia,serif] text-[clamp(30px,3.5vw,48px)] font-bold tracking-[-1px] leading-[1.1] mb-3.5 text-mw-ink">Your on-chain reputation, finally visible</h2>
              <p className="text-[16px] text-mw-ink-3 leading-[1.65] mb-7">Attribution reads your full on-chain history and computes a single score that captures the real picture of your contribution to DeFi — not just your balance.</p>
              <div className="flex flex-col gap-3 mb-8">
                {[
                  { icon: '🔍', title: 'Wallet score', desc: 'LP behavior, DeFi competence, wallet age, network quality — scored across 100+ chains.' },
                  { icon: '🏆', title: 'Global leaderboard', desc: 'See where you rank. Top score, top earners, top referrers, rising fast — live rankings.' },
                  { icon: '🔗', title: 'Referral network', desc: 'Refer wallets and build your network. Network quality improves your score.' },
                  { icon: '👤', title: 'Public profiles', desc: 'Every wallet gets a profile. Paste any address to explore their reputation and rank.' },
                ].map(f => (
                  <div key={f.title} className="flex items-start gap-3 py-3.5 px-4 bg-mw-surface border border-mw-border rounded-[10px] transition-[border-color] duration-150 hover:border-mw-green">
                    <div className="w-8 h-8 rounded-[8px] bg-mw-green-muted flex items-center justify-center text-[15px] shrink-0">{f.icon}</div>
                    <div>
                      <div className="text-[13px] font-semibold text-mw-ink mb-0.5">{f.title}</div>
                      <div className="text-[12px] text-mw-ink-3 leading-[1.5]">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link className="bg-mw-brand text-white py-3.5 px-8 rounded-[12px] text-[15px] font-semibold cursor-pointer transition-all duration-150 no-underline inline-block hover:bg-[#0040cc] hover:-translate-y-px" href="/explorer" style={{width:'fit-content'}}>
                Check your score →
              </Link>
            </div>

            <div className="bg-mw-ink rounded-[20px] p-7">
              <div className="text-[10px] text-[rgba(255,255,255,0.22)] font-[var(--font-mono),'DM_Mono',monospace] tracking-[1px] uppercase mb-1">Attribution score</div>
              <div className="flex items-start justify-between mb-1">
                <div>
                  <div className="font-[Georgia,serif] text-[58px] font-bold text-mw-brand tracking-[-2px] leading-[1]">82</div>
                </div>
                <div className="text-[11px] font-semibold bg-mw-brand-mid text-[#6b9fff] py-1 px-3 rounded-full border border-[rgba(0,82,255,0.25)] mt-1">Builder tier</div>
              </div>
              <div className="text-[11px] text-[rgba(255,255,255,0.2)] font-[var(--font-mono),'DM_Mono',monospace] mb-5">vaultking.mintware · top 5%</div>
              <div className="flex flex-col gap-2.5 mb-5">
                {[['LP behavior','91'],['DeFi competence','85'],['Wallet longevity','78'],['Network & referral','64'],['Mintware native','72']].map(([label, val]) => (
                  <div key={label} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[11px] text-[rgba(255,255,255,0.28)]">
                      <span>{label}</span>
                      <span className="text-mw-brand font-[var(--font-mono),'DM_Mono',monospace]">{val}</span>
                    </div>
                    <div className="h-[3px] bg-[rgba(255,255,255,0.07)] rounded-[2px] overflow-hidden">
                      <div className="h-full bg-mw-brand rounded-[2px]" style={{width: val+'%'}} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-[rgba(255,255,255,0.22)] mb-[3px]">Lifetime earnings</div>
                  <div className="font-[var(--font-mono),'DM_Mono',monospace] text-[18px] font-medium text-[#4ade80]">$2,760.24</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-[rgba(255,255,255,0.22)] mb-[3px]">This month</div>
                  <div className="font-[var(--font-mono),'DM_Mono',monospace] text-[13px] text-[rgba(255,255,255,0.32)]">+$184.50</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Mintware ── */}
      <section className="bg-mw-dark py-[100px] px-[52px] max-md:py-[72px] max-md:px-5" id="mintware">
        <div className="max-w-[1080px] mx-auto">
          <div className="grid grid-cols-2 gap-20 items-center max-md:grid-cols-1 max-md:gap-10">
            <div>
              <div className="inline-flex items-center gap-1.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.09)] rounded-full py-[5px] px-[14px] text-[12px] font-semibold text-[rgba(255,255,255,0.28)] mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,165,0,0.7)]" />Coming soon
              </div>
              <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3.5 block text-[rgba(255,255,255,0.25)]">Mintware</span>
              <h2 className="font-[Georgia,serif] text-[clamp(30px,3.5vw,48px)] font-bold tracking-[-1px] leading-[1.1] mb-3.5 text-mw-dark-text">Where reputation becomes earnings</h2>
              <p className="text-[16px] text-mw-dark-sub leading-[1.65] mb-7">Protocols deploy vaults and reward pools on Mintware. Your Attribution score determines how rewards flow to you — the more you've contributed, the more you earn.</p>
              <div className="flex flex-col gap-3 mb-7">
                {[
                  { icon: '🏦', title: 'Social LP vaults', desc: 'Deposit USDC. Teams seed the token side. Your score weights your share of fees and MEV capture.' },
                  { icon: '🎯', title: 'Reward pools', desc: 'Token teams deploy pools. Distributions flow to participants weighted by contribution — not holdings.' },
                  { icon: '⚡', title: 'MEV capture', desc: 'Uniswap V4 hooks redirect value that would normally go to bots back to LPs.' },
                  { icon: '🤖', title: 'AI range management', desc: 'Concentrated liquidity optimized automatically. No manual management required.' },
                ].map(f => (
                  <div key={f.title} className="flex items-start gap-3 py-3.5">
                    <div className="w-8 h-8 rounded-[8px] bg-[rgba(0,82,255,0.12)] flex items-center justify-center text-[15px] shrink-0">{f.icon}</div>
                    <div>
                      <div className="text-[13px] font-semibold text-[rgba(255,255,255,0.7)] mb-0.5">{f.title}</div>
                      <div className="text-[12px] text-[rgba(255,255,255,0.28)] leading-[1.5]">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-[14px] p-6">
                <div className="font-[Georgia,serif] text-[18px] font-bold text-mw-dark-text mb-1.5 tracking-[-0.3px]">Join the waitlist</div>
                <div className="text-[13px] text-[rgba(255,255,255,0.28)] mb-4 leading-[1.5]">Be first when Mintware vaults go live. Attribution score-holders get priority access.</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 py-[11px] px-3.5 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded-[10px] text-[13px] text-mw-dark-text outline-none font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-[border-color] duration-150 focus:border-[rgba(0,82,255,0.5)] placeholder:text-[rgba(255,255,255,0.18)]"
                    type="email"
                    placeholder="your@email.com"
                  />
                  <WaitlistButton />
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold tracking-[1px] text-[rgba(255,255,255,0.18)] uppercase mb-3">Vaults preview</div>
              <div className="flex flex-col gap-2.5">
                {[
                  { icon: '🐸', name: 'Pepe vault', pair: 'PEPE / USDC · Ethereum', apr: '28.4%', bg: 'rgba(34,197,94,0.1)' },
                  { icon: '🐕', name: 'Doge vault', pair: 'DOGE / USDC · Base', apr: '21.2%', bg: 'rgba(251,191,36,0.1)' },
                  { icon: '🐱', name: 'Keke vault', pair: 'KEKE / USDC · Base', apr: '34.1%', bg: 'rgba(168,85,247,0.1)' },
                  { icon: '🦴', name: 'Bonk vault', pair: 'BONK / USDC · Sonic', apr: '41.8%', bg: 'rgba(249,115,22,0.1)' },
                ].map(v => (
                  <div key={v.name} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.04)] rounded-[12px] py-3.5 px-[18px] flex items-center gap-3.5 transition-[border-color] duration-150 hover:border-[rgba(0,82,255,0.25)]">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[17px] shrink-0 border border-mw-dark-border" style={{background: v.bg}}>{v.icon}</div>
                    <div>
                      <div className="text-[13px] font-bold text-mw-dark-text">{v.name}</div>
                      <div className="text-[11px] text-[rgba(255,255,255,0.28)] mt-0.5 font-[var(--font-mono),'DM_Mono',monospace]">{v.pair}</div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-[15px] font-bold text-[#4ade80] font-[var(--font-mono),'DM_Mono',monospace]">{v.apr}</div>
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
      <section className="bg-mw-surface py-[100px] px-[52px] border-t border-mw-border max-md:py-[72px] max-md:px-5" id="teams">
        <div className="text-center">
          <span className="text-[11px] font-bold tracking-[1.5px] uppercase mb-3.5 block text-mw-brand">For teams &amp; protocols</span>
          <h2 className="font-[Georgia,serif] text-[clamp(28px,3vw,42px)] font-bold text-mw-ink tracking-[-1px] mb-3">Deploy smarter. Reward better.</h2>
          <p className="text-[16px] text-mw-ink-3 max-w-[480px] mx-auto mb-10 leading-[1.65]">Use Mintware to deploy vaults and reward pools that distribute to participants who actually contribute — not just whoever holds the most tokens.</p>
          <div className="grid grid-cols-3 gap-4 mb-10 max-md:grid-cols-1">
            {[
              { icon: '🏦', title: 'Social LP vaults', desc: 'Commit your tokens upfront. Community deposits USDC. Mintware handles MEV capture, AI range management, and score-weighted distribution.', tag: 'Mintware', tagCls: 'bg-mw-brand-dim text-mw-brand' },
              { icon: '🎯', title: 'Reward pools', desc: 'Deploy a reward pool. Attribution scores determine who earns and how much. Reward your real community — not bots and farmers.', tag: 'Mintware', tagCls: 'bg-mw-brand-dim text-mw-brand' },
              { icon: '🔗', title: 'Attribution plugin', desc: "One contract integration. Attribution's getScore(wallet) routes rewards through your existing protocol infrastructure.", tag: 'Coming soon', tagCls: 'bg-[rgba(26,26,46,0.06)] text-mw-ink-3' },
            ].map(c => (
              <div key={c.title} className="bg-white border border-mw-border rounded-[14px] p-6 text-left transition-all duration-150 hover:border-mw-brand hover:-translate-y-0.5">
                <span className="text-[24px] mb-3 block">{c.icon}</span>
                <div className="font-[Georgia,serif] text-[17px] font-bold text-mw-ink mb-1.5 tracking-[-0.2px]">{c.title}</div>
                <div className="text-[13px] text-mw-ink-3 leading-[1.6]">{c.desc}</div>
                <span className={`inline-block mt-3 text-[10px] font-bold tracking-[0.5px] uppercase py-[3px] px-[9px] rounded-full ${c.tagCls}`}>{c.tag}</span>
              </div>
            ))}
          </div>
          <button className="bg-mw-ink text-white py-3.5 px-8 rounded-[12px] text-[15px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-[background] duration-150 hover:bg-mw-brand">
            Join the team waitlist →
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-mw-ink border-t border-mw-dark-border py-11 px-[52px] flex items-center justify-between flex-wrap gap-5 max-md:py-8 max-md:px-5">
        <Link className="font-[Georgia,serif] text-[18px] font-bold text-mw-dark-text flex items-center gap-2 no-underline" href="/">
          <div className="w-[22px] h-[22px] rounded-[5px] bg-mw-brand flex items-center justify-center">
            <svg viewBox="0 0 14 14" width="13" height="13" fill="white"><path d="M7 1L13 4.5V9.5L7 13L1 9.5V4.5Z"/></svg>
          </div>
          Mintware
        </Link>
        <div className="flex gap-6 flex-wrap">
          {[
            { href: '/how-it-works.html', label: 'How it works' },
            { href: '/explorer', label: 'Attribution Explorer' },
            { href: '/for-protocols.html', label: 'For protocols' },
            { href: '/for-agents.html', label: 'For agents' },
            { href: '#', label: 'GitHub', external: true },
            { href: 'https://x.com/Mintware_org', label: 'Twitter', external: true },
            { href: '#', label: 'Discord', external: true },
          ].map(l => (
            <a
              key={l.label}
              className="text-[13px] text-[rgba(255,255,255,0.28)] no-underline transition-[color] duration-150 hover:text-[rgba(255,255,255,0.8)]"
              href={l.href}
              {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
            >{l.label}</a>
          ))}
        </div>
        <div className="text-[12px] text-[rgba(255,255,255,0.16)]">© 2026 Mintware. Powered by Attribution.</div>
      </footer>
    </>
  )
}

function WaitlistButton() {
  function handleJoin(e: React.MouseEvent<HTMLButtonElement>) {
    const btn = e.currentTarget
    btn.textContent = 'Joined ✓'
    btn.style.background = '#16a34a'
  }
  return (
    <button
      className="bg-mw-brand text-white py-[11px] px-5 rounded-[10px] text-[13px] font-semibold cursor-pointer font-[var(--font-jakarta),'Plus_Jakarta_Sans',sans-serif] transition-[background] duration-150 whitespace-nowrap hover:bg-[#0040cc]"
      onClick={handleJoin}
    >
      Join waitlist
    </button>
  )
}
