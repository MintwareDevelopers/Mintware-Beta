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
  <h1 style="margin-top:28px">Never idle.<br>Never locked.<br><span class="grad">Always yours.</span></h1>
  <p class="lede" style="margin-top:22px; font-size:1.3rem">Idle money is everywhere — trillions of it, earning nothing. Mintware makes it <b>productive, without ever locking it up.</b> Starting with the treasury.</p>
  <div class="row">
    <span class="pill"><span class="dot"></span>Seed round · confidential</span>
    <span class="pill">On-chain treasury OS</span>
  </div>
</section>

<!-- 2 · PROBLEM -->
<section class="slide cool">
  <span class="num mono">02</span>
  <div class="label">The problem</div>
  <h2>Every dollar is forced to choose: <span class="grad">earn, or be spendable.</span> Never both.</h2>
  <p class="lede" style="margin-top:18px">And it isn’t just bank cash. Idle money is <b>everywhere</b> — team treasuries, personal accounts, the balances agents leave between calls, the buffers and float that keep every on-chain system running. Trillions, earning nothing — because the moment capital has to stay usable, yield gets in the way.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><div class="stat mono">~$9T</div><div class="statlab">annual stablecoin settlement volume</div></div>
    <div class="card"><div class="stat mono">~0%</div><div class="statlab">yield on the liquid balance funding it</div></div>
    <div class="card"><div class="stat mono">$B+</div><div class="statlab">DAO &amp; startup treasuries, mostly idle USDC</div></div>
  </div>
  <div class="kicker">It’s an <b>idle-cash tax</b> — and everyone from a solo wallet to a corporate treasury pays it.</div>
  <div class="fine" style="margin-top:10px">Sources: a16z State of Crypto 2025 (settlement volume); CoinDesk Research 2025 (idle stablecoins); DeepDAO 2025 (treasury aggregate). Figures approximate.</div>
</section>

<!-- 3 · SOLUTION -->
<section class="slide">
  <span class="num mono">03</span>
  <div class="label">The solution</div>
  <h2>Mintware makes idle money <span class="grad">productive — everywhere it sits.</span></h2>
  <p class="lede" style="margin-top:18px">Capital sits in a Uniswap&nbsp;V4 vault earning real yield. When you spend, you spend the <b>yield</b> — a payment is a <b>hold</b> against the earning position, not a withdrawal. The position never unwinds. Nothing locks. Nothing sits idle. The same engine works on any idle balance — we start with the treasury.</p>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><h3>Never idle</h3><p>Idle capital is routed to the best-yielding venue and works as V4 liquidity — three return streams on one balance.</p></div>
    <div class="card"><h3>Never locked</h3><p>Spendable to the cent, in real time — card, payroll, vendor payout — with no withdrawal window.</p></div>
    <div class="card"><h3>Always yours</h3><p>Non-custodial. Your keys, your contracts. No deposit desk, no lockup, no counterparty holding your cash.</p></div>
  </div>
  <div class="kicker"><b>Spend the yield, not the position.</b> That one primitive is the whole company.</div>
</section>

<!-- 4 · HOW IT WORKS -->
<section class="slide cool">
  <span class="num mono">04</span>
  <div class="label">How it works</div>
  <h2>Deposit once. Earn three ways. <span class="grad">Spend from yield.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700;font-size:13px">01</div><h3 style="margin-top:8px">Earn</h3><p>Best-rate lending (routed across venues) + just-in-time V4 market-making + recaptured MEV — stacked on one balance.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700;font-size:13px">02</div><h3 style="margin-top:8px">Hold</h3><p>A card swipe or payout authorizes in ~milliseconds as a hold against live vault NAV. The position keeps earning.</p></div>
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700;font-size:13px">03</div><h3 style="margin-top:8px">Settle</h3><p>On settlement, exactly enough shares burn to pay the merchant on-chain. The rest never moved.</p></div>
  </div>
  <div class="card" style="margin-top:20px; display:flex; gap:14px 18px; align-items:center; flex-wrap:wrap">
    <span class="pill"><span class="dot"></span>Proven on-chain</span>
    <span style="font-size:14px; color:var(--ink-mid); flex:1 1 300px">A real card swipe authorized off live NAV and settled on-chain — <span class="mono" style="color:var(--ink);font-weight:700">$2.00 · balance 12→10 USDC</span> — position never unwound. That’s the whole loop, working.</span>
    <div class="vrow" style="flex-basis:100%; margin-top:2px">
      <a class="vlink" href="https://mintware.finance/proof" target="_blank" rel="noopener">Verify the full run on-chain →</a>
      <a class="vlink" href="https://mintware.finance/the-math" target="_blank" rel="noopener">See the yield model →</a>
    </div>
  </div>
