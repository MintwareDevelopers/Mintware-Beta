// =============================================================================
// constants/ypn-landing.ts
//
// ALL copy + data for the public "Yield Payment Network / Liquid Sovereign
// Account" marketing surface (route: /yield-payment-network + the embeddable
// YieldPaymentNetworkSection). TOP-OF-FUNNEL marketing only — no app state.
//
// THESIS: the Liquid Sovereign Account (LSA) — a zero-opportunity-cost cash
// primitive. USDC in a Uniswap v4 Unified Liquidity Vault earns institutional
// yield (Aave v3 buffer + v4 MEV/LVR recapture) AND stays 100% spendable at
// Visa terminals in sub-400ms. Principal is never touched — only yield moves.
//
// HONESTY: this is COMING SOON / in development. The ULV is in testing on
// testnet; card settlement over Circle CPN + Privy on Arc, sub-350ms, Visa —
// all DESIGNED, not shipped. No "Launch app" CTA. Verbs stay "designed to" /
// "built to"; numbers (4–8% APY, sub-400ms) are targets, not guarantees.
// =============================================================================

export const YPN_STATUS = {
  label: 'Coming soon',
  note: 'The Liquid Sovereign Account is in development. The vault and spend-from-yield model are future designs; card settlement is not live. Nothing here is available for use.',
} as const

export const YPN_HERO = {
  eyebrow: 'Mintware · Liquid Sovereign Account',
  title: 'Spend while you',
  titleAccent: 'earn.',
  bullets: [
    { title: 'Institutional Yield', body: 'Designed to combine Uniswap v4 market-making with best-rate lending, routed across venues, to compound your principal.' },
    { title: 'Instant Real-World Spending', body: 'Designed for instant card purchases.' },
    { title: 'Yield-Only Spending', body: 'The plan is for card swipes to draw on accrued yield while leaving your position in place.' },
    { title: 'Native USDC Gas', body: 'Designed for frictionless transactions powered by USDC.' },
  ],
} as const

// ─── The thesis: ending the idle cash tax (CoreMechanismSection) ────────────
export const YPN_THESIS = {
  eyebrow: 'The thesis',
  title: 'End the idle cash tax',
  intro: 'Every cash product forces a broken trade-off between liquidity and yield. You pick one and pay for the other. The Liquid Sovereign Account is designed to end that trade-off.',
  rows: [
    { product: 'Traditional checking', liquidity: '100% liquid', yield: '~0% yield', verdict: 'Purchasing power rots to inflation.', us: false },
    { product: 'Savings & CDs', liquidity: 'Locked', yield: 'Yield-bearing', verdict: 'Capital trapped behind withdrawal windows.', us: false },
    { product: 'Traditional DeFi LPs', liquidity: 'Friction-heavy', yield: 'High yield', verdict: 'Manual unwinding, DEX swaps, gas, tax events.', us: false },
    { product: 'Liquid Sovereign Account', liquidity: '100% liquid', yield: 'Institutional yield', verdict: 'Best-venue lending + v4 MEV recapture — earnings instantly spendable in the real world.', us: true },
  ],
} as const

// ─── The engine flow (PillarArchitectureDiagram) ────────────────────────────
export const YPN_FLOW = {
  eyebrow: 'The flow',
  title: 'One balance. Two engines. Real-world spend.',
  steps: [
    {
      key: 'deposit',
      label: 'USDC position',
      sub: 'Zero extra tokens',
      desc: 'The design puts USDC into the vault without extra tokens or complicated setups.',
      accent: 'text-atx-blue',
    },
    {
      key: 'grow',
      label: 'Grow Your Balance',
      sub: 'Interest + trading fees',
      desc: 'The design earns automated interest and trading fees around the clock.',
      accent: 'text-atx-coral',
    },
    {
      key: 'tap',
      label: 'Tap to Pay',
      sub: 'No account lockup',
      desc: 'The planned card holds the exact amount needed without locking up the account.',
      accent: 'text-atx-mesquite',
    },
    {
      key: 'spend',
      label: 'Designed for real-world spend',
      sub: '100M+ Visa · under ½ sec',
      desc: 'The planned experience targets spending earnings at Visa merchants in under half a second.',
      accent: 'text-atx-blue',
    },
  ],
} as const

