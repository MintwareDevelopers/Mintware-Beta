// =============================================================================
// constants/solutions-network-states.ts
//
// Copy + data for the PUBLIC "Solutions · Network States & Settlements"
// marketing page (route: /solutions/network-states). Top-of-funnel only.
//
// ANGLE: Mintware is the financial rail for a network state — a SHARED TREASURY
// that earns DeFi yield while staying spendable at par by members (YPN),
// NON-CUSTODIAL (members hold their own keys), with REPUTATION-WEIGHTED
// membership/access (Attribution), settled in native USDC (Circle / Arc).
// The quantified case: idle community capital that could earn × real-world spend
// moving on-chain = exactly the gap YPN fills.
//
// HONESTY (public copy — see docs/product/framing-and-messaging.md):
//  · Testnet + unaudited. Vision + where we're building to, proven on testnet.
//  · NO "deposit / savings / guaranteed / fixed APY / FDIC / insured" language
//    as if true. Yield is illustrative + protocol-native ("earns from the pools
//    it backs"), never a promised APY. One concentrated testnet note + an
//    inline "illustrative" label on the math block.
//  · Every stat is dated + sourced (Sources line at the foot of the page).
//    Movement figures are directional; macro figures are the quantified spine.
// =============================================================================

export const NS_META = { title: 'For Network States & Settlements — Mintware', description: 'Current curated liquidity uses MarketEngine on Robinhood Chain testnet. Unaudited; external audit gates real value.' } as const

export const NS_HERO = { eyebrow: 'For network states · charter cities · online settlements', title: 'A treasury that earns like a fund —', titleAccent: 'and spends like cash.', lead: 'Current Mintware liquidity is a quote-valued share in a curated Uniswap v4 pool. The former spend-from-NAV account and Arc/CCTP settlement designs are retired. Card rails are Bridge + Stripe, pre-enable.', ctaPrimary: { label: 'How it works ↓', href: '#how' }, ctaSecondary: { label: 'See current liquidity →', href: '/vaults' } } as const

export const NS_PROBLEM = {
  title: 'A digital nation with an',
  titleAccent: 'analog treasury.',
  lead:
    'A network state can crowdfund capital, issue on-chain membership, and coordinate thousands of aligned people online — then park the shared treasury in a multisig where it earns 0%, and route member payments back through banks and exchanges it was built to route around. The community is sovereign; its money isn’t.',
  points: [
    ['Idle capital', 'Crowdfunded USDC sits in a treasury multisig earning nothing — or gets locked in a yield strategy no member can spend from without an unwind, a bridge, and a taxable exit.'],
    ['Payments leak off-chain', 'Member dues, grants, vendor payouts and stipends detour through banks, cards and exchanges — slow, custodial, and foreign to the community that raised the money.'],
    ['Membership without a spine', 'Citizenship and access are a spreadsheet or a token balance. There’s no portable, on-chain reputation to weight who gets what — allocation, access, voice.'],
  ],
} as const

// ─── LEAD: the two macro trends, quantified. ─────────────────────────────────
// stat tiles — every value dated + sourced (see NS_SOURCES).
export const NS_TRENDS = {
  eyebrow: '01 · The tailwind',
  title: 'Idle money that could earn,',
  titleAccent: 'meeting spend that moved on-chain.',
  lead:
    'Two curves are crossing. Stablecoins have become real settlement infrastructure — and hundreds of billions of them sit idle, earning nothing for the people who hold them. A network state feels both sides at once: a shared treasury to make productive, and members to pay. That intersection is the whole thesis.',
  stats: [
    { value: '~$300B', sub: 'stablecoin supply', label: 'total stablecoin market cap in 2025 — roughly double two years earlier.', src: 'a16z State of Crypto, 2025' },
    { value: '$46T', sub: 'settled in 2025', label: 'stablecoin transaction volume — nearly 3× Visa; ~$9T on a bot-filtered basis, still >5× PayPal.', src: 'a16z State of Crypto, 2025' },
    { value: '$300B+', sub: 'sitting idle', label: 'stablecoins held idle, earning zero yield for their holders — the efficiency gap this rail closes.', src: 'CoinDesk Research, 2025' },
    { value: '$20B+', sub: 'in DAO treasuries', label: 'aggregate on-chain community-treasury value tracked, with service-DAOs holding ~41% in stablecoins.', src: 'DeepDAO, 2025' },
  ],
  note:
    'Capital that could be earning is sitting still, at the same moment real-world spend is moving on-chain. Network states — which crowdfund a treasury and pay a member roll — are the sharpest expression of both.',
} as const