</section>

<!-- 5 · WHY NOW -->
<section class="slide lav">
  <span class="num mono">05</span>
  <div class="label">Why now</div>
  <h2>The rails to do this <span class="grad">only just shipped.</span></h2>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><h3>Uniswap V4 hooks</h3><p>Programmable liquidity — just-in-time provisioning, dynamic fees, MEV recapture. The vault mechanic was impossible before V4.</p></div>
    <div class="card"><h3>Stablecoins went mainstream</h3><p>USDC settlement, native-USDC chains, and card rails matured — a dollar can now be on-chain and spendable at the point of sale.</p></div>
    <div class="card"><h3>On-chain treasuries &amp; agents</h3><p>DAOs, crypto-native startups, and now AI agents hold real balances and need them liquid <i>and</i> productive.</p></div>
    <div class="card"><h3>Proven in-market</h3><p>The same rehypothecation + JIT engine already ships in production (Bunni&nbsp;v2) at ~100× volume / TVL. We bring it to treasuries — spendable, and security-first.</p></div>
  </div>
</section>

<!-- 6 · MARKET -->
<section class="slide">
  <span class="num mono">06</span>
  <div class="label">Market</div>
  <h2>Start with treasuries. <span class="grad">Expand to every balance.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><div class="statlab">Beachhead — SOM</div><h3 style="margin-top:6px">Crypto-native team treasuries</h3><p>DAOs + crypto startups holding idle USDC that must stay liquid. Clear buyer, real pain, reachable today.</p></div>
    <div class="card"><div class="statlab">Expansion — SAM</div><h3 style="margin-top:6px">On-chain businesses &amp; agents</h3><p>Any org or AI agent that holds a spendable balance — the x402 agent economy is greenfield.</p></div>
    <div class="card"><div class="statlab">Vision — TAM</div><h3 style="margin-top:6px">Consumer liquid cash</h3><p>The Liquid Sovereign Account: everyone’s checking account that never stops earning. Trillions in idle stablecoins.</p></div>
  </div>
  <div class="kicker">One primitive — <b>earn-while-spendable</b> — serves all three. We win the treasury, then ride the same rails outward.</div>
</section>

<!-- 7 · THE WEDGE -->
<section class="slide">
  <span class="num mono">07</span>
  <div class="label">The wedge — where we win first</div>
  <h2>Teams feel this pain <span class="grad">hardest,</span> and they’re the clearest buyer.</h2>
  <p class="lede" style="margin-top:18px">A crypto-native team holds a treasury in USDC. It must stay liquid — payroll, vendors, cards — so it earns nothing. Mintware turns that treasury into a <b>vault that funds spend out of yield</b>, with the controls a team actually needs.</p>
  <div class="grid2" style="margin-top:22px">
    <div class="card"><h3>Treasury that earns</h3><p>Idle USDC works in the vault; the team spends from yield, principal keeps compounding.</p></div>
    <div class="card"><h3>Cards, payroll, spend reporting</h3><p>Role-capped cards, CSV payroll, vendor payouts — every spend recorded to the treasury ledger with caps and categories.</p></div>
    <div class="card"><h3>Role-capped spend &amp; multisig</h3><p>Owner / manager / contributor / vendor caps enforced on every transaction; treasury behind a passkey multisig.</p></div>
    <div class="card"><h3>Live, on-chain, verifiable</h3><p>Every balance reads off the on-chain vault. Cap enforcement + settlement are real, not a dashboard mock.</p></div>
  </div>
  <div class="kicker">Land the treasury → the cards, payroll, and every teammate’s spend follow. <b>Expansion is built in.</b></div>
</section>

