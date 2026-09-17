/* eslint-disable */
// Auto-embedded investor DATA ROOM HTML. Rendered ONLY inside the sandboxed iframe on /dataroom,
// and ONLY after the DATAROOM_PASSWORD gate passes. Regenerate from scratchpad/dataroom-view.html.
export const DATAROOM_HTML = `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>Mintware — Data Room</title>
<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap'>
<style>
:root{--ink:#191923;--mid:#494957;--soft:#8A8A9E;--peri:#6C6CF0;--peri-deep:#4C4CD6;--coral:#F0855E;--coral-deep:#C85A38;--ground:#F5F5FB;--band:#ECECFA;--warn:#FBF0EA;--hair:rgba(22,22,44,.10)}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,sans-serif;line-height:1.55}
.wrap{max-width:860px;margin:0 auto;padding:30px 20px 80px}
.top{margin-bottom:8px}.top h1{font-family:'Space Grotesk';font-weight:700;font-size:28px;margin:0}
.top p{color:var(--mid);margin:4px 0 0}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 8px}
.toc a{font-size:12.5px;font-weight:600;text-decoration:none;color:var(--peri-deep);background:#fff;border:1px solid var(--hair);border-radius:999px;padding:6px 12px}
section{background:#fff;border:1px solid var(--hair);border-radius:16px;padding:30px 34px;margin:18px 0;box-shadow:0 1px 2px rgba(20,20,50,.05),0 12px 34px -16px rgba(30,30,80,.14)}
h2.doctitle{font-family:'Space Grotesk';font-weight:700;font-size:22px;margin:0 0 6px;padding-bottom:10px;border-bottom:2px solid var(--band)}
h3{font-family:'Space Grotesk';font-weight:600;font-size:15px;margin:20px 0 8px;color:var(--peri-deep)}
p{margin:8px 0}p.sub{color:var(--soft);font-size:13px;font-style:italic}
ul{margin:8px 0 8px 0;padding-left:20px}li{margin:4px 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13.5px}
th,td{border:1px solid var(--hair);padding:7px 10px;text-align:left;vertical-align:top}
tr.hdr th{background:var(--ink);color:#fff;font-weight:600}
th.k{background:var(--band);font-weight:600;width:34%}
.callout{background:var(--warn);border:1px solid var(--coral);color:var(--coral-deep);border-radius:10px;padding:12px 16px;font-size:13px;margin:10px 0}
b{color:var(--ink)}
</style></head><body><div class='wrap'>
<div class='top'><h1>Mintware — Investor Data Room</h1><p>Read-only preview of the drafts. Source files (editable) are in ~/Desktop/MintWare/data-room/.</p></div>
<div class='toc'><a href='#s0'>One-Pager</a><a href='#s1'>V1 Revenue Model</a><a href='#s2'>Entity &amp; Deal Structure</a><a href='#s3'>Security Overview</a><a href='#s4'>Roadmap</a><a href='#s5'>Team &amp; Advisors</a><a href='#s6'>Data-Room Index</a></div>
<section id='s0'><h2 class='doctitle'>MINTWARE — One-Page Summary</h2>
<h3>Idle crypto treasuries, put to work — without ever locking them up</h3>
<p class='sub'>Confidential — prepared for prospective investors · December 2025</p>
<p class=''>Mintware turns a crypto company’s idle stablecoin treasury into working capital. We deploy it as on-chain liquidity where it earns lending yield and a share of trading fees — while it stays fully spendable, any moment. We take a 10% performance fee on the yield we generate, never a fee on principal.</p>
<h3>The problem</h3>
<p class=''>Exchanges, funds, and web3 startups sit on billions in stablecoins that earn almost nothing. Today the choice is binary: keep it spendable and earn ~0%, or lock it up to earn and lose access. So the cash sits idle.</p>
<h3>The solution</h3>
<p class=''>Mintware is the money standing ready in on-chain markets — the “liquidity” every trade runs on. A treasury’s idle digital dollars become that liquidity: two income streams (lending + trading fees) on the same dollar, still spendable via card or transfer at any time. Principal is never touched to cover a spend.</p>
<h3>Why now</h3>
<p class=''>Stablecoins now settle trillions of dollars a year, and the on-chain tools to put idle balances to work safely have only just matured. Crypto treasuries are piling up, and no one has made putting them to work simple, safe, and spendable.</p>
<h3>Where we are</h3>
<ul>
<li>Built — the full system exists (earn, spend, settle on-chain), not a concept.</li>
<li>Proven end-to-end — the complete loop has run live on test networks, down to a real settled transaction.</li>
<li>Security-first — an independent audit is the gate before real customer funds move; we build to that bar.</li>
</ul>
<h3>Business model</h3>
<p class=''>A 10% performance fee on yield generated for the customer (live in the product today). No account fees, no lock-ins. We earn only when the customer’s money does.</p>
<h3>The ask</h3>
<p class=''>Raising $250,000 for ≈10% on a SAFE ($2.5M post-money cap) — ~12 months of runway to a guarded launch with our first crypto-company treasuries, then a seed round at a higher valuation.</p>
<p class='sub'>Mintware LLC · Delaware · team@mintware.org · mintware.finance</p></section><section id='s1'>
<h2 class='doctitle'>V1 Revenue Model</h2>
<p class='sub'>Editable spreadsheet — Mintware-V1-Revenue-Model.xlsx. Revenue is driven by trading volume, not depth.</p>
<h3>What V1 is</h3><p>The LP Gateway. A user zaps their USDG into a curated third-party Uniswap V4 pool as a real liquidity position — they hold both tokens and bear 100% of the impermanent loss. Mintware supplies no capital and takes no IL. No JIT, no rehypothecation, no buffer.</p>
<h3>How Mintware earns</h3><p>The position collects trading fees; <b>Mintware takes 10% of the harvested fees</b> (live in the product), the user keeps 90%. Mintware earns on fee flow and bears none of the IL.</p>
<h3>The model</h3><p><b>Mintware revenue = trading volume (earning fees) × pool fee tier × 10%.</b> The driver is volume, not the size of the deposit. Breakeven ≈ $500M annual volume at a 0.30% tier (far less on higher-fee pools).</p>
<h3>Revenue by annual volume (0.30% tier)</h3><table>
<tr class='hdr'><th>Annual volume</th><th>Gross fees</th><th>Mintware revenue</th></tr>
<tr><td>$10,000,000</td><td>$30,000</td><td>$3,000</td></tr>
<tr><td>$100,000,000</td><td>$300,000</td><td>$30,000</td></tr>
<tr><td>$500,000,000</td><td>$1,500,000</td><td>$150,000</td></tr>
<tr><td>$1,000,000,000</td><td>$3,000,000</td><td>$300,000</td></tr>
<tr><td>$5,000,000,000</td><td>$15,000,000</td><td>$1,500,000</td></tr></table>
<h3>Volume, not depth — same book, different pools</h3><table>
<tr class='hdr'><th>Pool</th><th>Position</th><th>Annual volume</th><th>Fee tier</th><th>Mintware / yr</th></tr>
<tr><td>Cold blue-chip</td><td>$2,000,000</td><td>$10,000,000</td><td>0.05%</td><td>$500</td></tr>
<tr><td>Warm</td><td>$500,000</td><td>$25,000,000</td><td>0.30%</td><td>$7,500</td></tr>
<tr><td>Hot meme</td><td>$100,000</td><td>$20,000,000</td><td>1.00%</td><td>$20,000</td></tr>
<tr><td>Viral launch</td><td>$50,000</td><td>$40,000,000</td><td>1.00%</td><td>$40,000</td></tr></table>
<p class='sub'>The viral pool holds a fraction of the capital yet generates the most revenue — because it does the most volume (the user also carries the most IL there). Illustrative; only the 10% fee is a product fact.</p>
</section><section id='s2'><h2 class='doctitle'>MINTWARE LLC</h2>
<h3>Company &amp; Deal-Structure Summary</h3>
<p class='sub'>Confidential — prepared for prospective investors · December 2025</p>
<div class='callout'>Non-binding summary for discussion only. Not legal, tax, or investment advice, and not an offer to sell securities. Final terms are subject to definitive documents prepared by qualified counsel. See the structural note in §5.</div>
<h3>1 · The company</h3>
<table>
<tr><th class='k'>Legal name</th><td>Mintware LLC</td></tr>
<tr><th class='k'>Entity type</th><td>Limited Liability Company</td></tr>
<tr><th class='k'>Jurisdiction</th><td>State of Delaware, USA</td></tr>
<tr><th class='k'>Delaware file number</th><td>10445349  (SR 20254942627)</td></tr>
<tr><th class='k'>Date of formation</th><td>December 19, 2025</td></tr>
<tr><th class='k'>Duration</th><td>Perpetual</td></tr>
<tr><th class='k'>Registered agent</th><td>Delaware Registered Agent Service LLC — 8 The Green, Suite D, Dover, DE 19901</td></tr>
<tr><th class='k'>Federal EIN</th><td>41-3206951  (issued December 22, 2025)</td></tr>
<tr><th class='k'>Current tax status</th><td>Single-member LLC — disregarded entity</td></tr>
<tr><th class='k'>Sole member</th><td>Nicolas Robinson</td></tr>
<tr><th class='k'>Principal office</th><td>11214 Winthrop Main Street, Riverview, FL 33578</td></tr>
<tr><th class='k'>Contact</th><td>team@mintware.org</td></tr>
</table>
<h3>2 · What Mintware does</h3>
<p class=''>Mintware puts idle crypto treasuries to work. A crypto company deposits its idle stablecoin balance; Mintware deploys it as on-chain liquidity, where it earns lending yield and a share of trading fees while staying fully spendable at any moment. Mintware earns a 10% performance fee on the yield it generates — never a fee on principal. V1 is built and proven end-to-end on test networks today; an independent security audit is the gate before real customer funds move. Revenue detail is in the accompanying V1 Revenue Model.</p>
<h3>3 · The raise</h3>
<table>
<tr><th class='k'>Instrument</th><td>SAFE (Simple Agreement for Future Equity) — see the structural note in §5</td></tr>
<tr><th class='k'>Amount raised</th><td>$250,000</td></tr>
<tr><th class='k'>Post-money valuation cap</th><td>$2,500,000</td></tr>
<tr><th class='k'>Implied ownership at the cap</th><td>≈ 10%</td></tr>
<tr><th class='k'>Discount</th><td>None (valuation cap only)</td></tr>
<tr><th class='k'>Anticipated next round</th><td>Seed of $1.5M–$2.5M at a higher valuation</td></tr>
</table>
<h3>4 · Use of funds</h3>
<table>
<tr class='hdr'><th>Use</th><th>Amount</th><th>% of raise</th></tr>
<tr><td>Team &amp; runway (2 founders, ~12 months)</td><td>$150,000</td><td>60%</td></tr>
<tr><td>Security &amp; audit (independent audit + bug bounty)</td><td>$40,000</td><td>16%</td></tr>
<tr><td>Legal &amp; compliance</td><td>$20,000</td><td>8%</td></tr>
<tr><td>Infrastructure &amp; data</td><td>$20,000</td><td>8%</td></tr>
<tr><td>Growth &amp; first customers</td><td>$20,000</td><td>8%</td></tr>
<tr><td>Total</td><td>$250,000</td><td>100%</td></tr>
</table>
<h3>5 · Capitalization</h3>
<table>
<tr class='hdr'><th>Holder</th><th>Pre-raise</th><th>Post-raise (at cap, illus.)</th></tr>
<tr><td>Nicolas Robinson (founder / member)</td><td>100%</td><td>≈ 90%</td></tr>
<tr><td>New investors</td><td>—</td><td>≈ 10%</td></tr>
</table>
<p class='sub'>LLC ownership is held as membership interests (units), not shares of stock. Post-raise percentages are illustrative at the valuation cap and depend on final terms.</p>
<h3>6 · Structural note — please read</h3>
<p class=''>Mintware LLC is currently a single-member Delaware LLC taxed as a disregarded entity. A standard SAFE is designed for a C-corporation that issues stock. Admitting investors into an LLC — whether by SAFE or otherwise — has consequences the company and each investor should confirm with startup counsel before signing any document:</p>
<ul>
<li>The company becomes a multi-member LLC, which requires an Operating Agreement governing the members’ economic and voting rights.</li>
<li>Default tax treatment changes to a partnership (IRS Form 1065); members receive Schedule K-1s and pass-through income or loss — a structure many angel investors prefer to avoid.</li>
<li>LLC interests generally do not qualify for QSBS (Qualified Small Business Stock) capital-gains treatment, which is available on C-corporation stock.</li>
<li>Some investors’ standard SAFE templates assume a corporation and may require modification, or a conversion to a C-corp, to be usable.</li>
</ul>
<p class=''>The founder has elected to remain an LLC at this stage. The company and prospective investors should align on the instrument — and on whether a future conversion is warranted — with counsel. This document does not constitute legal or tax advice.</p></section><section id='s3'><h2 class='doctitle'>MINTWARE — Security Overview</h2>
<h3>How we protect customer funds</h3>
<p class='sub'>Confidential — prepared for prospective investors · December 2025</p>
<div class='callout'>V1 runs on test networks today and has not yet completed an external third-party audit. An independent audit is the explicit gate before real customer funds move on mainnet. This document describes our posture and the work done to reach that gate.</div>
<h3>Principles</h3>
<ul>
<li>Non-custodial by design — funds move through audited smart contracts, not a company wallet we can freely spend from.</li>
<li>Fail-closed everywhere — every money-moving control is OFF by default and refuses to act unless explicitly and correctly configured.</li>
<li>Principal is never touched to cover a spend — a spend settles against yield/position, and withdrawals are pure pro-rata and never brick.</li>
<li>Security is the gate, not an afterthought — external audit precedes any real-value mainnet launch.</li>
</ul>
<h3>What we’ve done so far</h3>
<p class=''>Beyond standard testing, the core contracts and off-chain services have been through repeated internal security review, each round re-run after every fix:</p>
<table>
<tr class='hdr'><th>Review</th><th>Focus</th><th>Outcome</th></tr>
<tr><td>Multi-round internal audits</td><td>Vault/liquidity accounting, access control, oracle/price manipulation</td><td>Findings fixed and regression-tested each round</td></tr>
<tr><td>Real-funds re-audit</td><td>Exploit paths that only appear with real capital at stake</td><td>High-severity items found and fixed before any mainnet value</td></tr>
<tr><td>Exploit-replay testing</td><td>Known real-world DeFi incident classes replayed against our own contracts</td><td>Defenses added and proven with fuzzing</td></tr>
<tr><td>Independent adversarial review</td><td>A second, empirical pass that runs tests rather than trusting reasoning</td><td>Confirmed findings fixed with reproduction tests</td></tr>
</table>
<h3>Threat modeling</h3>
<p class=''>We study real incidents in our category — including the rehypothecation-accounting class of exploit that cost one protocol roughly $8.3M — and build and test explicit defenses against each. The lesson we took from the market is not that the model fails, but that security has to come first; that failure is line one of our checklist, not a surprise.</p>
<h3>The path to real funds</h3>
<ul>
<li>Independent third-party smart-contract audit (funded by this round).</li>
<li>Public bug bounty (Immunefi-style) live before launch.</li>
<li>Guarded launch — a capped amount of value on mainnet first, scaled as it earns trust.</li>
</ul>
<p class='sub'>Full technical detail is available to serious investors under diligence.</p></section><section id='s4'><h2 class='doctitle'>MINTWARE — Roadmap</h2>
<h3>From built-and-proven to first customers to seed</h3>
<p class='sub'>Confidential — prepared for prospective investors · December 2025</p>
<h3>Now — pre-seed (product built)</h3>
<ul>
<li>V1 built end-to-end; full earn → spend → settle loop proven live on test networks.</li>
<li>Ongoing internal + independent security hardening.</li>
</ul>
<h3>This round — ~12 months, ~$250K</h3>
<table>
<tr class='hdr'><th>Phase</th><th>Milestone</th><th>~Timing</th></tr>
<tr><td>1 · Secure</td><td>Independent audit + public bug bounty complete</td><td>Months 1–4</td></tr>
<tr><td>2 · Launch</td><td>Guarded mainnet launch — capped treasury value live and earning</td><td>Months 4–6</td></tr>
<tr><td>3 · Land</td><td>First crypto-company treasuries onboarded, live and earning</td><td>Months 5–9</td></tr>
<tr><td>4 · Prove</td><td>Real usage + revenue metrics; expand the capped ceiling</td><td>Months 9–12</td></tr>
</table>
<h3>Next — seed round ($1.5M–$2.5M)</h3>
<ul>
<li>A safe, live product with real crypto-company treasuries earning on it and a metrics story strong enough to raise the seed at a higher valuation. Revenue tracks trading volume, not deposits: breakeven on the lean team is roughly $500M of annual trading volume across the book at a ~0.30% fee tier — far less on higher-fee pools (see V1 Revenue Model).</li>
<li>Marquee third-party audit as TVL grows.</li>
<li>Extend from company treasuries toward every wallet — “win the treasury, then give every balance the same superpower.”</li>
</ul>
<h3>What “done” looks like for this round</h3>
<p class=''>A safe, live product with real crypto-company treasuries earning on it and a metrics story strong enough to raise the seed at a higher valuation. Revenue tracks trading volume, not deposits: breakeven on the lean team is roughly $500M of annual trading volume across the book at a ~0.30% fee tier — far less on higher-fee pools (see V1 Revenue Model).</p></section><section id='s5'><h2 class='doctitle'>MINTWARE — Team &amp; Advisors</h2>
<p class='sub'>Confidential — prepared for prospective investors · December 2025</p>
<div class='callout'>DRAFT — please confirm the bracketed items before sending. Titles/bios marked [confirm] are placeholders.</div>
<h3>Founders</h3>
<table>
<tr><th class='k'>Nicolas Robinson — Founder &amp; CEO</th><td>Founder and sole member of Mintware LLC; built the product end-to-end. [Add 1–2 lines of background you want investors to see.]</td></tr>
<tr><th class='k'>Craig Barton — [Growth &amp; Business Development — confirm title]</th><td>[Confirm: growth / BD leadership across web3 companies. Add short bio.]</td></tr>
</table>
<h3>Advisors  [confirm inclusion + titles]</h3>
<table>
<tr><th class='k'>Curtis Smith</th><td>[Advisor — role/title to confirm.]</td></tr>
<tr><th class='k'>Eric Skeldon</th><td>[Advisor — M&amp;A / business brokerage background — confirm.]</td></tr>
<tr><th class='k'>Greg Lovett</th><td>[Advisor — operations / finance background — confirm.]</td></tr>
</table>
<p class='sub'>Note: bios and titles above are drafts based on earlier notes and need your confirmation. Tell me the final set and wording and I’ll lock it.</p></section><section id='s6'><h2 class='doctitle'>MINTWARE — Investor Data Room</h2>
<h3>Contents</h3>
<p class='sub'>Confidential — prepared for prospective investors · December 2025</p>
<p class=''>This package supports a $250,000 pre-seed raise (≈10%, SAFE, $2.5M cap) for Mintware LLC.</p>
<table>
<tr><th class='k'>Document</th><td>What it is</td></tr>
<tr><th class='k'>Mintware-One-Pager</th><td>The teaser — problem, solution, ask, on one page</td></tr>
<tr><th class='k'>Mintware-V1-Revenue-Model (xlsx)</th><td>How V1 makes money; editable assumptions, scenarios, breakeven</td></tr>
<tr><th class='k'>Mintware-Entity-and-Deal-Structure-Summary</th><td>Company facts, deal terms, cap table, the LLC/SAFE counsel note</td></tr>
<tr><th class='k'>Mintware-Security-Overview</th><td>Security posture, audit history, the path to real funds</td></tr>
<tr><th class='k'>Mintware-Roadmap</th><td>Milestones from launch to first customers to seed</td></tr>
<tr><th class='k'>Mintware-Team</th><td>Founders + advisors (draft)</td></tr>
<tr><th class='k'>Investor deck</th><td>mintware.finance/deck — password on request</td></tr>
<tr><th class='k'>Plain-English deck</th><td>mintware.finance/angels — password on request</td></tr>
<tr><th class='k'>On-chain proof</th><td>mintware.finance/proof — a real settled transaction</td></tr>
</table>
<p class='sub'>Formation certificate, EIN letter, and the SAFE (once finalized with counsel) are provided under diligence.</p>
<p class='sub'>Contact: team@mintware.org</p></section>
</div>
<script>(function(){
  function post(){try{parent.postMessage({mwDataroomHeight:document.documentElement.scrollHeight},'*')}catch(e){}}
  window.addEventListener('load',post);window.addEventListener('resize',post);
  if(window.ResizeObserver){try{new ResizeObserver(post).observe(document.body)}catch(e){}}
  setTimeout(post,200);setTimeout(post,800);setTimeout(post,2000);
  // In-page TOC anchors: the iframe is full-height and the PARENT page scrolls, so a plain
  // #hash has nowhere to scroll (and a sandboxed srcdoc can blank on it). Intercept clicks and
  // ask the parent to scroll to the section's offset instead.
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('a[href^="#"]'):null;
    if(!a)return;
    var id=a.getAttribute('href').slice(1);
    var el=id&&document.getElementById(id);
    if(!el)return;
    e.preventDefault();
    var y=Math.round(el.getBoundingClientRect().top+window.scrollY);
    try{parent.postMessage({mwDataroomScrollTo:y},'*')}catch(err){}
  });
})();</script>
</body></html>`
