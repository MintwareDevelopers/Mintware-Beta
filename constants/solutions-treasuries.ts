// =============================================================================
// constants/solutions-treasuries.ts
//
// ALL copy + data for the PUBLIC "Solutions · Treasuries" marketing page
// (route: /solutions/treasuries). Top-of-funnel only — no app state.
//
// AUDIENCE: DAO treasuries, protocol treasuries, on-chain orgs / foundations
// holding stablecoins in a multisig, earning ~0.
//
// THESIS: a treasury that EARNS while staying fully spendable. USDC that keeps
// its 1:1 spendability (cards, USDC settlement, vendor payouts) while the
// capital works — non-custodial, multisig-friendly, no lockups. The gap YPN
// fills = idle capital that could earn × spend moving on-chain.
//
// HONESTY (see solutions-pages-spec + /legal): ONE concentrated testnet note
// carries the legal weight (see TREASURY_STATUS). No "deposit / savings /
// guaranteed / fixed APY / FDIC / insured" as if true. No specific yield % as a
// promise — the stacked ~11–14% target is sourced + labelled ILLUSTRATIVE. Vision framing:
// where Mintware is building to, proven on testnet, not a production guarantee.
// =============================================================================

export const TREASURY_META = {
  title: 'Treasuries — Mintware',
  description:
    'Most on-chain treasuries hold stablecoins in a multisig earning ~0%. Mintware keeps that USDC fully spendable — cards, USDC settlement, vendor payouts — while the capital works. Non-custodial, multisig-friendly, no lockups. In testing on testnet.',
} as const

export const TREASURY_HERO = {
  eyebrow: 'Mintware · for Treasuries',
  title: 'Your treasury shouldn’t',
  titleAccent: 'sit still.',
  sub: 'DAOs, protocols, and on-chain orgs hold billions in stablecoins — and most of it sits idle in a multisig, earning nothing while it waits to be spent. Mintware keeps that USDC fully spendable at par, while the capital works. Never idle, never locked, always yours.',
  ctaPrimary: { label: 'See the vision', href: '/yield-payment-network' },
  ctaSecondary: { label: 'See it run on-chain', href: '/proof' },
} as const

// ONE concentrated honesty note — the single line that carries the legal weight.
export const TREASURY_STATUS = {
  label: 'In testing · testnet · unaudited',
  body: 'Mintware is pre-launch. The vault, settlement, and card rails run on Circle’s Arc testnet and Base Sepolia with valueless test USDC, and are not yet audited. This page describes where we’re building to, proven end-to-end on testnet — not a live product, an offer, or investment, legal, or tax advice. Yield figures are illustrative and sourced, never a promised rate. External audit is the gate before any real value.',
} as const

// ─── Stat tiles — the landscape, dated + sourced ────────────────────────────
export const TREASURY_STATS = [
  { value: '$24.5B', label: 'Total value held across DAO treasuries', sub: '2025', src: '1' },
  { value: '~18%', label: 'Of DAO treasury value sits in stablecoins — mostly idle', sub: '2025', src: '1' },
  { value: '$33T', label: 'Stablecoin settlement volume — more than Visa moved', sub: '2025, +72% YoY', src: '2' },
  { value: '$100B+', label: 'Secured by Safe multisigs — the on-chain treasury standard', sub: '10M+ accounts', src: '3' },
] as const

// ─── The problem — the idle-treasury pain, quantified ───────────────────────
export const TREASURY_PROBLEM = {
  eyebrow: 'The problem',
  title: 'Idle stablecoins are a tax on every treasury.',
  body: 'On-chain treasuries have done the responsible thing — diversified into stablecoins to survive the volatility of their native token. But that safety comes at a price: parked in a multisig, those stablecoins earn ~0% while inflation and runway quietly erode them. The moment a treasury tries to fix it — lending, LPing, staking — it trades away the one property it needed most: instant, unconditional access to spend. Yield or liquidity. Pick one, pay for the other.',
  points: [
    { k: 'The idle default', v: 'Stablecoins sit in a Safe waiting to be spent on contributors, grants, and vendors. Idle at ~0%, that runway is dead weight — earning nothing while the org burns it down.' },
    { k: 'The liquidity trap', v: 'Locking treasury into CDs, lending, or LP positions earns yield — but behind withdrawal windows, unwinding, gas, and price risk. A treasury needs to move on governance’s timeline, not a protocol’s.' },
    { k: 'The volatility bind', v: 'Native-token-heavy treasuries are one bad quarter from a runway crisis. Stablecoins fix that — but only if the org isn’t punished with 0% for holding them.' },
  ],
} as const

