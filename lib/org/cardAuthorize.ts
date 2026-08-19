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
import { policyForRole, withinDailyCap } from '@/lib/org/rolePresets'
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

export type CardAuthDecision =
  | { approved: true; holdId?: string }
  | { approved: false; reason: string }

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
}): Promise<CardAuthDecision> {
  const { supabase, providerCardToken, provider, amountAtomicUsdc, ref, spentTodayAtomic = 0n } = params
  const edge = params.edge !== undefined ? params.edge : edgeAuthorizerFromEnv()

  if (amountAtomicUsdc <= 0n) return { approved: false, reason: 'non_positive_amount' }

  // 1) Resolve card token -> (org, member). Unknown card = decline; never guess.
  const { data: card, error: cardErr } = await supabase
    .from('org_cards')
    .select('org_id, member_wallet, state')
    .eq('provider', provider)
    .eq('provider_card_token', providerCardToken)
    .maybeSingle()
  if (cardErr) return { approved: false, reason: 'card_lookup_failed' }
  if (!card) return { approved: false, reason: 'unknown_card' }
  if (card.state !== 'OPEN') return { approved: false, reason: 'card_not_open' }

  // 2) Belt — role's daily cap. Membership must be active.
  const { data: member, error: memErr } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', card.org_id)
    .eq('wallet', card.member_wallet)
    .maybeSingle()
  if (memErr) return { approved: false, reason: 'member_lookup_failed' }
  if (!member || member.status !== 'active') return { approved: false, reason: 'member_not_active' }

  const policy = policyForRole(member.role)
  if (!withinDailyCap(policy, amountAtomicUsdc, spentTodayAtomic)) {
    return { approved: false, reason: 'over_role_daily_cap' }
  }

  // 3) Suspenders — live NAV hold via edge-auth. Fail CLOSED when unconfigured (same posture as
  //    lib/x402/config.ts#getFacilitator and the pay route's relayer gate) — a card is a live-money
  //    surface, never default-approve because a downstream service is missing.
  if (!edge) return { approved: false, reason: 'edge_auth_unconfigured' }

  const res = await edge.authorize({
    payer: card.member_wallet,
    amountAtomic: amountAtomicUsdc.toString(),
    ref,
  })
  if (!res.approved) return { approved: false, reason: res.reason ?? 'insufficient_equity' }
  return { approved: true, holdId: res.holdId }
}
