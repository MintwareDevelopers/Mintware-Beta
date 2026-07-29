'use client'

import { useState, type ReactNode } from 'react'
import { MwNav } from '@/components/web2/MwNav'

// ── shared bits ──────────────────────────────────────────────────────────────
type Nav = (id: string) => void
const EY  = 'font-atx-mono uppercase tracking-[0.18em] text-[11px] text-atx-blue'
const SUB = 'text-[17px] text-atx-ink/80 mb-6 leading-[1.5]'

function Ln({ to, nav, children }: { to: string; nav: Nav; children: ReactNode }) {
  return <button onClick={() => nav(to)} className="text-atx-blue underline-offset-2 hover:underline cursor-pointer">{children}</button>
}
function Gap({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="border border-atx-ink border-l-4 border-l-atx-coral bg-atx-panel px-[18px] py-4 my-5">
      <div className="font-atx-mono text-[10px] tracking-[0.15em] uppercase text-atx-clay mb-1.5">{k}</div>
      <div className="text-[14.5px] leading-[1.5]">{children}</div>
    </div>
  )
}
function Note({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="border border-atx-ink border-l-4 border-l-atx-blue bg-atx-panel px-[18px] py-4 my-5">
      <div className="font-atx-mono text-[10px] tracking-[0.15em] uppercase text-atx-blue mb-1.5">{k}</div>
      <div className="text-[14.5px] leading-[1.5]">{children}</div>
    </div>
  )
}
function Claim({ children }: { children: ReactNode }) {
  return <div className="border border-atx-ink bg-atx-ink text-atx-bone px-[22px] py-5 my-6 text-[19px] font-bold tracking-[-0.01em] leading-[1.3] [&_b]:text-atx-acid">{children}</div>
}
function Spec({ children }: { children: ReactNode }) {
  return <div className="border border-atx-ink bg-atx-panel font-atx-mono text-[12.5px] px-4 py-3.5 my-4 whitespace-pre-wrap leading-[1.7] overflow-x-auto [&_b]:text-atx-blue [&_.g]:text-atx-grey">{children}</div>
}
function Pipe({ items }: { items: [string, string, string][] }) {
  return (
    <div className="flex my-4.5 border border-atx-ink flex-wrap">
      {items.map(([n, h, p], i) => (
        <div key={i} className="flex-1 min-w-[130px] px-3.5 py-3 border-r border-atx-ink last:border-r-0 text-[12.5px] max-[560px]:border-r-0 max-[560px]:border-b max-[560px]:last:border-b-0">
          <div className="font-atx-mono text-[10px] tracking-[0.1em] uppercase text-atx-grey">{n}</div>
          <div className="font-bold mt-0.5">{h}</div>
          <div className="mt-0.5">{p}</div>
        </div>
      ))}
    </div>
  )
}
const TABLE = 'w-full border-collapse text-[13px] my-4 [&_th]:border [&_th]:border-atx-ink/15 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:align-top [&_th]:bg-atx-panel [&_th]:font-atx-mono [&_th]:text-[10px] [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-atx-grey [&_td]:border [&_td]:border-atx-ink/15 [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-left [&_td]:align-top [&_td]:leading-[1.45]'
const YES = 'text-atx-mesquite font-bold'
const NO  = 'text-atx-ink/45'
const US  = '[&>td]:bg-atx-blue/[0.06] [&>td:first-child]:text-atx-blue [&>td:first-child]:font-bold'

