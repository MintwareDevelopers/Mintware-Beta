// =============================================================================
// constants/cards-landing.ts
//
// ALL copy + data for the public "Cards" marketing surface (route: /cards).
// TOP-OF-FUNNEL marketing only — no app state. This page pitches the card/spend
// side of the Liquid Sovereign Account on its own; the fuller yield thesis lives
// at /yield-payment-network (see constants/ypn-landing.ts).
//
// HONESTY: this is COMING SOON / in development, same posture as YPN_STATUS.
// Card issuance today is sandbox-only (see /legal — "Card issuer (production
// tier)... Any sandbox card today is demo-only"). No "Launch app" CTA. Verbs
// stay "designed to" / "built to"; nothing here is an offer to issue a card.
//
// Standing guardrails (see /legal bright line #4/#6 + docs/legal/priority-buffer-
// redesign.md item #5, and constants/ypn-landing.ts's YPN_STANDING — this page's
// tiers are the SAME data, presented in more depth): earned only by genuine,
// settled, third-party spend; perks are service quality, never a payout, a new
// token, or anything tradeable; fully independent of the informational-only
// Attribution score.
// =============================================================================

export const CARDS_STATUS = {
  label: 'Coming soon',
  note: 'Bridge + Stripe card integrations are coming and in development. No purchase is authorized or settled through Mintware today.',
} as const

export const CARDS_HERO = {
  eyebrow: 'Mintware · Cards',
  title: 'A card backed by',
  titleAccent: 'a balance that never idles.',
  body: 'Designed to spend from a position that stays deployed — the vault would hold what a purchase needs, settle it, and keep the rest working. No unwinding, no cashing out, no idle float waiting to be spent.',
} as const

// ─── How it works — spend, hold, settle ─────────────────────────────────────
export const CARDS_FLOW = {
  eyebrow: 'How it works',
  title: 'A swipe is a hold, then a settle.',
  steps: [
    { key: 'swipe', label: 'You swipe', desc: 'A purchase is designed to authorize against your balance in real time — no manual transfer, no bridging, no separate spending account.' },
    { key: 'hold', label: 'The vault holds', desc: 'The exact amount needed would be held against your position. The rest of your balance would stay deployed.' },
    { key: 'settle', label: 'It settles', desc: 'The hold is designed to convert and pay the merchant. Your position would keep running as it clears.' },
  ],
} as const

// ─── Standing — the card gets better the more you use it (counsel-safe) ─────
export const CARDS_STANDING = {
  eyebrow: 'Built for how you actually use it',
  title: 'The more you spend,',
  titleAccent: 'the better it gets.',
  body: 'The planned Standing tiers would track settled spending on your card — nothing else. There’s nothing to deposit, hold, or stake to move up. Using the card for what it’s for would move you forward.',
  tiers: [
    {
      name: 'Active',
      unlock: 'A handful of real purchases',
      perk: 'Priority settlement',
      detail: 'The design aims for faster settlement batches — less waiting, no extra step.',
    },
    {
      name: 'Established',
      unlock: 'Sustained spend over time',
      perk: 'More of your balance, available',
      detail: 'A tighter hold on your own position is designed to make more of your balance spendable, sooner.',
    },
    {
      name: 'Trusted',
      unlock: 'A long, consistent track record',
      perk: 'A higher daily limit + early access',
      detail: 'The plan is a higher daily limit and early access to new accounts before they open more widely.',
    },
  ],
  guardrails: [
    'Planned to be earned by settled purchases — never by depositing, holding, or staking anything.',
    'Each planned perk is a service improvement — faster settlement, more headroom, earlier access. Never a payout or a tradeable token.',
    'Completely separate from the Attribution score, which stays informational-only and never gates access to anything.',
  ],
  note: 'Standing is a planned card feature based on your own settlement history. It would change how the card serves you, not what it pays you.',
} as const

// ─── Why this is different from a generic crypto card ───────────────────────
export const CARDS_WHY = {
  eyebrow: 'Why this isn’t a generic crypto card',
  title: 'Most cards make you choose.',
    intro: 'Fund a spending account and your money sits idle. Stay fully deployed and you can’t spend without unwinding first. The Liquid Sovereign Account is designed so you won’t have to choose.',
  rows: [
    { product: 'Prepaid crypto cards', tradeoff: 'Load it, and it just sits there — no yield, and you did the manual transfer yourself.', us: false },
    { product: 'Staking-gated cards', tradeoff: 'Better rates require locking up a separate token — a second thing to hold, just to spend the first.', us: false },
    { product: 'The planned Liquid Sovereign Account card', tradeoff: 'One balance designed to earn and spend, with use planned to improve service.', us: true },
  ],
} as const

export const CARDS_CTA = {
  eyebrow: 'Coming soon',
  title: 'Be first to the card',
  body: 'Card issuance is in sandbox today. Leave your email for early access when it opens.',
  successLabel: '✴ You’re on the list',
  secondaryCta: 'Explore the full account',
  secondaryHref: '/yield-payment-network',
} as const

export type CardsStandingTier = (typeof CARDS_STANDING.tiers)[number]
export type CardsFlowStep = (typeof CARDS_FLOW.steps)[number]
