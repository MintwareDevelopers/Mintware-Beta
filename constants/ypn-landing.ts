// =============================================================================
// constants/ypn-landing.ts
//
// ALL copy + data for the public "Yield Payment Network / Liquid Sovereign
// Account" marketing surface (route: /yield-payment-network + the embeddable
// YieldPaymentNetworkSection). TOP-OF-FUNNEL marketing only — no app state.
//
// Current code no longer implements the former spend-in-place YPN design.
//
// Status: former YPN spend-in-place mechanics are retired. Cards use Bridge + Stripe and are pre-enable;
// the on-chain MintwarePaymentGateway supports refill-only transfers to a registered buffer.
// =============================================================================

export const YPN_STATUS = {
  label: 'Design concept · retired mechanics',
  note: 'The former YPN spend-in-place design is retired. Current card rails are Bridge + Stripe, pre-enable; the on-chain gateway only refills a registered buffer from Earn shares.',
} as const

export const YPN_HERO = {
  eyebrow: 'Mintware · Liquid Sovereign Account',
  title: 'Spend while you',
  titleAccent: 'earn.',
  bullets: [
    { title: 'MarketEngine', body: 'A quote-valued share represents a curated Uniswap v4 pool portfolio across a resting band and token adapters.' },
    { title: 'In-kind exits', body: 'Withdrawals return both pool tokens pro-rata, subject to minimum-output limits.' },
    { title: 'Card refills', body: 'A relayer can redeem Earn shares to the member’s registered buffer wallet.' },
    { title: 'Testnet status', body: 'Current contract deployments are testnet-only and unaudited.' },
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
    { product: 'Current Mintware products', liquidity: 'Testnet', yield: 'Unaudited', verdict: 'MarketEngine liquidity and a separate Earn-share card refill path.', us: true },
  ],
} as const

// ─── The engine flow (PillarArchitectureDiagram) ────────────────────────────
export const YPN_FLOW = {
  eyebrow: 'The flow',
  title: 'One pool share. A guarded lifecycle.',
  steps: [
    {
      key: 'deposit',
      label: 'Add pool tokens',
      sub: 'One or both tokens',
      desc: 'MarketEngine deposits accept either or both pool tokens with a minimum-shares floor.',
      accent: 'text-atx-blue',
    },
    {
      key: 'grow',
      label: 'Hold a pool share',
      sub: 'Quote-valued claim',
      desc: 'One share token represents a quote-valued claim on the engine portfolio.',
      accent: 'text-atx-coral',
    },
    {
      key: 'tap',
      label: 'Withdraw in kind',
      sub: 'Both pool tokens',
      desc: 'Withdraw pro-rata in both pool tokens, with minimum-output limits.',
      accent: 'text-atx-mesquite',
    },
    {
      key: 'spend',
      label: 'Refill a buffer',
      sub: 'Member-registered destination',
      desc: 'The refill gateway redeems a member’s Earn shares to their registered buffer after a 48-hour destination delay.',
      accent: 'text-atx-blue',
    },
  ],
} as const

// ─── The 3 structural moats (PillarCardGrid) ────────────────────────────────
export const YPN_PILLARS = {
  eyebrow: 'The moat',
  title: 'How current liquidity and refills work',
  cards: [
    {
      key: 'isolation',
      index: '01',
      icon: '⬡',
      accent: 'text-atx-blue',
      title: 'Resting liquidity band',
      subtitle: 'A position in one curated pool',
      how: 'The engine keeps liquidity in a configured Uniswap v4 band, alongside per-token adapters.',
      why: 'Guarded lifecycle actions can add, remove, or recenter the position.',
    },
    {
      key: 'loop',
      index: '02',
      icon: '◎',
      accent: 'text-atx-coral',
      title: 'Pro-rata in-kind exits',
      subtitle: 'Both pool tokens',
      how: 'Withdrawals return each pool token pro-rata and apply caller-supplied minimum outputs.',
      why: 'Withdrawals remain available when the external mark is stale.',
    },
    {
      key: 'identity',
      index: '03',
      icon: '◈',
      accent: 'text-atx-mesquite',
      title: 'Refill controls',
      subtitle: 'Member-selected destination',
      how: 'A member proposes a buffer wallet, waits 48 hours, then accepts it; the member can revoke it at any time.',
      why: 'Refills are bounded by per-user and global UTC-day caps, with cap increases timelocked.',
    },
  ],
} as const