// ── content sections ─────────────────────────────────────────────────────────
function Overview({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ Start here · Overview</div>
      <h1>The reputation economy of DeFi</h1>
      <p className={SUB}>Attribution measures every on-chain contribution. Mintware is where those contributions earn — across DeFi markets and real-world assets, on one reputation-weighted engine.</p>
      <p>Mintware exists to fix two failures at once. In DeFi, incentives attract the capital you least want — mercenary money that farms an emission and leaves. In real-world assets, tokenization delivered a token but not a market — gated, illiquid, no more useful than the spreadsheet it replaced. Both failures share one root: <b>rewards priced by the size of your wallet instead of the quality of your contribution.</b></p>
      <p>Mintware measures contribution (Attribution), holds it (Vaults), and pays it (the Rewards engine) — weighting every reward by reputation, commitment, and referral quality rather than raw dollars.</p>
      <Pipe items={[
        ['Measure', 'Attribution', 'On-chain reputation across 100+ chains — six signals, one score.'],
        ['Hold', 'Vaults', 'A shared ERC-4626 base — DeFi LP on one surface, RWA deals on the other.'],
        ['Reward', 'Engine', 'Campaigns that pay reputation × commitment × referral quality.'],
      ]} />
      <Note k="✴ Two audiences">If you run a <b>DeFi protocol</b>, start with <Ln to="defi" nav={nav}>Where the value is</Ln>. If you&apos;re an <b>RWA issuer</b>, the section you don&apos;t want to miss is <Ln to="rwa-wrapper" nav={nav}>The wrapper</Ln> — the piece that lets us make your asset liquid without ever becoming a securities dealer.</Note>
    </>
  )
}
function Model() {
  return (
    <>
      <div className={EY}>✴ Start here · The whole model</div>
      <h1>The model in one page</h1>
      <p className={SUB}>Everything else expands on this. If you read one screen, read this one.</p>
      <h3>1 · Reputation is the unit</h3>
      <p>Attribution scores any wallet from its on-chain history — volume, trading, holding, liquidity, governance, and the people it brings in. That score is the multiplier on every reward, up to <b>1.95×</b>. We reward who you are on-chain, not how much you deposited.</p>
      <h3>2 · One engine, two surfaces</h3>
      <p>The same reward engine runs over a <b>DeFi</b> surface (managed Uniswap V4 liquidity) and an <b>RWA</b> surface (real-world deals wrapped as tradeable tokens). The engine is surface-agnostic: an RWA deal is &ldquo;just another pool&rdquo; to point a campaign at.</p>
      <h3>3 · We incentivize the wrapper, never the holder</h3>
      <p>On RWA, Mintware rewards the <b>wrapped, transferable token</b> and never enforces who may hold it. Eligibility lives in the token, upstream of us. That one decision keeps us permissionless, keeps the asset liquid, and keeps our regulatory posture that of a DEX + rewards layer — not a securities dealer.</p>
      <h3>4 · Quality of capital, proven on-chain</h3>
      <p>Every reward-credited action is verified on-chain before a point is written, and rewards are weighted to attract sticky, duration-matched, relationship-sourced capital — the opposite of mercenary TVL.</p>
      <Claim>We measure Contribution and reward it. <b>Everything else is implementation.</b></Claim>
    </>
  )
}
function Attribution() {
  return (
    <>
      <div className={EY}>✴ How it works · Attribution</div>
      <h1>Attribution — how we measure</h1>
      <p className={SUB}>A chain-agnostic reputation score computed from six on-chain signals, updated from real activity, and used as the multiplier on everything you earn.</p>
      <p>Attribution reads a wallet&apos;s full on-chain life and reduces it to one score (max <b>925</b>). It is computed independently of Mintware — a wallet has a score whether or not it has ever touched us — and works for any address on 100+ chains, including Solana.</p>
      <table className={TABLE}>
        <thead><tr><th>Signal</th><th>Max</th><th>What it reads</th></tr></thead>
        <tbody>
          <tr><td><b>Volume</b></td><td>100</td><td>Lifetime traded value</td></tr>
          <tr><td><b>Trading</b></td><td>75</td><td>Frequency, consistency, venue diversity</td></tr>
          <tr><td><b>Holding</b></td><td>100</td><td>Conviction — what you keep, and for how long</td></tr>
          <tr><td><b>Liquidity</b></td><td>150</td><td>LP provision — depth and duration</td></tr>
          <tr><td><b>Governance</b></td><td>100</td><td>Votes, proposals, delegation</td></tr>
          <tr><td><b>Sharing</b></td><td>400</td><td>Your referral tree and its quality</td></tr>
        </tbody>
      </table>
      <p>Scores map to <b>Bronze / Silver / Gold</b> tiers and a percentile. Two multipliers derive from the score, applied at the moment a point is credited (never re-applied at payout):</p>
      <Spec><span className="text-atx-blue font-bold">combined</span> = attribution_multiplier × sharing_multiplier   <span className="g">// capped at 1.95×</span></Spec>
      <Note k="✴ Why it matters">Reputation in DeFi is invisible and unportable — every protocol re-underwrites you from zero. Attribution turns your history into a portable, earned asset that pays you a bigger share of every pool you enter. It is also the quality filter an RWA issuer cannot buy with raw APY.</Note>
    </>
  )
}
function Rewards() {
  return (
    <>
      <div className={EY}>✴ How it works · Rewards engine</div>
      <h1>Rewards — how we track &amp; pay</h1>
      <p className={SUB}>A surface-agnostic engine that verifies every action on-chain, credits reputation-weighted points, and settles to gas-free Merkle claims.</p>
      <h2>The formula</h2>
      <Spec><span className="text-atx-blue font-bold">reward</span> = attribution_score × lock_duration × referral_quality   <span className="g">// never: how many dollars</span></Spec>
      <h2>How we track — verification, not trust</h2>
      <p>A reward is never credited on a claim. Every reward-bearing swap is checked against its on-chain receipt before a single point is written:</p>
      <ul>
        <li>The transaction <b>exists and succeeded</b> (<code>status === 0x1</code>).</li>
        <li>The <b>sender matches</b> the rewarded wallet — no spoofing another address&apos;s trade.</li>
        <li>The router is in the <b>known LI.FI router set</b> — not an arbitrary contract.</li>
        <li>The <b>Mintware fee is present in the calldata</b> — strip the fee, forfeit the reward.</li>
      </ul>
      <p>RWA <code>hold</code> credit can&apos;t be a per-transaction event, so a weekly cron snapshots on-chain <code>vRWA</code> balances and credits <code>rate × balance × duration × attribution</code>. It is idempotent by construction — a campaign-scoped key means a wallet is never double-credited for the same epoch.</p>
      <h2>How we pay — epochs → Merkle → claim</h2>
      <Spec><span className="g">action</span> → <span className="text-atx-blue font-bold">verify on-chain</span> → credit to epoch_state → settle → <span className="text-atx-blue font-bold">Merkle root</span> → user claims leaf</Spec>
      <p>At epoch close, points settle into a Merkle distribution. The oracle signs the root off-chain via EIP-712, so distributions cost <b>zero oracle gas</b> and the oracle never holds custody. Users claim their own leaf directly on <code>MintwareDistributor v2</code>. A <b>duration-match</b> bonus rewards locking to (or through) a deal&apos;s settlement date.</p>
      <Gap k="✕ The gap it closes">Emissions pay the biggest wallet, which farms and exits first — every program races its own users to the door. Weighting by reputation and lock duration, and proving each action on-chain, rewards the capital an issuer actually wants: sticky, qualified, and matched to the asset.</Gap>
    </>
  )
}
function Vaults({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ How it works · Vaults</div>
      <h1>Vaults — two surfaces, one base</h1>
      <p className={SUB}>A shared ERC-4626 vault base and multi-tenant factory. One audited code path, two markets.</p>
      <h3>DeFi vault</h3>
      <p>Managed Uniswap V4 liquidity behind a hook. The hook captures MEV back to LPs, keeps the range auto-managed (no rebalancing), and splits fees by an <b>attribution-weighted</b> share — the same position earns you more than the wallet beside you, up to 2×.</p>
      <h3>RWA vault</h3>
      <p>An ERC-4626 vault whose shares are <b>vRWA</b> — a bearer token backed by a real-world instrument held in an SPV. v1 is reserve-only (USDC in the vault, no pool); the <code>vRWA/USDC</code> oracle-banded V4 pool is the secondary market layered on top.</p>
      <h3>Lock tiers</h3>
      <p>Deposits pick a lock tier (Flex → Core); longer locks earn a higher multiplier, early exit pays a penalty. On RWA, locks are wired to the deal&apos;s maturity so capital that stays as long as the asset needs it earns the duration-match bonus. See <Ln to="rwa-deals" nav={nav}>Deal qualification</Ln>.</p>
    </>
  )
}
function DeFi({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ For DeFi teams &amp; users · The value</div>
      <h1>Where the value is</h1>
      <p className={SUB}>For a user: the same deposit earns more, because your reputation is worth something. For a team: reward the users you actually want, not the mercenaries you don&apos;t.</p>
      <h2>For users</h2>
      <ul>
        <li><b>Your reputation is paid.</b> Attribution lifts your fee share up to 2× — the identical LP position out-earns a cold wallet&apos;s.</li>
        <li><b>MEV protection.</b> The V4 hook routes value bots would extract back to LPs.</li>
        <li><b>Set-and-forget.</b> Range is auto-managed; idle capital is routed to yield.</li>
        <li><b>Every action counts.</b> Swaps, referrals, holding — each is scored and multiplied, building a score that pays across every future pool.</li>
      </ul>
      <h2>For teams</h2>
      <ul>
        <li><b>Reward the right users.</b> Point a campaign at any pool and pay loyal, high-reputation wallets instead of mercenary farmers.</li>
        <li><b>Retention &amp; conversion.</b> The reputation filter drives the stickiness raw emissions never could — your best users earn more, and stay.</li>
        <li><b>Two campaign types.</b> A <b>Token Reward Pool</b> (per-swap, self-serve, depletes) or a <b>Points Campaign</b> (epoch-distributed, score-gated, multiplier-weighted).</li>
        <li><b>Embeddable.</b> A live campaign can run on your own site, verified as served from your domain.</li>
      </ul>
      <Note k="✴ Integrity you can point to">Because every credited swap is verified against its on-chain receipt (see <Ln to="rewards" nav={nav}>how we track</Ln>), your emissions can&apos;t be drained by wash-traded volume. You pay for real flow by real wallets with real reputation.</Note>
    </>
  )
}
function RwaWhy() {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · The thesis</div>
      <h1>Why RWAs belong on DeFi</h1>
      <p className={SUB}>Tokenizing your asset is solved and commoditized. What isn&apos;t: your cold-start, your distribution, and your dead secondary market. That gap is the whole opportunity.</p>
      <p>Trillions were &ldquo;tokenized&rdquo; this cycle, and most of it sits there — gated behind the same accreditation wall, redeemable only by request, unable to touch the rest of DeFi. Wrapping an asset in a token was never the point. What the token can <i>do</i> is.</p>
      <table className={TABLE}>
        <thead><tr><th>Tokenized — still stuck</th><th>On Mintware — unlocked</th></tr></thead>
        <tbody>
          <tr><td>Accredited investors only</td><td className={YES}>Any wallet, any amount — no KYC to hold or trade</td></tr>
          <tr><td>Redemption by request, thin secondary</td><td className={YES}>Trade vRWA 24/7 on Uniswap</td></tr>
          <tr><td>A token that can&apos;t touch DeFi</td><td className={YES}>Composable ERC-20 — collateral, strategies, vaults</td></tr>
          <tr><td>A database entry on someone&apos;s cap table</td><td className={YES}>A bearer token you actually hold</td></tr>
        </tbody>
      </table>
      <Claim>Real-world assets don&apos;t need a blockchain to exist. <b>They need DeFi to finally move.</b></Claim>
    </>
  )
}
function RwaWrapper() {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · The breakthrough</div>
      <h1>The wrapper: liquidity without becoming a securities dealer</h1>
      <p className={SUB}>This is the piece competitors can&apos;t copy without tearing down their own walls. It&apos;s why Mintware can offer open, rewarded, liquid markets on RWA-backed tokens when walled-garden platforms structurally cannot.</p>
      <h2>The trap every RWA platform falls into</h2>
      <p>The instant a platform decides <i>who is allowed to hold or buy</i> an asset, it becomes a gatekeeper — and legally, a distributor soliciting a private placement. That forces KYC walls onto every surface, which kills liquidity and rebuilds the exact cage RWAs were supposed to escape. Access and liquidity die together.</p>
      <h2>Our move: incentivize the token, never the holder</h2>
      <p>Mintware incentivizes the <b>wrapped, transferable token</b> and <b>never enforces holder eligibility</b>. Eligibility lives entirely in the wrapper, upstream of us, in one of two forms:</p>
      <table className={TABLE}>
        <thead><tr><th>Wrapper model</th><th>Where the gate lives</th><th>What Mintware sees</th></tr></thead>
        <tbody>
          <tr><td><b>Bearer-style</b><br />(e.g. Backed bTokens)</td><td>Issuer KYCs holders at the mint / redeem gateway; the token then trades freely on the open market.</td><td className={YES}>A plain, transferable ERC-20</td></tr>
          <tr><td><b>Permissioned</b></td><td>The token enforces an on-chain allowlist on every transfer — an ineligible wallet&apos;s swap reverts, on-chain, before it touches us.</td><td className={YES}>An ERC-20 whose own rules do the gating</td></tr>
        </tbody>
      </table>
      <p>Either way, the gate is <b>in the asset, not in our engine</b>. There is no <code>min_kyc_tier</code>, no eligibility check, no allowlist anywhere in the incentive layer. Our pool, vaults, campaigns, and referrals treat <code>vRWA</code> as an ordinary ERC-20 and stay fully permissionless.</p>
      <h2>Why this is the whole moat</h2>
      <p>Open, permissionless liquidity <i>plus</i> reputation-weighted rewards on RWA-backed tokens is precisely what walled-garden platforms cannot offer — bolting it on would mean dismantling the KYC walls their model is built on. We get the liquidity and the rewards; they can&apos;t follow without becoming us.</p>
      <Claim>By touching only the wrapped token, we deliver distribution, liquidity, and rewards — and stay out of placement-agent and private-placement territory <b>entirely.</b></Claim>
      <Note k="✴ For the issuer, concretely">You keep your compliance exactly where it belongs — at your mint/redeem gateway or in your token&apos;s transfer rules. You hand Mintware a transferable token, and we hand you a distributed, liquid, incentivized market for it. Nothing about your regulatory posture changes; everything about your token&apos;s usefulness does.</Note>
    </>
  )
}
function RwaPrecedent({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · Precedent</div>
      <h1>This is already how regulated assets trade on-chain</h1>
      <p className={SUB}>The most common objection a legal team raises is &ldquo;you can&apos;t put a regulated asset on-chain without wrapping every surface in KYC.&rdquo; The market has already answered it — at institutional scale, under real frameworks.</p>
      <p>Mintware did not invent the wrapper. We built the liquidity and rewards layer that sits on top of two models the largest institutions on earth already run in production today.</p>
      <table className={TABLE}>
        <thead><tr><th>Live example</th><th>Asset</th><th>Model</th><th>Regulatory frame</th></tr></thead>
        <tbody>
          <tr><td><b>Backed Finance</b><br />(bIB01, bCSPX)</td><td>Tokenized T-bills &amp; S&amp;P 500</td><td>Bearer ERC-20 — KYC at the gateway, then trades on Uniswap</td><td>Swiss / Liechtenstein DLT Act</td></tr>
          <tr><td><b>Paxos</b> (PAXG)</td><td>Tokenized gold</td><td>Bearer ERC-20 — freely transferable</td><td>NYDFS-regulated</td></tr>
          <tr><td><b>Ondo</b> (USDY)</td><td>Tokenized T-bill yield</td><td>Bearer-style — transferable after a short lockup</td><td>US frameworks</td></tr>
          <tr className={US}><td><b>BlackRock BUIDL</b><br />(via Securitize)</td><td>Tokenized US Treasuries</td><td>Permissioned — allowlist enforced on every transfer</td><td>SEC Reg D · Securitize transfer agent</td></tr>
          <tr><td><b>Superstate</b> (USTB)</td><td>Tokenized Treasuries</td><td>Permissioned token</td><td>US</td></tr>
          <tr><td><b>ERC-3643 / T-REX</b><br />(Tokeny)</td><td>The security-token standard itself</td><td>Permissioned — on-chain identity gates transfer</td><td>EU security tokens</td></tr>
        </tbody>
      </table>
      <h2>The two models map exactly to ours</h2>
      <ul>
        <li><b>Bearer / gateway-KYC</b> — Backed, Paxos, Ondo USDY. The issuer KYCs at mint and redeem; the token is then a freely-transferable ERC-20. <b>This is our bearer model.</b></li>
        <li><b>Permissioned / gate-in-the-token</b> — BlackRock BUIDL, Superstate, ERC-3643. The token itself enforces an on-chain allowlist; an ineligible transfer reverts. <b>This is our permissioned model.</b></li>
      </ul>
      <Claim>The largest asset manager on earth already issues a transfer-gated token that trades on Ethereum. <b>The &ldquo;you can&apos;t do this legally&rdquo; objection is empirically false.</b></Claim>
      <h2>And the frameworks are opening, not closing</h2>
      <p>EU <b>MiCA</b>, Liechtenstein&apos;s <b>TVTG (DLT Act)</b>, Switzerland&apos;s <b>DLT Act</b>, Singapore&apos;s <b>MAS Project Guardian</b>, and US transfer-agent regimes all recognize tokenized, transferable representations of regulated assets. The direction of travel is toward this model.</p>
      <Note k="✴ Honest boundary">This is precedent, not legal advice — your counsel applies your facts and your jurisdiction. But the road is paved: decentralized, transferable wrappers of regulated assets are being legally issued and traded right now, using the exact two models Mintware relies on. You are not the pioneer being asked to take the risk — you are following BlackRock. See <Ln to="rwa-wrapper" nav={nav}>The wrapper</Ln>.</Note>
    </>
  )
}
function RwaLegal() {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · Safety &amp; posture</div>
      <h1>Safe &amp; legal by design</h1>
      <p className={SUB}>Trust is enforced in the structure, in the code, and in the posture — not asserted in a badge.</p>
      <h2>Safe — structure &amp; code</h2>
      <ul>
        <li><b>Bankruptcy-remote SPV.</b> The underlying sits in a special-purpose vehicle, isolated from the issuer&apos;s balance sheet.</li>
        <li><b>Oracle-banded price.</b> vRWA can only trade within a band around NAV (±15% soft, ±45% hard) — no runaway mispricing, no manipulation outside the band.</li>
        <li><b>On-chain guardian / freeze.</b> A kill-switch in the contracts can halt a compromised deal.</li>
        <li><b>Automatic holder gating.</b> For permissioned tokens, an ineligible transfer reverts on-chain — the token protects itself, with no action from us.</li>
        <li><b>Review before public.</b> Issuer verification + a content review gate (<code>draft → in_review → approved</code>) stand between a deal and its first public wallet.</li>
        <li><b>Verified actions.</b> Every reward is checked against an on-chain receipt before it&apos;s credited.</li>
      </ul>
      <h2>Legal — the posture</h2>
      <p>Because we incentivize only the wrapped, transferable token and never gate holders, our posture collapses to that of <b>any DEX + rewards layer over an ERC-20</b>. We are not distributing, custodying, or gating a security. A referral says &ldquo;come trade this liquid token&rdquo; — not &ldquo;invest in this private placement.&rdquo; The eligibility question sits with the issuer at the wrapper, where it belongs.</p>
      <h2>What we deliberately do <i>not</i> do</h2>
      <table className={TABLE}>
        <tbody>
          <tr><td className={NO}>✕</td><td>Custody the underlying asset</td></tr>
          <tr><td className={NO}>✕</td><td>Decide or check who may hold the token</td></tr>
          <tr><td className={NO}>✕</td><td>Run the primary placement or solicit investors into it</td></tr>
          <tr><td className={NO}>✕</td><td>Make the market with our own book</td></tr>
          <tr><td className={NO}>✕</td><td>Touch primary issuance of a restricted instrument directly</td></tr>
        </tbody>
      </table>
      <Note k="✴ Honest boundary">Should a future product ever touch primary issuance of a restricted instrument directly — not the plan — that reopens a real regulatory surface and belongs with counsel. The incentive layer described in these docs does not.</Note>
    </>
  )
}
function RwaVs({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · The landscape</div>
      <h1>Mintware vs the alternatives</h1>
      <p className={SUB}>We borrow the information architecture proven by billion-dollar RWA platforms. We do not borrow their walls.</p>
      <table className={TABLE}>
        <thead><tr><th>Platform</th><th>Access</th><th>Secondary liquidity</th><th>Rewards weighted by capital quality</th></tr></thead>
        <tbody>
          <tr><td><b>Walled-garden RWA</b></td><td className={NO}>Accredited only</td><td className={NO}>Thin / none</td><td className={NO}>None</td></tr>
          <tr><td><b>Centrifuge</b></td><td className={NO}>Permissioned pools</td><td className={NO}>Limited</td><td className={NO}>No</td></tr>
          <tr><td><b>Ondo</b></td><td className={NO}>Gated distribution</td><td className={NO}>Limited</td><td className={NO}>No</td></tr>
          <tr><td><b>Maple</b></td><td className={NO}>Gated (credit)</td><td className={NO}>Limited</td><td className={NO}>No</td></tr>
          <tr className={US}><td>Mintware</td><td className={YES}>Permissionless*</td><td className={YES}>Oracle-banded pool + incentives</td><td className={YES}>Yes — reputation × duration × referral</td></tr>
        </tbody>
      </table>
      <p className="text-[12.5px] text-atx-grey">*Permissionless at the Mintware layer; the wrapped token still gates holders if the issuer requires it. See <Ln to="rwa-wrapper" nav={nav}>The wrapper</Ln>.</p>
      <p>We model our deal pages on <b>Centrifuge</b>&apos;s pool / issuer / NAV structure, borrow <b>Ondo</b>&apos;s single-number NAV clarity, and <b>Maple</b>&apos;s redemption UX — because our on-chain shape is a near-exact match. What none of them offer is the combination we lead with: <b>incentivized primary distribution + secondary liquidity, weighted by capital quality</b>, on an open market.</p>
      <Gap k="✕ The unsolved problem we take">Almost nobody has solved distribution <i>and</i> secondary liquidity, weighted by who the capital is rather than how much. That is the wedge — and the wrapper is what lets us stand in it.</Gap>
    </>
  )
}
function RwaVrwa() {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · Structure &amp; pricing</div>
      <h1>vRWA &amp; oracle-banded pricing</h1>
      <p className={SUB}>The vault share is a bearer token; it trades against USDC in a pool whose price is pinned to NAV — so incentivized volume is real price discovery, not wash-trading.</p>
      <h2>The SPV &amp; the share</h2>
      <p>Each deal is a bankruptcy-remote SPV holding the underlying — a trade-finance note, a T-bill ladder, a private-credit facility — with a defined maturity (<code>settle_days</code>) and a reserve/yield split (typically <b>40/60</b>). The vault&apos;s ERC-4626 share is <b>vRWA</b>: a bearer token you can hold, trade 24/7, use as collateral, or redeem for the underlying. Its value tracks the SPV&apos;s NAV.</p>
      <h2>The oracle band</h2>
      <Spec>soft band  <span className="text-atx-blue font-bold">±15%</span>   <span className="g">— fees ramp as price nears the edge</span>{'\n'}hard band  <span className="text-atx-blue font-bold">±45%</span>   <span className="g">— trades outside the band revert</span></Spec>
      <p>Because the band pins price to NAV — and, where the token is permissioned, the token itself constrains who trades — incentivized volume behaves like genuine price discovery, not the mercenary noise a DeFi volume campaign attracts. The band is theoretical until real two-sided liquidity exists; the rewards engine is the machine that creates it.</p>
      <h2>Oracle-enforced price — protection for both sides</h2>
      <p>The band is not a formality. It is a hard, on-chain guardrail that protects the two parties who most need protecting:</p>
      <ul>
        <li><b>For investors.</b> You can never buy vRWA meaningfully above NAV, or be dumped meaningfully below it. The band caps predatory pricing, thin-market spikes, and manipulation — and every price is transparent, on-chain, and anchored to the asset&apos;s real value.</li>
        <li><b>For issuers.</b> Your deal&apos;s on-chain price cannot detach from fair value and trash its reputation. No single actor can crater or pump the market. The band plus the reserve ratio keep the secondary honest — so the liquidity you gain never becomes a liability.</li>
      </ul>
      <p>There is no opaque market-maker desk and no off-book pricing. The oracle signs the reference, the band enforces it, and everyone — investor, issuer, regulator — sees the same number.</p>
      <Gap k="✕ The gap it closes">Secondary markets for tokenized credit and T-bills are thin to dead. An asset you can&apos;t exit is a roach motel. Oracle-banded pricing plus LP and volume incentives turn a dead wrapper into a market you can actually leave.</Gap>
    </>
  )
}
function RwaDeals() {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · Origination</div>
      <h1>Deal sourcing &amp; qualification</h1>
      <p className={SUB}>A verified issuer, a full data room, and a review gate before anything goes public. This is how we make sure a deal is real before a wallet ever sees it.</p>
      <h2>1 · The issuer must be verified</h2>
      <p>An issuer registers and must reach <b>VERIFIED</b> in the on-chain <code>SPVAssetProviderRegistry</code> (backed by an off-chain issuer profile — track record and transparency) before it can publish a deal.</p>
      <h2>2 · The deal is fully specified</h2>
      <table className={TABLE}>
        <thead><tr><th>Block</th><th>What the issuer provides</th></tr></thead>
        <tbody>
          <tr><td><b>Instrument</b></td><td>vRWA name/symbol, asset class, reserve/yield split, oracle bands</td></tr>
          <tr><td><b>Key terms</b></td><td>Target APY · TVL · minimum · settle window · price band · reserve ratio</td></tr>
          <tr><td><b>Explainers</b></td><td>Team-authored <b>yield-source</b> and <b>price / NAV</b> explainers</td></tr>
          <tr><td><b>Data room</b></td><td>Term sheet, legal opinion, SPV structure, audit — each document carries a review status</td></tr>
          <tr><td><b>Redemption</b></td><td>Window, KYC tier required to redeem, settlement terms</td></tr>
        </tbody>
      </table>
      <h2>3 · Mintware reviews it before it&apos;s public</h2>
      <Spec>review_status:  <span className="text-atx-blue font-bold">draft</span> → <span className="text-atx-blue font-bold">in_review</span> → <span className="text-atx-blue font-bold">approved</span></Spec>
      <p>Deal content — especially documents and price claims — passes Mintware review before it reaches a single public wallet. Trust is enforced at both the <b>content</b> layer (this review) and the <b>code</b> layer (the on-chain guardian). We copy the information architecture of Centrifuge, Ondo, and Maple because our on-chain model is a near-exact match — not their tokenomics, their proven <i>structure</i>.</p>
    </>
  )
}
function RwaRedeem() {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · Exit &amp; trust</div>
      <h1>Redemption &amp; the trust gate</h1>
      <p className={SUB}>Two ways out — trade the token instantly, or redeem the underlying on a settlement window. KYC applies only if you redeem.</p>
      <h2>Two exits</h2>
      <ul>
        <li><b>Trade.</b> Sell vRWA into the oracle-banded pool, 24/7, no permission — the liquid exit tokenization never delivered.</li>
        <li><b>Redeem.</b> Request redemption → a <b>30-day async window</b> → settlement. This is the only step that touches the real-world asset, so it is the only step that requires KYC.</li>
      </ul>
      <h2>The trust gate — three independent layers</h2>
      <Pipe items={[
        ['Layer 1', 'Verified issuer', 'Registry-gated; must be VERIFIED to publish.'],
        ['Layer 2', 'Reviewed content', 'Documents + price claims approved before public.'],
        ['Layer 3', 'On-chain guardian', 'Freeze / kill-switch enforced in the contracts.'],
      ]} />
    </>
  )
}
function RwaCases() {
  return (
    <>
      <div className={EY}>✴ For RWA issuers · The payoff</div>
      <h1>What issuers get</h1>
      <p className={SUB}>Not &ldquo;we tokenize your asset&rdquo; — that&apos;s solved. We solve your cold-start, your distribution, and your secondary liquidity, and reward the capital by how good it is.</p>
      <table className={TABLE}>
        <thead><tr><th>Deal</th><th>Instrument</th><th>Target</th></tr></thead>
        <tbody>
          <tr><td><b>ATX Credit Facility</b></td><td>Private credit · vRWA / USDC</td><td>10.4%</td></tr>
          <tr><td><b>Sovereign T-Bill</b></td><td>Treasury ladder · vRWA / USDC</td><td>~ T-bill</td></tr>
          <tr><td><b>LiquidHectar Note</b></td><td>Trade-finance note · vRWA / USDC</td><td>9.0%</td></tr>
        </tbody>
      </table>
      <ul>
        <li><b>Cold-start solved.</b> Threshold seeding brings qualified capital in before the economics work.</li>
        <li><b>Distribution.</b> Relationship-sourced referral — placement, not paid mercenaries.</li>
        <li><b>Duration-matched capital.</b> Locks tied to maturity; capital that stays exactly as long as the asset needs it.</li>
        <li><b>A real secondary.</b> Volume + LP rewards make the token trade — the one thing tokenizing was supposed to deliver.</li>
      </ul>
      <Claim>Your real-estate position trades at 3am on a Sunday. <b>Try that with a REIT.</b></Claim>
    </>
  )
}
function Wallets({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ Trust · Accounts</div>
      <h1>Wallets &amp; custody</h1>
      <p className={SUB}>Two ways in, one guarantee: Mintware is non-custodial end to end. It never holds your keys, your deposits, or the underlying asset.</p>
      <h2>Two ways in</h2>
      <ul>
        <li><b>Connect a wallet.</b> MetaMask, Rainbow, Coinbase, WalletConnect — via RainbowKit + wagmi, for anyone who already has one.</li>
        <li><b>Continue with email.</b> Privy spins up an <b>embedded wallet</b> from an email address — no seed phrase, no extension, no prior crypto experience required.</li>
      </ul>
      <h2>New users, institutional-grade key security</h2>
      <p>Privy&apos;s embedded wallets are <b>self-custodial</b>. Keys are split and held across secure enclaves (MPC / Shamir shards) and are never assembled in one place — not on Mintware&apos;s servers, not on Privy&apos;s. Privy is <b>SOC 2 Type II</b> certified, and a user can export their key at any time. A first-time crypto user gets a real self-custodial wallet from an email: the on-ramp is easy, and the security model is not compromised to make it so.</p>
      <Note k="✴ Non-custodial, end to end">Mintware never holds your <b>deposits</b> — you interact with audited vault contracts directly, and your assets stay in your wallet on-chain. It never holds the <b>RWA underlying</b> — the bankruptcy-remote SPV does. And it never holds your <b>keys</b> — you do, secured by Privy. There is no point in the system where Mintware can move your funds unilaterally.</Note>
      <h2>One identity</h2>
      <p>Your wallet is your identity — the same address carries your Attribution score across every surface, and can link additional wallets into a single profile without surrendering custody of any of them. See <Ln to="attribution" nav={nav}>Attribution</Ln>.</p>
    </>
  )
}
function Security() {
  return (
    <>
      <div className={EY}>✴ Trust · Security</div>
      <h1>Security &amp; guarantees</h1>
      <p className={SUB}>What&apos;s enforced on-chain, what&apos;s enforced off-chain, and what we deliberately don&apos;t do.</p>
      <ul>
        <li><b>Permissionless by construction.</b> No KYC, no eligibility gate anywhere in the incentive engine — the wrapped token gates, if at all.</li>
        <li><b>On-chain verification.</b> Every reward-credited swap is verified against its receipt (sender, router, fee, status) before a point is written.</li>
        <li><b>Oracle bands + guardian.</b> vRWA price is band-constrained to NAV; a guardian freeze can halt a compromised deal.</li>
        <li><b>Anti-sybil.</b> A 24-hour referral time-gate and reputation-weighting blunt farming; reward caps bound per-transaction abuse.</li>
        <li><b>Zero-oracle-gas claims.</b> The oracle signs Merkle roots off-chain (EIP-712); users claim directly, so the oracle never holds custody or pays per-epoch gas.</li>
        <li><b>Hardened surface.</b> Strict CSP, per-route rate limits, source maps off, and fee enforcement in calldata (MintGuard).</li>
      </ul>
      <Note k="✴ Contracts">Attribution, MintwareDistributor v2, the ERC-4626 vault family, and the oracle hook are deployed and verified on Base. Addresses and ABIs live in the API reference.</Note>
    </>
  )
}

