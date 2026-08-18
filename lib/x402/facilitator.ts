// x402 facilitator (P3) — the `verify` / `settle` split, backed by YPN. `verify` places a HOLD against the
// payer's live vault NAV (edge-auth `POST /authorize`); `settle` submits on-chain (relayer). Because verify is
// a hold against a *productive* vault, the payer's USDC keeps earning until settlement — the moat.
// Spec: docs/developers/agentkit-compute-402-spec.md §4/§6.2. The concrete transports are injected so this
// module is unit-testable with no network and no coupling to the Rust services' exact structs.

import { PaymentRequirements, PaymentPayload, VerifyResult, SettleResult } from './types'
import { checkPayloadAgainst } from './protocol'
import { policyForPercentile } from './pricing'

export interface Facilitator {
  verify(reqs: PaymentRequirements, payload: PaymentPayload, now: number): Promise<VerifyResult>
  settle(reqs: PaymentRequirements, payload: PaymentPayload, holdId?: string): Promise<SettleResult>
  supported(): Promise<{ schemes: string[]; networks: string[] }>
}

/** Edge-auth authorization port — mapped onto `POST /authorize` by the HTTP impl, mocked in tests. */
export interface EdgeAuthorizer {
  authorize(input: {
    payer: string
    amountAtomic: string
    ref: string // the x402 nonce/resource — idempotency + audit
  }): Promise<{ approved: boolean; holdId?: string; holdAtomic?: string; reason?: string }>
}

/** On-chain settlement port — mapped onto the relayer, mocked in tests. */
export interface Settler {
  settle(input: {
    holdId?: string
    payload: PaymentPayload
    reqs: PaymentRequirements
  }): Promise<{ success: boolean; txHash?: string; errorReason?: string }>
}

/** OPTIONAL trust port — a payer signal in [0,100] used only to tier the hold size. The signal can be
 *  anything (deposit tenure, parked size, staking) — Attribution is ONE possible source, NOT a dependency.
 *  Omit it entirely and the facilitator authorizes purely on live NAV. */
export interface TrustSource {
  percentileOf(address: string): Promise<number>
}

export interface YpnFacilitatorConfig {
  edge: EdgeAuthorizer
  settler: Settler
  /** Optional — omit to authorize purely on NAV (no trust gating). */
  trust?: TrustSource
  supportedNetworks: string[]
}

/** The YPN-backed facilitator. verify = reputation-gated NAV hold; settle = relayer submit. */
export class YpnFacilitator implements Facilitator {
  constructor(private readonly cfg: YpnFacilitatorConfig) {}

  async verify(reqs: PaymentRequirements, payload: PaymentPayload, now: number): Promise<VerifyResult> {
    // 1) cheap structural pre-filter (scheme/network/recipient/amount/window).
    const pre = checkPayloadAgainst(reqs, payload, now)
    if (!pre.ok) return { isValid: false, invalidReason: pre.reason }

    if (!this.cfg.supportedNetworks.includes(reqs.network)) {
      return { isValid: false, invalidReason: 'unsupported_network' }
    }

    const payer = payload.payload.authorization.from
    const requested = BigInt(payload.payload.authorization.value)

    // 2) OPTIONAL trust-gate the hold size (fraction of headroom the facilitator will authorize). Skipped
    //    entirely when no trust source is configured — the default path is pure NAV authorization.
    let cap = requested
    if (this.cfg.trust) {
      const pct = await this.cfg.trust.percentileOf(payer)
      const policy = policyForPercentile(pct)
      // Scale the requested amount by the tier's headroom fraction (integer math, /100).
      const frac = BigInt(Math.round(policy.navHeadroomFraction * 100))
      cap = (requested * frac) / 100n
      if (cap < requested) {
        // The payer's tier won't authorize the full ask up front.
        return { isValid: false, invalidReason: 'exceeds_trust_cap', payer, maxSettleable: cap.toString() }
      }
    }

    // 3) place the hold against live NAV via edge-auth.
    const res = await this.cfg.edge.authorize({
      payer,
      amountAtomic: requested.toString(),
      ref: reqs.nonce,
    })
    if (!res.approved) {
      return { isValid: false, invalidReason: res.reason ?? 'insufficient_equity', payer }
    }
    return {
      isValid: true,
      payer,
      holdId: res.holdId,
      maxSettleable: res.holdAtomic ?? requested.toString(),
    }
  }

  async settle(reqs: PaymentRequirements, payload: PaymentPayload, holdId?: string): Promise<SettleResult> {
    const res = await this.cfg.settler.settle({ holdId, payload, reqs })
    return { success: res.success, txHash: res.txHash, network: reqs.network, errorReason: res.errorReason }
  }

  async supported() {
    return { schemes: ['exact', 'deferred'], networks: this.cfg.supportedNetworks }
  }
}
