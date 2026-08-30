// =============================================================================
// constants/solutions-network-states.ts
//
// Copy + data for the PUBLIC "Solutions · Network States & Settlements"
// marketing page (route: /solutions/network-states). Top-of-funnel only.
//
// ANGLE: Mintware is the financial rail for a network state — a SHARED TREASURY
// that earns DeFi yield while staying spendable at par by members (YPN),
// NON-CUSTODIAL (members hold their own keys), settled in native USDC (Circle).
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

export const NS_META = {
  title: 'For Network States & Settlements — Mintware',
  description:
    'The financial rail for a network state: a shared treasury that earns DeFi yield while staying spendable at par by members, non-custodial, settled in native USDC on Circle. Vision, proven on testnet.',
} as const

export const NS_HERO = {
  eyebrow: 'For network states · charter cities · online settlements',
  title: 'A treasury that earns like a fund —',
  titleAccent: 'and spends like cash.',
  lead:
    'Network states run on a shared treasury and a member roll. Today that treasury either sits idle in stablecoins earning nothing, or gets locked in yield venues your members can’t spend from. Mintware makes it one balance: capital that stays productive while every member can spend it at par — non-custodial, settled in native USDC.',
  ctaPrimary: { label: 'How it works ↓', href: '#how' },
  ctaSecondary: { label: 'See it run on-chain →', href: '/proof' },
} as const