// ─── The 3 structural moats (PillarCardGrid) ────────────────────────────────
export const YPN_PILLARS = {
  eyebrow: 'The moat',
  title: 'Why generic crypto cards can’t do this',
  cards: [
    {
      key: 'isolation',
      index: '01',
      icon: '⬡',
      accent: 'text-atx-blue',
      title: 'JIT liquidity isolation',
      subtitle: 'Spend without disrupting depth',
      how: 'The design splits funds between a lending position and active trading. A future card payment is planned to draw from the interest buffer.',
      why: 'The planned experience lets you spend without pulling money out of active trades — the yield engine is designed to keep running.',
    },
    {
      key: 'loop',
      index: '02',
      icon: '◎',
      accent: 'text-atx-coral',
      title: 'The spent-yield loop',
      subtitle: 'Principal compounds forever',
      how: 'The design would use accrued yield for card purchases before touching the initial position.',
      why: 'The plan keeps the core balance in place while it compounds, with spending from accrued yield.',
    },
    {
      key: 'identity',
      index: '03',
      icon: '◈',
      accent: 'text-atx-mesquite',
      title: 'Identity-layer embedded',
      subtitle: 'No custodian, no off-ramp',
      how: 'The planned passkey flow links a wallet, vault balance, and card permissions into one identity.',
      why: 'The design keeps funds in user-controlled wallets or contracts, with no promised off-ramp fees or conversion costs.',
    },
  ],
} as const

// ─── Enterprise verticals (ValuePropMatrixTable) ────────────────────────────
export const YPN_MATRIX = {
  eyebrow: 'Where it goes',
  title: 'Three ways the account is designed to work',
  columns: ['Vertical', 'The pitch', 'The line'],
  rows: [
    {
      key: 'hnw',
      audience: 'HNW DeFi checking',
      pain: 'Earn institutional yield while buying coffee.',
      solution: '“Why keep $250k at 0.01%?”',
      solutionDetail: 'The design combines lending yield + LVR capture on-chain, with planned spending through Apple Pay.',
      accent: 'text-atx-blue',
    },
    {
      key: 'corp',
      audience: 'Corporate treasury OS',
      pain: 'Yield-funded team debit cards.',
      solution: 'Fund spend out of yield',
      solutionDetail: 'DAOs and startups hold idle USDC. The plan maps team cards to vault allowances, with spend designed to draw from yield.',
      accent: 'text-atx-coral',
    },
    {
      key: 'invisible',
      audience: 'Invisible DeFi',
      pain: 'Deposit dollars, tap your phone, watch it grow.',
      solution: 'No hooks to understand',
      solutionDetail: 'The planned retail experience hides v4 hooks, JIT, and lending adapters — a balance designed to grow as it is spent.',
      accent: 'text-atx-mesquite',
    },
  ],
} as const

// ─── Settlement stack (CircleTechBadge) — Arc · Circle · Privy · Visa ───────
export const YPN_CIRCLE = {
  eyebrow: 'Settlement stack',
  title: 'Native on Arc. Settled by Circle. Spent on Visa.',
  body: 'Designed for Arc and USDC gas, with Privy authorization and Circle settlement targeted below 350ms for Visa and Apple Pay purchases.',
  stack: [
    { name: 'Arc', role: 'Planned chain using USDC for gas.' },
    { name: 'Circle', role: 'Planned payment network; settlement speed is a target.' },
    { name: 'Privy', role: 'Planned passkey identity for card spending.' },
    { name: 'Visa', role: 'Planned card acceptance network.' },
  ],
  points: [
    'Designed for single-sided USDC',
    'Settlement planned from interest buffer',
    'Sub-400ms point-of-sale approval target',
  ],
} as const