// ─── The worked math — HONEST opportunity cost ──────────────────────────────
// Illustrative stacked target ~11–14%: a best-venue lending floor (~6–8%, shopping
// Aave + Morpho) plus a ~4–5% LP-fee + MEV layer on the SAME capital. ~12% is the
// single illustrative midpoint. Labelled illustrative + testnet — never a promise.
export const TREASURY_MATH = {
  eyebrow: 'The math',
  title: 'What idle costs — and what stays on the table.',
  intro: 'A worked example, not a quote. Take a mid-size treasury holding $10M in stablecoins for runway.',
  rows: [
    { label: 'Idle in a multisig', rate: '~0%', earns: '$0 / yr', tone: 'flat' },
    { label: 'Staying fully spendable while it works', rate: '~12% illustrative', earns: '≈ $1,200,000 / yr', tone: 'accent' },
  ],
  punch: '≈ $1.2M a year',
  punchSub: 'left on the table by a single $10M treasury — at no loss of liquidity. Across the ~$4.5B in stablecoins DAOs hold today, an illustrative 12% is on the order of $540M/yr the ecosystem forgoes for sitting still.',
  note: 'Illustrative only. The stacked model targets ~11–14% — a best-venue lending floor (~6–8%, shopping Aave + Morpho, where some USDC markets have reached ~7–8%) plus a ~4–5% LP-fee + MEV-recapture layer on the same capital; ~12% is the illustrative midpoint. It is a model of opportunity cost, not a rate Mintware offers or guarantees. Protocol-native yield varies with market conditions.',
} as const

// ─── How Mintware solves it — map value props to treasury needs ─────────────
export const TREASURY_SOLUTION = {
  eyebrow: 'How Mintware solves it',
  title: 'One balance that earns and spends.',
  body: 'Mintware turns the idle-vs-liquid trade-off into a non-choice. Your treasury’s USDC stays spendable at par — cards, USDC settlement, vendor payouts — while the capital keeps working underneath. A spend is a hold against the earning position, then a settle. Capital never has to un-park to be used.',
  cards: [
    {
      index: '01',
      title: 'Earns while it stays spendable',
      body: 'The senior balance behaves like a dollar and stays 1:1 spendable, while the capital earns protocol-native yield from the pools it backs — best-venue lending (the adapter shops Aave + Morpho for the top USDC rate) plus just-in-time V4 liquidity and recaptured MEV stacked on the same capital. No unwinding, no withdrawal window, no cashing out to pay a vendor.',
    },
    {
      index: '02',
      title: 'Non-custodial · multisig-friendly',
      body: 'Mintware never takes custody. Funds live in your own wallet or in autonomous, audited contracts — and the model fits how treasuries already operate: Safe as the signer, keys with your council. No handing the treasury to an exchange or a yield desk.',
    },
    {
      index: '03',
      title: 'Structured to protect the treasury',
      body: 'Community/senior capital is price-free — par, USDC-spendable — while a junior first-loss tranche absorbs the volatility. The code pays the community first, automatically — no admin override. Redemption is solvency-aware: par while covered, fair pro-rata in the tail. The market moves land on the tranche built to take them, not on your operating balance.',
    },
    {
      index: '04',
      title: 'Native USDC settlement',
      body: 'Payouts and card spend settle in USDC over Circle / Arc rails, with CCTP bridging across chains and a regulated card partner carrying the fiat leg. Mintware never touches fiat — licensed partners do. Your treasury pays contributors and vendors without leaving the dollar.',
    },
  ],
} as const

// ─── The mechanics, honestly ────────────────────────────────────────────────
export const TREASURY_MECHANICS = {
  eyebrow: 'The mechanics, honestly',
  title: 'How it actually works.',
  intro: 'No magic — just where the risk is placed and who holds the keys. Here’s the real shape.',
  items: [
    { k: 'Tranches', v: 'Your treasury sits senior: a price-free claim redeemable at par while the first-loss junior cushion covers it. Impermanent loss and market moves hit the junior tranche first — not your balance.' },
    { k: 'Spend = hold → settle', v: 'A card swipe or payout places a hold against the earning position off live NAV, then settles by burning shares to USDC. The principal is never idle between earning and spending.' },
    { k: 'Self-custody', v: 'Privy self-custody + external wallets (Safe included). Mintware holds no keys and no fiat; value lives in your wallet or in on-chain contracts you can read.' },
    { k: 'On testnet, honestly', v: 'The full loop — deposit → earn → authorize → settle, plus a native USDC bridge — is proven on-chain with real transaction hashes on Arc testnet + Base Sepolia. Deployed ≠ audited; external audit precedes real value.' },
  ],
} as const