<!-- 8 · TRACTION -->
<section class="slide cool">
  <span class="num mono">08</span>
  <div class="label">Traction &amp; validation</div>
  <h2>We’re not cold-starting — <span class="grad">Firma Labs is incubating us.</span></h2>
  <div class="grid3" style="margin-top:20px">
    <div class="card"><h3>Incubated &amp; backed</h3><p>Firma Labs is incubating Mintware and backing this round — an ecosystem partner bringing capital and distribution, not just a check.</p></div>
    <div class="card"><div class="stat mono">1</div><div class="statlab">on-chain settle loop, proven live</div></div>
    <div class="card"><div class="stat mono grad">LIVE</div><div class="statlab">x402 pay-per-call surface, <a class="vlink" style="font-size:12px; border-bottom:none; color:var(--peri-deep); text-transform:none; letter-spacing:0" href="https://mintware.finance/agents" target="_blank" rel="noopener">in production →</a></div></div>
  </div>
  <div class="vrow" style="margin-top:22px; align-items:center; gap:14px 22px">
    <div class="receipt"><span class="rv mono">502</span><span class="rl">Forge tests green · 0 fail</span></div>
    <div class="receipt"><span class="rv mono">7 / 7</span><span class="rl">solvency + MEV invariants</span></div>
    <div class="receipt"><span class="rv mono">109</span><span class="rl">Rust service tests</span></div>
    <div class="receipt"><span class="rv mono">~10 ms</span><span class="rl">edge decision off live NAV</span></div>
    <a class="vlink" href="https://mintware.finance/proof" target="_blank" rel="noopener">Every receipt →</a>
  </div>
  <div class="kicker">A founding design-partner cohort is forming — the working demo turns discovery calls into commitments from crypto-native treasuries.</div>
</section>

<!-- 9 · BUSINESS MODEL -->
<section class="slide lav">
  <span class="num mono">09</span>
  <div class="label">Business model</div>
  <h2>We make money when your money <span class="grad">works.</span></h2>
  <div class="grid3" style="margin-top:22px">
    <div class="card"><h3>Yield spread</h3><p>A thin skim on the routed/earned yield — aligned: we only earn when the treasury earns.</p></div>
    <div class="card"><h3>Settlement / card fees</h3><p>Interchange + per-settlement fee on card and vendor spend flowing through the rails.</p></div>
    <div class="card"><h3>Treasury SaaS</h3><p>Per-seat / per-org for the treasury OS — cards, payroll, policy, multisig, reporting.</p></div>
  </div>
  <div class="kicker"><b>Aligned by design</b> — we only make money when your treasury does.</div>
</section>

<!-- 10 · MOAT -->
<section class="slide">
  <span class="num mono">10</span>
  <div class="label">Why us — the moat</div>
  <h2>Hard to copy, <span class="grad">and getting harder.</span></h2>
  <div class="grid2" style="margin-top:20px">
    <div class="card"><h3>The converged stack</h3><p>Vault + JIT hook + payment gateway + off-chain sub-150ms authorization, all in one lineage. Not a weekend fork.</p></div>
    <div class="card"><h3>Security is the wedge</h3><p>Audit rounds + red-team + formal methods before a dollar moves. Incumbents got exploited (Bunni: <b>$8.3M</b>) — that class of bug is our #1 audit item.</p></div>
    <div class="card"><h3>Treasury Mesh — a network effect</h3><p>Idle team capital JIT-provisions other teams’ pools. Every dollar earns; more teams → a deeper mesh. The moat compounds with each tenant.</p></div>
    <div class="card"><h3>Honesty &amp; legal posture</h3><p>Non-custodial framing and disciplined disclosures — de-risks the regulatory path competitors hand-wave.</p></div>
  </div>
</section>