// ─── Interactive calculator (YieldCalculatorWidget) ─────────────────────────
// Illustrative estimate only. Monthly Yield = (Balance * APY) / 12.
export const YPN_CALCULATOR = {
  eyebrow: 'Estimate',
  title: 'Your always-liquid yield',
  sub: 'Illustrate what a balance could earn while designed to stay spendable — with no lockup or withdrawal window.',
  disclaimer: 'Illustrative estimate only. Not a quote, offer, or guarantee of yield. Actual returns vary with market conditions.',
  tvl: {
    label: 'Your balance (single-sided USDC)',
    min: 10_000,
    max: 10_000_000,
    step: 10_000,
    default: 250_000,
  },
  apy: {
    label: 'Estimated blended APY (best-venue lending + v4 MEV)',
    min: 1,
    max: 20,
    step: 0.5,
    default: 8.0,
  },
  resultLabel: 'Estimated monthly yield',
  yearSuffix: 'a year — modeled while designed to stay spendable',
  principalLabel: 'Planned availability',
  principalValue: 'Designed to stay spendable',
} as const

// ─── Coming-soon conversion (AppConversionCTA) — waitlist, no app launch ────
export const YPN_CTA = {
  eyebrow: 'Coming soon',
  title: 'Be first to the Liquid Sovereign Account',
  body: 'The account is in development. Leave your email for early access when yield-bearing, spendable cash is ready.',
  successLabel: '✴ You’re on the list',
  secondaryCta: 'Read the docs',
  secondaryHref: '/docs',
} as const

// ─── Ethos — liquidity as a public good (page band + home teaser) ───────────
export const YPN_ETHOS = {
  eyebrow: 'Liquidity as a public good',
  title: 'Money That Earns 24/7, Ready When You Are',
  body: 'Mintware is designed to turn capital into a spendable asset. The planned account earns yield while strengthening market liquidity — with earnings designed for point-of-sale spending.',
  quote: 'Never idle, never locked, always yours.',
} as const

// ─── Home-embed teaser (YieldPaymentNetworkSection) ─────────────────────────
export const YPN_TEASER = {
  eyebrow: 'Mintware Liquid Sovereign Account',
  title: 'Earn while you spend',
  body: 'That’s the other half: the plan makes yield spendable at the point of sale. The design lets capital keep working while you spend accrued yield.',
  cta: 'Explore the Liquid Sovereign Account',
  href: '/yield-payment-network',
} as const

// ─── The blended liquidity model + dual doors (in-page section) ─────────────
// Accurate model: a market-maker anchors a BLENDED position; the public makes up
// the difference; the vault runs it as active v4 liquidity + an Aave buffer, so
// one balance earns twice and stays spendable. Two audiences (depositor + MM).
export const YPN_LIQUIDITY = {
  eyebrow: 'How it works',
  title: 'Liquidity,',
  titleAccent: 'finally accessible.',
  body: 'The matched-liquidity roadmap has a market-maker anchor the pool with a blended position — say 200 ETH + 300,000 USDC — and the public make up the difference. The planned vault combines Uniswap v4 liquidity with a lending buffer, with trading capture and spendability as future goals.',
  flow: [
    { label: 'Broker anchors', sub: 'blended liquidity — e.g. 200 ETH + 300k USDC' },
    { label: 'Public fills',    sub: 'the community makes up the difference' },
    { label: 'Planned vault',   sub: 'Uniswap v4 + a lending buffer' },
    { label: 'Planned yield',   sub: 'trading capture + lending' },
  ],
  doors: [
    { kicker: 'For you', tone: 'peri', title: 'Deposit, earn, spend', body: 'The planned account accepts USDC, earns stacked yield, and supports card spending without unwinding or cashing out first.' },
    { kicker: 'For market-makers', tone: 'coral', title: 'Seed liquidity, reward your community', body: 'The roadmap lets market-makers anchor liquidity for a token launch and offer the community a spendable-yield account.' },
  ],
} as const