// ─── Movement momentum — vertical-specific trend, quantified. ────────────────
export const NS_MOVEMENT = {
  eyebrow: 'The movement, by the numbers',
  title: 'A digital-nation movement that',
  titleAccent: 'stopped being theoretical.',
  lead:
    'Since Balaji Srinivasan framed the network state in 2022, the idea has picked up capital, communities, and a working precedent for on-chain citizenship. The audience is real — and it has nowhere good to put its money.',
  stats: [
    { value: '$525M', sub: 'raised', label: 'committed to network-state project Praxis to build a crypto-native city — the largest raise in the space to date.', src: 'The Block, Oct 2024' },
    { value: '20+', sub: 'pop-up cities', label: 'derivative pop-up villages spawned within 18 months of Vitalik Buterin’s Zuzalu (Montenegro, 2023).', src: 'Gitcoin case study, 2024' },
    { value: '33,800+', sub: 'companies', label: 'founded through Estonia’s e-Residency — €274M+ cumulative state revenue. Digital citizenship, already proven.', src: 'e-Residency, 2024–25' },
  ],
} as const

// ─── The math — idle vs productive-but-spendable. Illustrative + testnet. ────
export const NS_MATH = { eyebrow: '02 · Current product', title: 'What the engine', titleAccent: 'actually does.', lead: 'MarketEngine is a testnet liquidity product, not a shared treasury or spendable-at-par account.', rows: [{ k: 'Pool', v: 'One curated Uniswap v4 pool per engine' }, { k: 'Share', v: 'One quote-valued share token' }, { k: 'Exit', v: 'Pro-rata in-kind withdrawal of both tokens' }, { k: 'Status', v: 'Robinhood Chain testnet · unaudited' }], footnote: 'Robinhood testnet adapters hold capital ready and do not earn. External audit gates real value.' } as const

// ─── How Mintware solves it — value props mapped to a network state. ─────────
export const NS_SOLUTION = { eyebrow: '03 · How Mintware fits', title: 'One engine for', titleAccent: 'each curated pool.', lead: 'Current Mintware liquidity and card refill are separate products with distinct mechanics.', cards: [{ k: 'MarketEngine', tone: 'peri', v: 'One engine per curated Uniswap v4 pool. It issues one share token valued in the quote asset.' }, { k: 'Deposits', tone: 'coral', v: 'Deposit either or both pool tokens with a minimum-shares floor. A fresh mark and spot-near-mark check are required.' }, { k: 'In-kind exits', tone: 'peri', v: 'Withdraw pro-rata in both pool tokens with minimum-output checks. Withdrawals remain available when the mark is stale.' }, { k: 'Card refill', tone: 'coral', v: 'The relayer redeems Earn shares to a member’s registered buffer. Bridge + Stripe are pre-enable; cards do not settle from vault NAV.' }] } as const

// ─── The mechanics, honestly — dark-pop band. ────────────────────────────────
export const NS_MECHANICS = { eyebrow: '04 · The mechanics, honestly', title: 'How the current', titleAccent: 'engine works.', intro: 'MarketEngine provides share-based liquidity for a curated pool. The former treasury and spend-in-place designs are retired.', items: [['Quote-valued share', 'One share token represents quote-asset value across the engine portfolio.'], ['Deposit guard', 'Deposits require a fresh mark and spot within the configured deviation.'], ['Resting capital', 'Capital sits in a resting v4 band plus per-token ERC-4626 adapters; Robinhood testnet adapters are idle custody.'], ['In-kind exit', 'Withdrawals return both pool tokens pro-rata and remain available when the mark is stale.']], note: 'Live on Robinhood Chain testnet · unaudited. External audit gates real value.' } as const

// ─── Why us / trust. ─────────────────────────────────────────────────────────
export const NS_TRUST = { eyebrow: '05 · Why trust it', title: 'Testnet, unaudited,', titleAccent: 'open about status.', lead: 'Current deployments are testnet-only. External audit gates real value.', stats: [{ value: 'RH', sub: 'testnet', label: 'Robinhood Chain MarketEngine', src: 'deployment record' }, { value: 'Base', sub: 'Sepolia', label: 'MarketEngine deployment', src: 'deployment record' }, { value: 'No', sub: 'external audit', label: 'External audit remains a gate', src: 'status' }], points: [['Market ranking', 'Discover ranks candidate pools using GeckoTerminal data and a risk score; it does not certify pools.'], ['Card refill', 'A relayer redeems Earn shares only to the member’s registered buffer wallet under daily caps.'], ['Retired designs', 'Arc/CCTP settlement, spend-from-NAV, ULV/JIT/MEV, and matched Treasury issuance are not current features.']], proofCta: { label: 'See current product →', href: '/vaults' }, mathCta: { label: 'Read the docs →', href: '/docs' } } as const

export const NS_CTA = {
  title: 'Building a network state? Explore current curated liquidity.',
  primary: { label: 'Talk to us →', href: 'https://x.com/Mintware_org' },
  secondary: { label: 'Explore the app →', href: '/yield-payment-network' },
} as const

// Small, dated Sources line at the foot — credibility, not decoration.
export const NS_SOURCES = 'Market and movement figures are historical context; they do not describe current product mechanics.'