<!-- 11 · WHAT'S REAL -->
<section class="slide">
  <span class="num mono">11</span>
  <div class="label">Where we are</div>
  <h2>Built and demonstrable — <span class="grad">the path to live is short.</span></h2>
  <div class="grid2" style="margin-top:20px">
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--live);margin-bottom:10px">Built &amp; proven</div>
      <div class="check"><span class="tick">✓</span><span><b>The full card loop runs</b> — issue → activate → swipe → authorize off live NAV → settle on-chain.</span></div>
      <div class="check"><span class="tick">✓</span><span><b>A pay-per-call surface is live in production</b> (agent x402).</span></div>
      <div class="check"><span class="tick">✓</span><span><b>Security-hardened &amp; audit-ready</b> — audit rounds, red-team, formal methods; scope frozen + deploy runbook done.</span></div>
      <div class="check"><span class="tick">✓</span><span><b>Converged vault + off-chain authorization + multi-tenant treasury</b> — built and tested.</span></div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--peri-deep);margin-bottom:10px">On the roadmap</div>
      <div class="check"><span style="color:var(--peri-deep);font-weight:700;flex-shrink:0">→</span><span><b>Mainnet deploy</b> — the vault stack ships next; testnet-proven today.</span></div>
      <div class="check"><span style="color:var(--peri-deep);font-weight:700;flex-shrink:0">→</span><span><b>Guarded audit + bounty</b> — competitive audit + Immunefi before real value (next slide).</span></div>
      <div class="check"><span style="color:var(--peri-deep);font-weight:700;flex-shrink:0">→</span><span><b>Card issuer</b> — wire the KYB partner; sandbox loop proven today.</span></div>
      <div class="check"><span style="color:var(--peri-deep);font-weight:700;flex-shrink:0">→</span><span><b>First real users</b> — the focus of this round.</span></div>
    </div>
  </div>
  <div class="kicker">Non-custodial and openly staged — capped launch first, the marquee audit as value grows. <b>Every claim has an <a class="vlink" style="font-size:15px" href="https://mintware.finance/proof" target="_blank" rel="noopener">on-chain receipt →</a></b></div>
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
  <p class="lede" style="margin-top:16px">The product is built and Firma is anchoring. This small round buys ~12 months of a lean team of 4 to reach a <b>capped, live launch</b> and real demand — then we raise the seed at a higher cap.</p>
  <div class="grid3" style="margin-top:20px">
    <div class="card"><div class="mono" style="color:var(--peri-deep);font-weight:700">01</div><h3 style="margin-top:6px">Runway</h3><p>4-person team, ~12 months, lean comp — build, ship, sell.</p></div>
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
    <div style="flex:0 0 84%; background:var(--peri); display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Space Mono',monospace; font-weight:700; font-size:13px">84%</div>
    <div style="flex:0 0 12%; background:var(--coral); display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Space Mono',monospace; font-weight:700; font-size:13px">12%</div>
    <div style="flex:0 0 4%; background:#9a8cf0"></div>
  </div>
  <div class="grid3" style="margin-top:26px">
    <div class="card"><div class="stat mono" style="color:var(--peri-deep)">$210K</div><div style="font-weight:600; font-size:15px; margin-top:4px">Team &amp; runway</div><p style="font-size:12.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">4 people at ~$5k/mo — ~10 months to build, ship, and sell.</p></div>
    <div class="card"><div class="stat mono" style="color:var(--coral-deep)">$30K</div><div style="font-weight:600; font-size:15px; margin-top:4px">Security &amp; audit</div><p style="font-size:12.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">A competitive audit + Immunefi bounty, before real value moves.</p></div>
    <div class="card"><div class="stat mono" style="color:#6E5FD0">$10K</div><div style="font-weight:600; font-size:15px; margin-top:4px">Community &amp; growth</div><p style="font-size:12.5px; color:var(--ink-mid); margin-top:6px; line-height:1.5">Public demo, content, and the first design-partner treasuries.</p></div>
  </div>
  <div class="kicker">≈10 months of runway to a <b>capped launch + the first design partners</b> — then we raise the seed.</div>
</section>

<!-- 15 · VISION -->
<section class="slide" style="min-height:420px; justify-content:center">
  <span class="num mono">15</span>
  <div class="logo" style="margin-bottom:24px"><svg width="34" height="34" viewBox="0 0 100 100" style="border-radius:10px;box-shadow:0 5px 14px -3px rgba(108,108,240,.6)"><defs><linearGradient id="mwv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A82F4"/><stop offset="1" stop-color="#6C6CF0"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#mwv)"/><ellipse cx="50" cy="55.5" rx="35" ry="7" fill="#fff"/><path d="M32,55.5 A18,18 0 0 1 68,55.5 Z" fill="#fff"/></svg>Mintware</div>
  <h2 style="font-size:clamp(1.9rem,4vw,3rem)">Win the treasury. Then give <span class="grad">every balance on earth</span> the same superpower.</h2>
  <p class="lede" style="margin-top:18px">A world where no dollar ever sits idle and no dollar is ever locked — for teams, for people, for agents. <b>Never idle. Never locked. Always yours.</b></p>
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