// ─── Enterprise verticals (ValuePropMatrixTable) ────────────────────────────
export const YPN_MATRIX = {
  eyebrow: 'Where it goes',
  title: 'Current product paths',
  columns: ['Vertical', 'The pitch', 'The line'],
  rows: [
    {
      key: 'hnw',
      audience: 'Curated liquidity',
      pain: 'A single pool engine with quote-valued shares.',
      solution: 'MarketEngine V1',
      solutionDetail: 'Each engine serves one curated Uniswap v4 pool with a resting band, token adapters, and in-kind exits.',
      accent: 'text-atx-blue',
    },
    {
      key: 'corp',
      audience: 'Earn',
      pain: 'Single-source ERC-4626 shares.',
      solution: 'MintwareYieldVault',
      solutionDetail: 'One yield adapter backs the mwEARN vault; exits pay available liquidity when the source is illiquid.',
      accent: 'text-atx-coral',
    },
    {
      key: 'invisible',
      audience: 'Card refill',
      pain: 'A member-controlled buffer destination.',
      solution: 'Refill only',
      solutionDetail: 'An authorized relayer redeems Earn shares to the member’s registered buffer wallet under daily caps.',
      accent: 'text-atx-mesquite',
    },
  ],
} as const

// ─── Settlement stack (CircleTechBadge) — Arc · Circle · Privy · Visa ───────
export const YPN_CIRCLE = {
  eyebrow: 'Card rails',
  title: 'Bridge + Stripe · pre-enable',
  body: 'Cards are not enabled. The current on-chain payment gateway supports Earn-share refills to member-registered buffers; it does not authorize purchases or settle merchants.',
  stack: [
    { name: 'Bridge', role: 'Card rail; pre-enable.' },
    { name: 'Stripe', role: 'Card rail; pre-enable.' },
    { name: 'MintwarePaymentGateway', role: 'Earn-share buffer refill only.' },
    { name: 'Earn', role: 'ERC-4626 shares redeemed by the refill gateway.' },
  ],
  points: [
    'Member proposes a buffer wallet',
    '48-hour delay before acceptance',
    'Per-user and global UTC-day refill caps',
  ],
} as const

// ─── Interactive calculator (YieldCalculatorWidget) ─────────────────────────
// Illustrative estimate only. Monthly Yield = (Balance * APY) / 12.
export const YPN_CALCULATOR = {
  eyebrow: 'Estimate',
  title: 'A hypothetical yield scenario',
  sub: 'Set an assumed annual rate to model a balance. This calculator does not use a current Mintware yield source or model card spending.',
  disclaimer: 'Scenario math only; this is not a Mintware yield estimate, quote, offer, or guarantee.',
  tvl: {
    label: 'Example balance',
    min: 10_000,
    max: 10_000_000,
    step: 10_000,
    default: 250_000,
  },
  apy: {
    label: 'Assumed annual rate (scenario input)',
    min: 1,
    max: 20,
    step: 0.5,
    default: 8.0,
  },
  resultLabel: 'Estimated monthly yield',
  yearSuffix: 'per year at the assumed rate',
  principalLabel: 'Scenario rate',
  principalValue: 'User selected',
} as const

// ─── Coming-soon conversion (AppConversionCTA) — waitlist, no app launch ────
export const YPN_CTA = {
  eyebrow: 'Coming soon',
  title: 'Get updates on current Mintware products',
  body: 'The former spend-in-place account design is retired. Leave your email for updates on current Mintware products.',
  successLabel: '✴ You’re on the list',
  secondaryCta: 'Read the docs',
  secondaryHref: '/docs',
} as const

// ─── Ethos — liquidity as a public good (page band + home teaser) ───────────
export const YPN_ETHOS = {
  eyebrow: 'Liquidity as a public good',
  title: 'Money That Earns 24/7, Ready When You Are',
  body: 'Mintware’s current liquidity engine issues quote-valued shares in curated Uniswap v4 pools. Card refills are a separate, pre-enable path to a member-registered buffer.',
  quote: 'Never idle, never locked, always yours.',
} as const

// ─── Home-embed teaser (YieldPaymentNetworkSection) ─────────────────────────
export const YPN_TEASER = {
  eyebrow: 'Mintware Liquid Sovereign Account',
  title: 'Earn while you spend',
  body: 'The former spend-in-place YPN design is retired. The current on-chain gateway only refills a member-registered buffer from Earn shares.',
  cta: 'Explore the Liquid Sovereign Account',
  href: '/yield-payment-network',
} as const

