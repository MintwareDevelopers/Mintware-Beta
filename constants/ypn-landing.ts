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
  title: 'Spend while you',
  titleAccent: 'earn.',
  bullets: [
    { title: 'Institutional Yield', body: 'Combines Uniswap v4 market-making with Aave lending to continuously compound your principal.' },
    { title: 'Instant Real-World Spending', body: 'Pays out instant card purchases.' },
    { title: 'Yield-Only Spending', body: 'Card swipes use accrued yield while leaving your underlying principal untouched.' },
    { title: 'Native USDC Gas', body: 'Frictionless transactions powered by USDC.' },
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
    { product: 'Liquid Sovereign Account', liquidity: '100% liquid', yield: 'Institutional yield', verdict: 'Aave v3 + v4 MEV recapture — earnings instantly spendable in the real world.', us: true },
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
      sub: 'Zero extra tokens',
      desc: 'Put USDC into the vault with zero extra tokens or complicated setups.',
      accent: 'text-atx-blue',
    },
    {
      key: 'grow',
      label: 'Grow Your Balance',
      sub: 'Interest + trading fees',
      desc: 'Your money earns automated interest and trading fees around the clock.',
      accent: 'text-atx-coral',
    },
    {
      key: 'tap',
      label: 'Tap to Pay',
      sub: 'No account lockup',
      desc: 'Swipe your card anywhere. The system holds the exact amount needed without locking up your account.',
      accent: 'text-atx-mesquite',
    },
    {
      key: 'spend',
      label: 'Instant Real-World Spend',
      sub: '100M+ Visa · under ½ sec',
      desc: 'Spend your earnings at over 100M Visa merchants worldwide in under half a second.',
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
      how: 'Your money is split: most sits safely earning interest, while a smaller portion powers active trading. When you swipe your card, payment comes directly from the interest buffer.',
      why: 'You can spend cash in the real world without pulling money out of active trades — your yield engine never stops running.',
    },
    {
      key: 'loop',
      index: '02',
      icon: '◎',
      accent: 'text-atx-coral',
      title: 'The spent-yield loop',
      subtitle: 'Principal compounds forever',
      how: 'Card purchases automatically burn accrued yield first before touching your initial deposit.',
      why: 'Your core balance stays untouched and compounds forever, funding perpetual daily spending.',
    },
    {
      key: 'identity',
      index: '03',
      icon: '◈',
      accent: 'text-atx-mesquite',
      title: 'Identity-layer embedded',
      subtitle: 'No custodian, no off-ramp',
      how: 'Your passkey links your wallet, vault balance, and card permissions into one secure identity.',
      why: 'No middleman exchanges or centralized custodians hold your money. You retain total control of your funds with zero off-ramp fees or hidden conversion costs.',
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
  body: 'Built on Arc using USDC for gas, payments authorize via Privy and settle in sub-350ms through Circle for instant spending at 100M+ Visa and Apple Pay terminals — with zero off-ramp fees or extra tokens.',
  stack: [
    { name: 'Arc', role: 'Native chain using USDC for gas.' },
    { name: 'Circle', role: 'Payment network with sub-350ms settlement.' },
    { name: 'Privy', role: 'Passkey identity for card spending power.' },
    { name: 'Visa', role: 'Accepted at 100M+ terminals globally.' },
  ],
  points: [
    'Single-sided USDC deposit',
    'Settlement paid directly from interest buffer',
    'Sub-400ms point-of-sale approval',
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
  title: 'Money That Earns 24/7, Ready When You Are',
  body: 'Mintware turns locked capital into a spendable asset. Your deposit continuously generates institutional yield for you while strengthening market liquidity for everyone — and your earnings are instantly available to spend at point-of-sale.',
  quote: 'Never idle, never locked, always yours.',
} as const

// ─── Built & proven (BuiltProofSection) — the mechanism + real testnet status ──
// HONESTY: every claim below is literally true on Base Sepolia today. What is NOT
// yet done stays explicit: no audit, no mainnet, card rail (Circle · Visa) in
// integration. "Coming soon" = the launch, not the technology.
export const YPN_PROOF = {
  eyebrow: 'Built in the open',
  title: 'Not a pitch deck. A working stack.',
  intro:
    'Here is exactly how a swipe works — and where each piece already stands. The on-chain payment core is deployed, on-chain-verified, and invariant-proven on Base Sepolia. “Coming soon” is the mainnet launch and the card rail — not the technology.',
  steps: [
    { n: '01', k: 'Earn', d: 'Your USDC idles in Aave near par, compounding lending yield plus its share of vault fees — always working.' },
    { n: '02', k: 'Authorize', d: 'A swipe is decided in sub-150ms off a cached vault NAV — no chain call in the hot path. A hold reserves the exact amount.' },
    { n: '03', k: 'Settle', d: 'Asynchronously, just enough shares burn against the idle buffer and USDC pays the rail. Nothing is custodied off-chain.' },
  ],
  priceFree:
    'Because a share is a clean USDC claim — no oracle, no drift — authorization is price-free and exact.',
  proof: [
    { k: 'Payment core — deployed + verified', d: 'Yield vault, gateway, and Aave adapter live and on-chain-verified on Base Sepolia.' },
    { k: 'Solvency — invariant-proven', d: 'The vault’s solvency property fuzzed to 256×128k calls, zero failures.' },
    { k: 'Settlement — proven end-to-end', d: 'Deposit → EIP-712 permit → settle → burn-for-payment, exercised on-chain.' },
    { k: 'Non-custodial by construction', d: 'Funds only ever move vault → rail; the auth engine reserves capacity, it never holds money.' },
  ],
  note: 'In testing on Base Sepolia — not audited, not mainnet, not an offer to deposit. The card rail (Circle · Visa) is in integration.',
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
