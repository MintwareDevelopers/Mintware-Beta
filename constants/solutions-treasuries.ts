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

export const TREASURY_META = { title: 'For Treasuries — Mintware', description: 'MarketEngine liquidity and Earn-share card refill on testnet. Unaudited; external audit gates real value.' } as const

export const TREASURY_HERO = { eyebrow: 'Mintware for Treasuries', status: 'Testnet · unaudited', title: 'Curated liquidity,', titleAccent: 'with a clear exit.', sub: 'MarketEngine issues quote-valued shares for curated Uniswap v4 pools. Card rails are Bridge + Stripe, pre-enable; the on-chain payment gateway only refills a member-registered buffer from Earn shares.', ctaPrimary: { label: 'Explore current liquidity', href: '/vaults' }, ctaSecondary: { label: 'Read the docs', href: '/docs' } } as const

// ONE concentrated honesty note — the single line that carries the legal weight.
export const TREASURY_STATUS = { label: 'Testnet · unaudited', body: 'Current liquidity is live on Robinhood Chain testnet. The former Treasury senior/junior issuance, spend-from-NAV card flow, and Arc/CCTP settlement design are retired. External audit gates real value.' } as const

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
export const TREASURY_MATH = { eyebrow: 'Current product', title: 'No yield projection.', intro: 'MarketEngine share value depends on its underlying pool portfolio. Robinhood testnet adapters are idle custody and do not earn.', rows: [{ label: 'MarketEngine share', rate: 'Quote-valued', earns: 'Pool portfolio value', tone: 'flat' }, { label: 'Robinhood testnet adapters', rate: 'Idle custody', earns: 'No adapter yield', tone: 'accent' }], punch: 'Testnet only', punchSub: 'Current deployments are unaudited.', note: 'External audit gates real value. This page does not describe a yield target or treasury return.' } as const

// ─── How Mintware solves it — map value props to treasury needs ─────────────
export const TREASURY_SOLUTION = { eyebrow: 'Current products', title: 'One engine per pool.', body: 'The current liquidity product is separate from card refill and does not settle purchases from vault NAV.', cards: [{ index: '01', title: 'MarketEngine', body: 'One engine per curated Uniswap v4 pool; one quote-valued share token; a resting band plus per-token ERC-4626 adapters.' }, { index: '02', title: 'Guarded deposits', body: 'Either or both pool tokens may be deposited with a minimum-shares floor. A fresh mark and spot-near-mark check are required.' }, { index: '03', title: 'In-kind withdrawals', body: 'Exits return both pool tokens pro-rata with minimum-output checks and work when the mark is stale.' }, { index: '04', title: 'Card refill', body: 'The relayer redeems Earn shares to the member’s registered buffer. Bridge + Stripe are pre-enable; no merchant settlement from vault NAV.' }] } as const

// ─── The mechanics, honestly ────────────────────────────────────────────────
export const TREASURY_MECHANICS = { eyebrow: 'The mechanics, honestly', title: 'How it actually works.', intro: 'Current MarketEngine and card refill mechanics:', items: [{ k: 'Share', v: 'One quote-valued share token for a curated pool portfolio.' }, { k: 'Deposit', v: 'Fresh mark and spot-near-mark guard; either or both pool tokens with a minimum-shares floor.' }, { k: 'Exit', v: 'Pro-rata in-kind withdrawal of both pool tokens; available when the mark is stale.' }, { k: 'Refill', v: 'Relayer redeems Earn shares to the member’s registered buffer wallet under daily caps.' }] } as const

// ─── The dark-pop "epic tech / why us" moment (single deliberate dark band) ──
export const TREASURY_TRUST = { eyebrow: 'Status', title: 'Testnet only —', titleAccent: 'unaudited.', intro: 'External audit gates real value.', items: [{ k: 'MarketEngine', v: 'Live on Robinhood Chain testnet; Base Sepolia deployment also exists.' }, { k: 'Adapters', v: 'Robinhood testnet adapters are idle custody and do not earn.' }, { k: 'Retired flows', v: 'Treasury senior/junior issuance, spend-from-NAV, Arc/CCTP, and ULV/JIT/MEV are not current.' }], note: 'External audit gates real value.', proofCta: { label: 'See current product', href: '/vaults' } } as const

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
  eyebrow: 'Current product · testnet',
  title: 'Explore curated liquidity.',
  body: 'MarketEngine is live on Robinhood Chain testnet · unaudited. External audit gates real value.',
  primary: { label: 'Explore MarketEngine', href: '/vaults' },
  secondary: { label: 'Read the docs', href: '/docs' },
  tertiary: { label: 'View deployments', href: '/docs' },
} as const

// ─── Sources (small, bottom) — dated + attributed ───────────────────────────
export const TREASURY_SOURCES = [
  { n: '1', text: 'DAO treasury value (~$24.5B, 2025) & stablecoin share (~18%): DeepDAO / CoinLaw DAO Treasury Holdings Statistics, 2025.' },
  { n: '2', text: 'Stablecoin settlement volume ($33T, 2025, +72% YoY) & supply projections: Arkham / CEX.IO / Citi 2025 stablecoin research.' },
  { n: '3', text: 'Safe (Gnosis Safe) multisig scale ($100B+ TVL, 10M+ accounts): Safe / DeFiLlama / CoinGecko, 2025.' },
  { n: '4', text: 'Current MarketEngine share value is quote-denominated. Robinhood testnet adapters are idle custody and do not earn.' },
  { n: '5', text: 'Crypto-linked card spend (~$18B annualized, +100%+ YoY; Visa 90%+): CoinDesk / insights4vc / Artemis, 2025–26.' },
] as const
