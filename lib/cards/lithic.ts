// Lithic client — sandbox card issuing. This is the provider-specific leg only: raw card creation
// + ASA (Auth Stream Access) webhook parsing/typing. The DECISION (role cap + edge-auth NAV hold)
// deliberately lives elsewhere (lib/org/cardAuthorize.ts) so swapping issuers later doesn't touch
// the authorization logic — mirrors how lib/x402/edgeHttp.ts is kept separate from facilitator.ts.
//
// Sandbox-only today. `LITHIC_API_KEY` is a sandbox key (see .env.local) — production issuance is a
// separate, KYB-gated tier on Lithic's side, not a config flip.

import { Lithic } from 'lithic'
import type { CardAuthorizationApprovalRequestWebhookEvent } from 'lithic/resources/webhooks'

let client: Lithic | null | undefined // undefined = not yet constructed, null = constructed but unconfigured

/** Lazily-constructed singleton, same pattern as lib/web2/supabase.ts's service client. Returns null
 *  (not throw) when LITHIC_API_KEY is unset so callers can degrade to a clean 503, same posture as
 *  lib/x402/config.ts#getFacilitator(). */
export function getLithicClient(): Lithic | null {
  if (client !== undefined) return client
  const apiKey = process.env.LITHIC_API_KEY
  if (!apiKey) {
    client = null
    return client
  }
  client = new Lithic({
    apiKey,
    environment: (process.env.LITHIC_ENV as 'sandbox' | 'production') ?? 'sandbox',
    webhookSecret: process.env.LITHIC_WEBHOOK_SECRET || undefined,
  })
  return client
}

export function lithicConfigured(): boolean {
  return getLithicClient() !== null
}

export type SandboxCard = {
  token: string
  lastFour: string
  state: string
  spendLimit: number
  spendLimitDuration: string
  /** SANDBOX ONLY — needed to call simulateAuthorization() later (Lithic has no "simulate by
   *  token" variant). See the migration header for why this is fine in sandbox and not in prod. */
  pan: string
}

/** Issue a sandbox virtual card. `spendLimitCents` is Lithic's own hard ceiling (belt #2, on top of
 *  the org role cap enforced at auth time) — set generously; the role cap + NAV hold are the real
 *  gates. `spendLimitDuration: 'TRANSACTION'` means the ceiling applies per-swipe, not cumulative —
 *  cumulative daily/monthly spend is the org role cap's job (lib/org/rolePresets.ts), not Lithic's. */
export async function issueSandboxVirtualCard(opts: {
  memo: string
  spendLimitCents?: number
}): Promise<SandboxCard> {
  const lithic = getLithicClient()
  if (!lithic) throw new Error('lithic_unconfigured')
  const card = await lithic.cards.create({
    type: 'VIRTUAL',
    memo: opts.memo,
    spend_limit: opts.spendLimitCents ?? 500_000, // $5,000 per-transaction ceiling; a backstop, not the policy
    spend_limit_duration: 'TRANSACTION',
    state: 'OPEN',
  })
  if (!card.pan) throw new Error('lithic_card_create_missing_pan') // sandbox always returns it on create
  return {
    token: card.token!,
    lastFour: card.last_four ?? '',
    state: card.state ?? 'OPEN',
    spendLimit: card.spend_limit ?? 0,
    spendLimitDuration: card.spend_limit_duration ?? 'TRANSACTION',
    pan: card.pan,
  }
}

export type SimulatedSwipe = { token?: string; debuggingRequestId?: string }

/** Fire a real ASA round-trip in sandbox: this makes Lithic call OUR webhook exactly as a live
 *  swipe would, then returns Lithic's own record of the simulated transaction. The actual
 *  approve/decline decision is read back from card_swipe_events (written by the webhook), not from
 *  this response — Lithic's simulate response is just a receipt, not the ASA decision. */
export async function simulateSwipe(opts: {
  pan: string
  amountCents: number
  merchantDescriptor: string
  mcc?: string
}): Promise<SimulatedSwipe> {
  const lithic = getLithicClient()
  if (!lithic) throw new Error('lithic_unconfigured')
  const res = await lithic.transactions.simulateAuthorization({
    pan: opts.pan,
    amount: opts.amountCents,
    descriptor: opts.merchantDescriptor,
    mcc: opts.mcc ?? '5734', // "Computer Software Stores" — a plausible default demo merchant category
  })
  return { token: res.token, debuggingRequestId: res.debugging_request_id }
}

export type AsaVerifyResult =
  | { ok: true; event: CardAuthorizationApprovalRequestWebhookEvent }
  | { ok: false; reason: 'unconfigured' | 'bad_signature' | 'not_an_authorization_request' }

/** Verify + parse an inbound ASA POST using the official SDK (standardwebhooks under the hood — see
 *  lib/x402 for the analogous pattern of never hand-rolling a signature scheme). Requires
 *  LITHIC_WEBHOOK_SECRET (from "retrieve ASA HMAC secret" in the Lithic sandbox dashboard after
 *  enrolling the responder endpoint) — fails CLOSED (not "trust unsigned") when unset, same posture
 *  as edge-auth's bearer check. */
export function verifyAsaRequest(rawBody: string, headers: Record<string, string>): AsaVerifyResult {
  const lithic = getLithicClient()
  const secret = process.env.LITHIC_WEBHOOK_SECRET
  if (!lithic || !secret) return { ok: false, reason: 'unconfigured' }
  let parsed: unknown
  try {
    parsed = lithic.webhooks.parse(rawBody, { headers, secret })
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  const event = parsed as { event_type?: string }
  if (event.event_type !== 'card_authorization.approval_request') {
    return { ok: false, reason: 'not_an_authorization_request' }
  }
  return { ok: true, event: parsed as CardAuthorizationApprovalRequestWebhookEvent }
}

/** Lithic amounts are integer CENTS; edge-auth / the gateway speak atomic 6dp USDC. Both are
 *  integer-scaled from USD so this is exact (no float): cents * 10_000 = atomic-6dp. */
export function centsToAtomicUsdc(cents: number): bigint {
  return BigInt(Math.round(cents)) * 10_000n
}
