// Bridge REST client + webhook verification/normalization — the I/O leg of the Bridge card rail
// (the pure config/allowance leg is lib/cards/bridge.ts). Bridge stablecoin cards run through Stripe
// Issuing, so the webhook is a Stripe-style signed event (`stripe-signature: t=<ts>,v1=<hmac>`).
//
// Deploy-gated: the exact issuance endpoint/fields are pinned against Bridge's API at deploy; the
// request/response SHAPING here is unit-tested with a mocked fetch, and the webhook verify + event
// normalization are fully testable offline. Returns null / clean errors when unconfigured — never
// throws on missing config, same posture as getLithicClient().

import { createHmac, timingSafeEqual } from 'node:crypto'

const BRIDGE_API_URL = () => process.env.BRIDGE_API_URL ?? 'https://api.bridge.xyz'

export function bridgeApiConfigured(): boolean {
  return !!process.env.BRIDGE_API_KEY
}

export interface IssueCardParams {
  /** The member wallet the card belongs to (for our own linkage / idempotency). */
  memberWallet: string
  /** The non-custodial funding wallet Bridge pulls from = the Privy/bufferOf address. */
  fundingWallet: string
  /** EVM chain the funding wallet + USDC live on (e.g. 'base', 'base-sepolia'). */
  chain: string
  /** Idempotency key so a retried issuance can't mint two cards. */
  idempotencyKey: string
}

export interface IssuedCard {
  /** Bridge/Stripe card id — persisted as org_cards.bridge_card_id and matched on webhooks. */
  bridgeCardId: string
  lastFour?: string
  status?: string
}

/**
 * Create a Bridge non-custodial card linked to the funding wallet (crypto_account type:standard, one
 * wallet = one card). Throws on a non-2xx so the onboarding runner treats issuance as not-done and
 * retries idempotently. Endpoint/fields verified against Bridge's API at deploy.
 */
export async function issueBridgeCard(p: IssueCardParams): Promise<IssuedCard> {
  const key = process.env.BRIDGE_API_KEY
  if (!key) throw new Error('bridge_api_unconfigured')

  const res = await fetch(`${BRIDGE_API_URL()}/v0/cards`, {
    method: 'POST',
    headers: {
      'Api-Key': key,
      'Content-Type': 'application/json',
      'Idempotency-Key': p.idempotencyKey,
    },
    body: JSON.stringify({
      crypto_account: { type: 'standard', chain: p.chain, currency: 'usdc', address: p.fundingWallet },
      metadata: { member_wallet: p.memberWallet },
    }),
  })
  if (!res.ok) throw new Error(`bridge_issue_failed_${res.status}`)
  const json = (await res.json()) as { id?: string; card_id?: string; last_four?: string; status?: string }
  const bridgeCardId = json.id ?? json.card_id
  if (!bridgeCardId) throw new Error('bridge_issue_no_card_id')
  return { bridgeCardId, lastFour: json.last_four, status: json.status }
}

// ── webhook verification (Stripe-style HMAC) ──────────────────────────────────────────────────────

export type WebhookVerify =
  | { ok: true; event: BridgeWebhookEvent }
  | { ok: false; reason: 'unconfigured' | 'bad_signature' | 'stale' | 'malformed' }

export interface BridgeWebhookEvent {
  id?: string
  type: string
  data?: { object?: Record<string, unknown> }
}

/** Parse a `stripe-signature` header into its timestamp + v1 signatures. */
function parseSigHeader(h: string): { t?: string; v1: string[] } {
  const v1: string[] = []
  let t: string | undefined
  for (const part of h.split(',')) {
    const [k, val] = part.split('=')
    if (k === 't') t = val
    else if (k === 'v1' && val) v1.push(val)
  }
  return { t, v1 }
}

const hexEq = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** Default replay-tolerance window (seconds) — matches Stripe's SDK default. */
export const WEBHOOK_TOLERANCE_SECS = 300

/**
 * Verify a Bridge/Stripe webhook signature over the RAW body and return the parsed event. Fail-closed:
 * 'unconfigured' when BRIDGE_WEBHOOK_SECRET is unset (→ 503, never a blind accept), 'bad_signature'
 * on mismatch, 'stale' when the signed timestamp is outside the tolerance window. Signed payload is
 * `${t}.${rawBody}`, HMAC-SHA256 with the secret.
 *
 * The freshness check closes the replay vector: a captured valid webhook re-POSTed later still has a
 * valid HMAC (the body is unchanged), so ONLY the timestamp bound stops it. `nowSecs` is injectable for
 * deterministic tests. This is necessary but not sufficient — the route also dedupes on event id so a
 * replay INSIDE the window is a no-op.
 */