// ─── The blended liquidity model + dual doors (in-page section) ─────────────
// Historical YPN model; not current product functionality.
export const YPN_LIQUIDITY = {
  eyebrow: 'How it works',
  title: 'Former YPN model,',
  titleAccent: 'finally accessible.',
  body: 'The former blended-liquidity, lending-buffer, and spend-in-place design is retired. Current liquidity uses a single MarketEngine per curated pool; current cards are pre-enable and do not spend from the engine.',
  flow: [
    { label: 'Curate pool', sub: 'one MarketEngine for each selected v4 pool' },
    { label: 'Add tokens', sub: 'one or both pool tokens, with a minimum-shares floor' },
    { label: 'Hold shares', sub: 'one quote-valued share token' },
    { label: 'Withdraw', sub: 'pro-rata in kind, with minimum outputs' },
  ],
  doors: [
    { kicker: 'For you', tone: 'peri', title: 'Pool shares', body: 'Add one or both pool tokens to a curated MarketEngine and withdraw pro-rata in kind.' },
    { kicker: 'For market-makers', tone: 'coral', title: 'Curated pool liquidity', body: 'Each MarketEngine serves one selected Uniswap v4 pool with a resting band and token adapters.' },
  ],
} as const

// ─── The epic tech (in-page dark-pop band) ──────────────────────────────────
export const YPN_TECH = {
  eyebrow: 'Under the hood',
  title: 'The hard part,',
  titleAccent: 'done right.',
  intro: 'None of this works without the engineering. Here’s the part we’re proud of.',
  items: [
    { k: 'MarketEngine', v: 'One quote-valued share for each curated Uniswap v4 pool.' },
    { k: 'Adapters', v: 'Per-token ERC-4626 adapters; Robinhood testnet adapters are idle custody.' },
    { k: 'Guarded lifecycle', v: 'Deposits require a fresh mark and spot within the configured deviation.' },
    { k: 'Status', v: 'Robinhood Chain testnet · unaudited · external audit gates real value.' },
  ],
  note: 'Testnet only · unaudited. An external audit gates real value.',
} as const

// ─── The senior tranche — the headline value prop (counsel-safe framing) ─────
// Honesty guardrails (see /legal + docs/developers/eth-senior-tranche.md): NO "deposit / savings /
// guaranteed / fixed APY" language. Frame as "cash that stays productive," yield "from the pools it
// backs" (protocol-native, not a Mintware promise), and always the testnet/not-a-guarantee note.
export const YPN_ETH_SENIOR = {
  eyebrow: 'Retired Treasury design',
  title: 'Senior / junior issuance',
  titleAccent: 'is not current.',
  body:
    'Treasury senior/junior new issuance is retired. The current Earn vault issues ERC-4626 shares over one yield adapter; it does not offer a par-valued senior claim.',
  cards: [
    { k: 'Earn shares', v: 'MintwareYieldVault is an ERC-4626 share vault over one yield adapter.' },
    { k: 'Pause behavior', v: 'Pausing blocks deposits and mints; it does not block exits.' },
    { k: 'Illiquid exits', v: 'Redemptions pay what is obtainable; unpaid shares remain with the holder.' },
  ],
  note:
    'Testnet only · unaudited. External audit gates real value.',
} as const

// ─── Standing — spend-based service tiers (counsel-safe framing) ────────────
// Honesty guardrails (see /legal bright line #4/#6 + docs/legal/priority-buffer-redesign.md item
// #5): Standing is earned ONLY by genuine, settled, third-party card spend — never by depositing,
// holding, or staking anything. Every perk is a SERVICE-QUALITY improvement (settlement speed,
// spend headroom, early access) — never a payout, a new token, or anything tradeable. No
// "earn / appreciate / trade" language. Fully independent of the Attribution score, which stays
// informational-only (docs/legal/attribution-informational.md) and never gates anything here.
export const YPN_STANDING = {
  eyebrow: 'Retired feature',
  title: 'Card spending tiers',
  titleAccent: 'are not current.',
  body: 'Spend-based standing and service tiers are retired and are not part of the current card refill product.',
  tiers: [
    { name: 'Retired', unlock: 'Not available', perk: 'No spend-based settlement tiers are currently offered.' },
    { name: 'Retired', unlock: 'Not available', perk: 'No spend-based settlement tiers are currently offered.' },
  ],
  note: 'Spend-based standing and service tiers are retired.',
} as const

export type YpnPillar = (typeof YPN_PILLARS.cards)[number]
export type YpnMatrixRow = (typeof YPN_MATRIX.rows)[number]
export type YpnFlowStep = (typeof YPN_FLOW.steps)[number]
export type YpnThesisRow = (typeof YPN_THESIS.rows)[number]
