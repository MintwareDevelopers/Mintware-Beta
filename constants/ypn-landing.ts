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

// ─── Home-embed teaser (YieldPaymentNetworkSection) ─────────────────────────
export const YPN_TEASER = {
  eyebrow: '✴ Mintware Liquid Sovereign Account',
  title: 'Earn while you spend',
  body: 'Institutional yield on your idle USDC — Aave v3 + Uniswap v4 MEV recapture — designed to stay instantly spendable at Visa terminals in sub-400ms. Principal never touched.',
  cta: 'Explore the Liquid Sovereign Account',
  href: '/yield-payment-network',
} as const

// =============================================================================
// ═══ THE ULV × YPN MODEL ═══
// The rigorous two-sided model that grounds the /yield-payment-network page.
// A project/treasury locks a token reserve (junior / first-loss); the community
// pairs in single-sided USDC (senior / par-backed) that earns in Aave, provides
// JIT depth, and stays spendable. Same coming-soon honesty: on Base Sepolia,
// figures illustrative until audited; deployed ≠ audited.
// =============================================================================

export const YPN_MODEL_HERO = {
  eyebrow: 'The ULV × YPN Model',
  title: 'Liquidity that earns —',
  titleAccent: 'then gets spent.',
  lede: 'A project or treasury locks a reserve of its token. The community pairs in with USDC. That USDC earns yield in Aave, provides just-in-time depth on every swap, and stays spendable at the point of sale — while the reserve absorbs the volatility. One vault, two sides, one clean promise per side.',
  pills: [
    'Reserve + community-matched liquidity',
    'Idle-in-Aave · JIT · 60/30/10 capture',
    'USDC spendable via Visa',
  ],
} as const

export const YPN_ONE_IDEA = {
  n: '01',
  label: 'The one idea',
  title: 'Two sides, and each side gets exactly one thing.',
  titleAccent: 'No compromise between them.',
  body: [
    'In a normal LP, everyone must bring both assets in a fixed ratio and everyone shares the same risk. Mintware splits it clean: the project/treasury brings its native token and locks it as the reserve; the community brings single-sided USDC and stays liquid. The reserve provides the pairing depth and takes the price risk. The community’s USDC sits mostly in Aave — earning yield, staying near par, and ready to spend. Nobody carries exposure they didn’t sign up for.',
    'In tranche terms: the community holds the senior claim — par-backed, first to be made whole; the team’s locked reserve is the junior / first-loss capital that absorbs inventory shifts. Deep depth for the project, whole-and-spendable USDC for everyone else.',
  ],
} as const

export const YPN_TWO_WAYS = {
  n: '02',
  label: 'Two ways in',
  title: 'Same vault.',
  titleAccent: 'Different reserve.',
  cards: [
    {
      kicker: 'Flow A · Token launch',
      tone: 'peri',
      title: 'A team seeds its own token',
      body: 'A meme, utility, or community token launches by locking a supply of its own token as the reserve (optionally some USDC too). The community then pairs in with USDC up to a value cap. The team gets deep, automated market-making depth for their token without fragmenting their treasury.',
      tag: 'projectToken = the team’s token',
    },
    {
      kicker: 'Flow B · Treasury / blue-chip',
      tone: 'coral',
      title: 'A fund seeds a blue-chip reserve',
      body: 'A treasury or large holder brings ETH, AAVE, or another blue-chip, locks and matches as much as it wants, and opens the difference to the community. Same mechanic, bigger reserve — a deep, yield-bearing pair the community can join with USDC.',
      tag: 'projectToken = the blue-chip asset',
    },
  ],
  footnote: 'Both are one contract — the only thing that changes is what the reserve token is. The quote side is always USDC.',
} as const

export const YPN_RESERVE_FLOW = {
  n: '03',
  label: 'How the reserve works',
  title: 'Commit → match → activate → earn.',
  titleAccent: 'Then it never sits idle.',
  steps: [
    { n: 'STEP 01', tone: 'warm', title: 'Team commits',      desc: 'Locks a reserve of its token + a target match value, hard cliff (≥ 90 days). No early-unlock path.' },
    { n: 'STEP 02', tone: 'cool', title: 'Community matches',  desc: 'Single-sided USDC deposits fill the reserve up to the cap, within the funding window.' },
    { n: 'STEP 03', tone: '',     title: 'Vault activates',    desc: 'Matched liquidity deploys as one V4 position — a locked team half + a free community half.' },
    { n: 'STEP 04', tone: 'cool', title: 'USDC idles in Aave', desc: 'Most community USDC earns lending yield near par; only a hot slice + JIT touch the live pair.' },
    { n: 'STEP 05', tone: '',     title: 'Value captured',     desc: 'Swap fees, recaptured MEV / LVR, and impact split 60 / 30 / 10 — LPs / treasury / buyback.' },
  ],
} as const

export const YPN_ROLES = {
  n: '04',
  label: 'Who brings, earns, bears',
  title: 'Every party has a clean deal.',
  titleAccent: 'That’s the whole design.',
  columns: ['Party', 'Brings', 'Earns', 'Bears', 'Liquidity'],
  rows: [
    { role: 'Community', sub: 'payment users', brings: 'USDC, single-sided', earns: 'Aave yield on idle + its USDC share of fees & MEV', bears: 'Senior tranche — par-backed, first made whole; backstopped by the idle buffer', liq: 'Free · liquid · spendable' },
    { role: 'Team / Treasury', sub: 'reserve provider', brings: 'Native token (locked reserve)', earns: 'Fees after the lock + deep MM depth + the community’s USDC as working liquidity', bears: 'Junior / first-loss — absorbs price & inventory shifts, by design', liq: 'Locked · ≥ 90-day cliff' },
    { role: 'Protocol', sub: 'Mintware', brings: 'The engine + rails', earns: 'The treasury + buyback slices of capture (30 / 10)', bears: 'Operational (keys, upgrades, audit)', liq: '—' },
  ],
} as const