export function verifyBridgeWebhook(
  rawBody: string,
  headers: Record<string, string>,
  opts: { toleranceSecs?: number; nowSecs?: number } = {},
): WebhookVerify {
  const secret = process.env.BRIDGE_WEBHOOK_SECRET
  if (!secret) return { ok: false, reason: 'unconfigured' }

  const sigHeader = headers['stripe-signature'] ?? headers['bridge-signature']
  if (!sigHeader) return { ok: false, reason: 'bad_signature' }
  const { t, v1 } = parseSigHeader(sigHeader)
  if (!t || v1.length === 0) return { ok: false, reason: 'bad_signature' }

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  if (!v1.some((sig) => hexEq(sig, expected))) return { ok: false, reason: 'bad_signature' }

  // Freshness (replay window) — checked AFTER the HMAC passes so it isn't a timing oracle.
  const toleranceSecs = opts.toleranceSecs ?? WEBHOOK_TOLERANCE_SECS
  const nowSecs = opts.nowSecs ?? Math.floor(Date.now() / 1000)
  const ts = Number(t)
  if (!Number.isFinite(ts) || Math.abs(nowSecs - ts) > toleranceSecs) return { ok: false, reason: 'stale' }

  try {
    const event = JSON.parse(rawBody) as BridgeWebhookEvent
    if (!event || typeof event.type !== 'string') return { ok: false, reason: 'malformed' }
    return { ok: true, event }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

// ── event normalization ───────────────────────────────────────────────────────────────────────────

export type BridgeEventKind = 'spend' | 'refund' | 'ignore'

/** A Bridge event reduced to what reconciliation needs; the route resolves providerCardId → org_card. */
export interface ParsedBridgeEvent {
  kind: BridgeEventKind
  /** Bridge/Stripe card id (org_cards.bridge_card_id) — null when the event carries no card. */
  providerCardId?: string
  /** Absolute atomic USDC (6dp) amount of the movement. */
  amountAtomic?: bigint
  eventId?: string
}

/** cents (Stripe issuing smallest unit, 2dp USD) → atomic USDC (6dp). 1 cent = 10_000 atomic units. */
export function centsToAtomicUsdc(cents: number): bigint {
  return BigInt(Math.round(Math.abs(cents))) * 10_000n
}

/**
 * Map a Bridge/Stripe issuing event onto a normalized spend/refund/ignore. A posted transaction that
 * debits the cardholder is a 'spend' (→ resync + refill); a refund credit is a 'refund' (→ resync only);
 * authorizations and everything else are 'ignore' (the money-moving event is the transaction).
 */
export function normalizeBridgeEvent(event: BridgeWebhookEvent): ParsedBridgeEvent {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>
  const providerCardId = typeof obj.card === 'string' ? obj.card : undefined
  const eventId = event.id

  if (event.type === 'issuing_transaction.created') {
    const txType = typeof obj.type === 'string' ? obj.type : ''
    const cents = typeof obj.amount === 'number' ? obj.amount : 0
    const amountAtomic = centsToAtomicUsdc(cents)
    // A capture is always a debit → spend. A `refund` is a CREDIT (positive) → refund, EXCEPT a refund
    // REVERSAL, which Stripe represents as type 'refund' with a NEGATIVE amount — that's a debit, so it
    // must refill like a spend, not be skipped like a credit. Hence: classify refunds by sign too.
    if (txType === 'refund') {
      return cents < 0
        ? { kind: 'spend', providerCardId, amountAtomic, eventId } // refund reversal = debit
        : { kind: 'refund', providerCardId, amountAtomic, eventId }
    }
    if (txType === 'capture') return { kind: 'spend', providerCardId, amountAtomic, eventId }
    // fall back on sign: Stripe issuing debits are negative amounts.
    if (cents < 0) return { kind: 'spend', providerCardId, amountAtomic, eventId }
    if (cents > 0) return { kind: 'refund', providerCardId, amountAtomic, eventId }
  }
  return { kind: 'ignore', providerCardId, eventId }
}