// ─── The epic tech (in-page dark-pop band) ──────────────────────────────────
export const YPN_TECH = {
  eyebrow: 'Under the hood',
  title: 'The hard part,',
  titleAccent: 'done right.',
  intro: 'None of this works without the engineering. Here’s the part we’re proud of.',
  items: [
    { k: 'Arc smart contracts', v: 'Planned USDC gas and card authorization, with sub-150ms as a target.' },
    { k: 'The ULV engine',      v: 'Designed for just-in-time liquidity on swaps, keeping capital productive.' },
    { k: 'MEV / LVR recapture', v: 'Designed to return some value otherwise captured by arbitrageurs.' },
    { k: 'Testnet work',        v: 'Payment core has been deployed and verified on Base Sepolia; unaudited.' },
  ],
  note: 'On testnet — deployed ≠ audited. An external audit precedes mainnet or real value.',
} as const

// ─── The senior tranche — the headline value prop (counsel-safe framing) ─────
// Honesty guardrails (see /legal + docs/developers/eth-senior-tranche.md): NO "deposit / savings /
// guaranteed / fixed APY" language. Frame as "cash that stays productive," yield "from the pools it
// backs" (protocol-native, not a Mintware promise), and always the testnet/not-a-guarantee note.
export const YPN_ETH_SENIOR = {
  eyebrow: 'The senior tranche',
  title: 'Cash that stays cash —',
  titleAccent: 'and stays productive.',
  body:
    'The roadmap explores a two-part structure: a community senior side and a first-loss junior tranche for team capital. If developed, the vault would aim to prioritize the senior claim in its payout order; this is not a current product or a promise of repayment.',
  cards: [
    { k: 'Senior / junior · roadmap', v: 'The proposed payout order places the community senior claim before the team’s junior tranche.' },
    { k: 'First-loss design · roadmap', v: 'The proposed junior tranche would absorb losses first; it cannot guarantee full coverage.' },
    { k: 'Spend from yield · roadmap', v: 'The card design would hold against an earning position, then settle. Spending is not currently available.' },
  ],
  note:
    'Senior/junior tranches and spend-from-yield are roadmap designs. MarketEngine is live on Robinhood Chain testnet; its adapters hold test assets without yield. Unaudited; no real value.',
} as const

// ─── Standing — spend-based service tiers (counsel-safe framing) ────────────
// Honesty guardrails (see /legal bright line #4/#6 + docs/legal/priority-buffer-redesign.md item
// #5): Standing is earned ONLY by genuine, settled, third-party card spend — never by depositing,
// holding, or staking anything. Every perk is a SERVICE-QUALITY improvement (settlement speed,
// spend headroom, early access) — never a payout, a new token, or anything tradeable. No
// "earn / appreciate / trade" language. Fully independent of the Attribution score, which stays
// informational-only (docs/legal/attribution-informational.md) and never gates anything here.
export const YPN_STANDING = {
  eyebrow: 'Built for how you actually use it',
  title: 'The more you spend,',
  titleAccent: 'the better it gets.',
  body: 'The planned Standing tiers would track settled spending on a card — nothing else. There’s nothing to deposit, hold, or stake to move up. Card use would move you forward.',
  tiers: [
    { name: 'Active', unlock: 'Planned: settled purchases', perk: 'Proposed priority settlement in the batch queue.' },
    { name: 'Established', unlock: 'Planned: sustained use', perk: 'A proposed tighter hold to make more of a balance available to spend.' },
    { name: 'Trusted', unlock: 'Planned: consistent use', perk: 'Proposed higher daily limits and early access to new accounts.' },
  ],
  note: 'Standing is a planned service feature based on settlement history, separate from Attribution. It would affect how the account serves you, not what it pays you.',
} as const

export type YpnPillar = (typeof YPN_PILLARS.cards)[number]
export type YpnMatrixRow = (typeof YPN_MATRIX.rows)[number]
export type YpnFlowStep = (typeof YPN_FLOW.steps)[number]
export type YpnThesisRow = (typeof YPN_THESIS.rows)[number]
