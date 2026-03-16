'use client'

import './page.css'
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
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-grid" />
        <div style={{fontFamily:'Georgia,serif',fontSize:'clamp(48px,6vw,64px)',fontWeight:700,color:'#1A1A2E',letterSpacing:'-2px',marginBottom:36,position:'relative',animation:'fadeUp 0.4s ease both'}}>Mintware</div>
        <div className="hero-eyebrow">
          <div className="eyebrow-pill ep-live"><span className="ep-dot dot-green" />Attribution — live now</div>
          <div className="eyebrow-pill ep-soon"><span className="ep-dot dot-amber" />Mintware — coming soon</div>
        </div>
        <h1 className="hero-h1">The reputation economy<br /><em>of DeFi</em></h1>
        <p className="hero-sub" style={{fontSize:'clamp(17px,2vw,22px)',color:'#3A3C52',fontWeight:500,lineHeight:1.5}}>
          Attribution measures every contribution.<br />
          <span style={{color:'#8A8C9E',fontWeight:400}}>Mintware is where those contributions earn rewards.</span>
        </p>
        <div className="hero-layers">
          <div className="hero-layer hl-attr">
            <div className="hl-tag"><span>Attribution</span><span className="hl-badge hl-badge-live">● Live</span></div>
            <div className="hl-title">Reputation layer</div>
            <div className="hl-desc">Connect your wallet. Get your on-chain reputation score. See where you rank across DeFi.</div>
          </div>
          <div className="hero-layer hl-mw">
            <div className="hl-tag"><span>Mintware</span><span className="hl-badge hl-badge-soon">Coming soon</span></div>
            <div className="hl-title">Economic layer</div>
            <div className="hl-desc">Protocols deploy vaults and reward pools. Your score determines how rewards flow to you.</div>
          </div>
        </div>
        <div className="hero-ctas">
          <button className="btn-p" onClick={handleHeroConnect}>
            {isConnected ? 'Go to profile →' : 'Connect wallet →'}
          </button>
          <Link className="btn-s" href="/explorer">Explore a wallet</Link>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><div className="hero-stat-val">24,817</div><div className="hero-stat-label">Wallets scored</div></div>
          <div className="hero-stat"><div className="hero-stat-val">100+</div><div className="hero-stat-label">Chains indexed</div></div>
          <div className="hero-stat"><div className="hero-stat-val">138K</div><div className="hero-stat-label">Referral connections</div></div>
          <div className="hero-stat"><div className="hero-stat-val">Free</div><div className="hero-stat-label">Always</div></div>
        </div>
      </section>

      <section className="attr-section" id="attribution">
        <div className="inner">
          <div className="attr-grid">
            <div>
              <div className="live-badge"><span className="live-dot" />Live now</div>
              <span className="section-badge badge-green">Attribution</span>
              <h2 className="section-h2" style={{color:'var(--ink)'}}>Your on-chain reputation, finally visible</h2>
              <p className="sub-light">Attribution reads your full on-chain history and computes a single score that captures the real picture of your contribution to DeFi — not just your balance.</p>
              <div className="attr-features">
                <div className="attr-feature"><div className="af-icon">🔍</div><div><div className="af-title">Wallet score</div><div className="af-desc">LP behavior, DeFi competence, wallet age, network quality — scored across 100+ chains.</div></div></div>
                <div className="attr-feature"><div className="af-icon">🏆</div><div><div className="af-title">Global leaderboard</div><div className="af-desc">See where you rank. Top score, top earners, top referrers, rising fast — live rankings.</div></div></div>
                <div className="attr-feature"><div className="af-icon">🔗</div><div><div className="af-title">Referral network</div><div className="af-desc">Refer wallets and build your network. Network quality improves your score.</div></div></div>
                <div className="attr-feature"><div className="af-icon">👤</div><div><div className="af-title">Public profiles</div><div className="af-desc">Every wallet gets a profile. Paste any address to explore their reputation and rank.</div></div></div>
              </div>
              <Link className="btn-p" href="/explorer" style={{width:'fit-content'}}>Check your score →</Link>
            </div>
            <div className="score-card">
              <div className="score-eyebrow">Attribution score</div>
              <div className="score-top"><div><div className="score-num">82</div></div><div className="score-tier">Builder tier</div></div>
              <div className="score-sub-text">vaultking.mintware · top 5%</div>
              <div className="score-bars">
                {[['LP behavior','91'],['DeFi competence','85'],['Wallet longevity','78'],['Network & referral','64'],['Mintware native','72']].map(([label, val]) => (
                  <div key={label} className="score-bar-row">
                    <div className="score-bar-label"><span>{label}</span><span>{val}</span></div>
                    <div className="score-bar-track"><div className="score-bar-fill" style={{width:val+'%'}} /></div>
                  </div>
                ))}
              </div>
              <div className="score-earn-row">
                <div><div className="score-earn-label">Lifetime earnings</div><div className="score-earn-val">$2,760.24</div></div>
                <div style={{textAlign:'right'}}><div className="score-earn-label">This month</div><div style={{fontFamily:'var(--font-mono),DM Mono,monospace',fontSize:13,color:'rgba(255,255,255,0.32)'}}>+$184.50</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mw-section" id="mintware">
        <div className="inner">
          <div className="mw-grid">
            <div>
              <div className="cs-badge"><span className="cs-dot" />Coming soon</div>
              <span className="section-badge badge-muted">Mintware</span>
              <h2 className="section-h2" style={{color:'var(--dark-text)'}}>Where reputation becomes earnings</h2>
              <p className="sub-dark">Protocols deploy vaults and reward pools on Mintware. Your Attribution score determines how rewards flow to you — the more you've contributed, the more you earn.</p>
              <div className="mw-features">
                <div className="mw-feature"><div className="mf-icon">🏦</div><div><div className="mf-title">Social LP vaults</div><div className="mf-desc">Deposit USDC. Teams seed the token side. Your score weights your share of fees and MEV capture.</div></div></div>
                <div className="mw-feature"><div className="mf-icon">🎯</div><div><div className="mf-title">Reward pools</div><div className="mf-desc">Token teams deploy pools. Distributions flow to participants weighted by contribution — not holdings.</div></div></div>
                <div className="mw-feature"><div className="mf-icon">⚡</div><div><div className="mf-title">MEV capture</div><div className="mf-desc">Uniswap V4 hooks redirect value that would normally go to bots back to LPs.</div></div></div>
                <div className="mw-feature"><div className="mf-icon">🤖</div><div><div className="mf-title">AI range management</div><div className="mf-desc">Concentrated liquidity optimized automatically. No manual management required.</div></div></div>
              </div>
              <div className="waitlist-box">
                <div className="waitlist-title">Join the waitlist</div>
                <div className="waitlist-sub">Be first when Mintware vaults go live. Attribution score-holders get priority access.</div>
                <div className="waitlist-form">
                  <input className="waitlist-input" type="email" placeholder="your@email.com" />
                  <WaitlistButton />
                </div>
              </div>
            </div>
            <div>
              <div className="vp-label">Vaults preview</div>
              <div className="vault-previews">
                {[
                  {icon:'🐸',name:'Pepe vault',pair:'PEPE / USDC · Ethereum',apr:'28.4%',bg:'rgba(34,197,94,0.1)'},
                  {icon:'🐕',name:'Doge vault',pair:'DOGE / USDC · Base',apr:'21.2%',bg:'rgba(251,191,36,0.1)'},
                  {icon:'🐱',name:'Keke vault',pair:'KEKE / USDC · Base',apr:'34.1%',bg:'rgba(168,85,247,0.1)'},
                  {icon:'🦴',name:'Bonk vault',pair:'BONK / USDC · Sonic',apr:'41.8%',bg:'rgba(249,115,22,0.1)'},
                ].map(v => (
                  <div key={v.name} className="vault-preview">
                    <div className="vp-icon" style={{background:v.bg}}>{v.icon}</div>
                    <div><div className="vp-name">{v.name}</div><div className="vp-pair">{v.pair}</div></div>
                    <div className="vp-apr"><div className="vp-apr-val">{v.apr}</div><div className="vp-apr-label">APR</div></div>
                  </div>
                ))}
                <div className="vp-more">+ more vaults at launch</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="teams-section" id="teams">
        <div className="teams-inner">
          <span className="section-badge badge-blue">For teams &amp; protocols</span>
          <h2 className="teams-h2">Deploy smarter. Reward better.</h2>
          <p className="teams-sub">Use Mintware to deploy vaults and reward pools that distribute to participants who actually contribute — not just whoever holds the most tokens.</p>
          <div className="teams-cards">
            <div className="teams-card"><span className="tc-icon">🏦</span><div className="tc-title">Social LP vaults</div><div className="tc-desc">Commit your tokens upfront. Community deposits USDC. Mintware handles MEV capture, AI range management, and score-weighted distribution.</div><span className="tc-tag tag-blue">Mintware</span></div>
            <div className="teams-card"><span className="tc-icon">🎯</span><div className="tc-title">Reward pools</div><div className="tc-desc">Deploy a reward pool. Attribution scores determine who earns and how much. Reward your real community — not bots and farmers.</div><span className="tc-tag tag-blue">Mintware</span></div>
            <div className="teams-card"><span className="tc-icon">🔗</span><div className="tc-title">Attribution plugin</div><div className="tc-desc">One contract integration. Attribution's getScore(wallet) routes rewards through your existing protocol infrastructure.</div><span className="tc-tag tag-gray">Coming soon</span></div>
          </div>
          <button className="teams-cta">Join the team waitlist →</button>
        </div>
      </section>

      <footer>
        <Link className="footer-logo" href="/">
          <div className="footer-logo-mark"><svg viewBox="0 0 14 14" width="13" height="13" fill="white"><path d="M7 1L13 4.5V9.5L7 13L1 9.5V4.5Z"/></svg></div>
          Mintware
        </Link>
        <div className="footer-links">
          <a href="/how-it-works.html">How it works</a>
          <a href="/explorer">Attribution Explorer</a>
          <a href="/for-protocols.html">For protocols</a>
          <a href="/for-agents.html">For agents</a>
          <a href="#" target="_blank" rel="noopener">GitHub</a>
          <a href="https://x.com/Mintware_org" target="_blank" rel="noopener">Twitter</a>
          <a href="#" target="_blank" rel="noopener">Discord</a>
        </div>
        <div className="footer-copy">© 2026 Mintware. Powered by Attribution.</div>
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
  return <button className="waitlist-btn" onClick={handleJoin}>Join waitlist</button>
}
