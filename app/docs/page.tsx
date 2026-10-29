'use client'

import { useState, type ReactNode } from 'react'
import { MwNav } from '@/components/web2/MwNav'

// ── shared bits ──────────────────────────────────────────────────────────────
type Nav = (id: string) => void
const EY  = 'font-mono uppercase tracking-[0.18em] text-[11px] text-peri'
const SUB = 'text-[17px] text-ink-mid mb-6 leading-[1.5]'

function Ln({ to, nav, children }: { to: string; nav: Nav; children: ReactNode }) {
  return <button onClick={() => nav(to)} className="text-peri font-medium underline-offset-2 hover:underline cursor-pointer">{children}</button>
}
function Gap({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-hair border-l-[3px] border-l-coral2-deep bg-ground-cool px-[18px] py-4 my-5">
      <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-coral2-deep mb-1.5">{k}</div>
      <div className="text-[14.5px] leading-[1.5] text-ink-mid">{children}</div>
    </div>
  )
}
function Note({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-hair border-l-[3px] border-l-peri bg-ground-cool px-[18px] py-4 my-5">
      <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-peri mb-1.5">{k}</div>
      <div className="text-[14.5px] leading-[1.5] text-ink-mid">{children}</div>
    </div>
  )
}
function Claim({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink text-white px-[24px] py-6 my-6 text-[19px] font-medium tracking-[-0.01em] leading-[1.3] [&_b]:text-pas-peri [&_b]:font-semibold">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full" style={{ background: 'radial-gradient(circle, rgba(108,108,240,0.45), transparent 70%)' }} />
      <div className="relative">{children}</div>
    </div>
  )
}
function Spec({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-hair bg-ground-cool font-mono text-[12.5px] px-4 py-3.5 my-4 whitespace-pre-wrap leading-[1.7] overflow-x-auto [&_b]:text-peri [&_.g]:text-ink-soft">{children}</div>
}
function Pipe({ items }: { items: [string, string, string][] }) {
  return (
    <div className="flex my-4.5 rounded-2xl border border-hair overflow-hidden flex-wrap">
      {items.map(([n, h, p], i) => (
        <div key={i} className="flex-1 min-w-[130px] px-3.5 py-3 border-r border-hair last:border-r-0 text-[12.5px] max-[560px]:border-r-0 max-[560px]:border-b max-[560px]:last:border-b-0">
          <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-soft">{n}</div>
          <div className="font-semibold mt-0.5">{h}</div>
          <div className="mt-0.5 text-ink-mid">{p}</div>
        </div>
      ))}
    </div>
  )
}
const TABLE = 'w-full border-collapse text-[13px] my-4 overflow-hidden [&_th]:border [&_th]:border-hair [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:align-top [&_th]:bg-ground-cool [&_th]:font-mono [&_th]:text-[10px] [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-ink-soft [&_td]:border [&_td]:border-hair [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-left [&_td]:align-top [&_td]:leading-[1.45]'

// ── content sections ─────────────────────────────────────────────────────────
function Overview({ nav }: { nav: Nav }) {
  return <><div className={EY}>Start here · Overview</div><span className="live-chip mb-2"><span className="dot" aria-hidden />Live on Robinhood Chain testnet · unaudited</span><h1>Mintware — <span className="text-gradient-accent">curated liquidity</span></h1><p className={SUB}>MarketEngine provides share-based liquidity for curated Uniswap v4 pools. Each pool has one engine and one share token valued in the quote asset.</p><table className={TABLE}><thead><tr><th>Surface</th><th>What it is</th><th>Status</th></tr></thead><tbody><tr><td>MarketEngine</td><td>Resting v4 band, per-token ERC-4626 adapters, guarded recenter and in-kind exits</td><td>Testnet · unaudited</td></tr><tr><td>Earn</td><td>ERC-4626 vault over one yield adapter</td><td>Testnet · unaudited</td></tr><tr><td>Card refill</td><td>Relayer redeems Earn shares to a member’s registered buffer wallet</td><td>Bridge + Stripe pre-enable</td></tr><tr><td>Discover</td><td>GeckoTerminal candidate feed and risk ranking</td><td>Ranking does not certify pools</td></tr></tbody></table><Note k="Status">External audit gates real value. See <Ln to="vaults" nav={nav}>MarketEngine</Ln> for current liquidity mechanics.</Note></>
}
function Model() {
  return <><div className={EY}>Start here · The model</div><h1>The model in one page</h1><p className={SUB}>Current mechanics are share-based liquidity, one-adapter Earn vaults, and refill-only cards.</p><h3>1 · MarketEngine liquidity</h3><p>Each curated Uniswap v4 pool has one engine. A single share token is valued in the quote asset; capital sits in a resting v4 band plus per-token ERC-4626 adapters. Robinhood testnet adapters are idle custody and do not earn.</p><h3>2 · Earn</h3><p>MintwareYieldVault (mwEARN) is ERC-4626 over one yield adapter. Pausing blocks deposits only. Exits pay what the source can provide when illiquid; the exiting holder bears source exit cost.</p><h3>3 · Card refill</h3><p>The relayer can redeem a member’s Earn shares only to that member’s registered buffer wallet. Cards do not settle purchases from vault NAV. Buffer registration uses propose, a 48-hour wait, and accept; revocation is available any time.</p><Claim>Live on testnet. <b>Unaudited.</b> External audit gates real value.</Claim></>
}
function Attribution() {
  return (
    <>
      <div className={EY}>How it works · Attribution</div>
      <h1>Attribution — the score</h1>
      <p className={SUB}>A chain-agnostic reputation score computed from seven on-chain dimensions plus a risk penalty. Pure, deterministic, and weighted so a whale is not 10× a minnow.</p>
      <p>Attribution reads a wallet&apos;s on-chain history and reduces it to one number in <b>[0, 925]</b> (engine <code>attribution-v2.0.0</code>, in <code>lib/attribution/*</code>). <code>computeScore(activity, nowMs)</code> is pure and deterministic. The score you see is computed off-chain in this repo, not read from a contract. A separate <b>AIAttribution v3</b> attestation contract is registered on Base mainnet for agents to reference, but it does not source the number here.</p>

      <h2>Seven dimensions + a risk penalty</h2>
      <p>The positive weights sum to exactly <b>925</b> (<code>MAX_SCORE</code>). There are seven positive dimensions and a separate deduction — not &ldquo;eight signals.&rdquo;</p>
      <table className={TABLE}>
        <thead><tr><th>Dimension</th><th>Weight</th><th>Reads</th></tr></thead>
        <tbody>
          <tr><td><b>Liquidity</b></td><td>200</td><td>LP depth × duration</td></tr>
          <tr><td><b>Holding</b></td><td>150</td><td>Value held, duration-weighted</td></tr>
          <tr><td><b>Activity</b></td><td>150</td><td>Consistency + chain breadth + tx depth</td></tr>
          <tr><td><b>Longevity</b></td><td>150</td><td>Wallet age</td></tr>
          <tr><td><b>Volume</b></td><td>100</td><td>Lifetime traded USD, log-scaled</td></tr>
          <tr><td><b>Network</b></td><td>100</td><td>Referral-tree quality</td></tr>
          <tr><td><b>Governance</b></td><td>75</td><td>Votes / proposals / delegations</td></tr>
          <tr><td><b>Risk</b></td><td>−200</td><td>Deduction (see below)</td></tr>
        </tbody>
      </table>

      <h2>The math (normalize.ts)</h2>
      <p>Each dimension maps a raw input to <b>0..1</b>, then rounds <code>raw × weight</code>. The core curves:</p>
      <Spec>{'logCurve(v, mid)   = 1 − 2^(−v/mid)     '}<span className="g">{'// saturating; 10× input is NOT 10× score'}</span>{'\nlinearCap(v, cap)  = clamp01(v / cap)\nrecencyDecay       = 0.5^(daysSinceLastSeen / halfLife)'}</Spec>
      <p>Worked examples straight from the engine:</p>
      <Spec><b>Liquidity</b>{'  = logCurve( Σ lp.usdDepth × clamp01(durationDays/180), 20000 ) × 200\n'}<b>Longevity</b>{'  ageScore = logCurve(ageDays, 730)  '}<span className="g">{'// 2yr ≈ 0.5; gates tenure+recency → 1-day wallet ≈ 0'}</span>{'\n'}<b>Network</b>{'   qualitySum = Σ referredScore × (retained ? 1 : 0.5)\n          = logCurve(qualitySum, 1200) × 100  '}<span className="g">{'// 1 real referral > 100 sybils'}</span></Spec>
      <p>Because <code>logCurve</code> saturates, the score is <b>whale-resistant</b> by construction. <b>Network</b> is quality-weighted, not a headcount — an unretained referral is worth half, and a sybil that never earns a score contributes nothing.</p>

      <h2>The Risk penalty (RISK_MAX 200)</h2>
      <p>Risk flags carry a severity in <b>0..1</b> times a weight; the penalty is capped and subtracted last.</p>
      <Spec>{`penalty = min(200, Σ severity × weight)
final   = clamp(raw − penalty, 0, 925)

weights: sanctioned 200 · mixer 120 · scam 100 · sybil_cluster 100 · wash_trading 80`}</Spec>

      <h2>Sybil scoring (sybil.ts)</h2>
      <p>The sybil detector emits a <i>graded</i> <code>sybil_cluster</code> flag with auditable reason codes. Soft heuristics — <code>shared_funder</code>, <code>dormant_burst</code>, <code>batch_scripting</code>, <code>low_diversity</code>, <code>wash_roundtrip</code>, <code>referral_farm</code> — are each capped so none condemns a wallet alone. Only a graph-confirmed ring forces a high severity:</p>
      <Spec>{`forced severity ≥ 0.9  ⟺  sharedFunderCount ≥ 5
                        &  seqSimilarity ≥ 0.8
                        &  temporalBatchFraction ≥ 0.6

severity < minSeverity(0.15) → needs_review, NOT a penalty`}</Spec>
      <p>Below <code>minSeverity</code> the wallet is marked <code>needs_review</code> rather than penalized — protecting real users from false positives.</p>

      <h2>Tiers, percentile, drivers</h2>
      <Spec>{`gold   ≥ 617
silver ≥ 308
bronze  otherwise`}</Spec>
      <p><code>topDrivers</code> returns ≤ 4 FICO / FCRA-style reason codes explaining the score. Data sources fall through <b>Etherscan V2 (multichain) → Zerion → mock</b>.</p>
      <Gap k="✕ Percentile is an estimate today">The reported percentile is a calibrated <b>estimate</b>: <code>100 × clamp01((score/925)^0.7)</code>. It becomes a real population percentile only when a frozen ECDF artifact is supplied. Until then, treat it as an estimate.</Gap>
    </>
  )
}
function Vaults({ nav }: { nav: Nav }) {
  return <><div className={EY}>How it works · MarketEngine</div><h1>MarketEngine liquidity</h1><p className={SUB}>One MintwareMarketEngine per curated Uniswap v4 pool. One share token is valued in the quote asset.</p><Note k="Status">Robinhood Chain testnet · unaudited. Base Sepolia deployment is also available. External audit gates real value.</Note><h2>Capital and deposits</h2><p>Capital sits in a resting v4 band plus per-token ERC-4626 adapters. Robinhood testnet adapters are idle custody: capital is held ready, not earning. Deposit either pool token or both with a minimum-shares floor. Deposits require a fresh mark and spot near that mark.</p><h2>Withdrawals</h2><p>Withdrawals return both pool tokens pro-rata with minimum-output checks. They remain available when the mark is stale.</p><h2>Recenter</h2><p>Recenter is guarded. Discover’s GeckoTerminal feed and risk score rank candidate pools; they do not certify them. Curated pools and engine configuration are maintained in the registry.</p><Note k="Retired">LP Gateway staging and deploy flows, fee ledger, harvest/compound loop, ULV/JIT, and matched issuance are retired.</Note></>
}
function Mev({ nav }: { nav: Nav }) {
  return <><div className={EY}>How it works · former ULV/JIT design</div><h1>ULV / JIT mechanics</h1><Note k="Retired">ULV/JIT and MEV recapture are not current Mintware features. Current liquidity uses MarketEngine’s resting band and guarded recenter; no per-swap JIT pull or MEV capture.</Note><p className={SUB}>Current details are in <Ln to="vaults" nav={nav}>MarketEngine</Ln>. The retired design is kept in the archive for historical reference.</p></>
}
function Matched({ nav }: { nav: Nav }) {
  return <><div className={EY}>How it works · matched liquidity</div><h1>Matched liquidity</h1><Note k="Retired">Community-matched launch issuance, lock tiers, and senior/junior new issuance are retired. They are not current product mechanics.</Note><p className={SUB}>Current curated-pool liquidity uses one MarketEngine per pool. See <Ln to="vaults" nav={nav}>MarketEngine</Ln> for deposit, mark, withdrawal, and recenter behavior.</p></>
}
function Rewards() {
  return <><div className={EY}>How it works · Rewards</div><h1>Rewards</h1><Note k="Status">The former LP Gateway fee ledger and harvest-based referral rewards are retired. This section does not describe current MarketEngine accounting.</Note><p className={SUB}>MarketEngine share value is denominated in the quote asset. Current pool curation and engine state are described in the registry documentation.</p></>
}
function LpGateway({ nav }: { nav: Nav }) {
  return <><div className={EY}>How it works · LP Gateway</div><h1>The LP Gateway</h1><Note k="Retired">LP Gateway PositionManager/Staging mechanics and stage → deploy → harvest → compound flow are retired. Current product is MarketEngine, live on Robinhood Chain testnet · unaudited.</Note><p className={SUB}>The legacy gateway route prefix remains for Discover, curation, and registry operations. The old deploy, harvest, portfolio, and leaderboard APIs are removed.</p><p>Current contracts and pool mechanics are documented under <Ln to="vaults" nav={nav}>MarketEngine</Ln>.</p></>
}
function LSA() {
  return <><div className={EY}>How it works · Liquid Sovereign Account</div><h1>Card refill</h1><Note k="Current behavior">MintwarePaymentGateway is refill-only. A relayer redeems the member’s Earn shares to that member’s registered buffer wallet. Bridge + Stripe card rails are pre-enable.</Note><p className={SUB}>There is no settleSpend flow, spend-from-NAV authorization, or merchant settlement from the vault. Buffer registration uses propose → 48 hours → accept; it can be revoked any time. Per-user and global UTC-day caps apply; cap increases are timelocked.</p></>
}
function AgentPay({ nav }: { nav: Nav }) {
  return <><div className={EY}>How it works · Agent payments</div><h1>Agent payments</h1><Note k="Status">Arc/CCTP settlement is retired. Agent park/unpark tooling on Base Sepolia is a separate testnet surface and unaudited.</Note><p className={SUB}>Do not treat the former YPN settle loop as a current payment path. External audit gates real value.</p></>
}
function Security({ nav }: { nav: Nav }) {
 return <><div className={EY}>Trust · Security</div><h1>Security</h1><p className={SUB}>Current MarketEngine deposits use a fresh-mark and spot-deviation guard; withdrawals remain available when the mark is stale. Recenter is guarded.</p><Note k="Status">Contracts are testnet deployments and unaudited. External audit gates real value.</Note><h2>Current contracts</h2><p>MarketEngine, per-token adapters, and the lifecycle module are recorded in <code>config/deployments.json</code>. See <Ln to="contracts" nav={nav}>Contracts &amp; status</Ln> for current deployment details.</p><h2>Retired designs</h2><p>ULV/JIT, am-AMM/MEV recapture, matched issuance, and the former YPN settlement path are not current features.</p></>
}
function Wallets({ nav }: { nav: Nav }) {
 return <><div className={EY}>Trust · Accounts</div><h1>Wallets &amp; custody</h1><p className={SUB}>MarketEngine shares are held by their holders. Card refill uses a member-registered buffer wallet.</p><h2>Buffer registration</h2><p>A member proposes a destination, waits 48 hours, then accepts it. The registration can be revoked any time. The refill relayer sends redeemed Earn assets only to that member’s registered buffer.</p><Note k="Status">Card rails are Bridge + Stripe, pre-enable. The payment gateway does not settle merchant spend from vault assets.</Note></>
}
function Contracts() {
 return <><div className={EY}>Reference · Contracts &amp; status</div><h1>Contracts &amp; status</h1><p className={SUB}>Current testnet deployments. Code presence confirmed by read-only RPC; constructor configuration and registry verification are not fully rechecked. Nothing is externally audited.</p><table className={TABLE}><thead><tr><th>Network</th><th>Contract</th><th>Address</th></tr></thead><tbody><tr><td>Robinhood Chain testnet</td><td>MintwareMarketEngine</td><td><code>0x38E426D6671FB2c07C07a468e59f954Dcd0eDeb8</code></td></tr><tr><td>Robinhood Chain testnet</td><td>MintwareMarketAdapter · tUSDG</td><td><code>0xFC17B41e102DA194083a3BfD0df49F79Fd1FcA62</code></td></tr><tr><td>Robinhood Chain testnet</td><td>MintwareMarketAdapter · tPONS</td><td><code>0xDc11D311364a175d992bB47484BA9DFaa3A0b73b</code></td></tr><tr><td>Robinhood Chain testnet</td><td>Fixed test mark</td><td><code>0xA7e84b45E59bccC5F1227e706Cc335dc7ab6ed10</code></td></tr><tr><td>Robinhood Chain testnet</td><td>Lifecycle module</td><td><code>0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421</code></td></tr><tr><td>Base Sepolia</td><td>MintwareMarketEngine</td><td><code>0x18c22836c71ae2dc6f483ab9ac41b4503e18c384</code></td></tr></tbody></table><Note k="Retired">LP Gateway staging/deploy contracts, ULV/JIT, matched issuance, and Treasury senior/junior new issuance are retired. See <code>config/deployments.json</code> for the deployment inventory.</Note></>
}