// ── nav + content registry ───────────────────────────────────────────────────
const GROUPS: { group: string; items: { id: string; label: string; star?: boolean }[] }[] = [
  { group: 'Start here', items: [
    { id: 'overview', label: 'Overview' },
    { id: 'model', label: 'The model in one page' },
  ]},
  { group: 'How it works', items: [
    { id: 'attribution', label: 'Attribution — how we measure' },
    { id: 'rewards', label: 'Rewards — how we track & pay' },
    { id: 'vaults', label: 'Vaults — two surfaces' },
  ]},
  { group: 'For DeFi teams & users', items: [
    { id: 'defi', label: 'Where the value is' },
  ]},
  { group: 'For RWA issuers', items: [
    { id: 'rwa-why', label: 'Why RWAs belong on DeFi' },
    { id: 'rwa-wrapper', label: 'The wrapper — the breakthrough', star: true },
    { id: 'rwa-precedent', label: "Precedent — it's already legal", star: true },
    { id: 'rwa-legal', label: 'Safe & legal by design', star: true },
    { id: 'rwa-vs', label: 'Mintware vs the alternatives', star: true },
    { id: 'rwa-vrwa', label: 'vRWA & oracle pricing' },
    { id: 'rwa-deals', label: 'Deal sourcing & qualification' },
    { id: 'rwa-redeem', label: 'Redemption & trust' },
    { id: 'rwa-cases', label: 'What issuers get' },
  ]},
  { group: 'Trust', items: [
    { id: 'wallets', label: 'Wallets & custody' },
    { id: 'security', label: 'Security & guarantees' },
  ]},
]

