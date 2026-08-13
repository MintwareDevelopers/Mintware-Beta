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

// ── content sections ─────────────────────────────────────────────────────────
function Overview({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ Start here · Overview</div>
      <h1>The reputation layer for DeFi</h1>
      <p className={SUB}>Attribution measures every on-chain contribution. Mintware is where that contribution earns — rewards, liquidity vaults, and agents that route value by the score instead of the size of your wallet.</p>
      <p>Mintware fixes one failure: <b>DeFi incentives attract the capital you least want.</b> Emissions pay the biggest wallet, which farms the reward and leaves — every program races its own users to the door. The root cause is <b>rewards priced by the size of your wallet instead of the quality of your contribution.</b></p>
      <p>Mintware measures contribution (Attribution), holds it (Vaults), and pays it (the Rewards engine) — weighting every reward by reputation, commitment, and referral quality rather than raw dollars.</p>
      <Pipe items={[
        ['Measure', 'Attribution', 'On-chain reputation across 100+ chains — six signals, one score.'],
        ['Hold', 'Vaults', 'Reputation-weighted Uniswap V4 liquidity — dual-sided pairs, built security-first.'],
        ['Reward', 'Engine', 'Vault fees and referrals that pay reputation × commitment × referral quality.'],
      ]} />
      <Note k="✴ Start here">If you run a <b>DeFi protocol</b> or provide liquidity, read <Ln to="defi" nav={nav}>Where the value is</Ln> next. If you want the mechanism, read <Ln to="model" nav={nav}>The model in one page</Ln>.</Note>
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
      <h3>2 · One engine over managed liquidity</h3>
      <p>The same reward engine runs over <b>reputation-weighted Uniswap V4 liquidity</b> and over referral rewards — every reward carries the reputation multiplier, so value routes to who you are on-chain rather than the size of your deposit.</p>
      <h3>3 · Quality of capital, proven on-chain</h3>
      <p>Every reward-credited action is verified on-chain before a point is written, and rewards are weighted to attract sticky, duration-committed, relationship-sourced capital — the opposite of mercenary TVL.</p>
      <h3>4 · Built security-first</h3>
      <p>The vault contracts ship behind a guardian kill-switch, an MEV-resistant hook, and fuzz-tested invariants — because a rewards mechanism is only as good as the money-path it runs on. See <span className="font-semibold">Security</span>.</p>
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
      <Note k="✴ Why it matters">Reputation in DeFi is invisible and unportable — every protocol re-underwrites you from zero. Attribution turns your history into a portable, earned asset that pays you a bigger share of every pool you enter.</Note>
    </>
  )
}
function Rewards() {
  return (
    <>
      <div className={EY}>✴ How it works · Rewards engine</div>
      <h1>Rewards — how we weight &amp; pay</h1>
      <p className={SUB}>Value routes by reputation, not wallet size — vault fees and referral rewards, weighted by your Attribution score and settled to gas-free Merkle claims.</p>
      <h2>The formula</h2>
      <Spec><span className="text-atx-blue font-bold">reward</span> = attribution_score × lock_duration × referral_quality   <span className="g">// never: how many dollars</span></Spec>
      <h2>Reputation-weighted, not dollar-weighted</h2>
      <p>Every reward carries your Attribution multiplier (up to <b>1.95×</b>), applied when it is credited. The identical vault position out-earns the cold wallet beside it; the same referral is worth more when the wallets you bring are real and active. Reputation is computed independently on-chain, so it can&apos;t be bought at deposit time.</p>
      <h2>How we pay — epochs → Merkle → claim</h2>
      <Spec><span className="g">accrue</span> → <span className="text-atx-blue font-bold">reputation-weight</span> → settle at epoch close → <span className="text-atx-blue font-bold">Merkle root</span> → user claims leaf</Spec>
      <p>At epoch close, weighted rewards settle into a Merkle distribution. The oracle signs the root off-chain via EIP-712, so distributions cost <b>zero oracle gas</b> and the oracle never holds custody — users claim their own leaf directly on-chain. A <b>duration-match</b> bonus rewards locking to (or through) a vault&apos;s window.</p>
      <h2>The Liquid Sovereign Account</h2>
      <p>The vault also underpins the <a href="/yield-payment-network" className="text-atx-blue font-semibold no-underline hover:underline">Liquid Sovereign Account</a> — a zero-opportunity-cost cash primitive. USDC in the Unified Liquidity Vault earns institutional yield (Aave v3 buffer + Uniswap v4 MEV recapture) while staying <b>100% spendable</b> at Visa terminals in sub-400ms — settlement is designed to clear against the idle Aave buffer without unwinding active liquidity, so principal never moves. <span className="text-atx-ink/50">(Coming soon.)</span></p>
      <Gap k="✕ The gap it closes">Emissions pay the biggest wallet, which farms and exits first — every program races its own users to the door. Weighting by reputation and lock duration rewards the capital a protocol actually wants: sticky, qualified, and relationship-sourced.</Gap>
    </>
  )
}
function Vaults({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ How it works · Vaults</div>
      <h1>Vaults — reputation-weighted liquidity</h1>
      <p className={SUB}>Managed Uniswap V4 liquidity where your reputation is worth something. One shared, security-first base; a coherent family of vaults on top.</p>
      <h3>A vault is a pair</h3>
      <p>The vault line is dual-sided <b>pairs</b> — USDC/ETH, USDC/PEPE, any two tokens — real liquidity behind a V4 hook that keeps the range managed and prices swaps to defend against MEV. Deposits earn swap fees split by an <b>attribution-weighted</b> share: the same position out-earns the wallet beside you.</p>
      <h3>Lock tiers</h3>
      <p>Deposits pick a lock tier (<b>Flex → Committed → Aligned → Core</b>); longer locks earn a higher multiplier, and early exit pays a penalty that flows to the LPs who stayed. Unlocked and Flex positions redeem instantly; locked positions exit on a notice window.</p>
      <h3>Team-locked launch liquidity</h3>
      <p>A launch variant lets a team lock its token liquidity while the community matches it 1:1. The team&apos;s side is provably locked on-chain for a fixed cliff and cannot be pulled early — and the community earns the team&apos;s forgone fees for the duration of the lock. Precisely: <i>team liquidity is locked and matched by community capital under transparent on-chain rules</i> — a claim you can verify yourself, not a promise.</p>
      <Note k="✴ Status">The reputation-weighted vault family is <b>built and tested, in testing ahead of launch</b> — feature-flagged off, and it starts on testnet. Attribution and agents are live today. See <Ln to="security" nav={nav}>Security</Ln> for what&apos;s hardened and what&apos;s pending.</Note>
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
        <li><b>Your reputation is paid.</b> Attribution lifts your fee share — the identical LP position out-earns a cold wallet&apos;s.</li>
        <li><b>MEV protection.</b> The V4 hook prices swaps against a manipulation-resistant oracle, defending LPs without reading trader identity.</li>
        <li><b>Set-and-forget.</b> The range is managed; idle capital can be routed to yield behind a hard-capped, allowlisted path.</li>
        <li><b>Every action counts.</b> Swaps, referrals, holding — each is scored and multiplied, building a score that pays across every future pool.</li>
      </ul>
      <h2>For teams</h2>
      <ul>
        <li><b>Reward the right users.</b> Reputation-weighted vault fees pay loyal, high-reputation wallets instead of mercenary farmers.</li>
        <li><b>Retention &amp; conversion.</b> The reputation filter drives the stickiness raw emissions never could — your best users earn more, and stay.</li>
        <li><b>Provable launch liquidity.</b> Team-locked, community-matched pools — the team&apos;s side is locked on-chain for a fixed cliff, and LPs earn its forgone fees for the duration.</li>
      </ul>
      <Note k="✴ Integrity you can point to">Reputation is computed independently on-chain (see <Ln to="rewards" nav={nav}>how we weight</Ln>), so your fee share can&apos;t be bought — you pay real reputation, not wash-traded volume.</Note>
    </>
  )
}
function Wallets({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>✴ Trust · Accounts</div>
      <h1>Wallets &amp; custody</h1>
      <p className={SUB}>Two ways in, one guarantee: Mintware is non-custodial end to end. It never holds your keys or your deposits.</p>
      <h2>Two ways in</h2>
      <ul>
        <li><b>Connect a wallet.</b> MetaMask, Rainbow, Coinbase, WalletConnect — via Privy + wagmi, for anyone who already has one.</li>
        <li><b>Continue with email.</b> Privy spins up an <b>embedded wallet</b> from an email address — no seed phrase, no extension, no prior crypto experience required.</li>
      </ul>
      <h2>New users, institutional-grade key security</h2>
      <p>Privy&apos;s embedded wallets are <b>self-custodial</b>. Keys are split and held across secure enclaves (MPC / Shamir shards) and are never assembled in one place — not on Mintware&apos;s servers, not on Privy&apos;s. Privy is <b>SOC 2 Type II</b> certified, and a user can export their key at any time.</p>
      <Note k="✴ Non-custodial, end to end">Mintware never holds your <b>deposits</b> — you interact with the vault contracts directly, and your assets stay in your wallet on-chain. And it never holds your <b>keys</b> — you do, secured by Privy. There is no point in the system where Mintware can move your funds unilaterally.</Note>
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
      <p className={SUB}>The vault stack was built security-first — hardened before it scales, not after. Here is what&apos;s enforced, what&apos;s verified, and what&apos;s still pending.</p>
      <h2>The money-path is hardened</h2>
      <ul>
        <li><b>Guardian kill-switch.</b> A monitoring guardian can pause deposits, rebalances, and new liquidity instantly; only the owner resumes — a fast-pause / deliberate-unpause design.</li>
        <li><b>MEV-resistant hook.</b> Swaps are priced against a truncated-oracle reference (a single-block price push barely moves it), with a deviation circuit breaker — no reliance on trader identity, so it defends single- and multi-address attackers alike.</li>
        <li><b>Hardened idle capital.</b> Yield destinations are hard-allowlisted behind a timelock, a withdrawal-buffer invariant keeps a floor un-rehypothecated, and every external call follows checks-effects-interactions.</li>
        <li><b>On-chain verification.</b> Every reward-credited swap is verified against its receipt (sender, router, fee, status) before a point is written.</li>
        <li><b>Anti-sybil.</b> A 24-hour referral time-gate and reputation-weighting blunt farming; reward caps bound per-transaction abuse.</li>
        <li><b>Zero-oracle-gas claims.</b> The oracle signs Merkle roots off-chain (EIP-712); users claim directly, so the oracle never holds custody.</li>
      </ul>
      <h2>Verified, not asserted</h2>
      <p>The vaults&apos; core invariants are <b>fuzz-tested</b> — stateful invariant runs over 100k+ call sequences prove properties like &ldquo;locked team liquidity can never be withdrawn before its cliff, under any path.&rdquo; The hook&apos;s per-swap cost is <b>gas-benchmarked</b> well under the routing budget, so pools stay discoverable by aggregators.</p>
      <Note k="✴ Honest status">An <b>independent third-party audit is pending</b> — we do not claim &ldquo;audited&rdquo; until a Uniswap-whitelisted auditor has signed off. Attribution is live and verified on Base; the reputation-weighted vault family is in testing ahead of launch. Non-custodial throughout.</Note>
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
    { id: 'vaults', label: 'Vaults — reputation-weighted liquidity' },
  ]},
  { group: 'For DeFi teams & users', items: [
    { id: 'defi', label: 'Where the value is' },
  ]},
  { group: 'Trust', items: [
    { id: 'wallets', label: 'Wallets & custody' },
    { id: 'security', label: 'Security & guarantees', star: true },
  ]},
]

const CONTENT: Record<string, (p: { nav: Nav }) => ReactNode> = {
  overview: Overview, model: Model, attribution: Attribution, rewards: Rewards, vaults: Vaults,
  defi: DeFi, wallets: Wallets, security: Security,
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
