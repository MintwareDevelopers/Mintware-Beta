// Seller-side x402 gate (P1) — wrap any resource so an unpaid request gets `402 PAYMENT-REQUIRED` and a paid
// request is verified (via a Facilitator) before the resource is served. Framework-agnostic: takes the raw
// header value + returns a decision, so a Next.js `createHandler` route (or anything) can drive it.
// Spec: docs/developers/agentkit-compute-402-spec.md §6.3.

import { PaymentRequirements, PaymentPayload, PAYMENT_SIGNATURE_HEADER } from './types'
import { encodePaymentRequired, decodePaymentPayload } from './protocol'
import { Facilitator } from './facilitator'

export interface Require402Config {
  priceAtomic: string
  asset: string
  payTo: string
  resource: string
  network: string
  scheme?: PaymentRequirements['scheme']
  nonce: string
  ttlSeconds?: number
  now: number
  description?: string
}

export interface Paid {
  paid: true
  payload: PaymentPayload
  payer?: string
  holdId?: string
  /** The requirements this payment satisfied — pass to the facilitator's settle after serving. */
  requirements: PaymentRequirements
}

export interface Unpaid {
  paid: false
  /** HTTP status to return (402). */
  status: 402
  /** Header name → value the caller must set (base64 PAYMENT-REQUIRED). */
  headers: Record<string, string>
  /** JSON body describing why + what's accepted. */
  body: { x402Version: number; accepts: PaymentRequirements[]; error?: string }
}

function buildReqs(cfg: Require402Config): PaymentRequirements {
  return {
    scheme: cfg.scheme ?? 'exact',
    network: cfg.network,
    maxAmountRequired: cfg.priceAtomic,
    asset: cfg.asset,
    payTo: cfg.payTo,
    resource: cfg.resource,
    description: cfg.description,
    nonce: cfg.nonce,
    validUntil: cfg.now + (cfg.ttlSeconds ?? 300),
    maxTimeoutSeconds: cfg.ttlSeconds ?? 300,
  }
}

function challenge(cfg: Require402Config, error?: string): Unpaid {
  const accepts = [buildReqs(cfg)]
  return {
    paid: false,
    status: 402,
    headers: { 'PAYMENT-REQUIRED': encodePaymentRequired(accepts, error) },
    body: { x402Version: 2, accepts, error },
  }
}

/**
 * Decide whether to serve. `paymentSignatureHeader` is the raw `PAYMENT-SIGNATURE` header value (or null).
 * On any problem the caller returns the `Unpaid` (402) verbatim; on success the caller serves the resource
 * and then calls `facilitator.settle(result.requirements, result.payload, result.holdId)`.
 */
export async function require402(
  paymentSignatureHeader: string | null,
  cfg: Require402Config,
  facilitator: Facilitator,
): Promise<Paid | Unpaid> {
  if (!paymentSignatureHeader) return challenge(cfg)

  let payload: PaymentPayload
  try {
    payload = decodePaymentPayload(paymentSignatureHeader)
  } catch {
    return challenge(cfg, 'malformed_payment_signature')
  }

  const requirements = buildReqs(cfg)
  const verdict = await facilitator.verify(requirements, payload, cfg.now)
  if (!verdict.isValid) return challenge(cfg, verdict.invalidReason ?? 'verification_failed')

  return { paid: true, payload, payer: verdict.payer, holdId: verdict.holdId, requirements }
}

/** Convenience for reading the header off a Fetch/Next `Request` (case-insensitive). */
export function readPaymentSignature(req: { headers: Headers }): string | null {
  return req.headers.get(PAYMENT_SIGNATURE_HEADER) ?? req.headers.get('PAYMENT-SIGNATURE')
}
