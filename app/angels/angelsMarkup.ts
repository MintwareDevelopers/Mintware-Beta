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
  <h1 style="margin-top:28px">Crypto companies sit on<br>billions in idle cash.<br><span class="grad">We put it to work.</span></h1>
  <p class="lede" style="margin-top:22px; font-size:1.3rem">Exchanges, funds, and web3 startups hold huge balances of <b>digital dollars</b> — stablecoins, always worth $1 — that earn almost nothing. Mintware turns that idle cash into <b>working capital that earns</b>, while staying spendable any moment.</p>
  <div class="row">
    <span class="pill"><span class="dot"></span>Seed round · confidential</span>
    <span class="pill">Plain-English overview</span>
  </div>
</section>

<!-- 2 · PROBLEM -->
<section class="slide cool">
  <span class="num mono">02</span>
  <div class="label">The problem</div>
  <h2>Every crypto treasury faces the same choice: <span class="grad">stay spendable, or earn.</span></h2>
  <p class="lede" style="margin-top:18px">A crypto company's cash sits on-chain as digital dollars. Keep it spendable for payroll and operations and it earns nothing; move it somewhere that earns and it's locked away. So <b>billions in stablecoins sit idle</b> — spendable, but dead.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><div class="stat mono">$B+</div><div class="statlab">in crypto-company treasuries, mostly idle stablecoins</div></div>
    <div class="card"><div class="stat mono">~0%</div><div class="statlab">earned on the balance they keep on hand</div></div>
    <div class="card"><div class="stat mono">~$9T/yr</div><div class="statlab">digital dollars now settle this much annually</div></div>
  </div>
  <div class="kicker">It's an <b>idle-cash tax</b> — and every crypto company pays it.</div>
</section>

<!-- 3 · THE PLUMBING -->
<section class="slide">
  <span class="num mono">03</span>
  <div class="label">How crypto markets work</div>
  <h2>Every market runs on <span class="grad">money standing ready.</span></h2>
  <p class="lede" style="margin-top:18px">For anyone to trade — a token, a digital dollar, anything on-chain — someone must have money standing ready on the other side. In crypto that standing-ready money is called <b>liquidity</b>, and it's the plumbing every market runs on.</p>
  <div class="grid2" style="margin-top:26px">
    <div class="card"><h3>Liquidity = the plumbing</h3><p>Money standing ready so trades can happen. No liquidity, no market.</p></div>
    <div class="card"><h3>Depth = the pressure</h3><p>How much is standing ready. More depth means smoother prices and bigger trades.</p></div>
  </div>
  <div class="kicker">Whoever supplies that liquidity earns a <b>fee on every trade</b> that flows through it. In crypto, that's a job any company's idle cash could do — but almost none does.</div>
</section>

<!-- 4 · WHAT WE DO -->
<section class="slide lav">
  <span class="num mono">04</span>
  <div class="label">What we do</div>
  <h2>We turn idle company balances into <span class="grad">that liquidity.</span></h2>
  <p class="lede" style="margin-top:18px">Mintware takes a crypto company's idle digital dollars and puts them to work as liquidity in on-chain markets. They earn <b>two ways at once</b> — and stay spendable the entire time.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><h3>Earns lending yield</h3><p>The return digital dollars make when they're lent into on-chain credit markets.</p></div>
    <div class="card"><h3>Earns trading fees</h3><p>A share of the fee every on-chain trade pays to the liquidity standing ready.</p></div>
    <div class="card"><h3>Still spendable</h3><p>Never locked — spend it or withdraw it any moment.</p></div>
  </div>
  <div class="kicker"><b>Two income streams on the same digital dollar</b> — that you can still spend.</div>
</section>

<!-- 5 · THE MAGIC -->
<section class="slide coral">
  <span class="num mono">05</span>
  <div class="label">The magic</div>
  <h2>It earns right up to <span class="grad">the second you spend it.</span></h2>
  <p class="lede" style="margin-top:18px">Every dollar keeps working the entire time it sits there — and it's <b>all yours to spend, any moment.</b> Tap a Mintware card and the money is there instantly; no idle cash waiting around, no penalty for pulling it out, no early exit to plan.</p>
  <p class="lede" style="margin-top:16px">A money-market fund makes you choose between earning and access. Mintware doesn't — you get <b>both, on the same dollar.</b></p>
  <div class="kicker">Spend it all, spend a little, or leave it working — <b>it's always yours, and always earning until the moment you use it.</b></div>
</section>

<!-- 6 · NEVER LOCKED -->
<section class="slide">
  <span class="num mono">06</span>
  <div class="label">Why it isn't a trade-off</div>
  <h2>Earns like an investment. <span class="grad">Spends like a checking account.</span></h2>
  <p class="lede" style="margin-top:18px">Normally, making money earn means locking it away. Mintware doesn't. Your balance stays <b>fully spendable — every dollar, any moment</b> — and it's earning the whole time it sits there. No lock-ups, no notice periods, nothing to break open to get to your cash.</p>
  <div class="grid2" style="margin-top:26px">
    <div class="card"><h3>The old way</h3><p>Lock it up to earn. Break it to spend. Pick one.</p></div>
    <div class="card"><h3>Mintware</h3><p>Fully spendable and earning at the same time. No picking.</p></div>
  </div>
