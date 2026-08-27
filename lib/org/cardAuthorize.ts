// Card-swipe authorization — belt (role daily cap) + suspenders (live NAV hold), same idiom as
// /api/orgs/[id]/pay/route.ts uses for vendor payouts. This is the decision only: it does NOT touch
// settlement (settleSpend / the relayer) — that leg is deploy-gated everywhere else in this repo
// (relayer has no HTTP server yet, see .claude/rules/payments-ypn.md) and stays that way here too;
// see the webhook route for how a capture is logged instead of settled.
//
// The "suspenders" half is the exact edge-auth /authorize port already proven live (lib/proof/
// latestRun.ts leg 2) and already used by the x402 facilitator (lib/x402/facilitator.ts) — a card
// swipe is authorized through the identical NAV-hold engine, not a parallel one.

import type { EdgeAuthorizer } from '@/lib/x402/facilitator'
import { httpEdgeAuthorizer } from '@/lib/x402/edgeHttp'
import { policyForRole } from '@/lib/org/rolePresets'
import {
  getStandingForWallet,
  withinStandingDailyCap,
  softHeadroomCeiling,
  type StandingTier,
} from '@/lib/org/standing'
import type { getServiceClient } from '@/lib/web2/supabase'

type SupabaseClient = ReturnType<typeof getServiceClient>

/** Builds the same edge-auth transport the x402 facilitator uses (lib/x402/config.ts#getFacilitator),
 *  or null when EDGE_AUTH_URL/_SECRET are unset — so the route layer can 503 rather than silently
 *  fail-closed-per-swipe with no visibility into why. Kept as a separate export (not called inside
 *  decideCardSwipe) so tests inject a fake EdgeAuthorizer instead of touching env/network. */
export function edgeAuthorizerFromEnv(): EdgeAuthorizer | null {
  const url = process.env.EDGE_AUTH_URL
  const secret = process.env.EDGE_AUTH_SECRET
  if (!url || !secret) return null
  return httpEdgeAuthorizer({ url, secret })
}

/** `orgId`/`orgCardId`/`memberWallet` are populated whenever the card token resolved to a real
 *  org_cards row (i.e. every outcome except unknown_card / card_lookup_failed) — the webhook route
 *  uses them to log the decision to card_swipe_events without a second lookup. */
export type CardAuthDecision =
  | { approved: true; holdId?: string; mode?: 'buffer' | 'edge'; orgId: string; orgCardId: string; memberWallet: string }
  | { approved: false; reason: string; orgId?: string; orgCardId?: string; memberWallet?: string }

/** `spentTodayAtomic` is a caller-supplied hook, not computed here — this module has no opinion on
 *  how "today" is tracked (matches the pay route's MVP note: "a production system also tracks
 *  spentToday; MVP checks this batch total"). Card swipes are far higher-frequency than vendor
 *  payouts, so a real spentToday accumulator is the natural next step once this is exercised for
 *  real; passing 0n here (the default) means the role cap only bounds a SINGLE swipe, not the day —
 *  edge-auth's own NAV hold is still the hard backstop regardless. */