const CONTENT: Record<string, (p: { nav: Nav }) => ReactNode> = {
  overview: Overview, model: Model, attribution: Attribution, rewards: Rewards, vaults: Vaults,
  defi: DeFi, 'rwa-why': RwaWhy, 'rwa-wrapper': RwaWrapper, 'rwa-precedent': RwaPrecedent,
  'rwa-legal': RwaLegal, 'rwa-vs': RwaVs, 'rwa-vrwa': RwaVrwa, 'rwa-deals': RwaDeals,
  'rwa-redeem': RwaRedeem, 'rwa-cases': RwaCases, wallets: Wallets, security: Security,
}

const PROSE = 'max-w-[840px] px-14 pt-11 pb-24 max-[880px]:px-5 max-[880px]:pt-8 ' +
  '[&_h1]:text-[clamp(28px,3.4vw,40px)] [&_h1]:font-bold [&_h1]:tracking-[-0.03em] [&_h1]:leading-[1.05] [&_h1]:mt-2.5 [&_h1]:mb-1.5 [&_h1]:text-wrap-balance ' +
  '[&_h2]:text-[21px] [&_h2]:font-bold [&_h2]:tracking-[-0.01em] [&_h2]:mt-8 [&_h2]:mb-2.5 [&_h2]:pt-5 [&_h2]:border-t [&_h2]:border-atx-ink/10 ' +
  '[&_h3]:text-[15.5px] [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-1 ' +
  '[&_p]:my-2.5 [&_p]:leading-[1.62] ' +
  '[&_code]:font-atx-mono [&_code]:text-[0.85em] [&_code]:bg-atx-panel [&_code]:border [&_code]:border-atx-ink/15 [&_code]:px-1.5 [&_code]:py-px ' +
  '[&_ul]:my-2.5 [&_li]:relative [&_li]:pl-5 [&_li]:py-1 [&_li]:leading-[1.5] ' +
  "[&_li]:before:content-['✦'] [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-2 [&_li]:before:text-atx-blue [&_li]:before:text-[11px]"