</section>

<!-- 7 · WHY NOW -->
<section class="slide cool">
  <span class="num mono">07</span>
  <div class="label">Why now</div>
  <h2>Digital dollars just went <span class="grad">mainstream.</span></h2>
  <p class="lede" style="margin-top:18px">Stablecoins now settle trillions of dollars a year — rivaling the big card networks — and the on-chain tools to put idle balances to work safely have only just matured. Crypto treasuries are piling up, and <b>no one has made putting them to work simple, safe, and spendable.</b></p>
  <div class="grid2" style="margin-top:26px">
    <div class="card"><h3>The money is here</h3><p>Trillions in digital dollars now move on-chain every year — the idle pile is enormous.</p></div>
    <div class="card"><h3>The seat is open</h3><p>No one's made crypto treasury cash earn while staying spendable. That's exactly what we do.</p></div>
  </div>
  <div class="kicker">Right idea, right rails, right moment — and <b>built security-first from day one.</b></div>
</section>

<!-- 8 · THE WEDGE -->
<section class="slide lav">
  <span class="num mono">08</span>
  <div class="label">Where we start</div>
  <h2>We start with <span class="grad">crypto company treasuries.</span></h2>
  <p class="lede" style="margin-top:18px">Every crypto company — exchanges, funds, DAOs, web3 startups — sits on idle digital dollars it needs to keep spendable. We're the <b>smarter place to put it</b>: it earns, it stays spendable for payroll and vendors, and every movement is on-chain and on the record.</p>
  <div class="kicker">Win the crypto treasury first — then give <b>every wallet on earth</b> the same thing. Think big, start focused.</div>
</section>

<!-- 9 · TRACTION -->
<section class="slide">
  <span class="num mono">09</span>
  <div class="label">Where we are</div>
  <h2>Built and <span class="grad">proven end-to-end.</span></h2>
  <div class="grid3" style="margin-top:24px">
    <div class="card"><h3>Built</h3><p>The full system exists — earn, spend, and settle on-chain — not a concept deck.</p></div>
    <div class="card"><h3>Security-first</h3><p>Built to pass an independent audit before real money moves — the bar, not an afterthought.</p></div>
    <div class="card"><h3>Proven</h3><p>The whole loop has run live — earned, spent, and settled — down to a real transaction.</p></div>
  </div>
  <div class="kicker">Running on test networks today; an <b>independent security audit is the gate</b> before real money moves. We're building to that bar, not around it.</div>
</section>

<!-- 10 · BUSINESS MODEL -->
<section class="slide cool">
  <span class="num mono">10</span>
  <div class="label">How we make money</div>
  <h2>We earn <span class="grad">only when you do.</span></h2>
  <p class="lede" style="margin-top:18px">Mintware takes a <b>small share of the earnings</b> it generates for you — nothing more.</p>
  <div class="grid3" style="margin-top:24px">
    <div class="card"><h3>A cut of the earnings</h3><p>A slice of what we earn for you — never a cut of your principal.</p></div>
    <div class="card"><h3>No account fees</h3><p>No monthly fees, no minimums, no lock-in.</p></div>
    <div class="card"><h3>Fully aligned</h3><p>No earnings means no cut — we only win when your money does.</p></div>
  </div>
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
<section class="slide" style="background:var(--ink); border-color:transparent; min-height:460px; justify-content:center">
  <span class="num mono" style="color:rgba(255,255,255,.4)">13</span>
  <div class="logo" style="color:#fff"><svg width="34" height="34" viewBox="0 0 100 100" style="border-radius:10px;box-shadow:0 5px 14px -3px rgba(108,108,240,.6)"><defs><linearGradient id="mwv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A82F4"/><stop offset="1" stop-color="#6C6CF0"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#mwv)"/><ellipse cx="50" cy="55.5" rx="35" ry="7" fill="#fff"/><path d="M32,55.5 A18,18 0 0 1 68,55.5 Z" fill="#fff"/></svg>Mintware</div>
  <h2 style="color:#fff; font-size:clamp(1.9rem,4vw,3rem); margin-top:26px; max-width:16ch">Win the treasury. Then give <span style="color:var(--coral)">every balance on earth</span> the same superpower.</h2>
  <p class="lede" style="color:rgba(255,255,255,.72); margin-top:20px; max-width:52ch">Money that never sits idle, never gets locked, and always stays yours — for every company, every wallet, every account.</p>
  <div class="kicker" style="color:rgba(255,255,255,.6); border-top:1px solid rgba(255,255,255,.14); margin-top:30px">team@mintware.org · Never idle. Never locked. Always yours.</div>
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
