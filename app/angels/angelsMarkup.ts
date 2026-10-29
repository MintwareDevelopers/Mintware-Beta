/* eslint-disable */
// Auto-embedded PLAIN-ENGLISH investor deck HTML ("Angels" edition). Rendered ONLY inside the
// sandboxed iframe on /angels, and ONLY after the same password gate /deck uses passes.
// Regenerate from scratchpad/mintware-simple-deck.html via gen-angels-markup.js.
export const ANGELS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Mintware — Plain-English Overview</title>
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
  .logo{display:flex; align-items:center; gap:11px; font-family:'Space Grotesk'; font-weight:700; font-size:22px}
  @media print{
    html,body{background:#fff}
    .stage{padding:0}
    .slide{break-inside:avoid; page-break-after:always; box-shadow:none; border:1px solid var(--hair); margin:0 auto 0; min-height:auto; page-break-inside:avoid}
    .slide:last-child{page-break-after:auto}
    .num{display:none}
  }
</style>
</head><body>
<div class="stage">

<!-- 1 · COVER -->
<section class="slide" style="justify-content:center; align-items:flex-start; min-height:520px">
  <span class="num mono">01</span>
  <div class="logo"><svg width="34" height="34" viewBox="0 0 100 100" style="border-radius:10px;box-shadow:0 5px 14px -3px rgba(108,108,240,.6)"><defs><linearGradient id="mwc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A82F4"/><stop offset="1" stop-color="#6C6CF0"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#mwc)"/><ellipse cx="50" cy="55.5" rx="35" ry="7" fill="#fff"/><path d="M32,55.5 A18,18 0 0 1 68,55.5 Z" fill="#fff"/></svg>Mintware</div>
  <h1 style="margin-top:28px">Every asset<br><span class="grad">deserves a market.</span></h1>
  <p class="lede" style="margin-top:22px; font-size:1.3rem">Stocks, property, treasuries and digital dollars are all moving onto blockchains. Mintware makes sure there’s always a <b>fair place to buy and sell them</b> — and pays the people who make that possible.</p>
  <div class="row">
    <span class="pill"><span class="dot"></span>Seed round · confidential</span>
    <span class="pill">Plain-English overview</span>
  </div>
</section>

<!-- 2 · WHAT'S HAPPENING -->
<section class="slide cool">
  <span class="num mono">02</span>
  <div class="label">What’s happening</div>
  <h2>Real-world assets are <span class="grad">moving on-chain.</span></h2>
  <p class="lede" style="margin-top:18px">A share of Tesla, a slice of farmland, a US Treasury bill — all of these can now exist as a digital token you hold in your own wallet and trade any hour of the day. This is called <b>tokenization</b>, and it’s growing fast.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><div class="stat mono">$300B</div><div class="statlab">in digital dollars (stablecoins)</div></div>
    <div class="card"><div class="stat mono">$38B+</div><div class="statlab">in tokenized real-world assets</div></div>
    <div class="card"><div class="stat mono">~2,000</div><div class="statlab">stock tokens issued by Robinhood</div></div>
  </div>
  <div class="fine" style="margin-top:14px">Sources: rwa.xyz, Token Terminal, Robinhood (Oct 2026). Figures approximate.</div>
</section>

<!-- 3 · THE PROBLEM -->
<section class="slide">
  <span class="num mono">03</span>
  <div class="label">The problem</div>
  <h2>Owning it is easy. <span class="grad">Selling it fairly isn’t.</span></h2>
  <p class="lede" style="margin-top:18px">For anyone to buy or sell, someone must have money standing ready on the other side. That standing-ready money is called <b>liquidity</b>. Most new tokens don’t have enough of it — so prices jump around, a single sale moves the market, and owners can’t get out at a fair price.</p>
  <div class="grid2" style="margin-top:26px">
    <div class="card"><h3>Liquidity = the plumbing</h3><p>Money standing ready so trades can happen. No liquidity, no market.</p></div>
    <div class="card"><h3>Today it’s rented</h3><p>Issuers pay professional market makers, who keep the trading income and leave when the contract ends.</p></div>
  </div>
</section>

<!-- 4 · WHAT WE DO -->
<section class="slide lav">
  <span class="num mono">04</span>
  <div class="label">What we do</div>
  <h2>We let everyday holders <span class="grad">become the market.</span></h2>
  <p class="lede" style="margin-top:18px">With Mintware, anyone can put one asset into a market and earn from every trade that flows through it — the income professional market makers have always kept for themselves.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><h3>Earns trading fees</h3><p>A share of the fee every trade pays, while the market is busy.</p></div>
    <div class="card"><h3>Earns while it waits</h3><p>When the money isn’t needed for trading, it’s lent out to earn interest instead of sitting still.</p></div>
    <div class="card"><h3>Never locked</h3><p>Take it out any time. No lock-ups, no notice periods.</p></div>
  </div>
  <div class="kicker"><b>Two income streams on the same balance</b> — and it’s always yours.</div>
</section>

<!-- 5 · WHY IT MATTERS -->
<section class="slide coral">
  <span class="num mono">05</span>
  <div class="label">Why it matters</div>
  <h2>Better for everyone <span class="grad">around the asset.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><h3>Holders</h3><p>Earn far more than a savings account, from the asset they already believe in.</p></div>
    <div class="card"><h3>Issuers</h3><p>A real, deep market from day one — funded by their own community, not a rented firm.</p></div>
    <div class="card"><h3>Traders</h3><p>Fair prices at any hour, without one sale swinging the market.</p></div>
  </div>
  <div class="kicker">We think liquidity should be <b>a public good</b> — owned by the people who use it.</div>
</section>

<!-- 6 · HOW IT WORKS -->
<section class="slide">
  <span class="num mono">06</span>
  <div class="label">How it works</div>
  <h2>Add once. <span class="grad">It works on its own.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><h3>1 · Add</h3><p>Choose a market and add one asset. You get a share of that market.</p></div>
    <div class="card"><h3>2 · Earn</h3><p>Our engine keeps the money trading when it’s busy and earning interest when it’s quiet.</p></div>
    <div class="card"><h3>3 · Withdraw</h3><p>Cash out your share whenever you like.</p></div>
  </div>
  <div class="kicker">It’s like owning a small piece of the stock exchange — <b>without having to run it.</b></div>
</section>

<!-- 7 · WHY NOW -->
<section class="slide cool">
  <span class="num mono">07</span>
  <div class="label">Why now</div>
  <h2>The assets just <span class="grad">arrived.</span></h2>
  <p class="lede" style="margin-top:18px">In the last year, tokenized stocks went from under $1 billion to over $3 billion, and Robinhood launched its own blockchain full of stock tokens. The assets are here. The markets around them aren’t ready yet — that’s the gap we fill.</p>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><h3>The money is here</h3><p>Hundreds of billions in digital dollars and tens of billions in real-world assets, already on-chain.</p></div>
    <div class="card"><h3>The seat is open</h3><p>No one has made community-funded markets simple for everyday holders and issuers. That’s exactly what we do.</p></div>
  </div>
</section>

<!-- 8 · WHERE WE START -->
<section class="slide lav">
  <span class="num mono">08</span>
  <div class="label">Where we start</div>
  <h2>We start with <span class="grad">stock tokens on Robinhood Chain.</span></h2>
  <p class="lede" style="margin-top:18px">Around three in four dollars on Robinhood’s blockchain sit in tokenized stocks — and many of them still trade in thin, unreliable markets. Mintware is built right there, ready to give each one a deep, fair market.</p>
  <div class="kicker">Win stock tokens first — <b>then bring every real-world asset to market.</b></div>
</section>

<!-- 9 · WHERE WE ARE -->
<section class="slide">
  <span class="num mono">09</span>
  <div class="label">Where we are</div>
  <h2>Built, and live <span class="grad">on testnet.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><h3>Live on testnet</h3><p>Our market engine runs on Robinhood’s test network, and adding and withdrawing works end-to-end in our live app.</p></div>
    <div class="card"><h3>Backed</h3><p>Firma Labs is incubating us and anchoring this round.</p></div>
    <div class="card"><h3>Security-first</h3><p>An independent security audit comes before real money moves — the bar, not an afterthought.</p></div>
  </div>
</section>

<!-- 10 · HOW WE MAKE MONEY -->
<section class="slide cool">
  <span class="num mono">10</span>
  <div class="label">How we make money</div>
  <h2>We earn <span class="grad">when the market earns.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><h3>A cut of trading fees</h3><p>10% of the fees a market earns — never a cut of anyone’s money.</p></div>
    <div class="card"><h3>Issuer launches</h3><p>Issuers pay to launch a curated market for their asset.</p></div>
    <div class="card"><h3>The card</h3><p>A small fee when people spend from their earning balance with a Mintware card.</p></div>
  </div>
  <div class="kicker">More trading means more for holders — <b>and more for us.</b></div>
</section>

<!-- 11 · THE ASK -->
<section class="slide peri">
  <span class="num mono">11</span>
  <div class="label">The ask</div>
  <h2>Raise <span class="grad">$250K for 10%</span> — pre-seed, on a simple agreement.</h2>
  <p class="lede" style="margin-top:16px">Enough to reach a careful, real-money launch with our first company treasuries — then raise the next round at a higher price.</p>
  <div class="grid3" style="margin-top:20px">
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700">01</div><h3 style="margin-top:6px">Runway</h3><p>A lean 2-person team, ~12 months — build, ship, and sell.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700">02</div><h3 style="margin-top:6px">Safe launch</h3><p>An independent security review + a bug bounty before real money moves.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700">03</div><h3 style="margin-top:6px">First customers</h3><p>Our first crypto-company treasuries, live and earning.</p></div>
  </div>
  <div class="kicker"><b>Terms:</b> simple agreement (SAFE), $2.5M cap (≈10%).</div>
</section>

<!-- 12 · USE OF FUNDS -->
<section class="slide cool">
  <span class="num mono">12</span>
  <div class="label">Where the money goes</div>
  <h2>Where the <span class="grad">$250K</span> goes.</h2>
  <div style="display:flex; height:46px; border-radius:9px; overflow:hidden; margin-top:26px">
    <div style="flex:0 0 60%; background:var(--peri); display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Space Mono',monospace; font-weight:700; font-size:13px">60%</div>
    <div style="flex:0 0 16%; background:var(--coral); display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Space Mono',monospace; font-weight:700; font-size:13px">16%</div>
    <div style="flex:0 0 8%; background:#8f7ff0"></div>
    <div style="flex:0 0 8%; background:#a99cf3"></div>
    <div style="flex:0 0 8%; background:#c3b9f7"></div>
  </div>
  <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-top:24px">
    <div class="card"><div class="stat mono" style="color:var(--peri-deep); font-size:24px">$150K</div><div style="font-weight:600; font-size:14px; margin-top:4px">Team &amp; runway</div><p style="font-size:11.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">Two founders, ~12 months — build and sell.</p></div>
    <div class="card"><div class="stat mono" style="color:var(--coral-deep); font-size:24px">$40K</div><div style="font-weight:600; font-size:14px; margin-top:4px">Security</div><p style="font-size:11.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">Independent audit + bug bounty before real money moves.</p></div>
    <div class="card"><div class="stat mono" style="color:#6E5FD0; font-size:24px">$20K</div><div style="font-weight:600; font-size:14px; margin-top:4px">Legal</div><p style="font-size:11.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">The paperwork to do this properly and above-board.</p></div>
    <div class="card"><div class="stat mono" style="color:#6E5FD0; font-size:24px">$20K</div><div style="font-weight:600; font-size:14px; margin-top:4px">Infrastructure</div><p style="font-size:11.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">The servers, data, and rails that keep it running.</p></div>
    <div class="card"><div class="stat mono" style="color:#6E5FD0; font-size:24px">$20K</div><div style="font-weight:600; font-size:14px; margin-top:4px">Growth</div><p style="font-size:11.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">Landing the first crypto-company treasuries.</p></div>
  </div>
  <div class="kicker">≈12 months to a <b>safe launch and first paying customers</b> — then we raise the seed.</div>
</section>

<!-- 13 · VISION -->
<section class="slide lav" style="min-height:460px; justify-content:center">
  <span class="num mono">13</span>
  <div class="logo"><svg width="34" height="34" viewBox="0 0 100 100" style="border-radius:10px;box-shadow:0 5px 14px -3px rgba(108,108,240,.6)"><defs><linearGradient id="mwv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A82F4"/><stop offset="1" stop-color="#6C6CF0"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#mwv)"/><ellipse cx="50" cy="55.5" rx="35" ry="7" fill="#fff"/><path d="M32,55.5 A18,18 0 0 1 68,55.5 Z" fill="#fff"/></svg>Mintware</div>
  <h2 style="font-size:clamp(1.9rem,4vw,3rem); margin-top:26px; max-width:18ch">Start with stock tokens. Then give <span class="grad">every asset on earth</span> a market.</h2>
  <p class="lede" style="margin-top:20px; max-width:52ch">Every real asset, owned by anyone, traded at a fair price — with the people who hold it earning from every trade.</p>
  <div class="kicker">team@mintware.org · Liquidity should be a public good.</div>
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
</body></html>
`
