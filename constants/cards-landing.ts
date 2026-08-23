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
  note: 'Card issuance is sandbox-only today. Nothing here is an offer to issue a card, a promise of a limit, or a guarantee of any perk.',
} as const

export const CARDS_HERO = {
  eyebrow: 'Mintware · Cards',
  title: 'A card backed by',
  titleAccent: 'a balance that never idles.',
  body: 'Spend straight from a position that stays deployed — the vault holds what a purchase needs, settles it, and the rest keeps working. No unwinding, no cashing out, no idle float sitting around waiting to be spent.',
} as const

// ─── How it works — spend, hold, settle ─────────────────────────────────────
export const CARDS_FLOW = {
  eyebrow: 'How it works',
  title: 'A swipe is a hold, then a settle.',
  steps: [
    { key: 'swipe', label: 'You swipe', desc: 'A purchase authorizes against your balance in real time — no manual transfer, no bridging, no pre-loading a separate spending account.' },
    { key: 'hold', label: 'The vault holds', desc: 'The exact amount needed is held against your position. Nothing else is touched — the rest of your balance stays deployed and earning.' },
    { key: 'settle', label: 'It settles', desc: 'The hold converts and pays the merchant. Your position keeps running the moment it clears.' },
  ],
} as const

// ─── Standing — the card gets better the more you use it (counsel-safe) ─────
export const CARDS_STANDING = {
  eyebrow: 'Built for how you actually use it',
  title: 'The more you spend,',
  titleAccent: 'the better it gets.',
  body: 'Standing tracks real, settled spending on your card — nothing else. There’s nothing to deposit, hold, or stake to move up. Using the card for what it’s for is what moves you forward.',
  tiers: [
    {
      name: 'Active',
      unlock: 'A handful of real purchases',
      perk: 'Priority settlement',
      detail: 'Your spend clears faster in the settlement batch — less waiting, no extra step.',
    },
    {
      name: 'Established',
      unlock: 'Sustained spend over time',
      perk: 'More of your balance, available',
      detail: 'A tighter hold on your own position means more of what you have becomes spendable, sooner.',
    },
    {
      name: 'Trusted',
      unlock: 'A long, consistent track record',
      perk: 'A higher daily limit + early access',
      detail: 'Spend more per day, and get first access to new accounts before they open to everyone else.',
    },
  ],
  guardrails: [
    'Earned only by real, settled purchases — never by depositing, holding, or staking anything.',
    'Every perk is a service improvement — faster settlement, more headroom, earlier access. Never a payout, never a new token, never anything to trade.',
    'Completely separate from the Attribution score, which stays informational-only and never gates access to anything.',
  ],
  note: 'Standing is computed from your own settlement history only. It changes how the card serves you, not what it pays you.',
} as const

// ─── Why this is different from a generic crypto card ───────────────────────
export const CARDS_WHY = {
  eyebrow: 'Why this isn’t a generic crypto card',
  title: 'Most cards make you choose.',
  intro: 'Fund a spending account and your money sits idle. Stay fully deployed and you can’t spend without unwinding first. The Liquid Sovereign Account is built so you never have to choose.',
  rows: [
    { product: 'Prepaid crypto cards', tradeoff: 'Load it, and it just sits there — no yield, and you did the manual transfer yourself.', us: false },
    { product: 'Staking-gated cards', tradeoff: 'Better rates require locking up a separate token — a second thing to hold, just to spend the first.', us: false },
    { product: 'The Liquid Sovereign Account card', tradeoff: 'One balance. It earns, it spends, and using it is the only thing that ever improves it.', us: true },
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