export const NS_PROBLEM = {
  title: 'A digital nation with an',
  titleAccent: 'analog treasury.',
  lead:
    'A network state can crowdfund capital, issue on-chain membership, and coordinate thousands of aligned people online — then park the shared treasury in a multisig where it earns 0%, and route member payments back through banks and exchanges it was built to route around. The community is sovereign; its money isn’t.',
  points: [
    ['Idle capital', 'Crowdfunded USDC sits in a treasury multisig earning nothing — or gets locked in a yield strategy no member can spend from without an unwind, a bridge, and a taxable exit.'],
    ['Payments leak off-chain', 'Member dues, grants, vendor payouts and stipends detour through banks, cards and exchanges — slow, custodial, and foreign to the community that raised the money.'],
    ['No middle ground on the treasury', 'The shared treasury is forced to choose: keep it liquid in a multisig earning 0%, or lock it in a yield venue no member can spend from. Liquidity or yield — never both.'],
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
export const NS_MATH = {
  eyebrow: '02 · The cost of idle',
  title: 'What a still treasury',
  titleAccent: 'gives up every year.',
  lead:
    'A worked example, not a promise — one slice of that $300B+ idle pile. Take a $10M community treasury. Left idle in stablecoins it earns ~0%. On Mintware it stays fully spendable at par while the capital works — earning from the pools it backs. The opportunity cost is the whole point.',
  rows: [
    { k: 'Treasury size (illustrative)', v: '$10,000,000' },
    { k: 'Idle in a multisig at ~0%', v: '$0 / yr' },
    { k: 'Productive-but-spendable at an illustrative ~11–14%*', v: '≈ $1.1M – $1.4M / yr' },
    { k: 'Liquidity given up to earn it', v: 'None — spendable at par, on demand' },
  ],
  footnote:
    '*Illustrative only, not a quote, offer, or guarantee of yield. The stacked model targets ~11–14% — a best-venue lending floor (~6–8%, shopping Aave + Morpho, where some USDC markets have reached ~7–8%) plus a ~4–5% LP-fee + MEV/LVR-recapture layer on the same capital. Protocol-native yield varies with market conditions and can be lower. Testnet — no real value.',
} as const

// ─── How Mintware solves it — value props mapped to a network state. ─────────
export const NS_SOLUTION = {
  eyebrow: '03 · How Mintware fits',
  title: 'One rail for the money',
  titleAccent: 'of a network state.',
  lead:
    'The same primitive that makes personal cash productive scales to a community treasury — earning while it stays spendable, and owned by its members.',
  cards: [
    {
      k: 'A treasury that stays spendable',
      tone: 'peri',
      v: 'Shared USDC stays productive and spendable at par at the same time. A member payment — dues, a grant, a stipend, a vendor — is a hold against the earning position, then a settle. Capital never un-parks to be spent. Never idle, never locked.',
    },
    {
      k: 'Non-custodial by construction',
      tone: 'coral',
      v: 'Members hold their own keys — self-custody via Privy plus any external wallet. Mintware never takes custody; funds live in members’ wallets or in autonomous, audited-to-be contracts. The community stays sovereign over its own money.',
    },
    {
      k: 'Capital that never sits idle',
      tone: 'peri',
      v: 'Idle treasury USDC earns protocol-native yield — the adapter shops best-venue lending and just-in-time V4 liquidity stacks a second layer of return on the same balance. Member funds keep working right up to the moment they’re spent, and LPs are paid pro-rata by their share of the pool.',
    },
    {
      k: 'Native USDC settlement',
      tone: 'coral',
      v: 'Payments settle in native USDC on Circle rails, bridged across chains via CCTP, with real-world card spend through a regulated card partner. Mintware never touches fiat — licensed partners carry that leg.',
    },
  ],
} as const

// ─── The mechanics, honestly — dark-pop band. ────────────────────────────────
export const NS_MECHANICS = {
  eyebrow: '04 · The mechanics, honestly',
  title: 'How a par-spendable treasury',
  titleAccent: 'actually holds together.',
  intro:
    'No magic — structure. The community holds the price-free senior side; a junior first-loss tranche absorbs the market’s moves. Redemption is solvency-aware: par while covered, fair pro-rata in the tail, with no race for the exit.',
  items: [
    ['Senior stays par', 'The community’s balance never reads a pool price. Impermanent loss and market swings land on the junior first-loss tranche, not on member funds.'],
    ['Covered, then fair', 'Redeemable at par while the first-loss cushion covers it. If a tail event ever exhausts the cushion, everyone shares one transparent pro-rata outcome — no first-redeemer run.'],
    ['The ULV engine', 'Idle capital earns at the best lending venue — the adapter shops Aave and Morpho for the top USDC rate; just-in-time Uniswap v4 liquidity plus MEV/LVR recapture stack a second layer of return on the same capital. Nothing sits still.'],
    ['Spend without unwinding', 'A card swipe or payout is a hold against the earning position, then a settle — the underlying stays deployed the entire time.'],
  ],
  note:
    'In testing on Base Sepolia — testnet, unaudited, no real value. These are design properties of autonomous contracts, not a deposit, a guarantee, or investment advice; an external audit is the gate before real value.',
} as const

// ─── Why us / trust. ─────────────────────────────────────────────────────────
export const NS_TRUST = {
  eyebrow: '05 · Why trust it',
  title: 'Non-custodial, self-reviewed,',
  titleAccent: 'and proven on-chain.',
  lead:
    'We don’t ask a community to take our word for it. The loop already runs end-to-end on testnet with real transaction hashes, the contract stack was put through a firm-grade security checklist, and the properties where money can be lost are backed by machine-checked proofs.',
  stats: [
    { value: '0', sub: 'Critical', label: 'critical findings across a 38-contract self-review' },
    { value: '6 / 6', sub: 'High', label: 'high-severity findings remediated + re-reviewed' },
    { value: '7', sub: 'proofs', label: 'safety properties backed by Coq / Halmos machine checks' },
    { value: '502 / 0', sub: 'Forge', label: 'contract tests pass / fail across the stack' },
  ],
  points: [
    ['Non-custodial', 'Members hold their keys. Funds live in the user’s wallet or in autonomous contracts — never on a Mintware balance sheet.'],
    ['Proven end-to-end', 'Deposit → earn → authorize → spend, plus a native USDC bridge, all executed on testnet with real hashes you can open in a block explorer.'],
    ['Built on Circle rails', 'USDC-native settlement plus CCTP bridging ($126B+ moved across 17 chains) on Circle’s infrastructure. Card spend runs via a regulated partner (sandbox today). We build on their rails — we don’t claim their licences.'],
  ],
  proofCta: { label: 'See the on-chain proof →', href: '/proof' },
  mathCta: { label: 'Read the math →', href: '/the-math' },
} as const

export const NS_CTA = {
  title: 'Building a network state? Give its treasury a rail that earns while it spends.',
  primary: { label: 'Talk to us →', href: 'https://x.com/Mintware_org' },
  secondary: { label: 'Explore the app →', href: '/yield-payment-network' },
} as const

// Small, dated Sources line at the foot — credibility, not decoration.
export const NS_SOURCES =
  'Sources: stablecoin supply & settlement volume ($46T total / ~$9T adjusted) — a16z State of Crypto 2025; idle-stablecoin figure — CoinDesk Research (2025, all stablecoins, not DAO-treasuries alone); DAO treasury aggregate & stablecoin share — DeepDAO (2025); Praxis $525M raise — The Block (Oct 2024); pop-up-city count — Gitcoin case study (2024); Estonia e-Residency statistics — e-resident.gov.ee (2024–25); USDC circulation & CCTP volume — Circle (2025). Movement framing: Balaji Srinivasan, “The Network State” (2022); Vitalik Buterin’s Zuzalu (2023). Figures are approximate, dated, and cited for context — not offers; several movement figures are project-reported. Yield: the stacked model targets ~11–14% — a best-venue lending floor (~6–8%, shopping Aave + Morpho; Aave USDC ~3.3–3.5% and Morpho USDC vaults ~4–8%, some ~7–8%, per Aave / Morpho / eco.com, 2026) plus a ~4–5% LP-fee + MEV-recapture layer on the same capital. Illustrative vision target, testnet, not a promised rate; protocol-native yield varies with market conditions.'