export const YPN_SPLIT = {
  n: '05',
  label: 'Where the value goes',
  title: 'One configurable split.',
  titleAccent: 'Set per project.',
  slices: [
    { name: 'LPs',      pct: 60, color: '#6C6CF0', desc: 'To the community + team positions (team’s share accrues after the lock). Reputation & lock tier can lift an LP’s fee share.' },
    { name: 'Treasury', pct: 30, color: '#F4A183', desc: 'The protocol treasury — funds ops, incentives, and the network.' },
    { name: 'Buyback',  pct: 10, color: '#4E4ED6', desc: 'Routed to a buyback / burn sink. A project can retune the split; LPs always keep the majority.' },
  ],
} as const

export const YPN_SPENDABLE = {
  eyebrow: 'The spendable layer · YPN',
  title: 'Your community’s USDC earns in Aave —',
  titleAccent: 'and pays for coffee in under 150 ms.',
  body: 'Because the community holds USDC (the reserve carries the volatility), a share is a clean USDC claim — no oracle, no drift. That’s what lets the Yield Payment Network authorize a Visa swipe off a cached NAV, then settle asynchronously by burning shares against the Aave idle buffer.',
  steps: [
    { n: '01 · EARN',      title: 'Idle in Aave',     desc: 'USDC sits near par, compounding lending yield + its share of capture.' },
    { n: '02 · AUTHORIZE', title: '< 150 ms decision', desc: 'Edge engine checks NAV + holds, approves the card at the terminal.' },
    { n: '03 · SETTLE',    title: 'Burn → USDC',       desc: 'Async: shares burn against the idle buffer, USDC to the card rail.' },
  ],
} as const

export const YPN_SYNTHESIS = {
  n: '06',
  label: 'What we already hold',
  title: 'The model isn’t three products.',
  titleAccent: 'It’s three parts we’ve built, fused.',
  parts: [
    { kicker: 'Accounting', title: 'Matched-Liquidity Vault', desc: 'Team-locked reserve, community-matched USDC, 90-day cliff, team / community split.', status: 'Built · fuzzed', live: false },
    { kicker: 'Engine', title: 'ULV Pair Engine', desc: 'Idle-in-Aave buffer, JIT-on-swap depth, surge / MEV recapture, 60/30/10 split.', status: 'Live on testnet', live: true },
    { kicker: 'Rails', title: 'YPN Gateway + Edge + Relayer', desc: 'EIP-712 spend permits, sub-150ms edge-auth engine, on-chain settlement relayer — behind a thin USDC facade.', status: 'Deployed + proven · testnet', live: true },
  ],
  footnote: 'Each part exists and is tested on its own — and the fusion is now built. The v1 payment core (yield vault + gateway + Aave adapter) is live and on-chain-verified on Base Sepolia; the edge-auth engine and settlement relayer are built and proven; and the treasury-anchored ULV keeps the community USDC price-free behind the same payment interface — invariant-proven to 256×128k. The payment adapter never has to know which vault sits underneath it.',
} as const

export const YPN_ECONOMICS = {
  n: '07',
  label: 'Economics — locked',
  title: 'Three calls, decided.',
  titleAccent: 'The contract follows from here.',
  decisions: [
    { title: 'Impermanent loss → the junior reserve absorbs it', body: 'Community USDC is the senior tranche: 80%+ sits in the idle buffer, so it operates at par. The team’s pre-seeded native reserve is the junior / first-loss capital that absorbs inventory shifts. Projects accept it because they get institutional dual-sided depth without dumping their token or asking the community for risky paired liquidity.', chip: 'Locked · senior / junior tranche' },
    { title: 'Fees during the 90-day lock → 100% to the community', body: 'While the team reserve is locked, all team-attributed fees (swap + MEV + LVR) redirect to community USDC depositors — “supercharged launch yield funded by the team’s locked reserve.” It’s the APY magnet that bootstraps the idle buffer card spending needs.', chip: 'Locked · 100% community (90/10 fallback)' },
    { title: 'Idle ratio → 80/20 default, per-vault governable', body: 'Global default idleBufferTargetBps = 8000 — 80% idle in Aave (par, instantly spendable), 20% active JIT depth. Card spending stays 100% safe and unwinds are rarely triggered. Blue-chip / high-volume partners can dial to 70/30 or 60/40 for deeper pool depth, as long as NAV comfortably covers real card authorization volume.', chip: 'Locked · 8000 bps, governable' },
  ],
  footnote: 'The senior tranche stays whole so long as idle buffer + recoverable LP-USDC + junior reserve value ≥ community USDC claims — the solvency invariant we fuzz to 256×128k, same class as the ULV proofs. The 80/20 default keeps the exposed slice small enough that the junior reserve comfortably covers it.',
} as const

export type YpnPillar = (typeof YPN_PILLARS.cards)[number]
export type YpnMatrixRow = (typeof YPN_MATRIX.rows)[number]
export type YpnFlowStep = (typeof YPN_FLOW.steps)[number]
export type YpnThesisRow = (typeof YPN_THESIS.rows)[number]
