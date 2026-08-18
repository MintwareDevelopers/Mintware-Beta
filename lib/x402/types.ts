// x402 protocol types (v2-aligned) — the shapes exchanged over HTTP `402` for agent compute payments.
// Spec: docs/developers/agentkit-compute-402-spec.md. Kept dependency-free so both the seller middleware
// (Next.js) and the AgentKit client can import them.

export type X402Scheme = 'exact' | 'deferred'

/** What a seller advertises in the `402` response — one acceptable way to pay. Amounts are ATOMIC units
 *  (USDC = 6dp) as decimal strings, never floats. */
export interface PaymentRequirements {
  scheme: X402Scheme
  network: string // 'base' | 'base-sepolia' | 'arc' | …
  /** Max the seller will charge, atomic units. */
  maxAmountRequired: string
  /** ERC-20 the payment settles in (USDC contract on `network`). */
  asset: string
  /** Recipient of the settlement. */
  payTo: string
  /** The protected resource (URL or stable id) this payment is bound to. */
  resource: string
  description?: string
  mimeType?: string
  maxTimeoutSeconds?: number
  /** Anti-replay: unique per challenge. */
  nonce: string
  /** Unix seconds; a payload presented after this is rejected. */
  validUntil: number
  extra?: Record<string, unknown>
}

/** The `402` body / `PAYMENT-REQUIRED` header payload: the version + the list of acceptable requirements. */
export interface PaymentRequiredResponse {
  x402Version: number
  accepts: PaymentRequirements[]
  error?: string
}

/** EIP-3009 `transferWithAuthorization` fields — the `exact`-scheme EVM payload for USDC. */
export interface Eip3009Authorization {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
}

/** What the client sends back in `PAYMENT-SIGNATURE` (base64 of this JSON). */
export interface PaymentPayload {
  x402Version: number
  scheme: X402Scheme
  network: string
  payload: {
    signature: string
    authorization: Eip3009Authorization
  }
}

/** Facilitator `/verify` result. */
export interface VerifyResult {
  isValid: boolean
  invalidReason?: string
  /** Recovered payer address when valid. */
  payer?: string
  /** Deferred scheme: the hold id reserved against the payer's YPN NAV (settle references it). */
  holdId?: string
  /** Max the facilitator will honor at settle (fee-net realizable), atomic units. */
  maxSettleable?: string
}

/** Facilitator `/settle` result. */
export interface SettleResult {
  success: boolean
  txHash?: string
  network?: string
  errorReason?: string
}

export const X402_VERSION = 2
export const PAYMENT_REQUIRED_HEADER = 'payment-required'
export const PAYMENT_SIGNATURE_HEADER = 'payment-signature'
