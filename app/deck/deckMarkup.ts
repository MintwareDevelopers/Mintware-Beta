/* eslint-disable */
// Auto-embedded investor-deck HTML. Rendered ONLY inside the sandboxed iframe on /deck,
// and ONLY after the password gate passes. Regenerate from scratchpad/mintware-seed-deck.html.
export const DECK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head><body>
<title>Mintware Seed Deck</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap">

<style>
  :root{
    color-scheme: light;
    --ground:#F5F5FB; --surface:#FFFFFF; --tint-peri:#ECECFA; --tint-coral:#FBF0EA; --tint-lav:#F1F0FE;
    --ink:#191923; --ink-mid:#494957; --ink-soft:#8A8A9E;
    --hair:rgba(22,22,44,.10); --hair-soft:rgba(22,22,44,.06);
    --peri:#6C6CF0; --peri-deep:#4C4CD6; --peri-mid:#9a8cf0; --coral:#F0855E; --coral-deep:#DC6A44;
    --live:#3BB273;
    --shadow:0 1px 2px rgba(20,20,50,.05), 0 12px 34px -14px rgba(30,30,80,.16);
    --grad:linear-gradient(100deg, var(--peri) 0%, #8E6FE8 45%, var(--coral) 100%);
  }
  *{box-sizing:border-box; margin:0; padding:0}
  body{background:var(--ground); color:var(--ink); font-family:'Plus Jakarta Sans',system-ui,sans-serif; line-height:1.5; -webkit-font-smoothing:antialiased}
  h1,h2,h3{font-family:'Space Grotesk',sans-serif; letter-spacing:-0.03em; line-height:1.05; text-wrap:balance}
  .mono{font-family:'Space Mono',monospace}
  .grad{background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent}

  /* slide shell */
  .slide{max-width:1000px; margin:0 auto 22px; background:var(--surface); border:1px solid var(--hair); border-radius:20px; box-shadow:var(--shadow); padding:56px 60px; min-height:440px; display:flex; flex-direction:column; position:relative; overflow:hidden}
  .slide.cool{background:var(--ground)} .slide.lav{background:var(--tint-lav)}
  .slide.peri{background:var(--tint-peri)} .slide.coral{background:var(--tint-coral)}
  @media(max-width:720px){ .slide{padding:36px 26px; border-radius:16px; min-height:0} }
  .stage{padding:34px 20px 60px}
  .num{position:absolute; top:22px; right:26px; font-family:'Space Mono'; font-size:12px; color:var(--ink-soft)}
  .label{font-size:11.5px; font-weight:700; letter-spacing:.15em; text-transform:uppercase; color:var(--peri-deep); margin-bottom:18px}
  .slide h2{font-size:clamp(1.7rem,3.6vw,2.7rem); font-weight:600}
  .slide h1{font-size:clamp(2.6rem,6vw,4.2rem); font-weight:600}
  .lede{color:var(--ink-mid); font-size:clamp(1.02rem,1.5vw,1.22rem); line-height:1.55; max-width:60ch}
  .fine{font-size:11.5px; color:var(--ink-soft); line-height:1.5}
  .kicker{color:var(--ink-mid); font-size:15px; margin-top:auto; padding-top:22px}
  b{color:var(--ink)}

  /* bits */
  .pill{display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; border-radius:999px; padding:7px 14px; background:var(--surface); border:1px solid var(--hair); color:var(--ink-mid)}
  .dot{width:8px; height:8px; border-radius:50%; background:var(--live); display:inline-block}
  .grid2{display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:8px}
  .grid3{display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-top:8px}
  @media(max-width:720px){ .grid2,.grid3{grid-template-columns:1fr} }
  .card{background:var(--surface); border:1px solid var(--hair); border-radius:14px; padding:22px}
  .cool .card,.lav .card,.peri .card,.coral .card{background:rgba(255,255,255,.7)}
  .card h3{font-size:17px; font-weight:600; margin-bottom:7px}
  .card p{font-size:13.5px; color:var(--ink-mid); line-height:1.5}
  .stat{font-family:'Space Grotesk'; font-weight:600; font-size:clamp(1.8rem,4vw,2.7rem); letter-spacing:-.03em}
  .statlab{font-size:12px; color:var(--ink-soft); margin-top:4px; text-transform:uppercase; letter-spacing:.08em; font-weight:600}
  .row{display:flex; gap:12px; flex-wrap:wrap; margin-top:18px}
  .check{display:flex; gap:10px; align-items:flex-start; font-size:14.5px; color:var(--ink-mid); padding:7px 0}
  .check .tick{color:var(--live); font-weight:700; flex-shrink:0}
  .check .warn{color:var(--coral-deep); font-weight:700; flex-shrink:0}
  .logo{display:flex; align-items:center; gap:11px; font-family:'Space Grotesk'; font-weight:700; font-size:22px}
  .dome{width:30px; height:30px; border-radius:9px; background:var(--grad); box-shadow:0 5px 14px -3px rgba(108,108,240,.6)}

  /* placeholder — the founder fills these */
  .ph{border:1.5px dashed var(--coral); background:var(--tint-coral); border-radius:12px; padding:16px 18px; color:var(--coral-deep); font-size:13.5px; margin-top:14px}
  .ph b{color:var(--coral-deep)}
  .ph .tag{font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; display:block; margin-bottom:5px; opacity:.85}

  .banner{max-width:1000px; margin:0 auto 20px; font-size:12.5px; color:var(--ink-mid); background:var(--tint-lav); border:1px solid var(--hair); border-radius:12px; padding:12px 18px; display:flex; gap:10px; align-items:center; flex-wrap:wrap}

  /* live-proof links out to the running product (open in a new tab) */
  .vlink{display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:var(--peri-deep); text-decoration:none; border-bottom:1.5px solid rgba(76,76,214,.32); padding-bottom:1px; transition:border-color .15s}
  .vlink:hover{border-bottom-color:var(--peri-deep)}
  .vrow{display:flex; gap:18px; flex-wrap:wrap; margin-top:16px}
  .receipt{display:flex; gap:9px; align-items:baseline}
  .receipt .rv{font-family:'Space Grotesk'; font-weight:700; font-size:19px; letter-spacing:-.02em; color:var(--ink)}
  .receipt .rl{font-size:12px; color:var(--ink-soft)}

  /* print — one clean page per slide (⎙ / Save PDF) */
  @media print{
    html,body{background:#fff}
    .stage{padding:0}
    .banner{display:none}
    .slide{break-inside:avoid; page-break-after:always; box-shadow:none; border:1px solid var(--hair); margin:0 auto 0; min-height:auto; page-break-inside:avoid}
    .slide:last-child{page-break-after:auto}
    .num{display:none}
    .vlink{border-bottom:none; color:var(--ink-mid)}
  }
</style>

<div class="stage">


<!-- 1 · COVER -->
<section class="slide" style="justify-content:center; align-items:flex-start; min-height:520px">
  <span class="num mono">01</span>
  <div class="logo"><svg width="34" height="34" viewBox="0 0 100 100" style="border-radius:10px;box-shadow:0 5px 14px -3px rgba(108,108,240,.6)"><defs><linearGradient id="mwc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A82F4"/><stop offset="1" stop-color="#6C6CF0"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#mwc)"/><ellipse cx="50" cy="55.5" rx="35" ry="7" fill="#fff"/><path d="M32,55.5 A18,18 0 0 1 68,55.5 Z" fill="#fff"/></svg>Mintware</div>
  <h1 style="margin-top:28px">Every asset<br><span class="grad">deserves a market.</span></h1>
  <p class="lede" style="margin-top:22px; font-size:1.3rem">Stocks, real-world assets and stablecoins are moving on-chain by the billions. Mintware gives them <b>deep, fair markets</b> — funded by the people who hold them, who earn what market makers earn.</p>
  <div class="row">
    <span class="pill"><span class="dot"></span>Seed round · confidential</span>
    <span class="pill">Liquidity for tokenized assets</span>
  </div>
</section>

<!-- 2 · PROBLEM -->
<section class="slide cool">
  <span class="num mono">02</span>
  <div class="label">The problem</div>
  <h2>Assets are going on-chain faster than <span class="grad">markets can form around them.</span></h2>
  <p class="lede" style="margin-top:18px">Tokenizing an asset solves who owns it. It doesn’t solve how to trade it. Thin markets mean wide spreads, prices that jump on a single sale, and holders who can’t get out at a fair price. Today, depth is rented from market makers who leave when the contract ends — and the trading income goes to them, not to the people who hold the asset.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><div class="stat mono">$38B+</div><div class="statlab">tokenized real-world assets</div></div>
    <div class="card"><div class="stat mono">&lt;$1B → $3B+</div><div class="statlab">tokenized stocks, in a year</div></div>
    <div class="card"><div class="stat mono">~1 in 6</div><div class="statlab">stock-token dollars sitting in memecoin-style pools</div></div>
  </div>
  <div class="kicker">The assets are real. <b>The markets around them aren’t ready.</b></div>
  <div class="fine" style="margin-top:10px">Sources: rwa.xyz, Token Terminal, Robinhood (Oct 2026). Figures approximate.</div>
</section>

<!-- 3 · SOLUTION -->
<section class="slide">
  <span class="num mono">03</span>
  <div class="label">The solution</div>
  <h2>Mintware turns holders into <span class="grad">the market.</span></h2>
  <p class="lede" style="margin-top:18px">Anyone can back a market with <b>one asset</b>. Mintware pools it into a shared position on Uniswap&nbsp;V4 that provides depth while the market trades, and earns lending yield while it waits. One share, one balance — <b>withdraw any time</b>.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><h3>For holders</h3><p>Earn what market makers earn — trading fees plus idle yield — without managing a position.</p></div>
    <div class="card"><h3>For issuers</h3><p>Depth from day one, from your own community, that doesn’t leave when a contract ends.</p></div>
    <div class="card"><h3>For traders</h3><p>Tighter spreads and fair prices on tokenized stocks, RWAs and stablecoins, around the clock.</p></div>
  </div>
  <div class="kicker"><b>Liquidity as a public good</b> — owned by the people who use it.</div>
</section>

<!-- 4 · HOW IT WORKS -->
<section class="slide cool">
  <span class="num mono">04</span>
  <div class="label">How it works</div>
  <h2>One asset in. <span class="grad">Two ways to earn.</span> Out any time.</h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700;font-size:13px">01</div><h3 style="margin-top:8px">Add</h3><p>Deposit a single asset into a curated market. You receive one share of the shared position.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700;font-size:13px">02</div><h3 style="margin-top:8px">Earn</h3><p>The MarketEngine keeps capital in the pool while it trades and parks the rest in curated lending — fees plus yield on one balance.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700;font-size:13px">03</div><h3 style="margin-top:8px">Withdraw</h3><p>Redeem your share any time for your pro-rata slice of the market. Nothing is locked.</p></div>
  </div>
  <div class="card" style="margin-top:20px; display:flex; gap:14px 18px; align-items:center; flex-wrap:wrap">
    <span class="pill"><span class="dot"></span>Live on testnet</span>
    <span style="font-size:14px; color:var(--ink-mid); flex:1 1 300px">The MarketEngine is live on Robinhood Chain testnet, with deposit and withdraw running end-to-end through the production app.</span>
    <div class="vrow" style="flex-basis:100%; margin-top:2px">
      <a class="vlink" href="https://mintware.finance/app/markets" target="_blank" rel="noopener">Open the live markets →</a>
      <a class="vlink" href="https://mintware.finance/the-math" target="_blank" rel="noopener">See the return model →</a>
    </div>
  </div>
</section>

<!-- 5 · WHY NOW -->
<section class="slide lav">
  <span class="num mono">05</span>
  <div class="label">Why now</div>
  <h2>Real assets just arrived on-chain — <span class="grad">at scale.</span></h2>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><h3>Stock tokens are here</h3><p>Robinhood has issued around 2,000 stock tokens on its own chain, and the largest issuers are listing with on-chain pools.</p></div>
    <div class="card"><h3>RWAs are compounding</h3><p>Tokenized real-world assets passed $38B and grew roughly two-thirds this year — treasuries, credit, property, commodities.</p></div>
    <div class="card"><h3>Stablecoins went mainstream</h3><p>Around $300B of stablecoins now settle trades, payroll and payments — the quote side of every new market.</p></div>
    <div class="card"><h3>Programmable liquidity</h3><p>Uniswap&nbsp;V4 makes a shared, single-asset market position possible — the engine we built couldn’t exist before it.</p></div>
  </div>
</section>

<!-- 6 · MARKET -->
<section class="slide">
  <span class="num mono">06</span>
  <div class="label">Market</div>
  <h2>Every tokenized asset <span class="grad">needs a market.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><div class="statlab">Beachhead</div><h3 style="margin-top:6px">Stock tokens on Robinhood Chain</h3><p>Thousands of listed tokens, most with thin or misplaced liquidity. A clear chain, a clear asset class, reachable today.</p></div>
    <div class="card"><div class="statlab">Expansion</div><h3 style="margin-top:6px">RWAs and their issuers</h3><p>Treasuries, credit, land and water — issuers who need depth for regulated assets and holders who want to earn on them.</p></div>
    <div class="card"><div class="statlab">Vision</div><h3 style="margin-top:6px">Every on-chain balance</h3><p>Stablecoins, agents and everyday accounts — every dollar earning market-maker income, spendable through the card.</p></div>
  </div>
  <div class="kicker">$300B in stablecoins. $38B in RWAs. Thousands of stock tokens. <b>One engine serves all of them.</b></div>
</section>

<!-- 7 · THE WEDGE -->
<section class="slide">
  <span class="num mono">07</span>
  <div class="label">The wedge — where we win first</div>
  <h2>Robinhood Chain is <span class="grad">where tokenized equities live.</span></h2>
  <p class="lede" style="margin-top:18px">Around three in four dollars on Robinhood Chain sit in tokenized equities, yet a meaningful share of that float trades in thin, memecoin-style pools. Mintware is built on that chain, in its quote asset, on the same Uniswap&nbsp;V4 pools — ready to give each stock token a deep, community-funded market.</p>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><h3>Curated markets</h3><p>Every market is reviewed before it opens, then ranked live by volume and depth.</p></div>
    <div class="card"><h3>Issuer partnerships</h3><p>Issuers bring their token; Mintware brings the market and the holders who fund it.</p></div>
  </div>
  <div class="kicker">Win stock tokens on Robinhood Chain → <b>carry the same engine to every RWA.</b></div>
</section>

<!-- 8 · TRACTION -->
<section class="slide cool">
  <span class="num mono">08</span>
  <div class="label">Traction &amp; validation</div>
  <h2>Built, live on testnet, and <span class="grad">backed.</span></h2>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><h3>Incubated &amp; backed</h3><p>Firma Labs is incubating Mintware and anchoring this round — capital and distribution, not just a check.</p></div>
    <div class="card"><h3>MarketEngine live on testnet</h3><p>Deployed on Robinhood Chain testnet, fork-tested on Base, with deposit and withdraw verified end-to-end through the production app.</p></div>
    <div class="card"><h3>Agent payments in production</h3><p>An x402 pay-per-call surface is live at mintware.finance today.</p></div>
    <div class="card"><h3>Security-first</h3><p>Multiple rounds of internal audits, exploit replays and fuzzing before any real value moves.</p></div>
  </div>
  <div class="vrow"><a class="vlink" href="https://mintware.finance/app/markets" target="_blank" rel="noopener">See the live markets →</a></div>
</section>

<!-- 9 · BUSINESS MODEL -->
<section class="slide">
  <span class="num mono">09</span>
  <div class="label">Business model</div>
  <h2>We earn when <span class="grad">the market earns.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><h3>Performance fee</h3><p>10% of the trading fees a market earns — never a cut of principal. Revenue scales with volume.</p></div>
    <div class="card"><h3>Issuer curation</h3><p>Issuers pay to launch and list a curated, community-funded market for their asset.</p></div>
    <div class="card"><h3>Card</h3><p>Interchange on card spend from an earning balance, refilled automatically.</p></div>
  </div>
  <div class="kicker">Aligned by design — <b>no trading, no fee.</b></div>
</section>

<!-- 10 · MOAT -->
<section class="slide lav">
  <span class="num mono">10</span>
  <div class="label">Why us — the moat</div>
  <h2>Hard to copy, and <span class="grad">getting harder.</span></h2>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><h3>A single-asset market engine</h3><p>One asset in, a shared V4 position plus idle yield, one share out — a primitive most LP products still make users assemble themselves.</p></div>
    <div class="card"><h3>Curation as a product</h3><p>Every market reviewed and ranked — the trust layer issuers and holders need for real assets.</p></div>
    <div class="card"><h3>Liquidity that compounds</h3><p>Each new holder deepens the market, tighter spreads draw more volume, and more volume pays holders more.</p></div>
    <div class="card"><h3>Security as the wedge</h3><p>Shared-liquidity protocols have been exploited through their accounting. We treat that failure class as audit item one.</p></div>
  </div>
</section>

<!-- 11 · WHERE WE ARE -->
<section class="slide">
  <span class="num mono">11</span>
  <div class="label">Where we are</div>
  <h2>Live on testnet — <span class="grad">the path to mainnet is planned.</span></h2>
  <div class="grid2" style="margin-top:22px">
    <div>
      <div class="statlab" style="margin-bottom:8px">Built</div>
      <div class="check"><span class="tick">✓</span><span>MarketEngine live on Robinhood Chain testnet, with deposit and withdraw verified in the production app.</span></div>
      <div class="check"><span class="tick">✓</span><span>Curated, ranked market discovery live at mintware.finance.</span></div>
      <div class="check"><span class="tick">✓</span><span>Agent x402 payments live in production.</span></div>
      <div class="check"><span class="tick">✓</span><span>Card earning balance and automatic refill contracts built.</span></div>
    </div>
    <div>
      <div class="statlab" style="margin-bottom:8px">Next</div>
      <div class="check"><span class="warn">→</span><span>Competitive audit and public bug bounty.</span></div>
      <div class="check"><span class="warn">→</span><span>Capped mainnet launch on Robinhood Chain.</span></div>
      <div class="check"><span class="warn">→</span><span>First issuer partners and stock-token markets.</span></div>
      <div class="check"><span class="warn">→</span><span>Card issuing with Bridge and Stripe.</span></div>
    </div>
  </div>
</section>

<!-- 12 · TEAM & ADVISORS -->
<section class="slide">
  <span class="num mono">12</span>
  <div class="label">Team &amp; advisors</div>
  <h2>Web3 operators, backed by a <span class="grad">dealmaking bench.</span></h2>
  <div class="grid2" style="margin-top:20px">
    <div class="card" style="display:flex; gap:13px; align-items:flex-start">
      <div style="width:38px;height:38px;border-radius:10px;flex-shrink:0;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk';font-weight:700;font-size:14px">NR</div>
      <div><div style="font-weight:600;font-size:14.5px">Nic Robinson</div><div style="font-size:10.5px;font-weight:700;color:var(--peri-deep);text-transform:uppercase;letter-spacing:.05em;margin:2px 0 5px">Founder &amp; CEO</div><p style="font-size:11.5px;color:var(--ink-mid);line-height:1.45">Founder of Nicolas Robinson Ministries — Gospel events across 12 nations, 50+ cities, 5 continents. Web3 operator across RWA, network-state &amp; decentralized tech.</p></div>
    </div>
    <div class="card" style="display:flex; gap:13px; align-items:flex-start">
      <div style="width:38px;height:38px;border-radius:10px;flex-shrink:0;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk';font-weight:700;font-size:14px">CB</div>
      <div><div style="font-weight:600;font-size:14.5px">Craig Barton</div><div style="font-size:10.5px;font-weight:700;color:var(--peri-deep);text-transform:uppercase;letter-spacing:.05em;margin:2px 0 5px">Growth &amp; Business Development</div><p style="font-size:11.5px;color:var(--ink-mid);line-height:1.45">Head of BD at Incentiv (account-abstraction L1) &amp; Head of Growth at GlitchD Labs (rollup infra). Founder of a live consumer move-to-earn app.</p></div>
    </div>
  </div>
  <div class="label" style="margin:22px 0 12px">Advisors</div>
  <div class="grid3">
    <div class="card" style="display:flex; gap:11px; align-items:flex-start">
      <div style="width:34px;height:34px;border-radius:9px;flex-shrink:0;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk';font-weight:700;font-size:13px">CS</div>
      <div><div style="font-weight:600;font-size:13.5px">Curtis Smith</div><div style="font-size:10px;font-weight:700;color:var(--peri-deep);text-transform:uppercase;letter-spacing:.04em;margin:2px 0 5px">Co-CEO, Firma Labs</div><p style="font-size:11px;color:var(--ink-mid);line-height:1.4">Co-CEO of Firma Labs — our incubator &amp; backer. Co-founder, Christ Is King.</p></div>
    </div>
    <div class="card" style="display:flex; gap:11px; align-items:flex-start">
      <div style="width:34px;height:34px;border-radius:9px;flex-shrink:0;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk';font-weight:700;font-size:13px">ES</div>
      <div><div style="font-weight:600;font-size:13.5px">Eric Skeldon</div><div style="font-size:10px;font-weight:700;color:var(--peri-deep);text-transform:uppercase;letter-spacing:.04em;margin:2px 0 5px">Founder, Kingdom Broker</div><p style="font-size:11px;color:var(--ink-mid);line-height:1.4">M&amp;A + business-brokerage — exits, valuations, a 2,500+ buyer network.</p></div>
    </div>
    <div class="card" style="display:flex; gap:11px; align-items:flex-start">
      <div style="width:34px;height:34px;border-radius:9px;flex-shrink:0;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk';font-weight:700;font-size:13px">GL</div>
      <div><div style="font-weight:600;font-size:13.5px">Greg Lovett</div><div style="font-size:10px;font-weight:700;color:var(--peri-deep);text-transform:uppercase;letter-spacing:.04em;margin:2px 0 5px">COO / CFO, Nobody Studios</div><p style="font-size:11px;color:var(--ink-mid);line-height:1.4">Ops &amp; finance at a venture studio — fundraising, structure, scale.</p></div>
    </div>
  </div>
</section>

<!-- 13 · ASK -->
<section class="slide peri">
  <span class="num mono">13</span>
  <div class="label">The ask</div>
  <h2>Raise <span class="grad">$250K for 10%</span> — angel / pre-seed, on a SAFE.</h2>
  <p class="lede" style="margin-top:16px">The product is built and Firma is anchoring. This small round buys ~20 months of a lean team of 2 to reach a <b>capped, live launch</b> and real demand — then we raise the seed at a higher cap.</p>
  <div class="grid3" style="margin-top:20px">
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700">01</div><h3 style="margin-top:6px">Runway</h3><p>2-person team, ~20 months, lean comp — build, ship, sell.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700">02</div><h3 style="margin-top:6px">Guarded launch</h3><p>A competitive audit + bounty → capped mainnet, real bounded value.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700">03</div><h3 style="margin-top:6px">Traction + community</h3><p>Firma live, public demo, first design-partner treasuries.</p></div>
  </div>
  <div class="kicker"><b>Terms:</b> SAFE, $2.5M post-money cap (≈10%), with Firma Labs anchoring. Next round: a $1.5–2.5M seed → name-brand audit, higher caps, scale.</div>
</section>

<!-- 14 · USE OF FUNDS -->
<section class="slide cool">
  <span class="num mono">14</span>
  <div class="label">Use of funds</div>
  <h2>Where the <span class="grad">$250K</span> goes.</h2>
  <div style="display:flex; height:46px; border-radius:9px; overflow:hidden; margin-top:26px">
    <div style="flex:0 0 82%; background:var(--peri); display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Space Mono',monospace; font-weight:700; font-size:13px">82%</div>
    <div style="flex:0 0 12%; background:var(--coral); display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Space Mono',monospace; font-weight:700; font-size:13px">12%</div>
    <div style="flex:0 0 6%; background:#9a8cf0"></div>
  </div>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><div class="stat mono" style="color:var(--peri-deep)">$205K</div><div style="font-weight:600; font-size:15px; margin-top:4px">Team &amp; runway</div><p style="font-size:12.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">2 people at ~$5k/mo — ~20 months to build, ship, and sell.</p></div>
    <div class="card"><div class="stat mono" style="color:var(--coral-deep)">$30K</div><div style="font-weight:600; font-size:15px; margin-top:4px">Security &amp; audit</div><p style="font-size:12.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">A competitive audit + Immunefi bounty, before real value moves.</p></div>
    <div class="card"><div class="stat mono" style="color:#6E5FD0">$15K</div><div style="font-weight:600; font-size:15px; margin-top:4px">Community &amp; growth</div><p style="font-size:12.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">Public demo, content, and the first design-partner treasuries.</p></div>
  </div>
  <div class="kicker">≈20 months of runway to a <b>capped launch + the first design partners</b> — then we raise the seed.</div>
</section>

<!-- 15 · VISION -->
<section class="slide" style="min-height:420px; justify-content:center">
  <span class="num mono">15</span>
  <div class="logo" style="margin-bottom:24px"><svg width="34" height="34" viewBox="0 0 100 100" style="border-radius:10px;box-shadow:0 5px 14px -3px rgba(108,108,240,.6)"><defs><linearGradient id="mwv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A82F4"/><stop offset="1" stop-color="#6C6CF0"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#mwv)"/><ellipse cx="50" cy="55.5" rx="35" ry="7" fill="#fff"/><path d="M32,55.5 A18,18 0 0 1 68,55.5 Z" fill="#fff"/></svg>Mintware</div>
  <h2 style="font-size:clamp(1.9rem,4vw,3rem)">Start with stock tokens. Then give <span class="grad">every asset on earth</span> a market.</h2>
  <p class="lede" style="margin-top:18px">A world where every real asset can be owned, traded and earned on — with liquidity owned by the people who use it. <b>Liquidity should be a public good.</b></p>
  <div class="row"><span class="pill"><span class="dot"></span>team@mintware.org</span><span class="pill">mintware.finance</span></div>
</section>

</div>

<script>(function(){
  var slides=Array.prototype.slice.call(document.querySelectorAll('.slide'));
  function post(){try{parent.postMessage({mwDeckHeight:document.documentElement.scrollHeight,mwDeckSlides:slides.map(function(s){return Math.round(s.getBoundingClientRect().top+window.scrollY)}),mwDeckCount:slides.length},'*')}catch(e){}}
  window.addEventListener('load',post);window.addEventListener('resize',post);
  if(window.ResizeObserver){try{new ResizeObserver(post).observe(document.body)}catch(e){}}
  window.addEventListener('message',function(e){var d=e.data||{};if(d&&d.mwDeckPrint){try{window.focus();window.print()}catch(err){}}});
  setTimeout(post,200);setTimeout(post,800);setTimeout(post,2000);
})();</script>
</body></html>`