export default function DocsPage() {
  const [active, setActive] = useState('overview')
  const nav: Nav = (id) => { if (CONTENT[id]) { setActive(id); window.scrollTo(0, 0) } }
  const Section = CONTENT[active] ?? Overview

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      <MwNav />
      <div className="grid grid-cols-[262px_1fr] max-w-[1280px] mx-auto max-[880px]:grid-cols-1">
        <aside className="border-r border-atx-ink px-4 pt-6 pb-16 sticky top-[58px] self-start h-[calc(100vh-58px)] overflow-y-auto max-[880px]:static max-[880px]:h-auto max-[880px]:overflow-visible max-[880px]:border-r-0 max-[880px]:border-b max-[880px]:border-atx-ink">
          {GROUPS.map((g) => (
            <div key={g.group}>
              <div className="font-atx-mono text-[10px] tracking-[0.15em] uppercase text-atx-grey mx-2 mt-5 mb-2 first:mt-0">{g.group}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => nav(it.id)}
                  className={`block w-full text-left text-[13px] px-2 py-[5px] border-l-2 leading-[1.35] cursor-pointer ${active === it.id ? 'text-atx-blue font-semibold border-atx-blue bg-atx-panel' : 'text-atx-ink/80 border-transparent hover:text-atx-blue'}`}
                >
                  {it.label}{it.star && <span className="text-atx-coral text-[9px] align-[1px]"> ★</span>}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <main className={PROSE}>
          <Section nav={nav} />
        </main>
      </div>
    </div>
  )
}