// ─── The dark-pop "epic tech / why us" moment (single deliberate dark band) ──
export const TREASURY_TRUST = {
  eyebrow: 'Why trust the plumbing',
  title: 'Proven where money can be lost —',
  titleAccent: 'and open about the rest.',
  intro: 'Custody, solvency, and settlement are where treasuries get burned. So we built the proof first, and we show it.',
  items: [
    { k: 'Non-custodial by construction', v: 'You keep your keys. There is no Mintware account holding your treasury — only your wallet and autonomous contracts.' },
    { k: 'Self-reviewed, testnet-proven', v: 'Internal audit sweep: 0 Critical open, all High findings fixed. The whole loop ran on-chain on testnet with real hashes you can open in an explorer.' },
    { k: 'Formal verification', v: 'The money-path invariants — where solvency and share accounting live — are machine-checked (Coq) and symbolically explored (Halmos), not just unit-tested.' },
    { k: 'Circle / Arc rails', v: 'USDC-native settlement and CCTP bridging built on Circle’s rails; the fiat and card legs are carried by licensed partners, never by Mintware.' },
  ],
  note: 'Testnet + unaudited — deployed is not audited. External audit is the gate before real value. See the live run + the self-assessment on /proof.',
  proofCta: { label: 'Read the proof →', href: '/proof' },
} as const

// ─── Trend note — the two big tailwinds ─────────────────────────────────────
export const TREASURY_TREND = {
  eyebrow: 'Why now',
  title: 'Two trends are closing the gap.',
  body: 'On-chain treasuries are growing and diversifying into stablecoins for stability — while stablecoins have become a genuine settlement layer, moving $33T in 2025, more than Visa. Idle capital that could earn, meeting real-world spend that’s moving on-chain: that intersection is exactly the gap Mintware fills. Crypto-linked card spend alone grew past 100% year over year to roughly an $18B annualized run-rate by late 2025.',
  pills: [
    { k: 'Treasuries diversifying', v: '~60% of large DAOs now run diversification strategies — stablecoins and real assets, not just native tokens.' },
    { k: 'Stablecoins as settlement', v: '$33T settled in 2025 (+72% YoY); Citi projects up to $4T in supply by 2030.' },
    { k: 'Spend moving on-chain', v: 'Crypto-linked card spend ≈ $18B annualized, +100%+ YoY — with Visa carrying 90%+ of it.' },
  ],
} as const

// ─── CTA — soft, honest ─────────────────────────────────────────────────────
export const TREASURY_CTA = {
  eyebrow: 'Bring your treasury to life',
  title: 'Stop paying the idle tax.',
  body: 'Mintware is building the treasury that earns while it stays spendable — non-custodial, multisig-friendly, no lockups. Explore the vision, watch the loop run on-chain, or come talk to us about your treasury.',
  primary: { label: 'Explore the app', href: '/app' },
  secondary: { label: 'See it run on-chain', href: '/proof' },
  tertiary: { label: 'Read the vision', href: '/yield-payment-network' },
} as const

// ─── Sources (small, bottom) — dated + attributed ───────────────────────────
export const TREASURY_SOURCES = [
  { n: '1', text: 'DAO treasury value (~$24.5B, 2025) & stablecoin share (~18%): DeepDAO / CoinLaw DAO Treasury Holdings Statistics, 2025.' },
  { n: '2', text: 'Stablecoin settlement volume ($33T, 2025, +72% YoY) & supply projections: Arkham / CEX.IO / Citi 2025 stablecoin research.' },
  { n: '3', text: 'Safe (Gnosis Safe) multisig scale ($100B+ TVL, 10M+ accounts): Safe / DeFiLlama / CoinGecko, 2025.' },
  { n: '4', text: 'Best-venue stablecoin lending floor (~6–8%, shopping Aave + Morpho): Aave USDC ~3.3–3.5% and Morpho USDC vaults ~4–8% (some ~7–8%), per Aave / Morpho / eco.com / earnpark, 2026. The stacked ~11–14% target adds a ~4–5% LP-fee + MEV-recapture layer on the same capital; illustrative vision target, not a Mintware rate.' },
  { n: '5', text: 'Crypto-linked card spend (~$18B annualized, +100%+ YoY; Visa 90%+): CoinDesk / insights4vc / Artemis, 2025–26.' },
] as const
