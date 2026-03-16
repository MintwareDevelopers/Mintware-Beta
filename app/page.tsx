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
      <style>{`
        :root{
          --blue:#0052FF;--blue-dim:rgba(0,82,255,0.07);--blue-mid:rgba(0,82,255,0.14);
          --ink:#1A1A2E;--ink-2:#3A3C52;--ink-3:#8A8C9E;
          --surface:#F7F6FF;--white:#ffffff;
          --green:#16a34a;--green-bg:#f0fdf4;--green-border:#bbf7d0;
          --border:rgba(26,26,46,0.08);--border-strong:rgba(26,26,46,0.13);
          --dark:#0A0D14;--dark-text:rgba(255,255,255,0.88);--dark-sub:rgba(255,255,255,0.38);
          --dark-border:rgba(255,255,255,0.06);
        }
        *{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        body{font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;background:var(--white);color:var(--ink);overflow-x:hidden}
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        .hero{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:72px 52px 80px;position:relative;overflow:hidden;text-align:center;background:var(--surface)}
        .hero-bg{position:absolute;inset:0;background:radial-gradient(ellipse 60% 40% at 50% 0%,rgba(0,82,255,0.06) 0%,transparent 65%);pointer-events:none}
        .hero-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(26,26,46,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(26,26,46,0.04) 1px,transparent 1px);background-size:56px 56px;pointer-events:none}
        .hero-eyebrow{display:inline-flex;align-items:center;gap:8px;margin-bottom:28px;animation:fadeUp 0.5s ease both;position:relative}
        .eyebrow-pill{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600}
        .ep-live{background:var(--white);border:1px solid var(--border-strong);color:var(--ink-2);box-shadow:0 1px 4px rgba(26,26,46,0.06)}
        .ep-soon{background:rgba(26,26,46,0.06);border:1px solid var(--border-strong);color:var(--ink-3)}
        .ep-dot{width:6px;height:6px;border-radius:50%}
        .dot-green{background:var(--green);animation:pulse 2s ease infinite}
        .dot-amber{background:rgba(255,165,0,0.7)}
        .hero-h1{font-family:Georgia,serif;font-size:clamp(42px,5.5vw,80px);font-weight:700;line-height:1.05;letter-spacing:-2px;color:var(--ink);max-width:780px;margin:0 auto;animation:fadeUp 0.5s 0.08s ease both;position:relative}
        .hero-h1 em{font-style:normal;color:var(--blue)}
        .hero-sub{font-size:clamp(15px,1.8vw,19px);font-weight:400;color:var(--ink-3);max-width:520px;margin:20px auto 0;line-height:1.65;animation:fadeUp 0.5s 0.16s ease both;position:relative}
        .hero-layers{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:680px;margin:40px auto 0;animation:fadeUp 0.5s 0.24s ease both;position:relative}
        .hero-layer{border-radius:14px;padding:22px;text-align:left}
        .hl-attr{background:var(--white);border:1.5px solid var(--border-strong)}
        .hl-mw{background:rgba(26,26,46,0.04);border:1.5px solid var(--border-strong)}
        .hl-tag{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:7px}
        .hl-attr .hl-tag{color:var(--green)}.hl-mw .hl-tag{color:var(--ink-3)}
        .hl-badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px}
        .hl-badge-live{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)}
        .hl-badge-soon{background:rgba(26,26,46,0.06);color:var(--ink-3);border:1px solid var(--border-strong)}
        .hl-title{font-family:Georgia,serif;font-size:17px;font-weight:700;letter-spacing:-0.3px;margin-bottom:6px;color:var(--ink)}
        .hl-desc{font-size:13px;line-height:1.6;color:var(--ink-3)}
        .hero-ctas{display:flex;align-items:center;gap:12px;justify-content:center;margin-top:36px;animation:fadeUp 0.5s 0.32s ease both;position:relative}
        .btn-p{background:var(--blue);color:#fff;border:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:all 0.15s;text-decoration:none;display:inline-block}
        .btn-p:hover{background:#0040cc;transform:translateY(-1px)}
        .btn-s{background:var(--white);color:var(--ink);border:1.5px solid var(--border-strong);padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:all 0.15s;text-decoration:none;display:inline-block}
        .btn-s:hover{border-color:var(--ink);transform:translateY(-1px)}
        .hero-stats{display:flex;align-items:stretch;margin-top:56px;border:1px solid var(--border-strong);border-radius:14px;overflow:hidden;background:var(--white);box-shadow:0 2px 12px rgba(26,26,46,0.06);animation:fadeUp 0.5s 0.4s ease both;position:relative}
        .hero-stat{padding:16px 32px;border-right:1px solid var(--border);text-align:center}
        .hero-stat:last-child{border-right:none}
        .hero-stat-val{font-family:Georgia,serif;font-size:24px;font-weight:700;color:var(--ink);letter-spacing:-0.5px}
        .hero-stat-label{font-size:12px;color:var(--ink-3);margin-top:3px}
        .inner{max-width:1080px;margin:0 auto}
        .section-badge{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px;display:block}
        .badge-green{color:var(--green)}.badge-blue{color:var(--blue)}.badge-muted{color:rgba(255,255,255,0.25)}
        .section-h2{font-family:Georgia,serif;font-size:clamp(30px,3.5vw,48px);font-weight:700;letter-spacing:-1px;line-height:1.1;margin-bottom:14px}
        .attr-section{background:var(--white);padding:100px 52px;border-top:1px solid var(--border)}
        .attr-grid{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
        .sub-light{font-size:16px;color:var(--ink-3);line-height:1.65;margin-bottom:28px}
        .live-badge{display:inline-flex;align-items:center;gap:6px;background:var(--green-bg);border:1px solid var(--green-border);border-radius:20px;padding:5px 14px;font-size:12px;font-weight:600;color:var(--green);margin-bottom:16px}
        .live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s ease infinite}
        .attr-features{display:flex;flex-direction:column;gap:12px;margin-bottom:32px}
        .attr-feature{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;transition:border-color 0.15s}
        .attr-feature:hover{border-color:var(--green)}
        .af-icon{width:32px;height:32px;border-radius:8px;background:var(--green-bg);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
        .af-title{font-size:13px;font-weight:600;color:var(--ink);margin-bottom:2px}
        .af-desc{font-size:12px;color:var(--ink-3);line-height:1.5}
        .score-card{background:var(--ink);border-radius:20px;padding:28px}
        .score-eyebrow{font-size:10px;color:rgba(255,255,255,0.22);font-family:var(--font-mono),'DM Mono',monospace;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
        .score-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px}
        .score-num{font-family:Georgia,serif;font-size:58px;font-weight:700;color:var(--blue);letter-spacing:-2px;line-height:1}
        .score-tier{font-size:11px;font-weight:600;background:var(--blue-mid);color:#6b9fff;padding:4px 12px;border-radius:20px;border:1px solid rgba(0,82,255,0.25);margin-top:4px}
        .score-sub-text{font-size:11px;color:rgba(255,255,255,0.2);font-family:var(--font-mono),'DM Mono',monospace;margin-bottom:20px}
        .score-bars{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}
        .score-bar-row{display:flex;flex-direction:column;gap:4px}
        .score-bar-label{display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.28)}
        .score-bar-label span:last-child{color:var(--blue);font-family:var(--font-mono),'DM Mono',monospace}
        .score-bar-track{height:3px;background:rgba(255,255,255,0.07);border-radius:2px;overflow:hidden}
        .score-bar-fill{height:100%;background:var(--blue);border-radius:2px}
        .score-earn-row{padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between}
        .score-earn-label{font-size:11px;color:rgba(255,255,255,0.22);margin-bottom:3px}
        .score-earn-val{font-family:var(--font-mono),'DM Mono',monospace;font-size:18px;font-weight:500;color:#4ade80}
        .mw-section{background:var(--dark);padding:100px 52px}
        .mw-grid{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
        .sub-dark{font-size:16px;color:var(--dark-sub);line-height:1.65;margin-bottom:28px}
        .cs-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);border-radius:20px;padding:5px 14px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.28);margin-bottom:16px}
        .cs-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,165,0,0.7)}
        .mw-features{display:flex;flex-direction:column;gap:12px;margin-bottom:28px}
        .mw-feature{display:flex;align-items:flex-start;gap:12px;padding:14px 0}
        .mf-icon{width:32px;height:32px;border-radius:8px;background:rgba(0,82,255,0.12);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
        .mf-title{font-size:13px;font-weight:600;color:rgba(255,255,255,0.7);margin-bottom:2px}
        .mf-desc{font-size:12px;color:rgba(255,255,255,0.28);line-height:1.5}
        .waitlist-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:24px}
        .waitlist-title{font-family:Georgia,serif;font-size:18px;font-weight:700;color:var(--dark-text);margin-bottom:6px;letter-spacing:-0.3px}
        .waitlist-sub{font-size:13px;color:rgba(255,255,255,0.28);margin-bottom:16px;line-height:1.5}
        .waitlist-form{display:flex;gap:8px}
        .waitlist-input{flex:1;padding:11px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;font-size:13px;color:var(--dark-text);outline:none;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:border-color 0.15s}
        .waitlist-input:focus{border-color:rgba(0,82,255,0.5)}
        .waitlist-input::placeholder{color:rgba(255,255,255,0.18)}
        .waitlist-btn{background:var(--blue);color:#fff;border:none;padding:11px 20px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:background 0.15s;white-space:nowrap}
        .waitlist-btn:hover{background:#0040cc}
        .vp-label{font-size:11px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,0.18);text-transform:uppercase;margin-bottom:12px}
        .vault-previews{display:flex;flex-direction:column;gap:10px}
        .vault-preview{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.04);border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:14px;transition:border-color 0.15s}
        .vault-preview:hover{border-color:rgba(0,82,255,0.25)}
        .vp-icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;border:1px solid var(--dark-border)}
        .vp-name{font-size:13px;font-weight:700;color:var(--dark-text)}
        .vp-pair{font-size:11px;color:rgba(255,255,255,0.28);margin-top:2px;font-family:var(--font-mono),'DM Mono',monospace}
        .vp-apr{margin-left:auto;text-align:right}
        .vp-apr-val{font-size:15px;font-weight:700;color:#4ade80;font-family:var(--font-mono),'DM Mono',monospace}
        .vp-apr-label{font-size:10px;color:rgba(255,255,255,0.22);margin-top:1px}
        .vp-more{text-align:center;padding:12px;font-size:12px;color:rgba(255,255,255,0.16)}
        .teams-section{background:var(--surface);padding:100px 52px;border-top:1px solid var(--border)}
        .teams-inner{text-align:center}
        .teams-h2{font-family:Georgia,serif;font-size:clamp(28px,3vw,42px);font-weight:700;color:var(--ink);letter-spacing:-1px;margin-bottom:12px}
        .teams-sub{font-size:16px;color:var(--ink-3);max-width:480px;margin:0 auto 40px;line-height:1.65}
        .teams-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:40px}
        .teams-card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:24px;text-align:left;transition:all 0.15s}
        .teams-card:hover{border-color:var(--blue);transform:translateY(-2px)}
        .tc-icon{font-size:24px;margin-bottom:12px;display:block}
        .tc-title{font-family:Georgia,serif;font-size:17px;font-weight:700;color:var(--ink);margin-bottom:6px;letter-spacing:-0.2px}
        .tc-desc{font-size:13px;color:var(--ink-3);line-height:1.6}
        .tc-tag{display:inline-block;margin-top:12px;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:3px 9px;border-radius:20px}
        .tag-blue{background:var(--blue-dim);color:var(--blue)}
        .tag-gray{background:rgba(26,26,46,0.06);color:var(--ink-3)}
        .teams-cta{background:var(--ink);color:#fff;border:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:var(--font-jakarta),'Plus Jakarta Sans',sans-serif;transition:background 0.15s}
        .teams-cta:hover{background:var(--blue)}
        footer{background:var(--ink);border-top:1px solid rgba(255,255,255,0.06);padding:44px 52px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:20px}
        .footer-logo{font-family:Georgia,serif;font-size:18px;font-weight:700;color:var(--dark-text);display:flex;align-items:center;gap:8px;text-decoration:none}
        .footer-logo-mark{width:22px;height:22px;border-radius:5px;background:var(--blue);display:flex;align-items:center;justify-content:center}
        .footer-links{display:flex;gap:24px;flex-wrap:wrap}
        .footer-links a{font-size:13px;color:rgba(255,255,255,0.28);text-decoration:none;transition:color 0.15s}
        .footer-links a:hover{color:rgba(255,255,255,0.8)}
        .footer-copy{font-size:12px;color:rgba(255,255,255,0.16)}
        @media(max-width:768px){
          .hero{padding:110px 20px 64px}
          .hero-layers,.attr-grid,.mw-grid,.teams-cards{grid-template-columns:1fr}
          .attr-grid,.mw-grid{gap:40px}
          .hero-stats{flex-direction:column}
          .hero-stat{border-right:none;border-bottom:1px solid var(--border)}
          .hero-stat:last-child{border-bottom:none}
          .attr-section,.mw-section,.teams-section{padding:72px 20px}
          footer{padding:32px 20px}
        }
      `}</style>

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
