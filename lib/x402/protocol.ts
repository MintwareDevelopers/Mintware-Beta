// x402 wire helpers — encode/decode the base64 headers, build a `402` challenge, and validate a payload
// against the requirements it claims to satisfy. Pure functions, no network. Spec: agentkit-compute-402-spec.md.

import {
  PaymentRequirements,
  PaymentRequiredResponse,
  PaymentPayload,
  X402_VERSION,
} from './types'

// ── base64 (works in Node and edge/browser without Buffer assumptions) ────────────────────────────────
function toBase64(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64')
  // eslint-disable-next-line no-undef
  return btoa(unescape(encodeURIComponent(s)))
}
function fromBase64(b64: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8')
  // eslint-disable-next-line no-undef
  return decodeURIComponent(escape(atob(b64)))
}

/** Encode the `402` body into the `PAYMENT-REQUIRED` header value. */
export function encodePaymentRequired(accepts: PaymentRequirements[], error?: string): string {
  const body: PaymentRequiredResponse = { x402Version: X402_VERSION, accepts, error }
  return toBase64(JSON.stringify(body))
}

/** Decode a `PAYMENT-REQUIRED` header (or `402` body string) back into structured requirements. */
export function decodePaymentRequired(headerOrJson: string): PaymentRequiredResponse {
  const looksB64 = !headerOrJson.trimStart().startsWith('{')
  const json = looksB64 ? fromBase64(headerOrJson) : headerOrJson
  const parsed = JSON.parse(json) as PaymentRequiredResponse
  if (!Array.isArray(parsed.accepts)) throw new Error('x402: malformed PAYMENT-REQUIRED (no accepts[])')
  return parsed
}

/** Encode a signed payload into the `PAYMENT-SIGNATURE` header value. */
export function encodePaymentPayload(payload: PaymentPayload): string {
  return toBase64(JSON.stringify(payload))
}

/** Decode a `PAYMENT-SIGNATURE` header value. Throws on malformed input (caller returns 402). */
export function decodePaymentPayload(header: string): PaymentPayload {
  const parsed = JSON.parse(fromBase64(header)) as PaymentPayload
  if (!parsed?.payload?.authorization || !parsed?.payload?.signature) {
    throw new Error('x402: malformed PAYMENT-SIGNATURE')
  }
  return parsed
}

export interface BuildRequirementsInput {
  priceAtomic: string // atomic units (USDC 6dp)
  asset: string
  payTo: string
  resource: string
  network: string
  scheme?: PaymentRequirements['scheme']
  nonce: string
  /** validity window seconds (default 300). */
  ttlSeconds?: number
  /** unix seconds "now" — injected so callers stay deterministic/testable. */
  now: number
  description?: string
}

/** Build a single `PaymentRequirements`. `now` is injected (no ambient clock) so it is pure + testable. */
export function buildRequirements(i: BuildRequirementsInput): PaymentRequirements {
  return {
    scheme: i.scheme ?? 'exact',
    network: i.network,
    maxAmountRequired: i.priceAtomic,
    asset: i.asset,
    payTo: i.payTo,
    resource: i.resource,
    description: i.description,
    nonce: i.nonce,
    validUntil: i.now + (i.ttlSeconds ?? 300),
    maxTimeoutSeconds: i.ttlSeconds ?? 300,
  }
}

export type PayloadCheck = { ok: true } | { ok: false; reason: string }

/** Structural validation of a payload against the requirements it claims to satisfy — BEFORE any on-chain
 *  verify. Checks scheme/network/asset/recipient match, amount ≤ max, and the EIP-3009 window vs `now`.
 *  On-chain signature recovery + funds are the facilitator's job; this is the cheap pre-filter. */
export function checkPayloadAgainst(
  reqs: PaymentRequirements,
  payload: PaymentPayload,
  now: number,
): PayloadCheck {
  if (payload.scheme !== reqs.scheme) return { ok: false, reason: 'scheme_mismatch' }
  if (payload.network !== reqs.network) return { ok: false, reason: 'network_mismatch' }
  if (now > reqs.validUntil) return { ok: false, reason: 'requirements_expired' }

  const auth = payload.payload.authorization
  if (auth.to.toLowerCase() !== reqs.payTo.toLowerCase()) return { ok: false, reason: 'wrong_recipient' }

  let value: bigint
  let max: bigint
  try {
    value = BigInt(auth.value)
    max = BigInt(reqs.maxAmountRequired)
  } catch {
    return { ok: false, reason: 'unparseable_amount' }
  }
  if (value <= 0n) return { ok: false, reason: 'non_positive_amount' }
  if (value > max) return { ok: false, reason: 'amount_exceeds_max' }

  // EIP-3009 validity window (seconds). validAfter < now < validBefore.
  const after = Number(auth.validAfter)
  const before = Number(auth.validBefore)
  if (Number.isFinite(after) && now < after) return { ok: false, reason: 'not_yet_valid' }
  if (Number.isFinite(before) && now >= before) return { ok: false, reason: 'authorization_expired' }

  return { ok: true }
}
