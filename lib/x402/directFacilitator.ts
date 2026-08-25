// Direct x402 facilitator — the STANDARD "exact" scheme with no YPN vault in the loop. `verify` is a pure
// signature + structural check (recipient == payTo, amount, window, valid EIP-3009 signature); there is NO
// NAV hold, because the payer isn't parking capital in a vault — they just pay. `settle` submits the signed
// transfer straight to the seller's wallet (lib/x402/directSettler.ts). This is the safer/simpler model when
// the seller only wants the fee; the vault-backed YpnFacilitator (edge-auth hold → settleSpend) is the
// separate "payer's capital keeps earning" product. Select with X402_SETTLE_PROVIDER=direct.

import { PaymentRequirements, PaymentPayload, VerifyResult, SettleResult } from './types'
import { checkPayloadAgainst } from './protocol'
import { verifyEip3009Authorization } from './verifyAuthorization'
import { Facilitator, Settler } from './facilitator'

export class DirectFacilitator implements Facilitator {
  constructor(private readonly cfg: { supportedNetworks: string[]; settler: Settler }) {}

  async verify(reqs: PaymentRequirements, payload: PaymentPayload, now: number): Promise<VerifyResult> {
    const pre = checkPayloadAgainst(reqs, payload, now)
    if (!pre.ok) return { isValid: false, invalidReason: pre.reason }
    if (!this.cfg.supportedNetworks.includes(reqs.network)) {
      return { isValid: false, invalidReason: 'unsupported_network' }
    }
    const auth = payload.payload.authorization
    const sigOk = await verifyEip3009Authorization({
      network: reqs.network,
      asset: reqs.asset,
      authorization: auth,
      signature: payload.payload.signature,
    })
    if (!sigOk) return { isValid: false, invalidReason: 'invalid_payment_signature', payer: auth.from }
    // No NAV hold in the direct model — the signed transfer IS the authorization. maxSettleable = the signed amount.
    return { isValid: true, payer: auth.from, maxSettleable: auth.value }
  }

  async settle(reqs: PaymentRequirements, payload: PaymentPayload): Promise<SettleResult> {
    // permit/edge are ignored in the direct model (no DelegatedSpendPermit / settleSpend).
    const res = await this.cfg.settler.settle({ payload, reqs })
    return { success: res.success, txHash: res.txHash, network: reqs.network, errorReason: res.errorReason }
  }

  async supported() {
    return { schemes: ['exact'], networks: this.cfg.supportedNetworks }
  }
}
