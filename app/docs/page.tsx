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
  return (
    <>
      <div className={EY}>Start here · Overview</div>
      <span className="live-chip mb-2"><span className="dot" aria-hidden />Live · Attribution, Agents &amp; Swap on Base mainnet</span>
      <h1>Mintware — <span className="text-gradient-accent">the liquidity spine</span></h1>
      <p className={SUB}>One pool of capital that is never idle, never locked to a single job, and always yours. Attribution measures on-chain contribution; the vault engine puts idle capital to work and hands it back the instant a swap needs it.</p>
      <p>Mintware is built on one idea: a unit of capital should do more than one thing. Deposited liquidity <b>idles in a lending market</b> earning yield, is <b>pulled just-in-time</b> into a Uniswap V4 pool exactly when a swap needs it, and — on the payments surface — stays <b>spendable</b> the whole time. Never idle. Never locked. Always yours (non-custodial throughout).</p>
      <p>Several surfaces sit on that spine, each at a different maturity. We are precise about status because these are developer docs, not a pitch:</p>
      <table className={TABLE}>
        <thead><tr><th>Surface</th><th>What it is</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td><b>Attribution</b></td><td>On-chain reputation score — seven dimensions plus a risk penalty (engine <code>attribution-v2.0.0</code>)</td><td>Live — Base mainnet</td></tr>
          <tr><td><b>AI Agents</b></td><td>ERC-8004 identity + agent reputation (behavior + contribution + interpretability − risk)</td><td>Live — Base mainnet</td></tr>
          <tr><td><b>Swap</b></td><td>LI.FI cross-chain routing</td><td>Live</td></tr>
          <tr><td><b>Vaults (ULV engine)</b></td><td>JIT-liquidity Uniswap V4 vaults with an Aave idle sink</td><td>Built &amp; tested — in testing on Base Sepolia</td></tr>
          <tr><td><b>Liquid Sovereign Account</b></td><td>USDC that earns yield and stays spendable</td><td>Coming — payment core on Base Sepolia</td></tr>
        </tbody>
      </table>
      <Note k="Honest status">Nothing here is externally audited. Attribution, Agents, and Swap are live on Base mainnet. The vault engine is <b>in testing on Base Sepolia</b> — never &ldquo;deposit now.&rdquo; The Liquid Sovereign Account is <b>coming</b>: its payment core is deployed and cast-verified on testnet, but deployed ≠ audited.</Note>
      <Note k="Where to go next">For the mechanism in one screen, read <Ln to="model" nav={nav}>The model</Ln>. For the score, <Ln to="attribution" nav={nav}>Attribution</Ln>. For the engine, <Ln to="vaults" nav={nav}>Vaults</Ln>.</Note>
    </>
  )
}
function Model() {
  return (
    <>
      <div className={EY}>Start here · The model</div>
      <h1>The model in one page</h1>
      <p className={SUB}>Three proofs, one screen. Everything else is implementation detail on top of these.</p>
      <h3>1 · Never idle — capital earns while it waits</h3>
      <p>Depositor principal sits in Aave v3 via <code>AaveV3YieldAdapter.sol</code> (supply-only — no borrow, no liquidation risk) and is pulled into the pool <b>just-in-time</b> on a swap, then re-supplied. Idle capital is tracked by price-free settled counters, never by a live aToken read (which would be donation-inflatable — the &ldquo;Bunni bug&rdquo;).</p>
      <h3>2 · Never locked — one unit, many jobs</h3>
      <p>A share is a pro-rata claim on both legs of the pair — pooled and idled principal together. On the payments surface the same USDC earns yield <b>and</b> authorizes a card charge in under 150ms, settled async by burning exactly enough shares. The capital is doing two jobs at once.</p>
      <h3>3 · Always yours — non-custodial, provable</h3>
      <p>You interact with the vault contracts directly; keys stay with you via Privy. Rewards settle as signed Merkle roots you claim yourself — the oracle never takes custody. On-chain guards (over-allocation caps, no-claims-after-sweep, a guardian kill-switch) enforce the rules, not a promise.</p>
      <Claim>Never idle. Never locked. <b>Always yours.</b></Claim>
      <Note k="Reputation weighting is not everywhere">Reputation- and referral-weighting applies to the <b>Growth (pair) vault</b> reward path only. The matched-liquidity vault pays strictly <b>pro-rata</b>. We flag which is which throughout.</Note>
    </>
  )
}
function Attribution() {
  return (
    <>
      <div className={EY}>How it works · Attribution</div>
      <h1>Attribution — the score</h1>
      <p className={SUB}>A chain-agnostic reputation score computed from seven on-chain dimensions plus a risk penalty. Pure, deterministic, and weighted so a whale is not 10× a minnow.</p>
      <p>Attribution reads a wallet&apos;s on-chain history and reduces it to one number in <b>[0, 925]</b> (engine <code>attribution-v2.0.0</code>, in <code>lib/attribution/*</code>). <code>computeScore(activity, nowMs)</code> is pure and deterministic. It is live: the on-chain <b>AIAttribution v3</b> contract sits on Base mainnet.</p>

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
      <Spec>{'logCurve(v, mid)   = 1 − 2^(−v/mid)     '}<span className="g">// saturating; 10× input is NOT 10× score</span>{'\nlinearCap(v, cap)  = clamp01(v / cap)\nrecencyDecay       = 0.5^(daysSinceLastSeen / halfLife)'}</Spec>
      <p>Worked examples straight from the engine:</p>
      <Spec><b>Liquidity</b>{'  = logCurve( Σ lp.usdDepth × clamp01(durationDays/180), 20000 ) × 200\n'}<b>Longevity</b>{'  ageScore = logCurve(ageDays, 730)  '}<span className="g">// 2yr ≈ 0.5; gates tenure+recency → 1-day wallet ≈ 0</span>{'\n'}<b>Network</b>{'   qualitySum = Σ referredScore × (retained ? 1 : 0.5)\n          = logCurve(qualitySum, 1200) × 100  '}<span className="g">// 1 real referral &gt; 100 sybils</span></Spec>
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
  return (
    <>
      <div className={EY}>How it works · Vaults · ULV engine</div>
      <h1>Vaults — the ULV engine</h1>
      <p className={SUB}>Dual-sided Uniswap V4 liquidity where depositor capital idles in Aave and is pulled just-in-time into the pool on a swap. The canonical vault is <code>MintwareDeFiPairVault.sol</code>.</p>
      <Note k="Status">The ULV engine is <b>built and tested, in testing on Base Sepolia</b> — feature-flagged, not on mainnet. Do not treat any address here as &ldquo;deposit now.&rdquo;</Note>

      <h2>The stack</h2>
      <ul>
        <li><b>Vault:</b> <code>MintwareDeFiPairVault.sol</code> — the canonical dual-sided &ldquo;Growth&rdquo; vault.</li>
        <li><b>Hook:</b> <code>MWHookCoordinator.sol</code> with <code>MWOracleGuard.sol</code> (truncated-tick oracle) and <code>MWDynamicFee.sol</code>.</li>
        <li><b>Idle sink:</b> <code>AaveV3YieldAdapter.sol</code>.</li>
        <li><b>Libs</b> (delegatecall, for EIP-170 code-size relief): <code>MWJitLib</code>, <code>MWIdleLib</code>, <code>MWPositionLib</code>.</li>
      </ul>
      <Gap k="✕ Deprecated — do not use">The single-sided <code>MintwareDeFiVault4626.sol</code> has a known NAV/solvency flaw (principal-pegged shares vs two-token backing → late-redeemer loss) and carries an in-code deprecation notice. Legacy <code>FeeVault.sol</code> is superseded too. The <b>pair vault is canonical.</b></Gap>

      <h2>JIT liquidity, mid-swap</h2>
      <p>Depositor capital idles in Aave and is pulled into the pool only for the swap that needs it, then returned. Three steps, price-free:</p>
      <Pipe items={[
        ['1 · Gate', 'Size filter', 'Only |amountSpecified| ≥ jitThreshold on a jitEnabled pool triggers JIT.'],
        ['2 · Open', 'beforeSwap → jitOpen', 'Pulls OUTPUT-side principal from Aave, sized from |amountSpecified| — no oracle read.'],
        ['3 · Close', 'afterSwap → jitClose', 'Removes the position, takes both sides, re-supplies to Aave.'],
      ]} />
      <p>The JIT position opens a tight single-sided range to one side of the live tick at a dedicated salt <code>keccak256(&quot;MW_JIT&quot;)</code> — a physically separate V4 position, never co-mingled with the main range. A <code>jitActive</code> guard blocks vault entrypoints while JIT is open. At rest, <code>jitLiquidity</code> MUST be zero and is never counted in share math.</p>
      <Gap k="✕ The settlement gotcha (found by fuzzing)">The swapper settles its <b>input</b> token <b>last</b> — after <code>afterSwap</code> — so at close the PoolManager may not yet hold the input reserves the JIT removal is owed. Reverting would brick the swap. The fix: take physical up to what&apos;s available and <b>mint an ERC-6909 claim for the shortfall</b> (real backing, counted in solvency), redeemed later via <code>sweepJitClaims()</code>.</Gap>

      <h2>The idle buffer (MWIdleLib)</h2>
      <p><code>bufferRatioBps</code> sets the fraction kept hot in the active range; the remainder idles in Aave. Crucially, <code>idle0</code> / <code>idle1</code> are <b>price-free settled counters</b> — the vault&apos;s own record of principal it supplied — never derived from <code>adapter.totalAssets()</code>:</p>
      <Spec>{'managed = positionLiquidity + idleLiquidity\ndeposit → mints shares against managed, VIRTUAL_LIQUIDITY = 1e3  '}<span className="g">// inflation defense</span>{'\n\nharvest: yield = adapter.totalAssets() − idle\n         MINTWARE_FEE_BPS = 2500 (25%)  '}<span className="g">// protocol cut on the HARVEST leg only</span></Spec>
      <p>A live aToken balance is donation-inflatable, so it is used only to measure <b>harvestable yield</b>, never to value shares. A share is a pro-rata claim on both legs — pooled plus idled principal.</p>

      <h2>The Aave adapter</h2>
      <ul>
        <li>Direct <code>IPool.supply</code> / <code>withdraw</code>, <b>supply-only</b> — no borrow, no collateral, no liquidation risk.</li>
        <li>Withdraw is <b>best-effort and never reverts</b>: clamps to headroom and a per-block cap, wrapped in try/catch.</li>
        <li>The aToken is verified in the constructor; <code>maxSuppliable()</code> models Aave&apos;s supply cap.</li>
      </ul>

      <h2>Fee split</h2>
      <p>Position/swap fees split <b>60% LP / 30% treasury / 10% buyback-and-burn</b> by default — configurable, but <code>MAX_NON_LP_FEE_BPS = 4000</code> guarantees LPs always keep <b>≥ 60%</b>, and rounding favors LPs. If <code>buybackSink == 0</code>, the buyback cut folds into treasury.</p>
      <p>The <b>LP leg</b> routes one of two ways: if a <code>weightedDistributor</code> is set, LP rewards are <b>reputation + referral weighted</b> (computed off-chain); otherwise a legacy MasterChef-style per-share accumulator pays flat. This is why reputation-weighting is a <b>Growth-vault-only</b> property.</p>

      <h2>Lock tiers &amp; redemption</h2>
      <table className={TABLE}>
        <thead><tr><th>Tier</th><th>Lock</th><th>Multiplier</th></tr></thead>
        <tbody>
          <tr><td><b>Flex</b></td><td>none</td><td>1.0×</td></tr>
          <tr><td><b>Committed</b></td><td>30 days</td><td>1.1×</td></tr>
          <tr><td><b>Aligned</b></td><td>90 days</td><td>1.25×</td></tr>
          <tr><td><b>Core</b></td><td>180 days</td><td>1.5×</td></tr>
        </tbody>
      </table>
      <p>Early exit pays a penalty to treasury by elapsed fraction: <b>&lt; 20% → 2.0%</b>, <b>20–50% → 1.0%</b>, <b>50–80% → 0.5%</b>. Redemption is async: <code>requestRedeem</code> (after a 24h <code>MIN_HOLD</code>) → a 7-day <code>NOTICE_PERIOD</code> → <code>executeRedeem</code>.</p>
      <Note k="Reward routing">Reputation-weighted LP rewards use the <Ln to="rewards" nav={nav}>weighted distributor</Ln>. For the pro-rata launch variant, see <Ln to="matched" nav={nav}>Matched liquidity</Ln>.</Note>
    </>
  )
}
function Matched({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>How it works · Matched liquidity</div>
      <h1>Matched liquidity</h1>
      <p className={SUB}>A launch vault where a team commits project tokens and the community matches with quote (USDC), under a hard 90-day cliff. Contract: <code>MintwareMatchedLiquidityVault.sol</code>.</p>

      <h2>The shape</h2>
      <p>A team commits <b>T</b> project tokens; the community matches with quote (USDC). <code>MIN_LOCK_DURATION = 90 days</code> is a hard cliff. Team funds are <b>locked but not owned by the protocol</b> — there is no team-initiated early withdrawal, and a guardian can <b>freeze but never release</b>.</p>

      <h2>Lifecycle</h2>
      <Pipe items={[
        ['1', 'commitTeam', 'Team locks its token side.'],
        ['2', 'depositCommunity', 'Community escrows quote; the team is barred from this side.'],
        ['3', 'activate / abort', 'Activate is permissionless; abort refunds everyone.'],
      ]} />
      <p><code>activate</code> is permissionless once it clears a threshold fill and a minimum number of depositors: it forms a <b>50/50</b> team-locked / community-free position and refunds any unmatched team remainder. The alternative terminal state is <code>abort</code> — a full refund to both sides.</p>

      <h2>Fees are pro-rata — not reputation-weighted</h2>
      <p>This is the key honest distinction from the Growth vault. Community fees are strictly <b>pro-rata to quote contribution</b>. While the position is locked, <code>teamFeesRedirected</code> excludes the team: the <b>team earns 0%</b> and the <b>community earns 100%</b> of fees for the duration of the lock.</p>
      <Note k="Which vault weights reputation?">Only the <Ln to="vaults" nav={nav}>Growth (pair) vault</Ln> routes rewards through reputation/referral weighting. The matched vault is pure pro-rata by design.</Note>
    </>
  )
}
function Rewards() {
  return (
    <>
      <div className={EY}>How it works · Rewards · Epochs</div>
      <h1>Rewards — epochs &amp; distribution</h1>
      <p className={SUB}>Off-chain owns the weighting math and the Merkle tree; on-chain enforces provenance and no-over-allocation. Canonical distributor: <code>MintwareWeightedDistributor.sol</code>.</p>

      <h2>Separation of duties</h2>
      <p>The design deliberately splits responsibilities. <b>Off-chain</b> computes the weighting formula and builds the Merkle tree. <b>On-chain</b> enforces only two things: provenance (a valid oracle signature) and that a signed root can never allocate more than the funded pot. The distributor is multi-tenant by <code>vaultId</code>.</p>
      <Spec>{`EPOCH_DURATION = 7 days
CLAIM_EXPIRY   = 90 days

closeEpoch: verify EIP-712 sig  AND  total0 ≤ pot0  &&  total1 ≤ pot1
claim:      pays BOTH tokens in one leaf · CEI · claim-once · none-after-sweep
sweep:      after expiry, unclaimed → funder`}</Spec>
      <p>A guardian kill-switch gates the value paths; the oracle rotates via a <b>48h timelock</b>.</p>

      <h2>The weighting formula (off-chain)</h2>
      <p>In <code>lib/rewards/vault/weightedDistribution.ts</code> there are <b>two pots</b>. The BASE pot is swap fees, paid pro-rata by a base weight. Referral does <b>not</b> enter the base weight:</p>
      <Spec><b>baseWeight</b>{' = liquidityUnits × durationMultiplier × attrMultiplier × lockTierMultiplier\n\n'}<span className="g">durationMultiplier</span>{'  ≥180d 1.3 · ≥90d 1.2 · ≥30d 1.1 · else 1.0\n'}<span className="g">attrMultiplier</span>{'      pct ≥67 1.5 · ≥34 1.25 · else 1.0\n'}<span className="g">lockTierMultiplier</span>{'  flex 1.0 · committed 1.1 · aligned 1.25 · core 1.5'}</Spec>
      <p>The MARGIN pot is a protocol top-up funding referral bonuses:</p>
      <Spec>{`referee boost   = +10% on own base
referrer earns  = 20% × referredLP.base × (refereePercentile / 100)`}</Spec>
      <p>Because the referrer&apos;s share scales by the referee&apos;s percentile, a score-0 sybil earns its referrer <b>~nothing</b> — the same anti-farming property as Attribution&apos;s Network dimension.</p>

      <h2>EIP-712 root</h2>
      <Spec>{`EPOCH_ROOT_TYPEHASH = keccak256(
  "EpochRoot(bytes32 vaultId,uint256 epochNumber,bytes32 merkleRoot,
   uint256 totalAmount0,uint256 totalAmount1,uint256 deadline)"
)
domain = EIP712("MintwareWeightedDistributor", "1")`}</Spec>
      <p>Embedding <code>vaultId</code> and <code>epochNumber</code> in the digest prevents cross-vault and cross-epoch replay of a signed root.</p>

      <h2>Leaf encoding (critical)</h2>
      <p>Both sides must produce identical hashes or every claim reverts. The two-token leaf and the single-token leaf both use <b><code>abi.encode</code> (64-byte padded)</b> and the OpenZeppelin double-keccak scheme — <b>never <code>abi.encodePacked</code></b>:</p>
      <Spec>{`two-token:    keccak256(bytes.concat(keccak256(abi.encode(
                msg.sender, amount0, amount1))))
              types: ['address','uint256','uint256']

single-token: StandardMerkleTree.of([[wallet, amount]], ['address','uint256'])`}</Spec>
      <p>Amounts are raw integer units (USDC × 1e6).</p>
      <Gap k="✕ Legacy path — superseded">The legacy <code>FeeVault</code> split was <b>70/15/10/5</b> (LPs / referrers / protocol / bonus). It is superseded by the weighted distributor plus the pair vault&apos;s <b>60/30/10</b> split. Document new work against the distributor.</Gap>
    </>
  )
}
function LSA() {
  return (
    <>
      <div className={EY}>How it works · Liquid Sovereign Account</div>
      <h1>The Liquid Sovereign Account</h1>
      <p className={SUB}>USDC that earns yield and stays spendable. A card charge authorizes in under 150ms off a cached vault NAV, then settles on-chain by burning exactly enough shares.</p>
      <Note k="Status — coming">The v1 payment core is <b>deployed and cast-verified on Base Sepolia</b>; the edge-auth service (55 tests) and relayer are built and proven; the v2 tranche vault is invariant-proven (256 × 128k) but not deployed. External audit precedes mainnet or any real value. <b>Deployed ≠ audited.</b></Note>

      <h2>Two tiers: authorize, then settle</h2>
      <Pipe items={[
        ['Authorization', 'Off-chain edge (Rust)', 'Under 150ms · APPROVE/DECLINE off cached NAV + reserve a hold · never moves funds.'],
        ['Settlement', 'On-chain (Base)', 'Async · burns shares + pays the rail.'],
      ]} />

      <h2>Earn — MintwareYieldVault.sol</h2>
      <p>A single-asset (USDC) 4626-style vault. Because there is one asset, it is <b>price-free by construction</b> — no oracle, no JIT. NAV rises monotonically as aTokens rebase. A symmetric virtual-offset inflation defense (<code>VIRTUAL = 1e3</code>) yields the invariant <code>totalShares ≤ totalAssets</code> — solvent by construction. <code>burnForPayment</code> is <code>onlyGateway</code>, CEI.</p>

      <h2>Authorize — services/edge-auth/src/ledger.rs</h2>
      <p>A pure decision core. It APPROVEs only if the charge clears all three bounds, each with a distinct decline reason:</p>
      <Pipe items={[
        ['1', 'Per-user equity', "Net of the user's own holds."],
        ['2', 'Daily cap', 'Net of spent + reserved holds.'],
        ['3', 'Global liquidity', "idleBuffer net of ALL users' holds — every hold stays settleable."],
      ]} />
      <p>A stale NAV/price declines first. On approve, it reserves a hold. NAV is cached in Redis and refreshed by a chain poller; a stalled refresher <b>fails safe</b>.</p>

      <h2>Spend permits — MintwarePaymentGateway.sol</h2>
      <p>EIP-712 domain <code>EIP712(&quot;Mintware Payment Gateway&quot;, &quot;2.0&quot;)</code>. The scheme is hybrid by amount:</p>
      <Spec>{`< $250            DelegatedSpendPermit(address user, uint256 maxDailySpendUSDC,
                                       uint256 nonce, uint256 deadline)   // long-lived

≥ $250            ALSO ShortLivedHoldAuth(bytes32 holdId, address user,
(HIGH_VALUE_          uint256 amountUSDC, uint256 nonce, uint256 expiry)  // ≤5min,
 THRESHOLD 250e6)     signed by an EDGE_SIGNER_ROLE key`}</Spec>
      <p>The nonce is <b>revocation-only</b>: <code>settleSpend</code> checks but never consumes it, so the long-lived permit is reusable. Replay of a specific charge is stopped by <code>holds[holdId].settled</code>; over-spend is stopped by the daily cap.</p>

      <h2>Settle — settleSpend (RELAYER_ROLE only)</h2>
      <p>Re-verifies both permits, enforces <code>vault.idleBuffer() ≥ assets</code>, hold idempotency, and the daily cap, then CEI:</p>
      <Spec>{`sharesBurned = previewWithdraw(assets)   // rounds up
vault.burnForPayment(...)
assert redeemed ≥ assets
USDC → Circle CPN rail treasury`}</Spec>
      <p>Funds settle to <b>Circle&apos;s CPN rail</b> and are <b>spendable via Visa</b>. The public stack is <b>Circle (CPN) + Visa</b>, with <b>Privy</b> for identity and custody.</p>
      <Gap k="✕ Rail naming">Settlement is described as &ldquo;settles to Circle&apos;s CPN rail, spendable via Visa.&rdquo; We do not name a card issuer on the authorization side — the code references a name not confirmed for public use.</Gap>
    </>
  )
}
function Security({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>Trust · Security</div>
      <h1>Security</h1>
      <p className={SUB}>Built security-first: a guardian kill-switch, an identity-blind price oracle, deviation-priced fees, and fuzzed invariants. Nothing here is externally audited — we never write &ldquo;audited.&rdquo;</p>

      <h2>Guardian kill-switch (MWGuardianPausable.sol)</h2>
      <p>The guardian pauses instantly; only the owner unpauses. In the hook, pause gates <code>beforeAddLiquidity</code> <b>only</b> — never the swap callbacks (a reverting <code>beforeSwap</code> would brick the pool) and never <code>beforeRemoveLiquidity</code> (positions must always be able to exit).</p>

      <h2>Truncated-oracle price guard (MWOracleGuard.sol)</h2>
      <p>A truncated geometric-mean tick oracle that reads <b>no trader identity</b>. The reference tick lags spot and advances at most <code>maxTickMovePerBlock</code> per block, so a single-block price push barely moves it.</p>
      <Spec>{`checkCircuitBreaker: revert swaps at deviation > maxDeviationTicks
pokeOracle:          permissionless heal path out of a circuit-breaker deadlock`}</Spec>

      <h2>Deviation-priced dynamic fee (MWDynamicFee.sol)</h2>
      <Spec>{`fee = base + slope × deviationTicks     // clamped, rate-limited per block
unmanaged pools: max(auction default, surge)   // recapture LVR
FALLBACK_MAX_FEE_PIPS = 10%`}</Spec>

      <h2>Access &amp; reentrancy</h2>
      <ul>
        <li><b>Vault-only LP gate.</b> The hook reverts add/remove unless <code>sender == vault</code>; JIT is hook-only; hook / vault / adapters are set-once; JIT uses a dedicated salt.</li>
        <li><b>CEI / reentrancy.</b> <code>nonReentrant</code> on all state-changing paths; settled state is decremented before external Aave withdraws.</li>
        <li><b>Adapter safety.</b> Supply-only, aToken verified in the constructor, a per-block withdraw cap, and a never-revert withdraw.</li>
        <li><b>Rewards guards.</b> total ≤ pot, a per-claim cumulative cap, no-claims-after-sweep, and a 48h oracle timelock.</li>
      </ul>

      <h2>Testing</h2>
      <p>ULV invariants run <b>256 runs × 128k calls over real swaps</b>; the YPN v2 vault is fuzzed to the same depth. Solidity <code>^0.8.26</code>; Slither clean; Halmos proof specs are written (execution is blocked by a tooling incompatibility, so those properties are covered by fuzzing). Suites: <b>Vitest ~256 green, Forge 175/175</b>.</p>
      <Note k="Honest status">No contract here has had an <b>external audit</b>. Attribution and agents are live on Base mainnet; the vault engine is in testing on Base Sepolia; YPN is coming. See <Ln to="contracts" nav={nav}>Contracts &amp; status</Ln>.</Note>
    </>
  )
}
function Wallets({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY}>Trust · Accounts</div>
      <h1>Wallets &amp; custody</h1>
      <p className={SUB}>Non-custodial throughout. Privy handles identity and custody; Mintware never holds your keys or your deposits.</p>
      <h2>Non-custodial by construction</h2>
      <p>You interact with the vault and payment contracts directly — assets stay in your control on-chain. Keys stay with you via <b>Privy</b>, the public stack&apos;s identity and custody layer (alongside Circle&apos;s CPN rail and Visa on the payments surface). There is no path where Mintware moves your funds unilaterally: rewards settle as signed Merkle roots you claim yourself, and the oracle never takes custody.</p>
      <h2>One identity</h2>
      <p>Your wallet is your identity — the same address carries your <Ln to="attribution" nav={nav}>Attribution</Ln> score across every surface. On the agent surface, identity is anchored on-chain via the <b>ERC-8004</b> registry (Mintware Agent #37297).</p>
      <Note k="Scope of this page">These docs describe custody at the level the engine guarantees it — direct contract interaction and self-claimed rewards. Deeper Privy key-management specifics are out of scope here.</Note>
    </>
  )
}
function Contracts() {
  return (
    <>
      <div className={EY}>Reference · Contracts &amp; status</div>
      <h1>Contracts &amp; status</h1>
      <p className={SUB}>The honest inventory: what is live on Base mainnet, and what is built but undeployed. Nothing here is externally audited.</p>

      <h2>Live — Base mainnet (8453)</h2>
      <table className={TABLE}>
        <thead><tr><th>Contract</th><th>Address / ID</th></tr></thead>
        <tbody>
          <tr><td><b>AIAttribution v3</b></td><td><code>0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421</code></td></tr>
          <tr><td>AIAttribution v2 (deprecated)</td><td><code>0xb9FB965…</code></td></tr>
          <tr><td><b>ERC-8004 registry</b></td><td><code>0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</code></td></tr>
          <tr><td>Mintware Agent</td><td><code>#37297</code></td></tr>
        </tbody>
      </table>
      <p>Agent reputation dimensions: <code>behavior + contribution + interpretability − risk</code>.</p>

      <h2>Built — Base Sepolia / undeployed (contracts-v4/src/)</h2>
      <table className={TABLE}>
        <thead><tr><th>Group</th><th>Contracts</th></tr></thead>
        <tbody>
          <tr><td><b>Hooks</b></td><td><code>MWHookCoordinator</code>, <code>MWOracleGuard</code>, <code>MWDynamicFee</code>, am-AMM auction</td></tr>
          <tr><td><b>Vaults</b></td><td><code>MintwareDeFiPairVault</code> (canonical), <code>MintwareMatchedLiquidityVault</code>, <code>AaveV3YieldAdapter</code>, <code>MintwareVaultFactory</code>, <code>MintwareVaultRegistry</code>, shared base — <i>deprecated:</i> <code>MintwareDeFiVault4626</code>, <code>FeeVault</code></td></tr>
          <tr><td><b>Libs</b></td><td><code>MWJitLib</code>, <code>MWIdleLib</code>, <code>MWPositionLib</code>, <code>MWGuardianPausable</code>, <code>MWTimelockedOracleSigner</code></td></tr>
          <tr><td><b>Rewards</b></td><td><code>MintwareWeightedDistributor</code>, soulbound <code>MintwareAttributionToken</code></td></tr>
          <tr><td><b>Payments / YPN</b></td><td><code>MintwarePaymentGateway</code>, <code>MintwareYieldVault</code>, <code>MintwareTreasuryVault</code></td></tr>
          <tr><td><b>Off-chain (Rust)</b></td><td><code>services/edge-auth</code> (55 tests), <code>services/relayer</code></td></tr>
        </tbody>
      </table>
      <Note k="The one rule">Live = Attribution, Agents, Swap (Base mainnet). In testing on Base Sepolia = the ULV vault engine. Coming = the Liquid Sovereign Account. <b>Nothing is externally audited.</b></Note>
    </>
  )
}

// ── nav + content registry ───────────────────────────────────────────────────
const GROUPS: { group: string; items: { id: string; label: string; star?: boolean }[] }[] = [
  { group: 'Start here', items: [
    { id: 'overview', label: 'Overview' },
    { id: 'model', label: 'The model' },
  ]},
  { group: 'How it works', items: [
    { id: 'attribution', label: 'Attribution — the score' },
    { id: 'vaults', label: 'Vaults — the ULV engine' },
    { id: 'matched', label: 'Matched liquidity' },
    { id: 'rewards', label: 'Rewards — epochs & distribution' },
    { id: 'lsa', label: 'Liquid Sovereign Account' },
  ]},
  { group: 'Trust', items: [
    { id: 'security', label: 'Security', star: true },
    { id: 'wallets', label: 'Wallets & custody' },
  ]},
  { group: 'Reference', items: [
    { id: 'contracts', label: 'Contracts & status' },
  ]},
]

const CONTENT: Record<string, (p: { nav: Nav }) => ReactNode> = {
  overview: Overview, model: Model, attribution: Attribution, vaults: Vaults,
  matched: Matched, rewards: Rewards, lsa: LSA, security: Security,
  wallets: Wallets, contracts: Contracts,
}

const PROSE = 'max-w-[840px] px-14 pt-11 pb-24 max-[880px]:px-5 max-[880px]:pt-8 ' +
  '[&_h1]:text-[clamp(28px,3.4vw,40px)] [&_h1]:font-bold [&_h1]:tracking-[-0.03em] [&_h1]:leading-[1.05] [&_h1]:mt-2.5 [&_h1]:mb-1.5 [&_h1]:text-wrap-balance ' +
  '[&_h2]:text-[21px] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:mt-8 [&_h2]:mb-2.5 [&_h2]:pt-5 [&_h2]:border-t [&_h2]:border-hair ' +
  '[&_h3]:text-[15.5px] [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-1 ' +
  '[&_p]:my-2.5 [&_p]:leading-[1.62] [&_p]:text-ink-mid ' +
  '[&_code]:font-mono [&_code]:text-[0.85em] [&_code]:bg-ground-cool [&_code]:border [&_code]:border-hair [&_code]:rounded-md [&_code]:px-1.5 [&_code]:py-px ' +
  '[&_ul]:my-2.5 [&_li]:relative [&_li]:pl-5 [&_li]:py-1 [&_li]:leading-[1.5] [&_li]:text-ink-mid ' +
  "[&_li]:before:content-['✦'] [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-2 [&_li]:before:text-peri [&_li]:before:text-[11px]"

export default function DocsPage() {
  const [active, setActive] = useState('overview')
  const nav: Nav = (id) => { if (CONTENT[id]) { setActive(id); window.scrollTo(0, 0) } }
  const Section = CONTENT[active] ?? Overview

  return (
    <div className="bg-white min-h-screen font-atx-display text-ink">
      <MwNav />
      <div className="grid grid-cols-[262px_1fr] max-w-[1280px] mx-auto max-[880px]:grid-cols-1">
        <aside className="border-r border-hair px-4 pt-6 pb-16 sticky top-[58px] self-start h-[calc(100vh-58px)] overflow-y-auto max-[880px]:static max-[880px]:h-auto max-[880px]:overflow-visible max-[880px]:border-r-0 max-[880px]:border-b max-[880px]:border-hair">
          {GROUPS.map((g) => (
            <div key={g.group}>
              <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-ink-soft mx-2 mt-5 mb-2 first:mt-0">{g.group}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => nav(it.id)}
                  className={`block w-full text-left text-[13px] px-3 py-[6px] rounded-lg leading-[1.35] cursor-pointer transition-colors ${active === it.id ? 'text-peri font-semibold bg-ground-cool' : 'text-ink-mid hover:text-peri hover:bg-ground-cool/60'}`}
                >
                  {it.label}{it.star && <span className="text-coral2-deep text-[9px] align-[1px]"> ★</span>}
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
