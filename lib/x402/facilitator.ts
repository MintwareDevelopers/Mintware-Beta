import type { PaymentRequirements, PaymentPayload, VerifyResult, SettleResult } from './types'

export interface Facilitator {
  verify(reqs: PaymentRequirements, payload: PaymentPayload, now: number): Promise<VerifyResult>
  settle(reqs: PaymentRequirements, payload: PaymentPayload): Promise<SettleResult>
  supported(): Promise<{ schemes: string[]; networks: string[] }>
}

export interface Settler {
  settle(input: { payload: PaymentPayload; reqs: PaymentRequirements }): Promise<{ success: boolean; txHash?: string; errorReason?: string }>
}
