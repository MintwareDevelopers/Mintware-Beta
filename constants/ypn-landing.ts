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
  note: 'The Liquid Sovereign Account is in active development. The Unified Liquidity Vault is in testing on testnet; card settlement over Circle + Privy on Arc is designed, not yet live. Nothing here is live or an offer to deposit.',
} as const

export const YPN_HERO = {
  eyebrow: 'Mintware · Liquid Sovereign Account',
  title: 'Your money should earn while you',
  titleAccent: 'spend it.',
  sub: 'The first Uniswap v4 Unified Liquidity Vault that generates institutional market-making yield — designed to deploy natively on Arc and turn every dollar of Aave + v4 liquidity into an instant, sub-350ms real-world spendable balance via Circle’s payments network, with native USDC for gas. Principal keeps compounding; only the yield moves.',
  secondaryCta: 'See how it works',
  secondaryHref: '#how-it-works',
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
    { product: 'Liquid Sovereign Account', liquidity: '100% liquid', yield: 'Institutional yield', verdict: 'Aave v3 + v4 MEV recapture, spendable at 100M+ Visa terminals in sub-400ms.', us: true },
  ],
} as const

// ─── The engine flow (PillarArchitectureDiagram) ────────────────────────────
export const YPN_FLOW = {
  eyebrow: 'The flow',
  title: 'One balance. Two engines. Real-world spend.',
  steps: [
    {
      key: 'deposit',
      label: 'Deposit USDC',
      sub: 'Single-sided · native gas',
      desc: 'Deposit single-sided USDC into the Unified Liquidity Vault — designed for native-USDC gas on Arc, no native token to manage.',
      accent: 'text-atx-blue',
    },
    {
      key: 'vault',
      label: 'Unified Liquidity Vault',
      sub: 'Aave v3 buffer + v4 JIT',
      desc: '~80%+ sits in an idle Aave v3 buffer earning 4–8% base APY; the rest powers a Uniswap v4 JIT engine that recaptures MEV/LVR and swap fees.',
      accent: 'text-atx-coral',
    },
    {
      key: 'intent',
      label: 'Privy Delegated Card Intent',
      sub: 'Real-time NAV hold',
      desc: 'A swipe triggers a delegated card intent: a real-time NAV hold designed to settle atomically against the idle Aave buffer — no unwind of active liquidity.',
      accent: 'text-atx-mesquite',
    },
    {
      key: 'spend',
      label: 'Instant real-world spend',
      sub: 'Visa · Apple Pay · sub-400ms',
      desc: 'Yield becomes spendable at 100M+ Visa terminals — designed for sub-400ms authorization, settled over Circle’s payments network.',
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
      how: 'Roughly 80%+ of vault capital sits in the idle Aave v3 buffer. Card authorizations are designed to settle natively against that buffer.',
      why: 'Spend never pulls liquidity out of active Uniswap v4 JIT pools or disrupts market-making depth — the yield engine keeps running while you transact.',
    },
    {
      key: 'loop',
      index: '02',
      icon: '◎',
      accent: 'text-atx-coral',
      title: 'The spent-yield loop',
      subtitle: 'Principal compounds forever',
      how: 'A point-of-sale transaction is designed to settle against accrued yield and MEV first, before ever touching deposited capital.',
      why: 'Principal stays 100% intact and keeps compounding indefinitely — you are spending the interest, not the balance. Zero opportunity cost.',
    },
    {
      key: 'identity',
      index: '03',
      icon: '◈',
      accent: 'text-atx-mesquite',
      title: 'Identity-layer embedded',
      subtitle: 'No custodian, no off-ramp',
      how: 'Privy binds the EVM wallet, vault shares, and card authorization to a single passkey — one identity across on-chain and card.',
      why: 'Unlike generic crypto cards that off-ramp USDC to a centralized custodian with slippage and tax drag, there is no middleman exchange. You keep custody.',
    },
  ],
} as const

// ─── Enterprise verticals (ValuePropMatrixTable) ────────────────────────────
export const YPN_MATRIX = {
  eyebrow: 'Where it goes',
  title: 'Three ways the account ships',
  columns: ['Vertical', 'The pitch', 'The line'],
  rows: [
    {
      key: 'hnw',
      audience: 'HNW DeFi checking',
      pain: 'Earn institutional yield while buying coffee.',
      solution: '“Why keep $250k at 0.01%?”',
      solutionDetail: 'Capture Aave yield + LVR arbitrage on-chain, yet remain instantly spendable via Apple Pay.',
      accent: 'text-atx-blue',
    },
    {
      key: 'corp',
      audience: 'Corporate treasury OS',
      pain: 'Yield-funded team debit cards.',
      solution: 'Fund spend out of yield',
      solutionDetail: 'DAOs and startups hold idle USDC. Issue team cards mapped to vault allowances — corporate spend funded purely from yield.',
      accent: 'text-atx-coral',
    },
    {
      key: 'invisible',
      audience: 'Invisible DeFi',
      pain: 'Deposit dollars, tap your phone, watch it grow.',
      solution: 'No hooks to understand',
      solutionDetail: 'Mass retail never sees v4 hooks, JIT, or Aave adapters — just a balance that grows every day, even as they spend.',
      accent: 'text-atx-mesquite',
    },
  ],
} as const