export async function decideCardSwipe(params: {
  supabase: SupabaseClient
  providerCardToken: string
  provider: string
  amountAtomicUsdc: bigint
  ref: string // idempotency key — the issuer's own authorization token
  spentTodayAtomic?: bigint
  /** Injectable for tests; defaults to the real edge-auth transport built from env. */
  edge?: EdgeAuthorizer | null
  /** Injectable standing tier for tests. When omitted, standing is computed on-read from the
   *  member's own settled card spend (getStandingForWallet), failing SAFE to `none`. Standing only
   *  ever WIDENS a limit within an existing hard cap — never bypasses a money-path guard. */
  standingTier?: StandingTier
}): Promise<CardAuthDecision> {
  const { supabase, providerCardToken, provider, amountAtomicUsdc, ref, spentTodayAtomic = 0n } = params
  const edge = params.edge !== undefined ? params.edge : edgeAuthorizerFromEnv()

  if (amountAtomicUsdc <= 0n) return { approved: false, reason: 'non_positive_amount' }

  // 1) Resolve card token -> (org, member). Unknown card = decline; never guess.
  const { data: card, error: cardErr } = await supabase
    .from('org_cards')
    .select('id, org_id, member_wallet, state')
    .eq('provider', provider)
    .eq('provider_card_token', providerCardToken)
    .maybeSingle()
  if (cardErr) return { approved: false, reason: 'card_lookup_failed' }
  if (!card) return { approved: false, reason: 'unknown_card' }
  const identity = { orgId: card.org_id as string, orgCardId: card.id as string, memberWallet: card.member_wallet as string }
  if (card.state !== 'OPEN') return { approved: false, reason: 'card_not_open', ...identity }

  // 2) Belt — role's daily cap. The org OWNER is implicitly an uncapped active spender (same
  //     policyForRole('owner') shortcut every other org route uses — /cards issuance already lets
  //     the owner hold a card without an org_members row, so the swipe decision must recognize that
  //     too, not require a redundant membership row for the one wallet that's exempt from having one).
  const { data: org, error: orgErr } = await supabase.from('orgs').select('owner_wallet').eq('id', card.org_id).single()
  if (orgErr || !org) return { approved: false, reason: 'org_lookup_failed', ...identity }
  const isOwner = (org.owner_wallet as string).toLowerCase() === card.member_wallet.toLowerCase()

  let policy
  if (isOwner) {
    policy = policyForRole('owner')
  } else {
    const { data: member, error: memErr } = await supabase
      .from('org_members')
      .select('role, status')
      .eq('org_id', card.org_id)
      .eq('wallet', card.member_wallet)
      .maybeSingle()
    if (memErr) return { approved: false, reason: 'member_lookup_failed', ...identity }
    if (!member || member.status !== 'active') return { approved: false, reason: 'member_not_active', ...identity }
    policy = policyForRole(member.role)
  }

  // 2b) Standing — a service-quality tier derived PURELY from this member's OWN settled card spend
  //     (never a reputation/Attribution score). It only ever WIDENS a limit within an existing hard
  //     cap; a `none`/unknown/missing tier reproduces today's exact behavior. Computed on-read unless
  //     a tier is injected (tests). Fail-safe: getStandingForWallet returns `none` on any error.
  const standingTier: StandingTier =
    params.standingTier ?? (await getStandingForWallet(supabase, card.member_wallet, card.org_id as string)).tier

  // Belt — role daily cap, TIER-WIDENED (Trusted perk: higher daily limit). effectiveDailyCap is
  // widen-only and hard-clamped, so a `none` tier == the raw role cap (unchanged), and no tier can
  // remove the cap or turn a receive-only (0n) role into a spender.
  if (!withinStandingDailyCap(policy.dailyCapUsdc, standingTier, amountAtomicUsdc, spentTodayAtomic)) {
    return { approved: false, reason: 'over_role_daily_cap', ...identity }
  }

  // Headroom — soft per-swipe ceiling, TIER-WIDENED (Established perk: more of your balance
  // available). DISABLED by default (returns null → no soft cap → today's exact behavior); when an
  // operator opts into a conservative floor it engages, and even then a tier can only widen UP TO the
  // hard $250 settle ceiling, never past it and never around the edge-auth NAV guard below.
  const softCeiling = softHeadroomCeiling(standingTier)
  if (softCeiling !== null && amountAtomicUsdc > softCeiling) {
    return { approved: false, reason: 'over_headroom_soft_cap', ...identity }
  }

  // 3) Suspenders — two modes:
  //
  //    (a) CARD SPEND BUFFER (docs/developers/card-spend-buffer-spec.md §1,§8): a Visa/Mastercard ASA
  //        authorization has a hard ~6s window and cannot survive a live, multi-RPC, AMM-priced NAV
  //        read — and that price is manipulable in the same block. So when the buffer feature is on
  //        AND this card has a buffer, the decision is a FLAT, deterministic read of the pre-funded
  //        buffer balance, which REPLACES the edge-auth NAV hold on the card rail (that hold is exactly
  //        the computation that can't meet card latency). No holdId — the buffer IS the reserve.
  //        (Agent-initiated x402 spend is a different rail with no such clock and keeps its live-NAV
  //        path — it never enters this function.) Flag-gated: OFF by default → path (b) unchanged.
  if (process.env.CARD_BUFFER_ENABLED === 'true') {
    // ATOMIC check-and-hold (audit fix C1): reserve_card_buffer debits an on-DB reservation ledger under
    // a row lock, so concurrent/sequential swipes can't both pass against one balance. It reads the
    // per-tx cap + available (= balance − reserved) from the row itself. 'no_buffer' → this card has no
    // buffer, fall through to edge-auth.
    const { data: reserve } = await supabase.rpc('reserve_card_buffer', {
      p_org_card_id: card.id,
      p_amount: amountAtomicUsdc.toString(),
    })
    if (reserve === 'ok') return { approved: true, mode: 'buffer', ...identity }
    if (reserve === 'over_cap') return { approved: false, reason: 'over_per_tx_cap', ...identity }
    if (reserve === 'insufficient') return { approved: false, reason: 'insufficient_buffer', ...identity }
    // 'no_buffer' / null → fall through to the default edge-auth path.
  }

  //    (b) default: live NAV hold via edge-auth. Fail CLOSED when unconfigured (same posture as
  //        lib/x402/config.ts#getFacilitator and the pay route's relayer gate) — a card is a live-money
  //        surface, never default-approve because a downstream service is missing.
  if (!edge) return { approved: false, reason: 'edge_auth_unconfigured', ...identity }

  const res = await edge.authorize({
    payer: card.member_wallet,
    amountAtomic: amountAtomicUsdc.toString(),
    ref,
  })
  if (!res.approved) return { approved: false, reason: res.reason ?? 'insufficient_equity', ...identity }
  return { approved: true, holdId: res.holdId, mode: 'edge', ...identity }
}
