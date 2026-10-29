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
  note: 'Cards use Bridge + Stripe and are pre-enable. The current on-chain gateway only refills a registered buffer from Earn shares; it does not settle purchases.',
} as const

export const CARDS_HERO = {
  eyebrow: 'Mintware · Cards',
  title: 'A card backed by',
  titleAccent: 'a balance that never idles.',
  body: 'The current card path is a refill: a relayer redeems your Earn shares to your registered buffer wallet. Purchases do not settle from vault shares or NAV.',
} as const

// ─── How it works — registered buffer refill ────────────────────────────────
export const CARDS_FLOW = {
  eyebrow: 'How it works',
  title: 'Refill a registered buffer.',
  steps: [
    { key: 'propose', label: 'Choose a buffer', desc: 'Propose your own buffer wallet as the destination.' },
    { key: 'accept', label: 'Wait, then accept', desc: 'Accept the proposed destination after the 48-hour delay. You can revoke it at any time.' },
    { key: 'refill', label: 'Refill within caps', desc: 'An authorized relayer redeems your Earn shares to that wallet, subject to per-user and global UTC-day caps.' },
  ],
} as const

// ─── Refill controls ────────────────────────────────────────────────────────
export const CARDS_STANDING = {
  eyebrow: 'Refill controls',
  title: 'Clear limits,',
  titleAccent: 'member controlled.',
  body: 'Each refill is identified once and bounded by per-user and global UTC-day caps. Cap increases are timelocked.',
  tiers: [
    {
      name: 'Per-user cap',
      unlock: 'UTC-day bucket',
      perk: 'Member-specific limit',
      detail: 'The relayer counts delivered assets against this member’s daily cap.',
    },
    {
      name: 'Global cap',
      unlock: 'UTC-day bucket',
      perk: 'System-wide limit',
      detail: 'All refills also count against the global daily cap.',
    },
    {
      name: 'Timelocked changes',
      unlock: 'Cap increases',
      perk: 'Delayed activation',
      detail: 'An increase to either cap must pass the on-chain risk-parameter timelock.',
    },
  ],
  guardrails: [
    'A refill is a redemption of the member’s own Earn shares.',
    'The destination must be registered by the member after a 48-hour delay.',
    'The member can revoke the registered destination at any time.',
  ],
  note: 'The gateway does not authorize purchases or settle merchants; card rails are pre-enable.',
} as const

// ─── Why this is different from a generic crypto card ───────────────────────
export const CARDS_WHY = {
  eyebrow: 'Why this isn’t a generic crypto card',
  title: 'Most cards make you choose.',
  intro: 'Cards are not enabled yet. The on-chain refill gateway sends redeemed Earn assets to a member-registered buffer; it does not spend directly from the vault.',
  rows: [
    { product: 'Prepaid crypto cards', tradeoff: 'Load it, and it just sits there — no yield, and you did the manual transfer yourself.', us: false },
    { product: 'Staking-gated cards', tradeoff: 'Better rates require locking up a separate token — a second thing to hold, just to spend the first.', us: false },
    { product: 'Mintware card refill', tradeoff: 'A relayer redeems Earn shares to your registered buffer wallet under daily caps.', us: true },
  ],
} as const

export const CARDS_CTA = {
  eyebrow: 'Coming soon',
  title: 'Be first to the card',
  body: 'Cards use Bridge + Stripe and are pre-enable. Leave your email for updates.',
  successLabel: '✴ You’re on the list',
  secondaryCta: 'Explore the full account',
  secondaryHref: '/yield-payment-network',
} as const

export type CardsStandingTier = (typeof CARDS_STANDING.tiers)[number]
export type CardsFlowStep = (typeof CARDS_FLOW.steps)[number]