// ─── Settlement stack (CircleTechBadge) — Arc · Circle · Privy · Visa ───────
export const YPN_CIRCLE = {
  eyebrow: 'Settlement stack',
  title: 'Native on Arc. Settled by Circle. Spent on Visa.',
  body: 'The account is designed to deploy natively on Arc with native-USDC gas, settle over Circle’s payments network in sub-350ms, authorize card intents through Privy, and clear at 100M+ Visa / Apple Pay terminals — no centralized off-ramp, no native-token juggling.',
  stack: [
    { name: 'Arc', role: 'Native deployment · USDC gas' },
    { name: 'Circle', role: 'Payments network · sub-350ms settlement' },
    { name: 'Privy', role: 'Delegated card intent · identity' },
    { name: 'Visa', role: '100M+ terminals · Apple Pay' },
  ],
  points: [
    'Single-sided USDC in — native-USDC gas, no native token',
    'Vault-level settlement against the idle Aave buffer',
    'Sub-400ms authorization at real-world point of sale',
  ],
} as const

// ─── Interactive calculator (YieldCalculatorWidget) ─────────────────────────
// Illustrative estimate only. Monthly Yield = (Balance * APY) / 12.
export const YPN_CALCULATOR = {
  eyebrow: 'Estimate',
  title: 'Your always-liquid yield',
  sub: 'See what your balance could earn while staying 100% spendable — no lockup, no withdrawal window, principal untouched.',
  disclaimer: 'Illustrative estimate only. Not a quote, offer, or guarantee of yield. Actual returns vary with market conditions.',
  tvl: {
    label: 'Your balance (single-sided USDC)',
    min: 10_000,
    max: 10_000_000,
    step: 10_000,
    default: 250_000,
  },
  apy: {
    label: 'Estimated blended APY (Aave + v4 MEV)',
    min: 1,
    max: 20,
    step: 0.5,
    default: 8.0,
  },
  resultLabel: 'Estimated monthly yield',
  yearSuffix: 'a year — earned while fully spendable',
  principalLabel: 'Locked or withdrawn',
  principalValue: 'None — 100% spendable',
} as const

// ─── Coming-soon conversion (AppConversionCTA) — waitlist, no app launch ────
export const YPN_CTA = {
  eyebrow: 'Coming soon',
  title: 'Be first to the Liquid Sovereign Account',
  body: 'The account opens soon. Leave your email for early access when yield-bearing, instantly-spendable cash goes live.',
  successLabel: '✴ You’re on the list',
  secondaryCta: 'Read the docs',
  secondaryHref: '/docs',
} as const

// ─── Ethos — liquidity as a public good (page band + home teaser) ───────────
export const YPN_ETHOS = {
  eyebrow: '✴ Liquidity as a public good',
  title: 'Liquidity that stays productive — and stays yours',
  body: 'Mintware exists to make liquidity a public good: capital that never sits idle and is never locked away. The Liquid Sovereign Account is that idea in your pocket — your deposit works as institutional market-making liquidity for the whole ecosystem, and its yield is instantly yours to spend in the real world. Never idle, never trapped, never surrendered.',
  quote: 'Liquidity should be a public good.',
} as const

// ─── Home-embed teaser (YieldPaymentNetworkSection) ─────────────────────────
export const YPN_TEASER = {
  eyebrow: '✴ Mintware Liquid Sovereign Account',
  title: 'Earn while you spend',
  body: 'Institutional yield on your idle USDC — Aave v3 + Uniswap v4 MEV recapture — designed to stay instantly spendable at Visa terminals in sub-400ms. Principal never touched.',
  cta: 'Explore the Liquid Sovereign Account',
  href: '/yield-payment-network',
} as const

export type YpnPillar = (typeof YPN_PILLARS.cards)[number]
export type YpnMatrixRow = (typeof YPN_MATRIX.rows)[number]
export type YpnFlowStep = (typeof YPN_FLOW.steps)[number]
export type YpnThesisRow = (typeof YPN_THESIS.rows)[number]
